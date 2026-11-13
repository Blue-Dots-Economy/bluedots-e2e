import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import { awaitEmailDelivered, captureMailBaseline } from '../../awaiters/mail.js';
import { logInWithEmailOtp } from '../../auth/browser_login.js';
import { KEYCLOAK_ISSUER, PUBLIC_API_URL, PUBLIC_UI_URL } from '../../env/compose/stack_env.js';

const CODE = /\b\d{6}\b/;

/**
 * The person who signed up logs in for the first time, with a code sent to
 * their email -- through the same forms a browser sees.
 *
 * A first login is where signals-dpg creates its local user mirror, and it
 * sends the welcome mail from there. Until it happens the person has no
 * user row, so nothing can act as them either; later steps act through an
 * api key bound to the user id this records.
 *
 * The code is read from Mailpit, used once, and never logged or stored.
 */
export const logIn = () =>
  step({
    label: 'Logged in for the first time with a code sent by email',
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const signedUp = requireState(state, 'signedUp');
      const mail = requireContext(ctx.mail, 'a mail probe');

      // Before the login: the code mail, and the welcome mail it causes, are
      // both measured against it.
      const baseline = await captureMailBaseline(mail);
      state.mailBaseline = baseline;

      const { sessionCookie } = await logInWithEmailOtp(signedUp.email, {
        http: ctx.http,
        signalsApi: ctx.endpoints.signalsApi,
        keycloak: ctx.endpoints.keycloak,
        publicSignalsApi: PUBLIC_API_URL,
        publicKeycloak: KEYCLOAK_ISSUER,
        publicUi: PUBLIC_UI_URL,
        readCode: async () => {
          const message = await awaitEmailDelivered(
            mail,
            { to: signedUp.email, bodyMatches: CODE },
            { baseline, deadlineMs: 30_000 },
          );
          const code = CODE.exec(message.text)?.[0] ?? CODE.exec(message.html)?.[0];
          if (!code) throw new Error('LOGIN_FAILED: the code mail carried no code');
          return code;
        },
      });

      // The first authenticated request is what provisions the person.
      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/auth/me`, {
        headers: { cookie: sessionCookie },
      });
      if (!res.ok) {
        throw new Error(`STEP_FAILED: the first request after login answered ${res.status}`);
      }
      const me = (await res.json()) as { id?: string };
      if (!me.id) throw new Error('STEP_FAILED: the session named no user');

      state.signedUp = { ...signedUp, userId: me.id };
    },
  });
