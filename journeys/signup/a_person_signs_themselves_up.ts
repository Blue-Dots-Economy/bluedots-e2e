import { defineJourney } from '../../src/journey/define_journey.js';
import { expectAlreadyRegistered, signUp } from '../../src/steps/index.js';

/**
 * `J16`. Every other journey here arrives through an aggregator holding a
 * service key. This is the public front door: no service key, no acting
 * org, the identity minted straight into the realm and left unverified
 * until an OTP proves the address.
 *
 * The second signup is the assertion. A route that reported a NEW account
 * for an address it had just taken would leave that person owning two,
 * each with its own profiles, and nothing would error -- the same silent
 * duplication J8 pins on the aggregator path, on the path anyone can reach.
 */
export const aPersonSignsThemselvesUp = {
  ...defineJourney({
    id: 'J16',
    title: 'A person signs themselves up and is recognised afterwards',
    capability: 'participant-onboarding',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [signUp({ as: 'seeker' }), expectAlreadyRegistered()],
  }),
  // No index, no queue: this is entirely the write model and the realm.
  requires: ['http'] as const,
};
