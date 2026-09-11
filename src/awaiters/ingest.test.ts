import { describe, expect, test } from 'vitest';
import { captureBaseline, awaitItemIndexed, type IngestProbe } from './ingest.js';

/** A probe whose readings can be scripted per call. */
function probeOf(over: Partial<IngestProbe> = {}): IngestProbe {
  return {
    lastStreamId: async () => '1-0',
    dlqLength: async () => 0,
    groupLastDeliveredId: async () => '1-0',
    pendingCount: async () => 0,
    indexedAt: async () => null,
    ...over,
  };
}

const KEY = { network: 'purple_dot', domain: 'seeker', type: 'profile', id: 'i-1' };
/** Advances 5ms per reading, so a deadline is actually reachable. */
const clock = () => {
  let t = 0;
  return () => (t += 5);
};
const NOOP_SLEEP = async () => {};

describe('awaitItemIndexed', () => {
  test('passes when the stream advanced, the group caught up, and the row was indexed', async () => {
    const base = await captureBaseline(probeOf());
    const probe = probeOf({
      lastStreamId: async () => '2-0',
      groupLastDeliveredId: async () => '2-0',
      indexedAt: async () => '2026-09-10T00:00:01Z',
    });

    await expect(
      awaitItemIndexed(probe, { key: KEY, baseline: base, deadlineMs: 100, now: clock(), sleep: NOOP_SLEEP }),
    ).resolves.toBeUndefined();
  });

  test('fails when the publish never happened, rather than reporting drained', async () => {
    // publishItemEvent swallows xadd failures. With no correlation, a lost
    // event looks identical to a fast one: lag is zero because nothing was
    // ever added.
    const base = await captureBaseline(probeOf());
    const probe = probeOf({
      lastStreamId: async () => '1-0', // unchanged
      indexedAt: async () => '2026-09-10T00:00:01Z',
    });

    await expect(
      awaitItemIndexed(probe, { key: KEY, baseline: base, deadlineMs: 10, now: clock(), sleep: NOOP_SLEEP }),
    ).rejects.toThrow(/stream did not advance/i);
  });

  test('fails when the consumer is dead but the sweep indexed the row anyway', async () => {
    // THE case this awaiter exists for. sweep() indexes any items row missing
    // from item_search every 60s straight from Postgres, so "the item is
    // findable" is true whether or not the event ever crossed the stream.
    const base = await captureBaseline(probeOf());
    const probe = probeOf({
      lastStreamId: async () => '2-0',
      groupLastDeliveredId: async () => '1-0', // consumer never advanced
      indexedAt: async () => '2026-09-10T00:00:01Z', // but the sweep did
    });

    await expect(
      awaitItemIndexed(probe, { key: KEY, baseline: base, deadlineMs: 10, now: clock(), sleep: NOOP_SLEEP }),
    ).rejects.toThrow(/consumer group/i);
  });

  test('fails when the event was consumed but nothing was indexed', async () => {
    // process_event returns early -- silently acking -- when it cannot find
    // the item row. Everything at stream level looks perfect.
    const base = await captureBaseline(probeOf());
    const probe = probeOf({
      lastStreamId: async () => '2-0',
      groupLastDeliveredId: async () => '2-0',
      indexedAt: async () => null,
    });

    await expect(
      awaitItemIndexed(probe, { key: KEY, baseline: base, deadlineMs: 10, now: clock(), sleep: NOOP_SLEEP }),
    ).rejects.toThrow(/never indexed/i);
  });

  test('fails immediately when the event was parked in the DLQ', async () => {
    // A poisoned event is acked and parked, so lag reaches zero exactly as a
    // success would. Without this the run reports a timeout instead.
    const base = await captureBaseline(probeOf());
    const probe = probeOf({
      lastStreamId: async () => '2-0',
      dlqLength: async () => 1,
    });

    await expect(
      awaitItemIndexed(probe, { key: KEY, baseline: base, deadlineMs: 10_000, now: clock(), sleep: NOOP_SLEEP }),
    ).rejects.toThrow(/dead-letter/i);
  });

  test('treats a null lag as not drained', async () => {
    // XINFO GROUPS reports lag as null once trimming loses the group
    // position. Reading null as zero would make every run pass.
    const base = await captureBaseline(probeOf());
    const probe = probeOf({
      lastStreamId: async () => '2-0',
      groupLastDeliveredId: async () => null,
      indexedAt: async () => '2026-09-10T00:00:01Z',
    });

    await expect(
      awaitItemIndexed(probe, { key: KEY, baseline: base, deadlineMs: 10, now: clock(), sleep: NOOP_SLEEP }),
    ).rejects.toThrow(/consumer group/i);
  });

  test('fails when entries are still un-acked, which is what catches a processing error', async () => {
    // Processing failures sit un-acked and only reach the DLQ after
    // INGEST_MAX_DELIVERIES redeliveries gated on PEL_MIN_IDLE_MS -- minutes
    // away. XPENDING is what actually catches them inside a run.
    const base = await captureBaseline(probeOf());
    const probe = probeOf({
      lastStreamId: async () => '2-0',
      groupLastDeliveredId: async () => '2-0',
      pendingCount: async () => 1,
      indexedAt: async () => '2026-09-10T00:00:01Z',
    });

    await expect(
      awaitItemIndexed(probe, { key: KEY, baseline: base, deadlineMs: 10, now: clock(), sleep: NOOP_SLEEP }),
    ).rejects.toThrow(/un-acknowledged/i);
  });

  test('never sleeps: it polls against an injected clock', async () => {
    let t = 0;
    const now = () => (t += 5);
    const base = await captureBaseline(probeOf());

    await expect(
      awaitItemIndexed(probeOf(), {
        key: KEY, baseline: base, deadlineMs: 20, now, sleep: NOOP_SLEEP,
      }),
    ).rejects.toThrow();

    expect(t).toBeGreaterThan(0);
  });
});

