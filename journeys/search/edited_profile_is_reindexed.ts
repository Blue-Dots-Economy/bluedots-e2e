import { defineJourney } from '../../src/journey/define_journey.js';
import {
  createProfile,
  editProfile,
  expectFoundInSearch,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

/**
 * `J5`. An edit that reaches the row and not the index leaves search
 * answering with the old value indefinitely -- no error, no failed request,
 * just a stale answer that looks like a cache nobody can find.
 *
 * The edited field carries a new seed-distinct value, so the assertion can
 * tell "the index moved" from "the index still holds what it held".
 */
export const editedProfileIsReindexed = {
  ...defineJourney({
    id: 'J5',
    title: 'An edited profile is findable by its new details',
    capability: 'search-and-discovery',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      waitUntilThisItemIndexed(),
      editProfile({ as: 'seeker' }),
      waitUntilThisItemIndexed(),
      expectFoundInSearch(),
    ],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
