import { defineJourney } from '../../src/journey/define_journey.js';
import {
  approveRegistration,
  expectKnownToNetwork,
  registerCoordinator,
  registerOrganisation,
} from '../../src/steps/index.js';

/**
 * `A2`. The second tier, and the one that reaches the network.
 *
 * Three things are being pinned at once, and each fails silently on its own:
 *
 *  - The coordinator names its parent by `org_id`, which the route refuses
 *    unless that organisation is `active`. So this re-proves A1's approval
 *    took effect, from the outside.
 *  - The review goes to the ORGANISATION'S OWNER, not the network admin.
 *    That routing IS the hierarchy; sent to the admin it would still be a
 *    perfectly valid approval of the wrong kind.
 *  - Approving calls signals to register an organisation for the
 *    coordinator. When that push is misconfigured the writer is null, the
 *    failure is one warn-level log line, and the aggregator's own record
 *    still reads `active` -- so every assertion on the aggregator side
 *    passes over an empty result. The last step reads the network's own
 *    write model instead.
 */
export const aCoordinatorJoinsAnOrganisation = {
  ...defineJourney({
    id: 'A2',
    title: 'A coordinator joins an approved organisation and the network is told',
    capability: 'aggregator-onboarding',
    targets: ['blue_dot/ka-dhwd'],
    steps: [
      registerOrganisation(),
      approveRegistration({ tier: 'organisation' }),
      registerCoordinator({ as: 'seeker' }),
      approveRegistration({ tier: 'coordinator' }),
      expectKnownToNetwork(),
    ],
  }),
  requires: ['http', 'postgres'] as const,
};
