import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext } from '../../journey/state.js';
import { actingAsSignedUp } from './acting_as_signed_up.js';

/**
 * The person records their age, as themselves. Recorded once and never
 * changed, which is why a minor's journey signs up without one.
 */
export const recordAge = (spec: { age: number }) =>
  step({
    label: `Recorded their age as ${spec.age}`,
    run: async (ctx: StepContext) => {
      const target = requireContext(ctx.target, 'target');
      const { apiKey } = await actingAsSignedUp(ctx);

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/consent/u18/dob`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ network: target.network, age: spec.age }),
      });
      if (!res.ok) {
        throw new Error(`STEP_FAILED: recording the age answered ${res.status} ${await res.text()}`);
      }

      const body = (await res.json()) as { isMinor?: boolean };
      const expected = spec.age <= 18;
      if (body.isMinor !== expected) {
        throw new Error(
          `STEP_FAILED: age ${spec.age} was read as ${body.isMinor ? 'a minor' : 'an adult'}, not ` +
            `${expected ? 'a minor' : 'an adult'}, ` +
            `so the guardian flow ${expected ? 'would never start' : 'would start for an adult'}.`,
        );
      }
    },
  });
