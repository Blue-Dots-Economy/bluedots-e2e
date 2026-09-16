import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import type { ItemKey } from '../../awaiters/ingest.js';

type PerformResponse = {
  summary?: { total: number; succeeded: number; failed: number };
  results?: { action_id?: string; action_status?: string; status?: string; error?: string; message?: string }[];
};

/**
 * Read the instance the item lives on, which the action body must name.
 *
 * `target_item.item_instance_url` is required and is compared against this
 * instance's own base URL before any PII is revealed, so a guessed value
 * does not fail here -- it fails four steps later with
 * CROSS_INSTANCE_REVEAL_NOT_SUPPORTED. Taken from the item itself so there
 * is nothing to guess.
 */
async function instanceUrlOf(
  ctx: StepContext,
  key: ItemKey,
  apiKey: string,
): Promise<string> {
  const query = new URLSearchParams({
    item_id: key.id,
    item_network: key.network,
    item_domain: key.domain,
    item_type: key.type,
  });
  const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/item/fetch?${query}`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    throw new Error(`STEP_FAILED: fetch target item ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { items?: { item_instance_url?: string | null }[] };
  const url = body.items?.[0]?.item_instance_url;
  if (!url) {
    throw new Error(
      `STEP_FAILED: the target item carries no item_instance_url, or /item/fetch returned ` +
        `nothing for it. Fetch is live-only, so a paused or draft target reads as absent.`,
    );
  }
  return url;
}

/**
 * One participant asks another for something, as themselves.
 *
 * The whole reason the network exists, and the first thing in this suite
 * that needs a real second party: `/action/perform` records who initiated
 * from `request.user.id`, and the reveal at the end of the flow is granted
 * to that person and no one else.
 *
 * The consent block is mandatory whenever the interaction declares
 * `reveals_pii_on_status` -- the route answers 422 CONSENT_REQUIRED before
 * creating anything -- because initiating IS the promise to share contact
 * details if the other side accepts.
 */
export const applyTo = (spec: { action: string; from: string; to: string }) =>
  step({
    label: `Asked the ${spec.to.replace(/_/g, ' ')} to ${spec.action.replace(/_/g, ' ')}`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const keys = requireContext(ctx.keys, 'participant credentials');
      const profiles = requireState(state, 'profiles');

      const from = profiles[spec.from];
      const to = profiles[spec.to];
      if (!from || !to) {
        throw new Error(
          `STEP_FAILED: this step needs a "${spec.from}" and a "${spec.to}" profile, and this ` +
            `journey created ${Object.keys(profiles).join(', ') || 'neither'}.`,
        );
      }

      const apiKey = await keys.issueFor(from.userId, `actor-${spec.from}`);
      const targetInstance = await instanceUrlOf(ctx, to.key, apiKey);

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/action/perform`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          action_type: spec.action,
          source_item: {
            item_network: from.key.network,
            item_domain: from.key.domain,
            item_type: from.key.type,
            item_id: from.key.id,
          },
          target_item: {
            item_network: to.key.network,
            item_domain: to.key.domain,
            item_type: to.key.type,
            item_id: to.key.id,
            item_instance_url: targetInstance,
          },
          // Empty on purpose where the interaction requires no fields; the
          // action's own requirement_schema is still enforced downstream, so
          // an interaction that DOES require some fails there rather than here.
          requirements_snapshot: {},
          // Server-resolved version, as everywhere else consent is accepted.
          consent: { acknowledged: true, version: 1 },
        }),
      });

      const body = (await res.json().catch(() => ({}))) as PerformResponse;
      const [result] = body.results ?? [];

      if (!res.ok || !result?.action_id) {
        throw new Error(
          `STEP_FAILED: perform ${res.status} ${result?.error ?? ''} ${result?.message ?? JSON.stringify(body)}`,
        );
      }

      state.actionId = result.action_id;
    },
  });
