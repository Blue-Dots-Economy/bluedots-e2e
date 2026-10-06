import { step, type StepContext } from '../../journey/define_journey.js';
import type { JourneyState } from '../../journey/state.js';
import { captureMailBaseline } from '../../awaiters/mail.js';
import { actingAsSignedUp } from './acting_as_signed_up.js';

/** A 1x1 PNG: the smallest file the support form accepts. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export const SUPPORT_ATTACHMENT_NAME = 'journey-screenshot.png';

/**
 * The person asks for help through the support form, as themselves, with
 * their own email as the contact and one screenshot attached.
 */
export const submitSupportRequest = (spec: {
  type: 'complaint' | 'support_request';
  details: string;
}) =>
  step({
    label: spec.type === 'complaint' ? 'Raised a complaint' : 'Asked for help through the support form',
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const { email, apiKey } = await actingAsSignedUp(ctx);

      if (ctx.mail) state.mailBaseline = await captureMailBaseline(ctx.mail);

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/support`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          name: 'Journey Person',
          email,
          type: spec.type,
          details: spec.details,
          consent: true,
          attachments: [
            { filename: SUPPORT_ATTACHMENT_NAME, contentType: 'image/png', data: PNG_1X1 },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`STEP_FAILED: the support form answered ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { reference?: string };
      if (!body.reference) throw new Error('STEP_FAILED: the support form returned no reference');

      state.supportReference = body.reference;
    },
  });
