import { defineJourney } from '../../src/journey/define_journey.js';
import {
  changeLifecycle,
  createProfile,
  expectNotFoundInSearch,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

/**
 * `J3`. Pausing is how someone voluntarily hides a profile they are not
 * ready to be contacted about, so a pause that does not reach the index
 * keeps them discoverable after they asked not to be.
 *
 * The transition publishes its own item event and signals-search is
 * live-only on every read path, so this asserts the index moved rather than
 * that the row did -- the second awaiter run is against the pause, not the
 * create.
 */
export const pausedProfileLeavesSearch = {
  ...defineJourney({
    id: 'J3',
    title: 'A paused profile stops being findable',
    capability: 'search-and-discovery',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      waitUntilThisItemIndexed(),
      changeLifecycle({ to: 'paused' }),
      waitUntilThisItemIndexed(),
      expectNotFoundInSearch({ because: 'it is paused' }),
    ],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
