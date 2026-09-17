import { defineJourney } from '../../src/journey/define_journey.js';
import {
  changeLifecycle,
  createProfile,
  expectNotificationQueued,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

/**
 * `J14`. Retire is terminal and destructive, so the one notification that
 * must never be lost is the one saying it happened. Best-effort sending
 * means a broken pipeline erases someone's data and tells them nothing.
 */
export const retiringNotifiesTheOwner = {
  ...defineJourney({
    id: 'J14',
    title: 'Retiring a profile tells its owner',
    capability: 'notifications',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      waitUntilThisItemIndexed(),
      changeLifecycle({ to: 'retired' }),
      expectNotificationQueued({
        forProfileAs: 'seeker',
        about: 'their profile being retired',
        templateIdIncludes: 'retire',
      }),
    ],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
