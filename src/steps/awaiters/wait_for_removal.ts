import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

/**
 * Wait until the item has been REMOVED from the read model.
 *
 * The mirror of waitUntilThisItemIndexed, and it exists because that one is
 * the wrong question after a retire. Retire publishes `delete` where every
 * other transition publishes `upsert`, so signals-search removes the row
 * rather than writing one -- and an awaiter that waits for `indexed_at` to
 * appear waits for something that is correctly never going to happen. J4
 * failed for exactly that reason on its first run: 30 seconds of waiting
 * for a row the system had just been asked to delete.
 *
 * The stream conditions still apply. "The row is gone" alone would pass
 * against a row that was never written, so this also requires the stream to
 * have advanced past the baseline taken before the transition.
 */
export const waitUntilThisItemRemoved = () =>
  step({
    label: 'Waited until the profile was removed from search',
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const probe = requireContext(ctx.probe, 'ingest probe');
      const key = requireState(state, 'itemKey');
      const baseline = requireState(state, 'baseline');

      const deadlineMs = 30_000;
      const started = Date.now();
      let last = 'no reading taken';

      while (Date.now() - started < deadlineMs) {
        const dlq = await probe.dlqLength();
        if (dlq === null) {
          last = 'dead-letter stream could not be read';
        } else if (dlq > baseline.dlqLength) {
          throw new Error(
            `INGEST_DEAD_LETTER: dead-letter stream grew from ${baseline.dlqLength} to ${dlq} ` +
              `while waiting for the removal`,
          );
        } else {
          const streamId = await probe.lastStreamId();
          if (streamId === baseline.lastStreamId) {
            last = `stream did not advance past ${baseline.lastStreamId}`;
          } else if ((await probe.indexedAt(key)) !== null) {
            last = 'the row is still in item_search';
          } else {
            return;
          }
        }
        await new Promise<void>((r) => setTimeout(r, 250));
      }

      throw new Error(
        `INGEST_REMOVAL_NOT_CONFIRMED after ${deadlineMs}ms: ${last} ` +
          `(${key.network}/${key.domain}/${key.id}). A retire publishes a delete event; ` +
          `if the row survives, the index is holding data the person asked to have erased.`,
      );
    },
  });
