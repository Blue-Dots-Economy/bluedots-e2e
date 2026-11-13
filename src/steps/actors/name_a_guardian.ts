import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import { captureMailBaseline } from '../../awaiters/mail.js';
import { actingAsSignedUp } from './acting_as_signed_up.js';

/**
 * A minor names their guardian, which sends the guardian a code to approve
 * the account.
 *
 * The guardian is given an email address and no phone. The guardian policy
 * tries channels in order and takes the first it can address, so with no
 * phone it can only choose email: nothing in this journey can produce a
 * text message, real or otherwise.
 */
export const nameAGuardian = () =>
  step({
    label: 'Named a guardian, reachable by email only',
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const target = requireContext(ctx.target, 'target');
      const seed = requireState(state, 'seed');
      const { apiKey } = await actingAsSignedUp(ctx);

      const guardianEmail = `journey-guardian-${seed}@example.test`;
      if (ctx.mail) state.mailBaseline = await captureMailBaseline(ctx.mail);

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/consent/u18/guardian`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          network: target.network,
          guardianName: 'Journey Guardian',
          guardianEmail,
          guardianDeclarationAccepted: true,
        }),
      });
      if (!res.ok) {
        throw new Error(`STEP_FAILED: naming the guardian answered ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { otpSent?: boolean };
      if (body.otpSent !== true) {
        throw new Error('STEP_FAILED: the guardian was named but no code was sent');
      }

      state.guardianEmail = guardianEmail;
    },
  });
