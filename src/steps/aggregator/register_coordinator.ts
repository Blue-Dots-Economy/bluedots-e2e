import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import { captureMailBaseline } from '../../awaiters/mailbox.js';

type Created = { aggregator_id?: string; org_slug?: string; status?: string };

/**
 * A coordinator applies to work under an approved organisation.
 *
 * The second tier, and the one that reaches the network: this record's
 * approval is what calls signals to register an organisation for it. The
 * parent is named by `org_id`, which the route refuses unless that
 * organisation is `active` -- so this step doubles as proof that the first
 * tier's approval actually took effect.
 *
 * The review goes to the ORGANISATION'S OWNER rather than the network
 * admin. That routing is the hierarchy; the approving step asserts it.
 */
export const registerCoordinator = (spec: { as: string }) =>
  step({
    label: `A coordinator applied to work under that organisation as a ${spec.as.replace(/_/g, ' ')}`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const mail = requireContext(ctx.mail, 'a mailbox');
      const serviceToken = requireContext(ctx.serviceToken, 'service credentials');
      const organisation = requireState(state, 'organisation');
      const seed = requireState(state, 'seed');

      // Re-taken, not reused: the organisation's own review mail is already
      // past, and matching against the older baseline would find THAT one
      // and approve the wrong record.
      state.mailBaseline = await captureMailBaseline(mail);

      const email = `journey-coordinator-${seed}@example.test`;
      const token = await serviceToken('aggregator-bff');

      const res = await ctx.http(
        `${ctx.endpoints.aggregatorApi}/v1/aggregator-registrations/create`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({
            name: `Journey Coordinator ${seed}`,
            // Validated against the network's own registration schema, which
            // declares the domains that network serves.
            type: spec.as,
            contact: { name: 'Journey Coordinator', phone: '9000100002', email },
            consent: {
              value: true,
              given_at: new Date().toISOString(),
              valid_till: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
            },
            org_id: organisation.id,
          }),
        },
      );

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `STEP_FAILED: coordinator registration ${res.status} ${body}. TARGET_ORG_INACTIVE ` +
            `here means the organisation's approval did not take effect, not that this ` +
            `request was malformed.`,
        );
      }

      const created = (await res.json()) as Created;
      if (!created.aggregator_id) {
        throw new Error('STEP_FAILED: the registration returned no id to approve.');
      }
      if (created.status && created.status !== 'pending') {
        throw new Error(
          `STEP_FAILED: the coordinator was created ${created.status}, not pending -- so ` +
            `nobody had to approve it.`,
        );
      }

      state.coordinator = {
        id: created.aggregator_id,
        email,
        ...(created.org_slug ? { slug: created.org_slug } : {}),
      };
    },
  });
