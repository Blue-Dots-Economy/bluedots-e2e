import { defineJourney } from '../../src/journey/define_journey.js';
import {
  changeLifecycle,
  createProfile,
  expectNotificationQueued,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

/**
 * `J12`. A lifecycle change is something the owner needs to be told about
 * -- it is how they learn their profile stopped being visible, whether or
 * not they were the one who paused it.
 *
 * A different case id from J11 through the same pipeline, which is what
 * makes the pair worth having: J11 alone would pass with every case but
 * `account.aggregator_init` broken.
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
      expectNotificationQueued({
        forProfileAs: 'seeker',
        about: 'their profile being paused',
        templateIdIncludes: 'pause',
      }),
    ],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
