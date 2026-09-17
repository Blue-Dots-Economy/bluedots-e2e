import { defineJourney } from '../../src/journey/define_journey.js';
import {
  createProfile,
  editProfile,
  expectFoundInDiscover,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

/**
 * `J15`. J5 proves an edit reaches /v1/search; this proves it reaches the
 * feed people actually read. They are different paths -- the BFF owns its
 * own request and falls back to a native query when signals-search is
 * unreachable -- so an edit can be searchable and still stale on the list.
 */
export const editedProfileReachesBrowseFeed = {
  ...defineJourney({
    id: 'J15',
    title: 'An edited profile appears in the browse feed with its new details',
    capability: 'search-and-discovery',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      waitUntilThisItemIndexed(),
      editProfile({ as: 'seeker' }),
      waitUntilThisItemIndexed(),
      expectFoundInDiscover({ byFacet: true }),
    ],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
