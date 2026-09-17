import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import { awaitItemIndexed } from '../../awaiters/ingest.js';

/**
 * Wait until this item was indexed BECAUSE the event crossed the stream.
 *
 * Not "wait until it appears": the reconciliation sweep would satisfy that
 * with the ingest spine dead.
 */
export const waitUntilThisItemIndexed = (deadlineMs = 30_000) =>
  step({
    label: 'Waited until the new profile was picked up for search',
    run: async (ctx: StepContext) => {
      const probe = requireContext(ctx.probe, 'ingest probe');
      await awaitItemIndexed(probe, {
        key: requireState(ctx.state, 'itemKey'),
        baseline: requireState(ctx.state, 'baseline'),
        deadlineMs,
      });
    },
  });
