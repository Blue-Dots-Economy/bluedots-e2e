import { defineJourney } from '../../src/journey/journey.js';
import {
  createProfile,
  expectFoundInSearch,
  waitUntilThisItemIndexed,
} from '../../src/steps/j2_steps.js';

export const J2 = defineJourney({
  id: 'J2',
  title: 'A new profile becomes findable in search',
  capability: 'search-and-discovery',
  targets: ['purple_dot', 'blue_dot/ka-dhwd'],
  steps: [createProfile({ as: 'seeker' }), waitUntilThisItemIndexed(), expectFoundInSearch()],
});
