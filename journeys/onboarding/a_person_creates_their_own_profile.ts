import { defineJourney } from '../../src/journey/define_journey.js';
import {
  createProfileAsSelf,
  expectFoundInSearch,
  registerAccount,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

/**
 * `J17`. Every other profile in this suite is written by an aggregator
 * holding a service key, on somebody's behalf. This is the person doing it
 * themselves, which is the path most participants take and the one nothing
 * here covered: no service key, no acting org, no `created_by` -- the
 * caller owns what they write, and the route refuses `created_by` from
 * anyone who is not an admin api-key caller.
 *
 * The consent carried on the create is what makes it live. Without it the
 * route answers 400 on a domain that gates go-live on consent, and a
 * regression that recorded the acceptance but failed to classify with it
 * would leave the profile draft -- a 201 on the way in and invisible
 * forever after, which is exactly the shape that survives a unit suite.
 */
export const aPersonCreatesTheirOwnProfile = {
  ...defineJourney({
    id: 'J17',
    title: 'A person creates their own profile and it becomes findable',
    capability: 'participant-onboarding',
    targets: ['blue_dot/ka-dhwd', 'purple_dot/alimco'],
    steps: [
      registerAccount({ as: 'seeker' }),
      createProfileAsSelf({ as: 'seeker' }),
      waitUntilThisItemIndexed(),
      expectFoundInSearch(),
    ],
  }),
  // postgres for the credential and the lifecycle read, redis for the
  // correlating awaiter.
  requires: ['http', 'redis', 'postgres'] as const,
};
