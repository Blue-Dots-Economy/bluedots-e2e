export type ItemKey = {
  network: string;
  domain: string;
  type: string;
  id: string;
};

/**
 * Everything the awaiter reads. Injected so the logic is testable without a
 * live Redis and Postgres, and so an environment lacking those capabilities
 * simply cannot construct one (see checkCapabilities).
 */
export type IngestProbe = {
  /** XINFO STREAM -> last-generated-id. */
  lastStreamId: () => Promise<string>;
  /** XLEN of the dead-letter stream. */
  dlqLength: () => Promise<number>;
  /** XINFO GROUPS -> last-delivered-id, or null when it cannot be read. */
  groupLastDeliveredId: () => Promise<string | null>;
  /** XPENDING -> count of un-acknowledged entries. */
  pendingCount: () => Promise<number>;
  /** item_search.indexed_at for this key, or null when absent. */
  indexedAt: (key: ItemKey) => Promise<string | null>;
};

export type Baseline = { lastStreamId: string; dlqLength: number };

/** Read before the action, so "advanced" and "unchanged" have a meaning. */
export async function captureBaseline(probe: IngestProbe): Promise<Baseline> {
  return {
    lastStreamId: await probe.lastStreamId(),
    dlqLength: await probe.dlqLength(),
  };
}

/** Redis ids are `<millis>-<seq>`; compare numerically, not as strings. */
function idAtLeast(a: string, b: string): boolean {
  const [am = 0, as = 0] = a.split('-').map(Number);
  const [bm = 0, bs = 0] = b.split('-').map(Number);
  return am > bm || (am === bm && as >= bs);
}

/**
 * Wait until THIS item was indexed BECAUSE OF an event that crossed the
 * stream.
 *
 * The obvious version of this -- wait for the item to appear in the index --
 * proves the row reached Postgres and nothing more. signals-search runs a
 * reconciliation sweep every 60s that indexes any items row missing from
 * item_search, straight from Postgres, and publish_item_event.ts calls it
 * "the backstop". So a journey built on the obvious version passes with the
 * ingest spine completely dead.
 *
 * Nor is it enough to check stream-level drain. process_event returns early,
 * silently acking, when it cannot find the item row: the stream advances,
 * the group catches up, pending empties, and nothing is indexed.
 *
 * Hence four conditions that have to hold together, and a DLQ check that
 * fails fast rather than waiting for a deadline that would report a timeout
 * for what is really a poisoned event.
 */
export async function awaitItemIndexed(
  probe: IngestProbe,
  opts: {
    key: ItemKey;
    baseline: Baseline;
    deadlineMs: number;
    now?: () => number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<void> {
  const now = opts.now ?? Date.now;
  const pollMs = opts.pollMs ?? 250;
  // Injected so tests do not spend real time, and so the loop always yields
  // rather than spinning the event loop between readings.
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = now();
  let last = 'no reading taken';

  while (now() - started < opts.deadlineMs) {
    // Poison first: a parked event acks on the main group, so lag reaches
    // zero exactly as a success would and the deadline would otherwise
    // expire reporting a timeout.
    const dlq = await probe.dlqLength();
    if (dlq > opts.baseline.dlqLength) {
      throw new Error(
        `INGEST_DEAD_LETTER: dead-letter stream grew from ${opts.baseline.dlqLength} to ${dlq}`,
      );
    }

    const streamId = await probe.lastStreamId();
    if (!idAtLeast(streamId, opts.baseline.lastStreamId) || streamId === opts.baseline.lastStreamId) {
      last = `stream did not advance past ${opts.baseline.lastStreamId}`;
      await sleep(pollMs);
      continue;
    }

    // null, not zero: XINFO GROUPS cannot always report a position, and
    // reading that as "caught up" would make every run pass.
    const delivered = await probe.groupLastDeliveredId();
    if (delivered === null || !idAtLeast(delivered, streamId)) {
      last = `consumer group has not consumed ${streamId} (at ${delivered ?? 'unknown'})`;
      await sleep(pollMs);
      continue;
    }

    const pending = await probe.pendingCount();
    if (pending > 0) {
      last = `${pending} un-acknowledged entries remain`;
      await sleep(pollMs);
      continue;
    }

    const indexed = await probe.indexedAt(opts.key);
    if (!indexed) {
      last = `item was never indexed (${opts.key.network}/${opts.key.domain}/${opts.key.id})`;
      await sleep(pollMs);
      continue;
    }

    return;
  }

  throw new Error(`INGEST_NOT_CONFIRMED after ${opts.deadlineMs}ms: ${last}`);
}
