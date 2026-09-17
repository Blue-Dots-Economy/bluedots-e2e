import { defineJourney } from '../../src/journey/define_journey.js';
import {
  createProfile,
  expectFoundInDiscover,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

/**
 * `J7`. Filtering is how anyone finds one person among thousands, and a
 * dropped filter is invisible: the BFF drops a filter on an undeclared or
 * private field rather than erroring, so the feed answers 200 with
 * everything and looks like it worked.
 *
 * The step therefore asserts both directions -- the filter returns this
 * profile, and a filter on a value nothing has returns it to nobody.
 */
export const browseFeedHonoursAFilter = {
  ...defineJourney({
    id: 'J7',
    title: 'The browse feed honours a filter on a declared field',
    capability: 'search-and-discovery',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      waitUntilThisItemIndexed(),
      expectFoundInDiscover({ byFacet: true }),
    ],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
