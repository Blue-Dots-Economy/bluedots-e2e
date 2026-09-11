import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import { buildSearchBody } from '../request_bodies.js';
import type { ItemKey } from '../../awaiters/ingest.js';

type SearchItem = { item_id: string; item_state?: Record<string, unknown> };

type SearchResponse = {
  message?: { items?: SearchItem[]; meta?: { total?: number } };
};

/** Assert set membership, never rank position. */
export const expectFoundInSearch = () =>
  step({
    label: 'Found the profile in search',
    run: async (ctx: StepContext) => {
      const auth = requireContext(ctx.auth, 'authentication');
      const key = requireState(ctx.state, 'itemKey');

      // Isolate this run's item by a generated, seed-distinct text field --
      // and only one the API stored unchanged. purple_dot's
      // beneficiary_name is its contact_fields.name and comes back masked,
      // so a filter on it can never match. Comparing written against stored
      // finds a surviving field without per-network knowledge of which
      // fields get rewritten.
      const itemState = requireState(ctx.state, 'itemState');
      const stored = requireState(ctx.state, 'storedItemState');
      const candidates = Object.keys(itemState).filter(
        (k) => typeof itemState[k] === 'string' && String(itemState[k]).startsWith('journey'),
      );
      const field = candidates.find((k) => stored[k] === itemState[k]);
      if (!field) {
        throw new Error(
          `STEP_FAILED: no identifying field survived the write. Tried ` +
            `${candidates.join(', ') || '(none)'}; the API stored ` +
            `${JSON.stringify(Object.fromEntries(candidates.map((k) => [k, stored[k]])))}. ` +
            `Search can only isolate this run's item by a field it stores verbatim.`,
        );
      }

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

      const found = (items: SearchItem[]) => items.some((i) => i.item_id === key.id);

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
  filtered: SearchItem[],
  unfiltered: SearchItem[],
): string {
  const where = `${key.network}/${key.domain}/${key.type}`;
  const ours = unfiltered.find((i) => i.item_id === key.id);
  if (ours) {
    // The row is right here, so the message quotes what is stored rather
    // than saying it differs and leaving the reader to go and look. A
    // masked value reads very differently from a trimmed one.
    const stored = ours.item_state?.[field];
    // The whole row, not just the one field: the create response can echo
    // a value the searchable mirror does not hold, so this is the only
    // place that says what search actually has to match against.
    const strings = Object.fromEntries(
      Object.entries(ours.item_state ?? {}).filter(([, v]) => typeof v === 'string'),
    );
    return (
      `STEP_FAILED: the filter matched nothing, though ${key.id} is in ${where}. ` +
      `eq item_state.${field} = ${JSON.stringify(value)} returned ${filtered.length} item(s); ` +
      `unfiltered returned ${unfiltered.length}, and that row has ${field} ` +
      `stored ${JSON.stringify(stored ?? null)}. Filtering on a field the API rewrites ` +
      `(a masked contact field, say) can never match what the journey wrote. ` +
      `The row's string fields as search holds them: ${JSON.stringify(strings)}`
    );
  }
  return (
    `STEP_FAILED: ${key.id} is not visible to search. An unfiltered query of ${where} ` +
    `returned ${unfiltered.length} item(s), none of them this one, so the item reached ` +
    `item_search but search cannot see it -- check lifecycle_status and the items join.`
  );
}
