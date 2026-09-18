import { defineJourney } from '../../src/journey/define_journey.js';
import {
  acceptTerms,
  applyTo,
  createProfileAsSelf,
  expectContactDetailsHidden,
  respondToRequest,
  signIn,
  signUp,
} from '../../src/steps/index.js';

/**
 * `L2`. Saying no has to mean no.
 *
 * The mirror of L1's last two steps, and the half nothing covered: every
 * connection journey so far ends in an acceptance. A reject that revealed
 * contact details anyway would be a disclosure to someone the other person
 * explicitly refused -- worse than the pending case J18 pins, because here
 * an answer was given.
 *
 * Asserted on the same concrete 403 as J18 rather than on absence. A reveal
 * route that had simply broken would satisfy "no details came back" for
 * every status equally.
 */
export const aRejectedRequestRevealsNothing = {
  ...defineJourney({
    id: 'L2',
    title: 'A rejected request reveals nothing to the person who asked',
    capability: 'consent-and-data-disclosure',
    targets: ['blue_dot/ka-dhwd'],
    steps: [
      signUp({ as: 'provider' }),
      signIn({ as: 'provider' }),
      acceptTerms({ as: 'provider' }),
      createProfileAsSelf({ as: 'provider' }),

      signUp({ as: 'seeker' }),
      signIn({ as: 'seeker' }),
      acceptTerms({ as: 'seeker' }),
      createProfileAsSelf({ as: 'seeker' }),

      applyTo({ action: 'apply', from: 'seeker', to: 'provider' }),
      respondToRequest({ as: 'provider', status: 'rejected' }),
      expectContactDetailsHidden({ as: 'seeker' }),
    ],
  }),
  requires: ['http', 'postgres'] as const,
};
