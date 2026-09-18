import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import type { ItemSchema } from '../../targets/target_schemas.js';

type ContactDetailsResponse = {
  action_status?: string;
  revealed?: boolean;
  reveal_blocked_reason?: string;
  other_actor?: { item?: { item_state?: Record<string, unknown> } };
};

/**
 * The fields the schema itself marks as contact details.
 *
 * Read from the target's schema rather than named here, so this asserts
 * against whatever THAT network considers private -- blue_dot's provider
 * marks hiringManagerName / hiringManagerPhoneNumber / hiringManagerEmail,
 * and another network marks something else.
 */
function privateFieldsOf(schema: ItemSchema): string[] {
  return Object.entries(schema.properties ?? {})
    .filter(([, spec]) => (spec as { private?: boolean })?.private === true)
    .map(([field]) => field);
}

async function readContactDetails(
  ctx: StepContext,
  viewer: string,
): Promise<{ status: number; body: ContactDetailsResponse; raw: string }> {
  const state = ctx.state as JourneyState;
  const actionId = requireState(state, 'actionId');
  const profile = requireState(state, 'profiles')[viewer];
  if (!profile) {
    throw new Error(`STEP_FAILED: no "${viewer}" profile in this journey to view as.`);
  }

  const session = state.sessions?.[viewer];
  const auth: Record<string, string> = session
    ? { cookie: session.cookie }
    : {
        'x-api-key': await requireContext(ctx.keys, 'participant credentials').issueFor(
          profile.userId,
          `actor-${viewer}`,
        ),
      };
  const res = await ctx.http(
    `${ctx.endpoints.signalsApi}/api/v1/action/${actionId}/contact-details`,
    { headers: auth },
  );
  const raw = await res.text();
  return { status: res.status, body: JSON.parse(raw || '{}') as ContactDetailsResponse, raw };
}

/**
 * The accepted request actually hands over the contact details.
 *
 * The end of the connection story, and the only place in the product where
 * one participant sees another's PII. Asserted on the VALUES, not on the
 * `revealed` flag: the pre-reveal view returns the same shape with those
 * fields masked (`"j***"`), so a regression that stopped decrypting would
 * still answer `revealed: true` and a flag-only check would pass it.
 */
export const expectContactDetailsRevealed = (spec: { as: string; of: string }) =>
  step({
    label: `The ${spec.as.replace(/_/g, ' ')} can now see the contact details`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const target = requireContext(ctx.target, 'target');
      const counterparty = requireState(state, 'profiles')[spec.of];
      if (!counterparty) {
        throw new Error(`STEP_FAILED: no "${spec.of}" profile whose details could be revealed.`);
      }

      const { status, body, raw } = await readContactDetails(ctx, spec.as);
      if (status !== 200) {
        throw new Error(`STEP_FAILED: contact-details ${status} ${raw}`);
      }
      if (body.revealed !== true) {
        throw new Error(
          `STEP_FAILED: the details were not revealed (reason: ` +
            `${body.reveal_blocked_reason ?? 'none given'}, action is ${body.action_status}). ` +
            `Both parties' profiles must be live and the status must be one the interaction ` +
            `declares in reveals_pii_on_status.`,
        );
      }

      const { itemSchema } = target.schemaFor(spec.of);
      const fields = privateFieldsOf(itemSchema);
      if (fields.length === 0) {
        throw new Error(
          `STEP_FAILED: ${target.network}'s "${spec.of}" schema marks no field private, so a ` +
            `reveal has nothing to reveal and this assertion would pass vacuously.`,
        );
      }

      const seen = body.other_actor?.item?.item_state ?? {};
      for (const field of fields) {
        const expected = counterparty.itemState[field];
        if (expected === undefined) continue;
        if (seen[field] !== expected) {
          throw new Error(
            `STEP_FAILED: "${field}" reads ${JSON.stringify(seen[field])}, not the value the ` +
              `counterparty stored. A masked value here means the reveal was authorised but ` +
              `the private state was never decrypted.`,
          );
        }
      }
    },
  });

/**
 * Nobody sees anything until the other side agrees.
 *
 * The negative half, and the one worth the most: the reveal gate is keyed on
 * the action's status, so a transition that accidentally widened
 * `reveals_pii_on_status` -- or a gate that stopped consulting it -- would
 * hand over contact details to anyone who merely asked. Asserted on a
 * concrete 403 rather than on absence, so a broken pipeline cannot pass it.
 */
export const expectContactDetailsHidden = (spec: { as: string }) =>
  step({
    label: `The ${spec.as.replace(/_/g, ' ')} cannot see the contact details yet`,
    run: async (ctx: StepContext) => {
      const { status, body, raw } = await readContactDetails(ctx, spec.as);

      if (status === 200 && body.revealed === true) {
        throw new Error(
          `STEP_FAILED: the contact details were revealed on an action that is ` +
            `${body.action_status}, which the interaction does not declare as a revealing ` +
            `status. This is a disclosure, not a test failure.`,
        );
      }
      if (status !== 403) {
        throw new Error(
          `STEP_FAILED: expected 403 PII_NOT_REVEALED before the request is accepted, got ` +
            `${status} ${raw}`,
        );
      }
    },
  });
