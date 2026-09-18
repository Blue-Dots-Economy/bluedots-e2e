import { Client } from 'pg';

/**
 * The organisations the NETWORK holds.
 *
 * A coordinator's approval is the only step in the aggregator flow that
 * crosses into signals: it calls `upsertAggregator`, which writes an
 * organisation there whose slug is the coordinator's. Nothing on the
 * aggregator's side can tell you whether that landed -- its own record says
 * `active` either way -- and signals exposes no read for it, so this is the
 * write model.
 *
 * The slug is load-bearing beyond this assertion: signals resolves a
 * client-credentials caller to an organisation BY it, so a coordinator
 * without one here can authenticate and act for nobody.
 */
export type NetworkOrgs = {
  findBySlug: (slug: string) => Promise<{ id: string; name: string } | null>;
};

export function createNetworkOrgs(cfg: { postgresUrl: string }): NetworkOrgs & {
  close: () => Promise<void>;
} {
  const pg = new Client({ connectionString: cfg.postgresUrl });
  let connected = false;

  return {
    async findBySlug(slug) {
      if (!connected) {
        await pg.connect();
        connected = true;
      }
      const { rows } = await pg.query<{ id: string; name: string }>(
        'SELECT id, name FROM "organization" WHERE slug = $1 LIMIT 1',
        [slug],
      );
      return rows[0] ?? null;
    },

    async close() {
      if (connected) await pg.end();
    },
  };
}
