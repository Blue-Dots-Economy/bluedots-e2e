import { defineJourney } from '../../src/journey/define_journey.js';
import { createProfile, expectSameParticipant } from '../../src/steps/index.js';

/**
 * `J8`. An aggregator onboards the same person more than once as a matter
 * of course -- a re-import, a retry, a second campaign. If the upsert key
 * stops matching, nobody sees an error: both requests return 200, both
 * accounts own items, and the person now exists twice with their profiles
 * split between them.
 *
 * Only visible across two requests, which is why neither service's own
 * tests can hold it.
 */
export const participantIsNotDuplicated = {
  ...defineJourney({
    id: 'J8',
    title: 'Onboarding the same person twice keeps one account',
    capability: 'participant-onboarding',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      expectSameParticipant({ alsoOwnsProfilesIn: ['seeker'] }),
    ],
  }),
  // No index involved: this is entirely about the write model.
  requires: ['http'] as const,
};
