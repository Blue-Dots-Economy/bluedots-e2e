import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';

type UpsertEcho = {
  user_id?: string;
  user_existed?: boolean;
  items?: { item_id: string; item_domain: string }[];
};

/**
 * Assert the upsert matched an existing participant rather than making a
 * second one.
 *
 * The route is an upsert keyed on the address, and a duplicate is not an
 * error anyone sees: both accounts return 200, both own items, and the
 * person now exists twice with their profiles split between them. Nothing
 * in signals-dpg's own tests can catch a key that stopped matching in a
 * real deployment, because the key is only interesting across two requests.
 */
export const expectSameParticipant = (spec: { alsoOwnsProfilesIn: string[] }) =>
  step({
    label: `Kept one participant, now owning ${spec.alsoOwnsProfilesIn.length} profiles`,
    run: async (ctx: StepContext) => {
      const auth = requireContext(ctx.auth, 'authentication');
      const profiles = requireState(ctx.state, 'profiles');
      const [first] = Object.values(profiles);
      if (!first) throw new Error('STEP_FAILED: this journey created no profile to check');

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/admin/participant`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': auth.apiKey,
          'x-acting-org-id': auth.actingOrgId,
        },
        // account_only: asks "who is this address" without writing an item.
        body: JSON.stringify({
          channel: 'bulk',
          mode: 'account_only',
          name: 'Journey participant',
          email: first.email,
        }),
      });

      if (!res.ok) {
        throw new Error(`STEP_FAILED: participant lookup ${res.status} ${await res.text()}`);
      }

      const body = (await res.json()) as UpsertEcho;
      if (body.user_existed !== true) {
        throw new Error(
          `STEP_FAILED: ${first.email} was not recognised as an existing participant, ` +
            `so this journey's profiles are split across two accounts.`,
        );
      }

      const domains = new Set((body.items ?? []).map((i) => i.item_domain));
      const missing = spec.alsoOwnsProfilesIn.filter((d) => !domains.has(d));
      if (missing.length > 0) {
        throw new Error(
          `STEP_FAILED: the participant owns profiles in ${[...domains].join(', ') || 'no domain'}, ` +
            `missing ${missing.join(', ')}. A second profile was written to somebody else.`,
        );
      }
    },
  });
