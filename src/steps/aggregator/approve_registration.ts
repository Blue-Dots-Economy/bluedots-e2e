import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import { approvalLinkIn } from '../../awaiters/mailbox.js';
import { NETWORK_ADMIN_EMAIL } from '../../env/compose/stack_env.js';

type Tier = 'organisation' | 'coordinator';

/** Where each tier's review link is sent, and which record it decides. */
const TIERS = {
  organisation: {
    // The network admin approves an organisation; its token carries no org
    // claim, because there is no organisation above it to belong to.
    recipient: (state: JourneyState) => {
      requireState(state, 'organisation');
      // The same address the stack configures as ADMIN_EMAILS. Read from
      // there rather than restated, so the two cannot drift into a step
      // waiting on a mailbox nothing sends to.
      return NETWORK_ADMIN_EMAIL;
    },
    path: 'orgs',
    label: 'The network administrator approved the organisation',
  },
  coordinator: {
    // The ORGANISATION'S OWNER approves a coordinator, not the network
    // admin -- that routing IS the hierarchy, and a review sent to the
    // admin instead would mean the tier is not being honoured.
    recipient: (state: JourneyState) => requireState(state, 'organisation').ownerEmail,
    path: 'aggregator-registrations',
    label: 'The organisation owner approved the coordinator',
  },
} as const;

/**
 * A human opens the review link and approves.
 *
 * Every part of this is only reachable through the mailbox: the decision
 * route takes a signed token that the service mints, mails, and exposes
 * nowhere else. So the step reads the mail, which is also how it can assert
 * WHO was asked -- the routing difference between the two tiers is the
 * whole point of having two.
 *
 * The link is re-based onto this run's ephemeral port. The host written into
 * the mail is PUBLIC_API_URL, a deployment setting; the path, the record id
 * and the token are the behaviour.
 */
export const approveRegistration = (spec: { tier: Tier }) =>
  step({
    label: TIERS[spec.tier].label,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const mail = requireContext(ctx.mail, 'a mailbox');
      const baseline = requireState(state, 'mailBaseline');
      const tier = TIERS[spec.tier];
      const recipient = tier.recipient(state);

      const message = await mail.find({ to: recipient, baseline });
      if (!message) {
        throw new Error(
          `STEP_FAILED: no review email reached ${recipient}. Without one there is no token, ` +
            `and the decision route refuses every request that carries none -- so this is the ` +
            `approval never being ASKED for, not one being refused.`,
        );
      }

      const link = approvalLinkIn(message.body, ctx.endpoints.aggregatorApi);
      if (!link.url.includes(`/admin/v1/${tier.path}/`)) {
        throw new Error(
          `STEP_FAILED: the review link points at ${link.url}, not at the ${spec.tier} ` +
            `decision route. The wrong tier was asked to approve.`,
        );
      }

      // A browser form post, which is what this route is: it renders HTML on
      // every path, success and failure alike, so the status code is the
      // only machine-readable part and the body is read for the reason.
      const res = await ctx.http(
        `${ctx.endpoints.aggregatorApi}/admin/v1/${tier.path}/decision/${link.id}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: link.token, decision: 'approve' }).toString(),
        },
      );

      const page = await res.text();
      if (!res.ok) {
        throw new Error(`STEP_FAILED: ${spec.tier} decision ${res.status} ${page.slice(0, 500)}`);
      }

      if (spec.tier === 'coordinator') {
        // The coordinator's approval is the only one that reaches signals,
        // and it ABORTS when that call fails -- leaving the record pending
        // and the link re-clickable. That abort answers 503, so the check
        // above already catches it; this is a second reading of the page
        // itself, because every other outcome on this route is rendered
        // HTML with a status chosen per branch, and a future branch that
        // reports the same refusal as a 200 would otherwise pass.
        if (/still pending|could not register|try again/i.test(page)) {
          throw new Error(
            `STEP_FAILED: the approval was refused and the record left pending. The network ` +
              `registration is what aborts it, so check the aggregator reached signals at all: ` +
              `an incomplete bearer config disables that push with only a warn-level log.`,
          );
        }
        state.coordinator = { ...requireState(state, 'coordinator'), id: link.id };
      }
    },
  });
