import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

/** Granted on approval; without it the owner can sign in and do nothing. */
const OWNER_ROLE = 'org_owner';

/**
 * The approval actually turned the owner into one.
 *
 * Asserted in the realm, not on the response, because the realm is where
 * every part of the effect lives: registration creates the owner DISABLED,
 * and approval enables them, grants `org_owner` and adds them to the
 * organisation's mirrored group. A page that says "approved" while the user
 * stays disabled is a person who can never sign in -- and the page would
 * still be a 200.
 */
export const expectOwnerActivated = () =>
  step({
    label: 'The owner can now sign in and act for that organisation',
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const realmUser = requireContext(ctx.realmUser, 'access to the realm');
      const organisation = requireState(state, 'organisation');

      const user = await realmUser(organisation.ownerEmail);
      if (!user) {
        throw new Error(
          `STEP_FAILED: no realm user for ${organisation.ownerEmail}. Registration creates one ` +
            `disabled, so an absent user means the registration never provisioned an identity ` +
            `at all.`,
        );
      }

      if (!user.enabled) {
        throw new Error(
          `STEP_FAILED: ${organisation.ownerEmail} is still disabled after approval, so the ` +
            `owner cannot sign in. The approval page answers 200 either way.`,
        );
      }

      if (!user.roles.includes(OWNER_ROLE)) {
        throw new Error(
          `STEP_FAILED: the owner carries ${user.roles.join(', ') || 'no realm roles'} and not ` +
            `"${OWNER_ROLE}", so they can sign in and do nothing an owner does.`,
        );
      }

      if (user.groups.length === 0) {
        throw new Error(
          `STEP_FAILED: the owner is in no group, so nothing ties them to the organisation ` +
            `that was just approved. The group is mirrored at registration and joined here.`,
        );
      }
    },
  });
