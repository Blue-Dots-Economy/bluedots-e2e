import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import { buildUpsertBody, extractItemKey, ADULT_AGE } from '../request_bodies.js';
import { buildItemState } from '../../fixtures/item_state.js';
import { captureBaseline } from '../../awaiters/ingest.js';

/**
 * Create a profile that is actually searchable.
 *
 * Goes through the aggregator upsert rather than a self-signup: search only
 * returns `live` items, and a profile promotes past `draft` only with
 * consent and an owning aggregator org. The seeded org supplies the latter.
 *
 * The ingest baseline is captured HERE, before the write, so "the stream
 * advanced" and "the dead-letter stream is unchanged" have a reference
 * point that predates the event.
 */
export const createProfile = (spec: { as: string }) =>
  step({
    // Named for the domain it acts as. blue_dot declares provider and
    // service_provider as well, and in a design where the label IS the
    // report line, printing "seeker" for a provider profile is wrong in
    // the business-facing report and in every recorder step key.
    //
    // Underscores become spaces: checkLabel rejects identifiers and
    // defineJourney runs the guards at definition time, so
    // "Created a service_provider profile" would throw at module load and
    // take the suite with it -- on the very domain this label was written
    // for.
    label: `Created a ${spec.as.replace(/_/g, ' ')} profile`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const auth = requireContext(ctx.auth, 'authentication');
      const target = requireContext(ctx.target, 'target');
      const probe = requireContext(ctx.probe, 'ingest probe');

      state.baseline = await captureBaseline(probe);

      // Resolved from the domain this step acts as, not from whatever
      // domain the spec pinned: the two diverging is how a provider
      // profile got built out of the seeker schema.
      const { itemType, itemSchema } = target.schemaFor(spec.as);

      const itemState = {
        ...buildItemState(itemSchema as never, requireState(state, 'seed')),
        // Keep the item's own age consistent with the one consent is
        // recorded against, and adult either way: the schema permits a
        // minimum of 1, and a minor stays draft under the guardian gate
        // regardless of consent.
        ...('age' in ((itemSchema.properties ?? {}) as object)
          ? { age: ADULT_AGE }
          : {}),
      };
      // Kept so the search step can isolate THIS item: filters target
      // item_state.<field>, never item_id.
      state.itemState = itemState;

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
            // Generated from the target's own schema, so a second target
            // costs configuration rather than test code.
            itemState,
            name: `Journey ${spec.as}`,
            // Unique per RUN and reproducible from the seed. The upsert is
            // keyed on the address, so a fixed one would update the previous
            // run's participant; a clock-derived one made JOURNEY_SEED
            // reproduce the fixture but not the participant, which is most
            // of what a replay is for.
            email: `journey-${spec.as}-${requireState(state, 'seed')}@example.test`,
          }),
        ),
      });

      if (!res.ok) {
        throw new Error(`STEP_FAILED: upsert ${res.status} ${await res.text()}`);
      }
      state.itemKey = extractItemKey(
        (await res.json()) as Parameters<typeof extractItemKey>[0],
      );
    },
  });
