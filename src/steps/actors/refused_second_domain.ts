import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import { buildUpsertBody } from '../request_bodies.js';
import { buildItemState } from '../../fixtures/item_state.js';

/**
 * Attempt a profile in a second domain for someone who already has one, and
 * require it to be refused.
 *
 * An account is deliberately single-domain: `user.onboarded_by_org_id`
 * grants PII-decrypt rights per ACCOUNT, so an account spanning two domains
 * would let one domain's default aggregator decrypt the other domain's
 * participant. The lock is a disclosure control, not a modelling
 * preference, which is why it is worth a journey rather than a unit test --
 * the hole only opens across two requests.
 */
export const expectSecondDomainRefused = (spec: { as: string; forProfileAs: string }) =>
  step({
    label: `Refused a ${spec.as.replace(/_/g, ' ')} profile for someone already registered`,
    run: async (ctx: StepContext) => {
      const auth = requireContext(ctx.auth, 'authentication');
      const target = requireContext(ctx.target, 'target');
      const profiles = requireState(ctx.state, 'profiles');

      const existing = profiles[spec.forProfileAs];
      if (!existing) {
        throw new Error(
          `STEP_FAILED: this step needs an existing "${spec.forProfileAs}" profile, and ` +
            `this journey created ${Object.keys(profiles).join(', ') || 'none'}.`,
        );
      }

      const { itemType, itemSchema } = target.schemaFor(spec.as);
      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/admin/participant`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': auth.apiKey,
          'x-acting-org-id': auth.actingOrgId,
        },
        body: JSON.stringify(
          buildUpsertBody({
            network: target.network,
            domain: spec.as,
            itemType,
            itemState: buildItemState(itemSchema as never, requireState(ctx.state, 'seed')),
            name: `Journey ${spec.as}`,
            email: existing.email,
          }),
        ),
      });

      if (res.ok) {
        throw new Error(
          `STEP_FAILED: the second domain was ACCEPTED. ${existing.email} is registered as ` +
            `"${spec.forProfileAs}" and now also holds a "${spec.as}" profile, so one ` +
            `domain's default aggregator can decrypt the other domain's participant.`,
        );
      }

      const body = (await res.json()) as { error?: string; message?: string };
      if (body.error !== 'DOMAIN_LOCKED') {
        throw new Error(
          `STEP_FAILED: expected DOMAIN_LOCKED, got ${res.status} ${body.error ?? ''} ` +
            `${body.message ?? ''}. Refused for the wrong reason is not the same as refused ` +
            `by the single-domain lock.`,
        );
      }
    },
  });
