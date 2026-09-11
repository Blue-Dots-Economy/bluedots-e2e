import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import { buildSearchBody } from '../request_bodies.js';

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
