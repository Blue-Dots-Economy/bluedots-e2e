import type { StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

/**
 * The signed-up person, and an api key that authenticates as them.
 *
 * Only after their first login: signals-dpg creates the local user row
 * there, and a key can only be bound to a row that exists.
 */
export async function actingAsSignedUp(ctx: StepContext): Promise<{
  email: string;
  apiKey: string;
}> {
  const state = ctx.state as JourneyState;
  const signedUp = requireState(state, 'signedUp');
  if (!signedUp.userId) {
    throw new Error(
      'STEP_FAILED: this step acts as the person who signed up, and they have not logged ' +
        'in yet. logIn creates the user it acts as.',
    );
  }
  const keys = requireContext(ctx.keys, 'participant credentials');
  return {
    email: signedUp.email,
    apiKey: await keys.issueFor(signedUp.userId, `self-${signedUp.domain}`),
  };
}
