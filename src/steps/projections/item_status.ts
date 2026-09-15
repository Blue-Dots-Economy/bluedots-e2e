import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';

/**
 * Assert what the write model says the profile's status is.
 *
 * Read from Postgres, not from /api/v1/item/fetch. That route is live-only
 * -- it answers 200 with zero items for a draft or a retired profile -- so
 * the two states this exists to distinguish are precisely the two it cannot
 * report. Both J4 and J10 failed against it for that reason, and the
 * message said "not returned at all", which was true and useless.
 *
 * Separate from the search assertions on purpose: "not in search" and "not
 * live" are different claims, and a journey checking only search would pass
 * against an item that never committed.
 */
export const expectLifecycleStatus = (spec: { is: string; because: string }) =>
  step({
    label: `Left the profile ${spec.is}, ${spec.because}`,
    run: async (ctx: StepContext) => {
      const probe = requireContext(ctx.probe, 'a database probe');
      const key = requireState(ctx.state, 'itemKey');

      const status = await probe.lifecycleStatus(key);
      if (status === null) {
        throw new Error(
          `STEP_FAILED: there is no items row for ${key.id} at all, so its status ` +
            `cannot be checked -- the upsert reported it written.`,
        );
      }

      if (status !== spec.is) {
        throw new Error(
          `STEP_FAILED: expected ${key.id} to be ${spec.is} ${spec.because}, it is ${status}.`,
        );
      }
    },
  });
