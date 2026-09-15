import { step, type StepContext } from '../../journey/define_journey.js';
import { requireState } from '../../journey/state.js';

type DiscoverResponse = { items?: { item_id: string }[]; meta?: { total?: number } };

/**
 * Assert the profile reaches the feed a reader actually browses.
 *
 * A different path from /v1/search: signals-dpg's BFF owns the request,
 * restricts `q` and facets to declared non-private fields server-side, and
 * falls back to a native distance/recency query when signals-search is
 * down. So a profile can be in signals-search and still be missing here --
 * which is the seam this asserts and the search journey cannot.
 *
 * With `byFacet`, the filter is the assertion: the BFF drops a filter on an
 * undeclared or private field rather than erroring, so a facet that is
 * quietly ignored returns the item anyway and would look like a pass. The
 * step therefore also checks a deliberately wrong value returns nothing.
 */
export const expectFoundInDiscover = (spec: { byFacet?: boolean } = {}) =>
  step({
    label: spec.byFacet
      ? 'Found the profile in the browse feed by filtering on a declared field'
      : 'Found the profile in the browse feed',
    run: async (ctx: StepContext) => {
      const key = requireState(ctx.state, 'itemKey');
      const written = requireState(ctx.state, 'itemState');

      const field = Object.keys(written).find(
        (k) => typeof written[k] === 'string' && String(written[k]).startsWith('journey'),
      );
      if (!field) throw new Error('STEP_FAILED: no identifying field in the fixture');

      const discover = async (filters?: { field: string; values: unknown[] }[]) => {
        const res = await ctx.http(
          `${ctx.endpoints.signalsApi}/api/v1/network/item/discover`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              item_network: key.network,
              item_domain: key.domain,
              item_type: key.type,
              ...(filters ? { filters } : {}),
            }),
          },
        );
        if (!res.ok) {
          throw new Error(`STEP_FAILED: discover ${res.status} ${await res.text()}`);
        }
        const body = (await res.json()) as DiscoverResponse;
        return { items: body.items ?? [], total: body.meta?.total ?? 0 };
      };

      if (!spec.byFacet) {
        const page = await discover();
        if (page.items.some((i) => i.item_id === key.id)) return;
        throw new Error(
          `STEP_FAILED: ${key.id} is not in the browse feed for ${key.network}/${key.domain}/` +
            `${key.type}. The feed returned ${page.items.length} of ${page.total} item(s). ` +
            `The BFF falls back to a native query when signals-search is unreachable, so ` +
            `this can be missing while /v1/search holds it.`,
        );
      }

      const matching = await discover([{ field, values: [written[field]] }]);
      if (!matching.items.some((i) => i.item_id === key.id)) {
        throw new Error(
          `STEP_FAILED: filtering ${field} = ${JSON.stringify(written[field])} did not ` +
            `return ${key.id}; the feed gave ${matching.items.length} item(s).`,
        );
      }

      // A filter the BFF silently dropped would have returned the item too.
      const other = await discover([{ field, values: ['journey-no-such-value'] }]);
      if (other.items.some((i) => i.item_id === key.id)) {
        throw new Error(
          `STEP_FAILED: filtering ${field} on a value nothing has still returned ${key.id}, ` +
            `so the filter was ignored rather than applied. The BFF drops a filter on an ` +
            `undeclared or private field instead of erroring, which is what this catches.`,
        );
      }
    },
  });
