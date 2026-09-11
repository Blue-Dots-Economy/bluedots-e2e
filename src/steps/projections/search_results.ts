import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import { buildSearchBody } from '../request_bodies.js';
import type { ItemKey } from '../../awaiters/ingest.js';

type SearchResponse = {
  message?: { items?: { item_id: string }[]; meta?: { total?: number } };
};

/** Assert set membership, never rank position. */
export const expectFoundInSearch = () =>
  step({
    label: 'Found the profile in search',
    run: async (ctx: StepContext) => {
      const auth = requireContext(ctx.auth, 'authentication');
      const key = requireState(ctx.state, 'itemKey');

      // Isolate this run's item by a generated, seed-distinct text field.
      const itemState = requireState(ctx.state, 'itemState');
      const field = Object.keys(itemState).find(
        (k) => typeof itemState[k] === 'string' && String(itemState[k]).startsWith('journey'),
      );
      if (!field) throw new Error('STEP_FAILED: no identifying field in the fixture');

      const search = async (filter: { field: string; value: unknown } | null) => {
        const res = await ctx.http(`${ctx.endpoints.searchApi}/v1/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': auth.apiKey },
          body: JSON.stringify(buildSearchBody(key, filter)),
        });

        if (!res.ok) {
          throw new Error(`STEP_FAILED: search ${res.status} ${await res.text()}`);
        }
        // message.items[].item_id, never a substring of the whole body:
        // signals-search echoes the request context, and the request
        // carries messageId "journey-<item id>", so a whole-body check
        // matches its own echo and passes on zero results.
        return ((await res.json()) as SearchResponse).message?.items ?? [];
      };

      const found = (items: { item_id: string }[]) => items.some((i) => i.item_id === key.id);

      const filtered = await search({ field, value: itemState[field] });
      if (found(filtered)) return;

      // Zero results has two causes with different fixes. Re-querying the
      // same context unfiltered says which one, so the failure names a
      // subsystem instead of leaving the reader to guess.
      const unfiltered = await search(null);
      throw new Error(describeMiss(key, field, itemState[field], filtered, unfiltered));
    },
  });

function describeMiss(
  key: ItemKey,
  field: string,
  value: unknown,
  filtered: { item_id: string }[],
  unfiltered: { item_id: string }[],
): string {
  const where = `${key.network}/${key.domain}/${key.type}`;
  if (unfiltered.some((i) => i.item_id === key.id)) {
    return (
      `STEP_FAILED: the filter matched nothing, though ${key.id} is in ${where}. ` +
      `eq item_state.${field} = ${JSON.stringify(value)} returned ${filtered.length} item(s); ` +
      `unfiltered returned ${unfiltered.length}. The stored value differs from the one written.`
    );
  }
  return (
    `STEP_FAILED: ${key.id} is not visible to search. An unfiltered query of ${where} ` +
    `returned ${unfiltered.length} item(s), none of them this one, so the item reached ` +
    `item_search but search cannot see it -- check lifecycle_status and the items join.`
  );
}
