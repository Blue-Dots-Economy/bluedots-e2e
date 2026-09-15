import { defineJourney } from '../../src/journey/define_journey.js';
import {
  changeLifecycle,
  createProfile,
  expectLifecycleStatus,
  expectNotFoundInSearch,
  waitUntilThisItemIndexed,
  waitUntilThisItemRemoved,
} from '../../src/steps/index.js';

/**
 * `J4`. Retire is terminal and destructive: it scrubs PII from item_state,
 * clears the encrypted blob, wipes locations, cancels open connections and
 * publishes a `delete`. A retire that reaches the database and not the
 * index leaves a searchable copy of data the person asked to have removed,
 * which is the worst failure in this list and the one neither service can
 * see alone.
 */
export const retiredProfileLeavesSearch = {
  ...defineJourney({
    id: 'J4',
    title: 'A retired profile is removed from search',
    capability: 'search-and-discovery',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      waitUntilThisItemIndexed(),
      changeLifecycle({ to: 'retired' }),
      // Removed, not indexed: retire publishes `delete`, so waiting for the
      // row to appear waits for something that must never happen.
      waitUntilThisItemRemoved(),
      expectNotFoundInSearch({ because: 'it is retired' }),
      expectLifecycleStatus({ is: 'retired', because: 'retire is terminal' }),
    ],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
