import { defineJourney } from '../../src/journey/define_journey.js';
import {
  applyTo,
  createProfile,
  expectContactDetailsRevealed,
  respondToRequest,
} from '../../src/steps/index.js';

/**
 * `J19`. Two participants connect, and the network does the one thing it
 * exists to do: hand each of them the other's contact details, once, and
 * only because both agreed.
 *
 * Three consents in a row hold this up -- the initiator's, the receiver's,
 * and the interaction's own declaration of which status reveals -- and each
 * is recorded against a different party. Nothing else in this suite crosses
 * two participants at all, so a regression anywhere in that chain was
 * previously invisible here.
 *
 * The final assertion compares the VALUES the counterparty stored, not the
 * `revealed` flag: the pre-reveal view returns the same shape with those
 * fields masked, so a decrypt that quietly stopped working would still
 * answer `revealed: true`.
 */
export const anAcceptedRequestRevealsContactDetails = {
  ...defineJourney({
    id: 'J19',
    title: 'An accepted request lets both people see each other s contact details',
    capability: 'consent-and-data-disclosure',
    targets: ['blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'provider' }),
      createProfile({ as: 'seeker' }),
      applyTo({ action: 'apply', from: 'seeker', to: 'provider' }),
      respondToRequest({ as: 'provider', status: 'accepted' }),
      expectContactDetailsRevealed({ as: 'seeker', of: 'provider' }),
      expectContactDetailsRevealed({ as: 'provider', of: 'seeker' }),
    ],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
