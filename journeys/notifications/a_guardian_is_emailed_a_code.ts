import { defineJourney } from '../../src/journey/define_journey.js';
import {
  expectEmailDelivered,
  logIn,
  nameAGuardian,
  recordAge,
  signUp,
} from '../../src/steps/index.js';

/**
 * `J22`. A minor's account waits on their guardian, so the guardian's code
 * is the one message that, lost, locks a child out with nothing to say why.
 *
 * The guardian has an email address and no phone, so the guardian policy
 * can only choose email and nothing can leave as a text message. The code
 * is matched by shape and never printed.
 */
export const aGuardianIsEmailedACode = {
  ...defineJourney({
    id: 'J22',
    title: 'A guardian is emailed a code to approve a minor account',
    capability: 'notifications',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      // No age at signup: one recorded age can never be changed.
      signUp({ as: 'seeker', age: null }),
      logIn(),
      recordAge({ age: 15 }),
      nameAGuardian(),
      expectEmailDelivered({
        to: { guardian: true },
        about: 'a 6-digit code to approve the account',
        subjectIncludes: "Approve your ward's account",
        bodyIncludes: ['Journey Guardian'],
        bodyMatches: /\b\d{6}\b/,
        recordedAs: 'guardian.otp.account',
        recordedDomain: null,
      }),
    ],
  }),
  // postgres: acting as the person needs an api key bound to their user
  // row; mail: the login code and the assertion are read from Mailpit.
  requires: ['http', 'postgres', 'mail'] as const,
};
