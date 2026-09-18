import { defineJourney } from '../../src/journey/define_journey.js';
import {
  approveRegistration,
  expectOwnerActivated,
  registerOrganisation,
} from '../../src/steps/index.js';

/**
 * `A1`. The first tier of onboarding, and the only one in this suite whose
 * subject is an organisation rather than a person.
 *
 * Registration deliberately creates the owner DISABLED: an applicant cannot
 * sign in until a human has approved them. The whole effect of that approval
 * is in the realm -- enabled, granted `org_owner`, joined to the
 * organisation's mirrored group -- and the decision route renders HTML on
 * every path, so it answers 200 whether or not any of it happened.
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
      expectOwnerActivated(),
    ],
  }),
  // No index and no queue: this is the aggregator, the realm and the mail
  // server. postgres is here because the run's own probes hold it open.
  requires: ['http', 'postgres'] as const,
};
