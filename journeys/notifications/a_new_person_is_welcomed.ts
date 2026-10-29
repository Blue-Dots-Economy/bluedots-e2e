import { defineJourney } from '../../src/journey/define_journey.js';
import { expectEmailDelivered, logIn, signUp } from '../../src/steps/index.js';

/**
 * `J23`. Signing up is not what sends the welcome: the first login is,
 * because that is where signals-dpg creates the person's own record. So the
 * journey logs in, with the emailed code, the way a browser does.
 *
 * Signed up with an email and no phone, so the welcome's WhatsApp channel
 * has no address and only the email is sent.
 */
export const aNewPersonIsWelcomed = {
  ...defineJourney({
    id: 'J23',
    title: 'A new person is welcomed after their first login',
    capability: 'notifications',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      signUp({ as: 'seeker' }),
      logIn(),
      expectEmailDelivered({
        to: { signedUp: true },
        about: 'a welcome',
        subjectIncludes: 'Complete your profile to get started',
        bodyIncludes: ['http://localhost:5173/'],
        recordedAs: 'user.welcome',
        recordedDomain: 'seeker',
      }),
    ],
  }),
  requires: ['http', 'mail'] as const,
};
