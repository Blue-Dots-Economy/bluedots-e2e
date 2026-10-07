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
 * The event notification-service recorded is checked too: signals-dpg
 * must call this the onboarding event for a seeker, whatever template the
 * catalogue maps it to.
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
        recordedAs: 'item.onboarded_by_aggregator',
        recordedDomain: 'seeker',
        bodyIncludes: ['Activate your account', 'http://localhost:5173/'],
      }),
    ],
  }),
  // redis + postgres: createProfile records an ingest baseline. mail: the
  // assertion reads Mailpit. An environment without it reports NOT COVERED.
  requires: ['http', 'redis', 'postgres', 'mail'] as const,
};
