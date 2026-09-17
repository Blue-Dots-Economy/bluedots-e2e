import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import { ADULT_AGE } from '../request_bodies.js';

type UpsertResponse = { user_id?: string; items?: unknown[] };

/**
 * Register a person, and nothing else.
 *
 * `POST /api/v1/admin/participant` enters account-only mode when the body
 * carries no `item_state`: it creates (or finds) the user and writes no item.
 * That is the precondition the self-service create needs and that nothing
 * else in this suite produces -- createProfile hands back somebody who
 * already owns a profile, so a create on top of it would be a second one.
 *
 * Only the two account-level consents are accepted here. `profile_creation`
 * belongs to the profile, and is accepted by the person at the moment they
 * create it -- which is the thing the next step is there to prove.
 */
export const registerAccount = (spec: { as: string }) =>
  step({
    label: `Registered an account with no profile yet, for a ${spec.as.replace(/_/g, ' ')}`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const auth = requireContext(ctx.auth, 'authentication');
      const target = requireContext(ctx.target, 'target');
      const seed = requireState(state, 'seed');

      // Distinct from every address createProfile uses: the upsert is keyed
      // on it, so a collision would hand this journey a participant who
      // already owns a profile and quietly defeat the whole point.
      const email = `journey-account-${spec.as}-${seed}@example.test`;

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/admin/participant`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': auth.apiKey,
          'x-acting-org-id': auth.actingOrgId,
        },
        body: JSON.stringify({
          channel: 'bulk',
          name: `Journey account ${spec.as}`,
          email,
          age: ADULT_AGE,
          network: target.network,
          domain: spec.as,
          // Both-or-none: the route answers USER_LEVEL_INCOMPLETE for one
          // without the other.
          compliance: [
            { key: 'user_terms', value: true },
            { key: 'user_privacy', value: true },
          ],
          // item_state omitted ON PURPOSE. This is what account-only mode is.
        }),
      });

      if (!res.ok) {
        throw new Error(`STEP_FAILED: register ${res.status} ${await res.text()}`);
      }

      const body = (await res.json()) as UpsertResponse;
      if (body.items?.length) {
        throw new Error(
          `STEP_FAILED: the register wrote ${body.items.length} item(s), so this is not the ` +
            `account-only path and the person already owns a profile. Account-only mode is ` +
            `entered by omitting item_state -- check the body.`,
        );
      }
      if (!body.user_id) {
        throw new Error('STEP_FAILED: the register returned no user_id to act as.');
      }

      state.accounts = { ...state.accounts, [spec.as]: { userId: body.user_id, email } };
    },
  });
