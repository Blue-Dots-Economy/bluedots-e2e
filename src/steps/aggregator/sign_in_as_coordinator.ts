import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

/**
 * The approved coordinator signs in.
 *
 * Every bulk route reads `aggregator_id` and `decision_made` off the
 * caller's token and refuses anything that is not `approved`, so this is
 * also the first end-to-end proof that the approval did what A2 asserts:
 * a token that carries those claims can only exist if the registration
 * wrote them and the approval flipped them.
 *
 * The password is set by the harness because the aggregator never sets one
 * -- a real coordinator signs in by OTP -- but nothing else here is
 * synthetic. Keycloak mints the token, the claims are the product's, and
 * the service checks them exactly as it checks anyone's.
 */
export const signInAsCoordinator = () =>
  step({
    label: 'The approved coordinator signed in',
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const signInAs = requireContext(ctx.signInAs, 'a way to sign in');
      const coordinator = requireState(state, 'coordinator');

      try {
        state.coordinatorToken = await signInAs(coordinator.email);
      } catch (err) {
        throw new Error(
          `STEP_FAILED: ${coordinator.email} could not sign in. Registration creates the user ` +
            `DISABLED and the approval enables them, so this failing after an approval that ` +
            `reported success means the enable did not happen. Cause: ${
              err instanceof Error ? err.message : String(err)
            }`,
        );
      }
    },
  });
