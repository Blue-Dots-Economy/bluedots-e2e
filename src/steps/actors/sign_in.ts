import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

/**
 * The person signs in, which is also when signals first hears of them.
 *
 * Signing up creates a Keycloak identity and nothing local: the `user` row
 * appears at FIRST LOGIN, keyed on the Keycloak subject. So this is not
 * plumbing before the interesting part -- until it succeeds the person
 * cannot be the subject of anything, and every later step in the journey
 * depends on the row it creates.
 */
export const signIn = (spec: { as: string }) =>
  step({
    label: `The ${spec.as.replace(/_/g, ' ')} signed in for the first time`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const signInToSignals = requireContext(ctx.signInToSignals, 'a way to sign in');
      const signedUp = requireState(state, 'signups')[spec.as];
      if (!signedUp) {
        throw new Error(
          `STEP_FAILED: nobody signed up as a "${spec.as}", so there is no identity to sign ` +
            `in with.`,
        );
      }

      const session = await signInToSignals(signedUp.email);
      state.session = session;
      state.sessions = { ...state.sessions, [spec.as]: session };
    },
  });
