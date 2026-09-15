import { step, type StepContext } from '../../journey/define_journey.js';
import { probeSearch } from './search_results.js';

/**
 * Assert the profile is NOT returned by search.
 *
 * The mirror of expectFoundInSearch, and it has a trap of its own: an empty
 * result is also what a broken filter, a wrong network or an unindexed item
 * returns, so "not found" on its own proves nothing. This first checks the
 * item IS in the index unfiltered -- then a filtered query that misses is
 * about visibility rather than about the query, which is the distinction a
 * paused or retired profile actually tests.
 */
export const expectNotFoundInSearch = (opts: { because: string }) =>
  step({
    label: `Could no longer find the profile in search, ${opts.because}`,
    run: async (ctx: StepContext) => {
      const { search, key, written, where } = await probeSearch(ctx);

      const field = Object.keys(written).find(
        (k) => typeof written[k] === 'string' && String(written[k]).startsWith('journey'),
      );
      if (!field) throw new Error('STEP_FAILED: no identifying field in the fixture');

      const filtered = await search({ field, value: written[field] });
      if (!filtered.items.some((i) => i.item_id === key.id)) return;

      // Still there. Say whether the read model still holds it live, which
      // separates "the event never published" from "search ignores status".
      const unfiltered = await search(null);
      const row = unfiltered.items.find((i) => i.item_id === key.id);
      throw new Error(
        `STEP_FAILED: ${key.id} is still returned by search in ${where}, ${opts.because}. ` +
          `Every lifecycle transition publishes an item event and signals-search is ` +
          `live-only, so either the transition published nothing or the index still ` +
          `holds the old row${row ? ' (it is in the unfiltered page too)' : ''}.`,
      );
    },
  });