describe('a probe that cannot read', () => {
  test('keeps waiting rather than passing when the pending count is unknown', async () => {
    // pendingCount degraded to 0 on error, which is the PASSING value for
    // its gate -- so a broken probe satisfied one of the four conditions
    // the design says have to hold together. Its siblings get this right:
    // lastStreamId and groupLastDeliveredId both degrade toward failure.
    const base = await captureBaseline(probeOf());
    const probe = probeOf({
      lastStreamId: async () => '2-0',
      groupLastDeliveredId: async () => '2-0',
      indexedAt: async () => '2026-09-10T00:00:01Z',
      pendingCount: async () => null,
    });

    await expect(
      awaitItemIndexed(probe, { key: KEY, baseline: base, deadlineMs: 10, now: clock(), sleep: NOOP_SLEEP }),
    ).rejects.toThrow(/pending/i);
  });

  test('keeps waiting rather than passing when the dead-letter length is unknown', async () => {
    const base = await captureBaseline(probeOf());
    const probe = probeOf({
      lastStreamId: async () => '2-0',
      groupLastDeliveredId: async () => '2-0',
      indexedAt: async () => '2026-09-10T00:00:01Z',
      dlqLength: async () => null,
    });

    await expect(
      awaitItemIndexed(probe, { key: KEY, baseline: base, deadlineMs: 10, now: clock(), sleep: NOOP_SLEEP }),
    ).rejects.toThrow(/dead-letter/i);
  });

  test('refuses a baseline it could not read, rather than assuming zero', async () => {
    // A blip during captureBaseline recorded dlqLength 0 against a real
    // length of 5, and every later read then threw a spurious
    // INGEST_DEAD_LETTER.
    await expect(captureBaseline(probeOf({ dlqLength: async () => null }))).rejects.toThrow(
      /baseline/i,
    );
  });
});
