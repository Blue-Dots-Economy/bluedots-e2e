import { defineJourney } from '../../src/journey/define_journey.js';
import { createProfile, expectSameParticipant } from '../../src/steps/index.js';

/**
 * `J9`. Somebody can be a seeker and a provider at once, and the second
 * profile has to land on the account that already exists rather than on a
 * new one. The failure is silent in the same way as J8, and it is the shape
 * that breaks a dashboard weeks later when one person's work is spread over
 * two accounts.
 */
export const secondProfileJoinsTheSamePerson = {
  ...defineJourney({
    id: 'J9',
    title: 'A second profile joins the person who already exists',
    capability: 'participant-onboarding',
    targets: ['blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      createProfile({ as: 'provider', asParticipantOf: 'seeker' }),
      expectSameParticipant({ alsoOwnsProfilesIn: ['seeker', 'provider'] }),
    ],
  }),
  requires: ['http'] as const,
};
