import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';

type FetchResponse = { items?: { item_id: string; lifecycle_status?: string }[] };

/**
 * Assert what the write model says the profile's status is.
 *
 * Separate from the search assertions on purpose. "Not in search" and "not
 * live" are different claims, and a journey that only checked search could
 * pass against an item that never committed at all -- which is what a
 * consent gate silently leaves behind, with a 200 on the way in.
 */
export const expectLifecycleStatus = (spec: { is: string; because: string }) =>
  step({
    label: `Left the profile ${spec.is}, ${spec.because}`,
    run: async (ctx: StepContext) => {
      const auth = requireContext(ctx.auth, 'authentication');
      const key = requireState(ctx.state, 'itemKey');

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/item/fetch`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': auth.apiKey,
          'x-acting-org-id': auth.actingOrgId,
        },
        body: JSON.stringify({ item_ids: [key.id] }),
      });

      if (!res.ok) {
        throw new Error(`STEP_FAILED: item fetch ${res.status} ${await res.text()}`);
      }

      const body = (await res.json()) as FetchResponse;
      const item = body.items?.find((i) => i.item_id === key.id);
      if (!item) {
        throw new Error(
          `STEP_FAILED: ${key.id} was not returned by item fetch at all, so its ` +
            `status cannot be checked. The upsert reported it written.`,
        );
      }

      if (item.lifecycle_status !== spec.is) {
        throw new Error(
          `STEP_FAILED: expected ${key.id} to be ${spec.is} ${spec.because}, ` +
            `it is ${item.lifecycle_status}.`,
        );
      }
    },
  });
