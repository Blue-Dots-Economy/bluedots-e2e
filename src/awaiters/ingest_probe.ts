import Redis from 'ioredis';
import { Client } from 'pg';
import type { IngestProbe, ItemKey } from './ingest.js';

export type ProbeConfig = {
  redisUrl: string;
  postgresUrl: string;
  /** Defaults match signals-dpg and signals-search's own defaults. */
  stream?: string;
  group?: string;
  dlqStream?: string;
};

/**
 * A probe backed by the real Redis stream and the real read model.
 *
 * Requires the `redis` and `postgres` capabilities. An environment offering
 * only `http` cannot construct one, which is what makes a journey needing it
 * report NOT COVERED there instead of quietly asserting something weaker.
 */
export function createIngestProbe(cfg: ProbeConfig): IngestProbe & {
  close: () => Promise<void>;
} {
  const stream = cfg.stream ?? 'signals:item-events';
  const group = cfg.group ?? 'signals-search';
  const dlq = cfg.dlqStream ?? `${stream}:dlq`;

  const redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: 3 });
  const pg = new Client({ connectionString: cfg.postgresUrl });
  let connected = false;
  const pgReady = async () => {
    if (!connected) {
      await pg.connect();
      connected = true;
    }
    return pg;
  };

  return {
    async lastStreamId() {
      const info = (await redis.xinfo('STREAM', stream).catch(() => null)) as
        | unknown[]
        | null;
      if (!info) return '0-0';
      const i = info.findIndex((f) => f === 'last-generated-id');
      return i >= 0 ? String(info[i + 1]) : '0-0';
    },

    async dlqLength() {
      // null, never 0: 0 is what a clean dead-letter stream reads, and the
      // awaiter gates on it. An unreadable probe must not look clean.
      return redis.xlen(dlq).catch(() => null);
    },

    async groupLastDeliveredId() {
      const groups = (await redis
        .xinfo('GROUPS', stream)
        .catch(() => null)) as unknown[][] | null;
      if (!groups) return null;
      for (const g of groups) {
        const name = g[g.indexOf('name') + 1];
        if (name !== group) continue;
        const i = g.indexOf('last-delivered-id');
        // null rather than a guess: an unreadable position must not be
        // mistaken for "caught up".
        return i >= 0 ? String(g[i + 1]) : null;
      }
      return null;
    },

    async pendingCount() {
      const res = (await redis
        .xpending(stream, group)
        .catch(() => null)) as unknown[] | null;
      // null, never 0, for the same reason as dlqLength.
      return res ? Number(res[0] ?? 0) : null;
    },

    async indexedAt(key: ItemKey) {
      const client = await pgReady();
      const { rows } = await client.query<{ indexed_at: string | null }>(
        `SELECT indexed_at FROM item_search
          WHERE item_network = $1 AND item_domain = $2
            AND item_type = $3 AND item_id = $4
          LIMIT 1`,
        [key.network, key.domain, key.type, key.id],
      );
      return rows[0]?.indexed_at ?? null;
    },

    async close() {
      redis.disconnect();
      if (connected) await pg.end();
    },
  };
}
