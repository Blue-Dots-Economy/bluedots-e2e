import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

type SignupResponse = { ok?: boolean; alreadyRegistered?: boolean };

/**
 * A person signs themselves up, rather than being onboarded by anyone.
 *
 * A different route through the system from createProfile: no service key,
 * no acting org, and the identity is minted straight into the realm --
 * unverified until an OTP login proves they own the address. Nothing else
 * in this suite exercises the public front door.
 */
export const signUp = (spec: { as: string }) =>
  step({
    label: `Signed themselves up as a ${spec.as.replace(/_/g, ' ')}`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const target = requireContext(ctx.target, 'target');
      const seed = requireState(state, 'seed');

      // Distinct from the aggregator-onboarded addresses, or the upsert
      // would match one of those and this would assert nothing about the
      // self-service path.
      const email = `journey-self-${spec.as}-${seed}@example.test`;

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `Journey self ${spec.as}`,
          email,
          domain: spec.as,
          // Adult: a minor is gated behind guardian consent and would not
          // reach the same end state.
          age: 30,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `STEP_FAILED: signup ${res.status} ${body}. SELF_SIGNUP_MODE defaults to ` +
            `"gated", which answers SELF_SIGNUP_DISABLED -- check the instance allows it.`,
        );
      }

      const body = (await res.json()) as SignupResponse;
      if (body.alreadyRegistered) {
        throw new Error(
          `STEP_FAILED: ${email} was already registered, so this run is asserting ` +
            `against somebody an earlier run created. The seed should have made it unique.`,
        );
      }

      state.signedUp = { email, domain: spec.as };
    },
  });
