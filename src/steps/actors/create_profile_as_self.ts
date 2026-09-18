import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import { ADULT_AGE } from '../request_bodies.js';
import { buildItemState } from '../../fixtures/item_state.js';
import { captureBaseline } from '../../awaiters/ingest.js';
import { captureNotificationBaseline } from '../../awaiters/notification.js';

type CreateResponse = { item_id?: string; item_type?: string };

/**
 * The person creates their own profile, with their own credential.
 *
 * A different route through the system from createProfile, and the one most
 * participants actually take: no service key, no acting org, no
 * `created_by` -- the caller owns what they write. `POST /item/create`
 * refuses `created_by` from anyone but an admin api-key caller, so this
 * cannot accidentally become the aggregator path.
 *
 * The consent block is the point. A domain gating go-live on
 * `consent_required` answers 400 CONSENT_REQUIRED without it, and WITH it
 * the create is itself the profile_creation acceptance -- the item promotes
 * straight to live rather than landing draft and waiting for a second call.
 */
export const createProfileAsSelf = (spec: { as: string }) =>
  step({
    label: `Created their own ${spec.as.replace(/_/g, ' ')} profile`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const target = requireContext(ctx.target, 'target');
      const probe = requireContext(ctx.probe, 'ingest probe');

      // The person's own session when they have one, and a minted
      // credential otherwise. Both put the same participant in
      // `request.user`, but a session is what a person actually holds --
      // and it is the only one available to somebody who signed themselves
      // up, since they have no account anybody else registered.
      const session = state.sessions?.[spec.as];
      const account = session ? undefined : requireState(state, 'accounts')[spec.as];
      if (!session && !account) {
        throw new Error(
          `STEP_FAILED: nobody is signed in as a "${spec.as}" and no account was registered ` +
            `for one, so there is nobody to create a profile as.`,
        );
      }

      state.baseline = await captureBaseline(probe);
      if (ctx.notifications) {
        state.notificationBaseline = await captureNotificationBaseline(ctx.notifications);
      }

      const { itemType, itemSchema } = target.schemaFor(spec.as);
      const itemState = {
        ...buildItemState(itemSchema as never, requireState(state, 'seed')),
        ...('age' in ((itemSchema.properties ?? {}) as object) ? { age: ADULT_AGE } : {}),
      };
      state.itemState = itemState;

      const auth: Record<string, string> = session
        ? { cookie: session.cookie, 'x-csrf-token': session.csrfToken }
        : {
            'x-api-key': await requireContext(ctx.keys, 'participant credentials').issueFor(
              account!.userId,
              `self-${spec.as}`,
            ),
          };

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/item/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({
          item_network: target.network,
          item_domain: spec.as,
          item_type: itemType,
          item_state: itemState,
          // The version is resolved server-side from the network's consent
          // config and the ledger records THAT, never this number -- the
          // field is only here because the request schema requires one. So
          // a target bumping its profile_creation version cannot silently
          // put this journey out of date.
          consent: { category: 'profile_creation', version: 1 },
        }),
      });

      if (!res.ok) {
        throw new Error(`STEP_FAILED: self create ${res.status} ${await res.text()}`);
      }

      const created = (await res.json()) as CreateResponse;
      if (!created.item_id) {
        throw new Error('STEP_FAILED: the create returned no item_id.');
      }

      const key = {
        network: target.network,
        domain: spec.as,
        type: created.item_type ?? itemType,
        id: created.item_id,
      };

      // Asserted here rather than left to the search step. The create
      // answers 201 whether the item landed live or draft, and a draft is
      // invisible to search however well ingestion works -- so a consent
      // regression would surface three steps later as a missing search hit
      // and point at the wrong subsystem entirely.
      const status = await probe.lifecycleStatus(key);
      if (status !== 'live') {
        throw new Error(
          `STEP_FAILED: the self-created profile is ${status ?? 'missing'}, not live. ` +
            `A consenting create promotes straight to live, so either the consent was not ` +
            `recorded or the domain gates go-live on something else it did not satisfy.`,
        );
      }

      state.itemKey = key;
      state.profiles = {
        ...state.profiles,
        [spec.as]: {
          key,
          itemState,
          email: account?.email ?? requireState(state, 'signups')[spec.as]!.email,
          // Only an account path knows the id up front. A signed-in person's
          // is their Keycloak subject, and no step needs it.
          userId: account?.userId ?? '',
        },
      };
    },
  });
