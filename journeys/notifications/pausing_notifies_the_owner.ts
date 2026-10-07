import { defineJourney } from '../../src/journey/define_journey.js';
import {
  changeLifecycle,
  createProfile,
  expectEmailDelivered,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

/**
 * `J12`. A lifecycle change is something the owner needs to be told about
 * -- it is how they learn their profile stopped being visible, whether or
 * not they were the one who paused it.
 *
 * A different event from J11 through the same pipeline, which is what
 * makes the pair worth having: J11 alone would pass with every event but
 * the onboarding one broken. Asserted as a delivered email; "paused" is in
 * the subject and body of every target's copy.
 */
export const pausingNotifiesTheOwner = {
  ...defineJourney({
    id: 'J12',
    title: 'Pausing a profile tells its owner',
    capability: 'notifications',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      waitUntilThisItemIndexed(),
      changeLifecycle({ to: 'paused' }),
      expectEmailDelivered({
        to: { profile: 'seeker' },
        about: 'their profile being paused',
        subjectIncludes: 'paused',
        recordedAs: 'item.paused',
        recordedDomain: 'seeker',
        bodyIncludes: ['paused', 'http://localhost:5173/'],
      }),
    ],
  }),
  requires: ['http', 'redis', 'postgres', 'mail'] as const,
};
