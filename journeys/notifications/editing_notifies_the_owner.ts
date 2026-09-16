import { defineJourney } from '../../src/journey/define_journey.js';
import {
  createProfile,
  editProfile,
  expectNotificationQueued,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

/**
 * `J13`. Someone editing their own profile expects to hear that it
 * changed -- it is the only confirmation they get that the edit took. A
 * different case id (`profile.update`) down the same pipeline as J11 and
 * J12, which is what stops one working case standing in for all of them.
 */
export const editingNotifiesTheOwner = {
  ...defineJourney({
    id: 'J13',
    title: 'Editing a profile tells its owner',
    capability: 'notifications',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      waitUntilThisItemIndexed(),
      editProfile({ as: 'seeker' }),
      expectNotificationQueued({
        forProfileAs: 'seeker',
        about: 'their profile being updated',
        templateIdIncludes: 'update',
      }),
    ],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
