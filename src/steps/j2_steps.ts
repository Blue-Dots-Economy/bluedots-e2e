import { step, type StepContext } from '../journey/journey.js';
import { buildSearchBody, buildUpsertBody, extractItemKey } from './steps.js';
import { awaitItemIndexed, captureBaseline, type ItemKey } from '../awaiters/ingest.js';
import { buildItemState } from '../fixtures/item_state.js';
import { ADULT_AGE } from './steps.js';

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`STEP_FAILED: ${what} is not available`);
  return value;
}

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
    label: 'Created a seeker profile',
    run: async (ctx: StepContext) => {
      const auth = required(ctx.auth, 'authentication');
      const target = required(ctx.target, 'target');
      const probe = required(ctx.probe, 'ingest probe');

      ctx.state.baseline = await captureBaseline(probe);

      const itemState = {
        ...buildItemState(
          target.itemSchema as never,
          String(ctx.state.seed ?? Date.now()),
        ),
        // Keep the item's own age consistent with the one consent is
        // recorded against, and adult either way: the schema permits a
        // minimum of 1, and a minor stays draft under the guardian gate
        // regardless of consent.
        ...('age' in ((target.itemSchema.properties ?? {}) as object)
          ? { age: ADULT_AGE }
          : {}),
      };
      // Kept so the search step can isolate THIS item: filters target
      // item_state.<field>, never item_id.
      ctx.state.itemState = itemState;

      const res = await fetch(`${ctx.endpoints.signalsApi}/api/v1/admin/participant`, {
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
            itemType: target.itemType,
            // Generated from the target's own schema, so a second target
            // costs configuration rather than test code.
            itemState,
            name: `Journey ${spec.as}`,
            // Unique per run: the upsert is keyed on the identifier, so a
            // fixed address would update the previous run's participant
            // instead of creating one, and the journey would assert against
            // an item it did not create.
            email: `journey-${spec.as}-${Date.now()}@example.test`,
          }),
        ),
      });

      if (!res.ok) {
        throw new Error(`STEP_FAILED: upsert ${res.status} ${await res.text()}`);
      }
      ctx.state.itemKey = extractItemKey(
        (await res.json()) as Parameters<typeof extractItemKey>[0],
      );
    },
  });

/**
 * Wait until this item was indexed BECAUSE the event crossed the stream.
 *
 * Not "wait until it appears": the reconciliation sweep would satisfy that
 * with the ingest spine dead.
 */
export const waitUntilThisItemIndexed = (deadlineMs = 30_000) =>
  step({
    label: 'Waited until the new profile was picked up for search',
    run: async (ctx: StepContext) => {
      const probe = required(ctx.probe, 'ingest probe');
      await awaitItemIndexed(probe, {
        key: ctx.state.itemKey as ItemKey,
        baseline: ctx.state.baseline as Awaited<ReturnType<typeof captureBaseline>>,
        deadlineMs,
      });
    },
  });

/** Assert set membership, never rank position. */
export const expectFoundInSearch = () =>
  step({
    label: 'Found the profile in search',
    run: async (ctx: StepContext) => {
      const auth = required(ctx.auth, 'authentication');
      const key = ctx.state.itemKey as ItemKey;

      // Isolate this run's item by a generated, seed-distinct text field.
      const itemState = ctx.state.itemState as Record<string, unknown>;
      const field = Object.keys(itemState).find(
        (k) => typeof itemState[k] === 'string' && String(itemState[k]).startsWith('journey'),
      );
      if (!field) throw new Error('STEP_FAILED: no identifying field in the fixture');

      const res = await fetch(`${ctx.endpoints.searchApi}/v1/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': auth.apiKey },
        body: JSON.stringify(buildSearchBody(key, { field, value: itemState[field] })),
      });

      if (!res.ok) {
        throw new Error(`STEP_FAILED: search ${res.status} ${await res.text()}`);
      }
      const body = JSON.stringify(await res.json());
      if (!body.includes(key.id)) {
        throw new Error(`STEP_FAILED: search did not return ${key.id}`);
      }
    },
  });
