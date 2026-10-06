import { defineJourney } from '../../src/journey/define_journey.js';
import {
  changeLifecycle,
  createProfile,
  expectEmailDelivered,
  waitUntilThisItemIndexed,
} from '../../src/steps/index.js';

/**
 * `J14`. Retire is terminal and destructive, so the one notification that
 * must never be lost is the one saying it happened. Best-effort sending
 * means a broken pipeline erases someone's data and tells them nothing.
 *
 * Asserted as a delivered email. The copy says "retired" on one target and
 * "deleted" on another, so the subject is matched on what they share.
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
      expectEmailDelivered({
        to: { profile: 'seeker' },
        about: 'their profile being retired',
        subjectIncludes: 'Your profile has been',
        bodyIncludes: ['Create a new profile', 'http://localhost:5173/'],
      }),
    ],
  }),
  requires: ['http', 'redis', 'postgres', 'mail'] as const,
};
