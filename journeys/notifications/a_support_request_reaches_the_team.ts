import { defineJourney } from '../../src/journey/define_journey.js';
import {
  expectEmailDelivered,
  logIn,
  signUp,
  submitSupportRequest,
} from '../../src/steps/index.js';

/**
 * `J24`. A support request is a person asking for help, so it has to reach
 * every address the deployment named, with a way to answer them.
 *
 * The stack names two support addresses and one cc. signals-dpg sends to
 * the first and copies the second and the cc, and sets reply-to to the
 * person. The support mailbox is shared by every run, so the message is
 * matched on the reference this submission was answered with; the
 * attachment summary proves the screenshot travelled with it.
 */
export const aSupportRequestReachesTheTeam = {
  ...defineJourney({
    id: 'J24',
    title: 'A support request reaches the support team',
    capability: 'notifications',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      signUp({ as: 'seeker' }),
      logIn(),
      submitSupportRequest({ type: 'support_request', details: 'I cannot find my profile.' }),
      expectEmailDelivered({
        to: { address: 'support@bluedots.test' },
        about: 'the support request',
        subjectIncludes: 'Issue Number:',
        bodyIncludes: [
          { fromState: 'supportReference' },
          'I cannot find my profile.',
          'journey-screenshot.png (',
        ],
        cc: ['ops@bluedots.test', 'cc@bluedots.test'],
        replyTo: { signedUp: true },
        recordedAs: 'support.request',
        recordedDomain: null,
      }),
    ],
  }),
  requires: ['http', 'postgres', 'mail'] as const,
};
