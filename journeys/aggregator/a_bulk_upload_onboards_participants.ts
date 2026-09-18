import { defineJourney } from '../../src/journey/define_journey.js';
import {
  approveRegistration,
  expectParticipantInNetwork,
  registerCoordinator,
  registerOrganisation,
  signInAsCoordinator,
  uploadParticipants,
  waitUntilBulkFinished,
} from '../../src/steps/index.js';

/**
 * `B1`. The longest path in the fleet, and the one that pays for the
 * infrastructure: an organisation is approved, a coordinator under it is
 * approved, that coordinator signs in, uploads a file, and the person in
 * that file becomes a participant in the network.
 *
 * Six services and three queues between the first step and the last, and
 * almost every stage reports success independently of the one after it. The
 * upload record reads `completed` whether or not the worker's push to
 * signals was configured; `getSignalStackWriter()` returns null and logs a
 * single warn line at boot, and every row is then processed and sent
 * nowhere. So the last step asks the NETWORK, with the network's own
 * credential, rather than reading the aggregator's account of what it
 * believes it sent.
 *
 * Signing in is load-bearing beyond convenience: every bulk route reads
 * `aggregator_id` and `decision_made` off the token and refuses anything
 * not `approved`. A token carrying those claims can only exist if the
 * registration wrote them and the approval flipped them, so this is also
 * the end-to-end proof of what A1 and A2 assert from the inside.
 */
export const aBulkUploadOnboardsParticipants = {
  ...defineJourney({
    id: 'B1',
    title: 'A coordinator uploads a file and the people in it join the network',
    capability: 'aggregator-onboarding',
    targets: ['blue_dot/ka-dhwd'],
    steps: [
      registerOrganisation(),
      approveRegistration({ tier: 'organisation' }),
      registerCoordinator({ as: 'seeker' }),
      approveRegistration({ tier: 'coordinator' }),
      signInAsCoordinator(),
      uploadParticipants({ as: 'seeker' }),
      waitUntilBulkFinished(),
      expectParticipantInNetwork(),
    ],
  }),
  requires: ['http', 'postgres'] as const,
};
