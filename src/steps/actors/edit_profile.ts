import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import { buildUpsertBody, extractItemKey } from '../request_bodies.js';
import { captureBaseline } from '../../awaiters/ingest.js';
import { captureNotificationBaseline } from '../../awaiters/notification.js';

/**
 * Edit a profile through the same upsert that created it.
 *
 * The participant upsert is keyed on the address, so re-sending it with a
 * changed item_state takes the update path rather than creating a second
 * person. That matters for what follows: an update publishes its own item
 * event, and a journey can then prove the INDEX moved, not merely the row.
 * A search that still returns the old value is the failure this exists to
 * catch, and it is invisible from either service alone.
 */
export const editProfile = (spec: { as: string }) =>
  step({
    label: `Edited the ${spec.as.replace(/_/g, ' ')} profile`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const auth = requireContext(ctx.auth, 'authentication');
      const target = requireContext(ctx.target, 'target');
      const probe = requireContext(ctx.probe, 'ingest probe');
      const profiles = requireState(state, 'profiles');

      const profile = profiles[spec.as];
      if (!profile) {
        throw new Error(
          `STEP_FAILED: this step edits the "${spec.as}" profile, and this journey ` +
            `created ${Object.keys(profiles).join(', ') || 'none'}.`,
        );
      }

      const field = Object.keys(profile.itemState).find(
        (k) =>
          typeof profile.itemState[k] === 'string' &&
          String(profile.itemState[k]).startsWith('journey'),
      );
      if (!field) throw new Error('STEP_FAILED: no identifying field to edit');

      // A NEW seed-distinct value, so "the index moved" is distinguishable
      // from "the index still holds what it always held".
      const edited = { ...profile.itemState, [field]: `${String(profile.itemState[field])}-edited` };

      state.baseline = await captureBaseline(probe);
      if (ctx.notifications) {
        state.notificationBaseline = await captureNotificationBaseline(ctx.notifications);
      }

      const { itemType } = target.schemaFor(spec.as);
      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/admin/participant`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': auth.apiKey,
          'x-acting-org-id': auth.actingOrgId,
        },
        body: JSON.stringify(
          buildUpsertBody({
            network: target.network,
            domain: spec.as,
            itemType,
            itemState: edited,
            name: `Journey ${spec.as}`,
            email: profile.email,
          }),
        ),
      });

      if (!res.ok) {
        throw new Error(`STEP_FAILED: edit upsert ${res.status} ${await res.text()}`);
      }

      const body = (await res.json()) as { user_existed?: boolean } & Parameters<
        typeof extractItemKey
      >[0];
      if (body.user_existed !== true) {
        throw new Error(
          `STEP_FAILED: the edit created a new participant instead of updating one. ` +
            `The upsert is keyed on the address, so this means ${profile.email} did not ` +
            `match what was written -- the journey is asserting against a different person.`,
        );
      }

      const key = extractItemKey(body);
      state.itemKey = key;
      state.itemState = edited;
      state.profiles = { ...state.profiles, [spec.as]: { ...profile, key, itemState: edited } };
    },
  });
