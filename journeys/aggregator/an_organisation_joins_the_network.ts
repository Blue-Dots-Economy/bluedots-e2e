import { defineJourney } from '../../src/journey/define_journey.js';
import {
  approveRegistration,
  expectOwnerProvisioned,
  registerOrganisation,
} from '../../src/steps/index.js';

/**
 * `A1`. The first tier of onboarding, and the only one in this suite whose
 * subject is an organisation rather than a person.
 *
 * The effect of approving is entirely in the realm -- `org_owner` granted,
 * the organisation's mirrored group joined -- and BOTH assignments are
 * soft-fail: each logs a warning and continues, leaving an active
 * organisation whose owner owns nothing. The decision route renders HTML on
 * every path, so the page says "approved" either way.
 *
 * The owner stays disabled, and the journey pins that too. Written first
 * asserting the opposite, from the route's own file header and published
 * API description -- both of which still say it enables the owner, where
 * the code deliberately does not.
 *
 * That is why this asserts the realm and not the page, and why the approval
 * goes through the emailed link rather than a direct call: the token is
 * minted, mailed, and exposed nowhere else, so reading the mailbox is the
 * only way in and is also how the next journey can prove that a
 * COORDINATOR's review goes somewhere different.
 */
export const anOrganisationJoinsTheNetwork = {
  ...defineJourney({
    id: 'A1',
    title: 'An organisation applies to join and an administrator approves it',
    capability: 'aggregator-onboarding',
    targets: ['blue_dot/ka-dhwd'],
    steps: [
      registerOrganisation(),
      approveRegistration({ tier: 'organisation' }),
      expectOwnerProvisioned(),
    ],
  }),
  // No index and no queue: this is the aggregator, the realm and the mail
  // server. postgres is here because the run's own probes hold it open.
  requires: ['http', 'postgres'] as const,
};
