import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

/**
 * The network knows the coordinator, which is the point of approving one.
 *
 * The only step in the whole aggregator flow that crosses into signals, and
 * the reason this journey belongs in this suite rather than in
 * aggregator-dpg's own. Approval calls `upsertAggregator`; when that push is
 * misconfigured the writer is null, the failure is a warn-level log line,
 * and the aggregator's own record still reads `active`. Every assertion on
 * the aggregator side therefore passes over an empty result.
 *
 * Checked by SLUG rather than by name because the slug is what signals
 * resolves a client-credentials caller by: a coordinator whose organisation
 * carries the wrong one can authenticate and act for nobody.
 */
export const expectKnownToNetwork = () =>
  step({
    label: 'The network has an organisation for that coordinator',
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const networkOrgs = requireContext(ctx.networkOrgs, 'the network read model');
      const coordinator = requireState(state, 'coordinator');

      if (!coordinator.slug) {
        throw new Error(
          `STEP_FAILED: the registration returned no slug, so there is nothing to look the ` +
            `network organisation up by -- and signals resolves a service caller by exactly ` +
            `that slug.`,
        );
      }

      const org = await networkOrgs.findBySlug(coordinator.slug);
      if (!org) {
        throw new Error(
          `STEP_FAILED: the network holds no organisation with slug "${coordinator.slug}", so ` +
            `the approval registered nobody. The aggregator's own record reads active either ` +
            `way: an incomplete bearer config disables that push with only a warn-level log.`,
        );
      }
    },
  });
