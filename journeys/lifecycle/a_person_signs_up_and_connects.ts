import { defineJourney } from '../../src/journey/define_journey.js';
import {
  acceptTerms,
  applyTo,
  createProfileAsSelf,
  expectContactDetailsRevealed,
  respondToRequest,
  signIn,
  signUp,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

/**
 * `L1`. The whole of what a person does, done the way a person does it.
 *
 * Every other journey here reaches signals with a credential somebody
 * issued: a service key, an acting org, or an api-key row this harness
 * minted against a participant. This one uses none of them. Two people sign
 * themselves up, complete the real authorization-code flow, and hold the
 * same opaque session cookie a browser would -- which signals requires,
 * because it refuses a human bearer token however valid it is.
 *
 * Signing in is not setup. The local `user` row appears at FIRST LOGIN,
 * keyed on the Keycloak subject, so until it succeeds neither person exists
 * in signals at all and nothing after it could be attributed to them.
 *
 * The order is the product's, not a convenience: terms before a profile,
 * because the account-level pair is recorded against the person, while the
 * `profile_creation` acceptance the create carries is recorded against the
 * item. Two ledgers, two subjects, and only one of them is what this step
 * is about.
 */
export const aPersonSignsUpAndConnects = {
  ...defineJourney({
    id: 'L1',
    title: 'A person signs up, accepts the terms, creates a profile and connects',
    capability: 'participant-onboarding',
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
      waitUntilThisItemIndexed(),

      applyTo({ action: 'apply', from: 'seeker', to: 'provider' }),
      respondToRequest({ as: 'provider', status: 'accepted' }),
      expectContactDetailsRevealed({ as: 'seeker', of: 'provider' }),
    ],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
