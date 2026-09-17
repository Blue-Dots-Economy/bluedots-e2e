import { step, type StepContext } from '../../journey/define_journey.js';
import { requireState } from '../../journey/state.js';

type SignupResponse = { ok?: boolean; alreadyRegistered?: boolean };

/**
 * Assert the system now recognises the person who just signed up.
 *
 * Asked by signing up again: the route answers `alreadyRegistered: true`
 * for an identifier it already knows, which is how the UI decides to send
 * someone to sign-in instead. A second signup that reports a NEW account
 * means the identity was not persisted, or was persisted somewhere the
 * lookup does not read -- and the person would then own two accounts, each
 * with its own profiles, with nothing erroring.
 *
 * Only observable across two requests, which is what makes it a journey
 * rather than a unit test.
 */
export const expectAlreadyRegistered = () =>
  step({
    label: 'Recognised them on a second attempt, rather than making a second account',
    run: async (ctx: StepContext) => {
      const signedUp = requireState(ctx.state, 'signedUp');

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Journey self repeat',
          email: signedUp.email,
          domain: signedUp.domain,
          age: 30,
        }),
      });

      if (!res.ok) {
        throw new Error(`STEP_FAILED: second signup ${res.status} ${await res.text()}`);
      }

      const body = (await res.json()) as SignupResponse;
      if (body.alreadyRegistered !== true) {
        throw new Error(
          `STEP_FAILED: signing ${signedUp.email} up again reported a new account, so the ` +
            `first identity was not persisted where the lookup reads. That person now has ` +
            `two accounts and nothing said so.`,
        );
      }
    },
  });
