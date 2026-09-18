import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

/** Granted on approval; without it the owner is an owner of nothing. */
const OWNER_ROLE = 'org_owner';

/**
 * The approval provisioned the owner, and deliberately did not let them in.
 *
 * Asserted in the realm, not on the response: the decision route renders
 * HTML on every path, so a page reading "approved" proves only that a page
 * was rendered. The role and group assignments are soft-fail -- each logs a
 * warning and continues, leaving the organisation active with an owner who
 * owns nothing -- so nothing else would notice.
 *
 * The owner stays DISABLED on purpose, and this pins that too. It is not an
 * oversight: an enabled owner would pass Keycloak's OTP step, and org-owner
 * console login is deferred until that console ships. Two comments in the
 * product still describe this route as enabling the owner -- its own file
 * header and its published API description -- and this journey was written
 * from those before the code below them said otherwise.
 */
export const expectOwnerProvisioned = () =>
  step({
    label: 'The owner is provisioned as an owner, with sign-in still deferred',
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const realmUser = requireContext(ctx.realmUser, 'access to the realm');
      const organisation = requireState(state, 'organisation');

      const user = await realmUser(organisation.ownerEmail);
      if (!user) {
        throw new Error(
          `STEP_FAILED: no realm user for ${organisation.ownerEmail}. Registration creates one ` +
            `disabled, so an absent user means no identity was provisioned at all.`,
        );
      }

      if (!user.roles.includes(OWNER_ROLE)) {
        throw new Error(
          `STEP_FAILED: the owner carries ${user.roles.join(', ') || 'no realm roles'} and not ` +
            `"${OWNER_ROLE}". The assignment is soft-fail -- it logs a warning and leaves the ` +
            `organisation active -- so nothing else reports it.`,
        );
      }

      if (user.groups.length === 0) {
        throw new Error(
          `STEP_FAILED: the owner is in no group, so nothing ties them to the organisation ` +
            `just approved. Mirrored at registration, joined here, and soft-fail like the role.`,
        );
      }

      if (user.enabled) {
        // Deliberately an assertion and not a tolerance. The deferral is a
        // security posture -- an enabled owner passes the OTP step -- so it
        // should not become untrue quietly.
        throw new Error(
          `STEP_FAILED: the owner is ENABLED. Approval is supposed to leave console sign-in ` +
            `deferred until the org console ships, because an enabled owner passes Keycloak's ` +
            `OTP step. If that shipped on purpose, this assertion is what needs updating.`,
        );
      }
    },
  });
