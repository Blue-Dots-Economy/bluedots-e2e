import { defineJourney } from '../../src/journey/journey.js';
import {
  createProfile,
  expectFoundInSearch,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

export const J2 = {
  ...defineJourney({
    id: 'J2',
    title: 'A new profile becomes findable in search',
    capability: 'search-and-discovery',
    targets: ['purple_dot', 'blue_dot/ka-dhwd'],
    steps: [createProfile({ as: 'seeker' }), waitUntilThisItemIndexed(), expectFoundInSearch()],
  }),
  // The correlation check reads the ingest stream and the read model
  // directly. Without them this journey degrades to "the item became
  // findable", which the reconciliation sweep satisfies on its own -- so in
  // an http-only environment it is reported NOT COVERED instead.
  requires: ['http', 'redis', 'postgres'] as const,
};
