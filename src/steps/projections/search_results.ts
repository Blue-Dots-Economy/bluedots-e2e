import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import { buildSearchBody } from '../request_bodies.js';

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
      const written = requireState(ctx.state, 'itemState');

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
        const body = (await res.json()) as SearchResponse;
        return {
          items: body.message?.items ?? [],
          total: body.message?.meta?.total ?? body.message?.items?.length ?? 0,
        };
      };

      const where = `${key.network}/${key.domain}/${key.type}`;

      // What does search actually hold for this item? Asked first, because
      // the filter has to match the INDEXED value and nothing else knows
      // what that is. signals-dpg masks its domain's contact fields --
      // purple_dot stores beneficiary_name as "j***" -- and the upsert
      // response is no guide, since it echoes the unmasked values back to
      // the caller that wrote them.
      const visible = await search(null);
      const row = visible.items.find((i) => i.item_id === key.id);
      if (!row) {
        // Only claim absence when the whole set was seen. A page of a
        // larger index says nothing about what is on the other pages, and
        // pointing at lifecycle_status there sends the reader at the wrong
        // subsystem entirely.
        const sawEverything = visible.items.length >= visible.total;
        throw new Error(
          sawEverything
            ? `STEP_FAILED: ${key.id} is not visible to search. An unfiltered query of ${where} ` +
              `returned all ${visible.total} item(s) and this is not among them, so the item ` +
              `reached item_search but search cannot see it -- check lifecycle_status and the ` +
              `items join.`
            : `STEP_FAILED: ${key.id} was not in the first ${visible.items.length} of ` +
              `${visible.total} item(s) in ${where}, so whether search can see it is unknown. ` +
              `This step's probe reads one page; against a shared or long-lived environment, ` +
              `assert through a filtered query only.`,
        );
      }

      const field = identifyingField(written, row.item_state ?? {});
      if (!field) throw new Error(noSurvivingField(written, row.item_state ?? {}));

      const filtered = await search({ field, value: written[field] });
      if (filtered.items.some((i) => i.item_id === key.id)) return;

      throw new Error(
        `STEP_FAILED: the filter matched nothing, though ${key.id} is in ${where} and ` +
          `search holds item_state.${field} = ${JSON.stringify(row.item_state?.[field])}, ` +
          `exactly what was filtered on. The filter path is broken, not the indexing.`,
      );
    },
  });

/**
 * A field that isolates THIS run's item in the index.
 *
 * Seed-distinct so a previous run's item cannot satisfy it, and stored
 * verbatim so the filter can match at all. Derived per run rather than
 * configured per network: which fields a domain masks is signals-dpg's
 * business, and a target that masks something else needs no change here.
 */
function identifyingField(
  written: Record<string, unknown>,
  stored: Record<string, unknown>,
): string | undefined {
  return Object.keys(written).find(
    (k) =>
      typeof written[k] === 'string' &&
      String(written[k]).startsWith('journey') &&
      stored[k] === written[k],
  );
}

function noSurvivingField(
  written: Record<string, unknown>,
  stored: Record<string, unknown>,
): string {
  const tried = Object.keys(written).filter(
    (k) => typeof written[k] === 'string' && String(written[k]).startsWith('journey'),
  );
  const asStored = Object.fromEntries(tried.map((k) => [k, stored[k] ?? null]));
  return (
    `STEP_FAILED: no identifying field survived indexing. Tried ` +
    `${tried.join(', ') || '(none)'}; search holds ${JSON.stringify(asStored)}. ` +
    `Every seed-distinct field in this fixture is rewritten on the way in (masked ` +
    `contact fields, say), so nothing can isolate this run's item -- give the ` +
    `fixture a seed-distinct value in a field the domain stores verbatim.`
  );
}
