import { defineJourney } from '../../src/journey/define_journey.js';
import {
  createProfile,
  expectFoundInDiscover,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

/**
 * `J6`. The browse feed is what a person actually sees, and it is a
 * different path from /v1/search: signals-dpg's BFF owns the request,
 * restricts q and facets to declared non-private fields server-side, and
 * falls back to a native distance/recency query when signals-search is
 * unreachable. A profile can therefore be perfectly indexed and still be
 * missing from the only list anyone looks at.
 */
export const profileReachesBrowseFeed = {
  ...defineJourney({
    id: 'J6',
    title: 'A new profile appears in the browse feed',
    capability: 'search-and-discovery',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      waitUntilThisItemIndexed(),
      expectFoundInDiscover(),
    ],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
