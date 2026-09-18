import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

type PerformResponse = {
  summary?: { total: number; succeeded: number; failed: number };
  results?: { action_id?: string; action_status?: string; status?: string; error?: string; message?: string }[];
};

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
      const probe = requireContext(ctx.probe, 'ingest probe');
      const profiles = requireState(state, 'profiles');

      const from = profiles[spec.from];
      const to = profiles[spec.to];
      if (!from || !to) {
        throw new Error(
          `STEP_FAILED: this step needs a "${spec.from}" and a "${spec.to}" profile, and this ` +
            `journey created ${Object.keys(profiles).join(', ') || 'neither'}.`,
        );
      }

      // Their own session when they signed themselves up, a minted
      // credential when an aggregator onboarded them. Same participant in
      // `request.user` either way; only one of them is what a person holds.
      const session = state.sessions?.[spec.from];
      const auth: Record<string, string> = session
        ? { cookie: session.cookie, 'x-csrf-token': session.csrfToken }
        : {
            'x-api-key': await requireContext(ctx.keys, 'participant credentials').issueFor(
              from.userId,
              `actor-${spec.from}`,
            ),
          };

      // From the write model, not from /api/v1/item/fetch: that route scopes
      // every query to `created_by = caller` -- it is the owner's "my
      // profiles" list -- so the counterparty's item reads as absent there,
      // which is not the same thing as missing.
      const targetInstance = await probe.instanceUrl(to.key);
      if (!targetInstance) {
        throw new Error(
          `STEP_FAILED: the "${spec.to}" item has no row to read an instance url from, so ` +
            `the action body cannot name where it lives.`,
        );
      }

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/action/perform`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
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
