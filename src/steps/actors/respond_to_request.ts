import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

type BulkResponse = {
  summary?: { total: number; succeeded: number; failed: number };
  results?: { status?: string; error?: string; message?: string; action_status?: string }[];
};

/**
 * The receiving party answers, as themselves.
 *
 * Self-acted only: `/action/update-status` requires the caller to own the
 * TARGET item, and on-behalf-of was removed by spec, so the aggregator's
 * service key cannot answer on a participant's behalf. Accepting is also the
 * receiver's own consent to reveal their contact details, which is why the
 * consent block is here as well as on the initiating side.
 *
 * The body is an array: the route is bulk-only, and a bare object is
 * rejected by the schema rather than treated as a batch of one.
 */
export const respondToRequest = (spec: { as: string; status: string }) =>
  step({
    label: `The ${spec.as.replace(/_/g, ' ')} ${spec.status.replace(/_/g, ' ')} the request`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const keys = requireContext(ctx.keys, 'participant credentials');
      const actionId = requireState(state, 'actionId');
      const responder = requireState(state, 'profiles')[spec.as];
      if (!responder) {
        throw new Error(
          `STEP_FAILED: no "${spec.as}" profile in this journey, so nobody can answer as one.`,
        );
      }

      const apiKey = await keys.issueFor(responder.userId, `actor-${spec.as}`);

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/action/update-status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify([
          {
            action_id: actionId,
            action_status: spec.status,
            consent: { acknowledged: true, version: 1 },
          },
        ]),
      });

      const body = (await res.json().catch(() => ({}))) as BulkResponse;
      const [result] = body.results ?? [];

      // A bulk route answers 200 with a failed row inside, so the status code
      // alone is not the verdict.
      if (!res.ok || body.summary?.succeeded !== 1) {
        throw new Error(
          `STEP_FAILED: update-status ${res.status} ${result?.error ?? ''} ` +
            `${result?.message ?? JSON.stringify(body)}`,
        );
      }
    },
  });
