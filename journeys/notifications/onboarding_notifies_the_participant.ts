import { defineJourney } from '../../src/journey/define_journey.js';
import { createProfile, expectNotificationQueued } from '../../src/steps/index.js';

/**
 * `J11`. Being onboarded by an aggregator is the first a person hears of
 * the network, and signals-dpg sends that mail best-effort: it catches its
 * own failures and logs them, so a broken pipeline is a quiet log line and
 * a 200. Nothing downstream notices.
 *
 * Asserted on the queue notification-service writes rather than an inbox --
 * that service speaks SES or Gmail and nothing else, so a hermetic run has
 * no mailbox. The queue is the better assertion anyway: a job only lands
 * there once /notify has validated the template against the provider's
 * allowlist and the variables against its schema, so a queued job means
 * both services still agree on the contract.
 */
export const onboardingNotifiesTheParticipant = {
  ...defineJourney({
    id: 'J11',
    title: 'Onboarding a participant tells them they have an account',
    capability: 'notifications',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      expectNotificationQueued({
        forProfileAs: 'seeker',
        about: 'their new account',
        templateIdIncludes: 'aggregator_init',
      }),
    ],
  }),
  // redis: the notification queue is read directly, the same way the ingest
  // stream is. An http-only environment reports this NOT COVERED.
  requires: ['http', 'redis'] as const,
};
