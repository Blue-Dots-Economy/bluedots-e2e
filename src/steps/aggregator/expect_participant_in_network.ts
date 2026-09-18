import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

type Participant = { user_id?: string; items?: { item_id?: string }[] };

/**
 * The uploaded row became a participant in the NETWORK.
 *
 * The only assertion in the bulk flow that leaves the aggregator, and the
 * reason these journeys belong in this suite. Everything before it can
 * succeed over an empty result: the upload completes, the record says
 * `completed`, the row counts say it worked -- and if the worker's push is
 * misconfigured, `getSignalStackWriter()` returned null, logged one warn
 * line at boot, and sent nobody anywhere.
 *
 * Asked of signals directly, with the aggregator's own service credential,
 * so what is being read is the network's answer rather than the
 * aggregator's record of what it believes it sent.
 */
export const expectParticipantInNetwork = () =>
  step({
    label: 'The uploaded person is a participant in the network',
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const auth = requireContext(ctx.auth, 'authentication');
      // By phone, not by address: the seeker template declares no email
      // column, so the number is the only identifier the row carries. The
      // aggregator normalises it to E.164 on the way in.
      const phone = requireState(state, 'bulkPhone');
      const e164 = `+91${phone}`;

      const res = await ctx.http(
        `${ctx.endpoints.signalsApi}/api/v1/admin/participant?phone_number=${encodeURIComponent(e164)}`,
        { headers: { 'x-api-key': auth.apiKey, 'x-acting-org-id': auth.actingOrgId } },
      );

      if (res.status === 404) {
        throw new Error(
          `STEP_FAILED: the network has no participant for ${e164}, so the upload completed ` +
            `and onboarded nobody. The aggregator's own record says completed either way -- an ` +
            `incomplete bearer config disables the push with one warn-level log line.`,
        );
      }
      if (!res.ok) {
        throw new Error(`STEP_FAILED: participant lookup ${res.status} ${await res.text()}`);
      }

      const participant = (await res.json()) as Participant;
      if (!participant.user_id) {
        throw new Error(
          `STEP_FAILED: the lookup answered 200 with no user for ${e164}, which is the same ` +
            `outcome as a 404 and must not read as a pass.`,
        );
      }
      if (!participant.items?.length) {
        throw new Error(
          `STEP_FAILED: ${e164} exists in the network with no profile. The upload created the ` +
            `account and not the item it was carrying, so the row's data went nowhere.`,
        );
      }
    },
  });
