import { defineJourney } from '../../src/journey/define_journey.js';
import {
  createProfile,
  expectFoundInSearch,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

/**
 * `J2` in the epic and the design spec. The id stays as the
 * cross-reference to those documents; the export and the filename say what
 * the journey actually does, because "J2" tells a reader nothing.
 */
export const profileBecomesFindable = {
  ...defineJourney({
    id: 'J2',
    title: 'A new profile becomes findable in search',
    capability: 'search-and-discovery',
    // Instances, not the bare dot: purple_dot gained an alimco instance
    // (bluedots-schemas#34) and listTargets stops offering a dot once it
    // has one, because nothing deploys the dot-level config then. The
    // prepare job caught this as JOURNEY_TARGET_UNKNOWN rather than
    // booting a stack for a target that cannot resolve.
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [createProfile({ as: 'seeker' }), waitUntilThisItemIndexed(), expectFoundInSearch()],
  }),
  // The correlation check reads the ingest stream and the read model
  // directly. Without them this journey degrades to "the item became
  // findable", which the reconciliation sweep satisfies on its own -- so in
  // an http-only environment it is reported NOT COVERED instead.
  requires: ['http', 'redis', 'postgres'] as const,
};
