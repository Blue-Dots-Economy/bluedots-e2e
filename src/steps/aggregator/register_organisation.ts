import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import { captureMailBaseline } from '../../awaiters/mailbox.js';

type OrgCreated = { org_id?: string; org_slug?: string; status?: string };

/** A year out, so the consent a registration carries is live when it is read. */
const consentWindow = () => ({
  value: true as const,
  given_at: new Date().toISOString(),
  valid_till: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
});

/**
 * An organisation applies to join the network.
 *
 * The first tier. Reached anonymously by a real applicant, so the product's
 * own BFF attaches a client-credentials token on their behalf -- this uses
 * the same `aggregator-bff` client rather than inventing a credential, or
 * the journey would exercise an auth path nobody takes.
 *
 * What it creates is a PENDING org, a mirrored Keycloak group, and a
 * DISABLED owner: the applicant cannot sign in until a human approves. That
 * is the property the next step exists to check.
 */
export const registerOrganisation = () =>
  step({
    label: 'An organisation applied to join the network',
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const mail = requireContext(ctx.mail, 'a mailbox');
      const serviceToken = requireContext(ctx.serviceToken, 'service credentials');
      const seed = requireState(state, 'seed');

      // Before the write. The review mail is the ONLY place the approval
      // token appears, and the mailbox already holds this run's other mail.
      state.mailBaseline = await captureMailBaseline(mail);

      const ownerEmail = `journey-org-owner-${seed}@example.test`;
      const token = await serviceToken('aggregator-bff');

      const res = await ctx.http(`${ctx.endpoints.aggregatorApi}/v1/orgs/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          display_name: `Journey Organisation ${seed}`,
          owner: {
            name: 'Journey Org Owner',
            // Digits only and 10-15 long; the shared contact schema rejects
            // anything else before the route is reached.
            phone: '9000100001',
            email: ownerEmail,
          },
          consent: consentWindow(),
        }),
      });

      if (!res.ok) {
        throw new Error(
          `STEP_FAILED: org registration ${res.status} ${await res.text()}. A 404 here means ` +
            `the hierarchy flag is off, which leaves these routes unregistered rather than ` +
            `disabled.`,
        );
      }

      const body = (await res.json()) as OrgCreated;
      if (!body.org_id) {
        throw new Error('STEP_FAILED: the registration returned no org id to approve.');
      }
      if (body.status && body.status !== 'pending') {
        throw new Error(
          `STEP_FAILED: the organisation was created ${body.status}, not pending. A ` +
            `registration that is live before anyone approved it is the gate not running.`,
        );
      }

      state.organisation = { id: body.org_id, ownerEmail, ...(body.org_slug ? { slug: body.org_slug } : {}) };
    },
  });
