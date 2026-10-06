import { defineJourney } from '../../src/journey/define_journey.js';
import { createProfile, expectEmailDelivered } from '../../src/steps/index.js';

/**
 * `J11`. Being onboarded by an aggregator is the first a person hears of
 * the network, and signals-dpg sends that mail best-effort: it catches its
 * own failures and logs them, so a broken pipeline is a quiet log line and
 * a 200. Nothing downstream notices.
 *
 * Asserted as a DELIVERED email in the stack's Mailpit: notification-service
 * resolved the template from the target's catalogue, rendered it and sent it
 * over SMTP. The subject and body fragments hold on every target this runs
 * on (the catalogue copy differs between them), and the link is the stack's
 * FRONTEND_BASE_URL, which proves the CTA variable was rendered.
 *
 * expectEmailDelivered can also check the event type notification-service
 * recorded (recordedAs). These journeys do not use it yet: the service
 * leaves notification_event.event_type empty, so the check could only fail.
 */
export const onboardingNotifiesTheParticipant = {
  ...defineJourney({
    id: 'J11',
    title: 'Onboarding a participant tells them they have an account',
    capability: 'notifications',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      expectEmailDelivered({
        to: { profile: 'seeker' },
        about: 'their new account',
        subjectIncludes: 'Your account is ready',
        bodyIncludes: ['Activate your account', 'http://localhost:5173/'],
      }),
    ],
  }),
  // redis + postgres: createProfile records an ingest baseline. mail: the
  // assertion reads Mailpit. An environment without it reports NOT COVERED.
  requires: ['http', 'redis', 'postgres', 'mail'] as const,
};
