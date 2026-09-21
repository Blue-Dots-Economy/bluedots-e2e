import { step, type StepContext } from '../../journey/define_journey.js';
import { requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

type FetchResponse = {
  meta?: { total?: number; limit?: number; offset?: number };
  items?: { item_id?: string }[];
};

/**
 * The listing route the voice assistant reads, answering as it does.
 *
 * A different route from the browse feed the other journeys assert on:
 * `/network/item/discover` is the BFF the web app calls, while this one is
 * the peer-to-peer listing an assistant uses to fetch what a provider has
 * posted. Nothing else here touches it, so a regression in it would have
 * been invisible to this suite and visible to every caller on a phone.
 *
 * Sent unsigned and unauthenticated, because that is how the assistant
 * sends it: the route is behind the peer guard, which admits an unsigned
 * request while PEER_AUTH_MODE is `permissive` -- its default. Adding a
 * credential here would test a path the real caller does not take.
 */
export const expectListedForTheAssistant = (spec: { as: string }) =>
  step({
    label: `The new ${spec.as.replace(/_/g, ' ')} listing is returned to an assistant`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const profile = requireState(state, 'profiles')[spec.as];
      if (!profile) {
        throw new Error(`STEP_FAILED: this journey created no "${spec.as}" to look for.`);
      }

      const res = await ctx.http(
        `${ctx.endpoints.signalsApi}/api/v1/network/item/fetch_local`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            item_network: profile.key.network,
            item_domain: profile.key.domain,
            item_type: profile.key.type,
            item_state: {},
            // The assistant asks for a page of 20. A run puts more than
            // that in the corpus, so this asks for the largest page the
            // route allows -- the same query, sized so a present item
            // cannot be absent merely by having fallen off page one.
            limit: 1000,
            offset: 0,
          }),
        },
      );

      if (!res.ok) {
        throw new Error(
          `STEP_FAILED: listing ${res.status} ${await res.text()}. A 401 here means the peer ` +
            `guard is enforcing signatures, which the assistant does not send.`,
        );
      }

      const body = (await res.json()) as FetchResponse;
      const found = (body.items ?? []).some((item) => item.item_id === profile.key.id);
      if (!found) {
        throw new Error(
          `STEP_FAILED: the listing returned ${body.items?.length ?? 0} of ` +
            `${body.meta?.total ?? 'unknown'} items and this journey's is not among them. It ` +
            `is live and in the write model, so this is the listing route rather than the ` +
            `profile.`,
        );
      }
    },
  });
