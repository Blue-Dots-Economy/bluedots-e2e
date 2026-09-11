import { describe, expect, test } from 'vitest';
import { expectFoundInSearch } from './search_results.js';
import type { StepContext } from '../../journey/define_journey.js';

const ITEM_ID = '5002cde5-8a9d-464a-93bd-f625c2891097';

const ctx = (http: typeof fetch): StepContext => ({
  clients: {},
  state: {
    itemKey: { network: 'purple_dot', domain: 'seeker', type: 'profile_1.0', id: ITEM_ID },
    itemState: { beneficiary_name: 'journey-abc123' },
  },
  endpoints: { signalsApi: '', searchApi: 'http://search', keycloak: '', postgresUrl: '', redisUrl: '' },
  seeded: {},
  http,
  auth: { apiKey: 'k', actingOrgId: 'org', participantToken: 't' },
});

/** What signals-search returns: the request context, echoed, plus results. */
const response = (items: { item_id: string }[]) =>
  new Response(
    JSON.stringify({
      context: { messageId: `journey-${ITEM_ID}`, networkId: 'purple_dot' },
      message: { items, meta: { total: items.length, limit: 20, offset: 0 } },
    }),
    { status: 200 },
  );

describe('expectFoundInSearch', () => {
  test('fails when search returned nothing, however the id appears elsewhere', async () => {
    // signals-search echoes the request context, and the request carries
    // messageId "journey-<item id>". A whole-body substring check therefore
    // matches its own echo and passes on zero results -- which is exactly
    // what run 34581115232 did.
    const http = (async () => response([])) as unknown as typeof fetch;

    await expect(expectFoundInSearch().run(ctx(http))).rejects.toThrow(/STEP_FAILED/);
  });

  test('passes when the item is among the returned items', async () => {
    const http = (async () => response([{ item_id: ITEM_ID }])) as unknown as typeof fetch;

    await expect(expectFoundInSearch().run(ctx(http))).resolves.toBeUndefined();
  });

  test('fails when search returned other items but not this one', async () => {
    const http = (async () => response([{ item_id: 'someone-else' }])) as unknown as typeof fetch;

    await expect(expectFoundInSearch().run(ctx(http))).rejects.toThrow(/STEP_FAILED/);
  });

  test('says whether the filter or the indexing is at fault', async () => {
    // Zero results has two very different causes: the item is not visible
    // to search at all, or it is visible and the filter did not match. The
    // unfiltered re-query separates them, so a red run names the subsystem.
    const bodies: string[] = [];
    const http = (async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      // Unfiltered: the item IS there. So the filter is what failed.
      return response(bodies.length === 1 ? [] : [{ item_id: ITEM_ID }]);
    }) as unknown as typeof fetch;

    await expect(expectFoundInSearch().run(ctx(http))).rejects.toThrow(
      /filter matched nothing/i,
    );
    expect(JSON.parse(bodies[1]!).message.intent.filters ?? []).toHaveLength(0);
  });

  test('names indexing when the item is absent even unfiltered', async () => {
    const http = (async () => response([])) as unknown as typeof fetch;

    await expect(expectFoundInSearch().run(ctx(http))).rejects.toThrow(/not visible to search/i);
  });

  test('issues its search through ctx.http, so the report can show the request', async () => {
    const calls: string[] = [];
    const http = (async (url: string) => {
      calls.push(String(url));
      return response([{ item_id: ITEM_ID }]);
    }) as unknown as typeof fetch;

    await expectFoundInSearch().run(ctx(http));

    expect(calls).toEqual(['http://search/v1/search']);
  });
});
