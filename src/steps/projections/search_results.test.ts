import { describe, expect, test } from 'vitest';
import { expectFoundInSearch } from './search_results.js';
import type { StepContext } from '../../journey/define_journey.js';

const ITEM_ID = '5002cde5-8a9d-464a-93bd-f625c2891097';

/** As signals-dpg stores it: contact fields masked, the rest verbatim. */
const STORED = {
  beneficiary_name: 'j***',
  address: '***',
  mobile_number: '122***',
  looking_for_details: 'journey fixture abc123 looking_for_details',
  gender: 'Other',
};

const WRITTEN = {
  beneficiary_name: 'journey-beneficiary_name-abc123',
  address: 'journey-address-abc123',
  looking_for_details: 'journey fixture abc123 looking_for_details',
  gender: 'Other',
};

const ctx = (http: typeof fetch): StepContext => ({
  clients: {},
  state: {
    itemKey: { network: 'purple_dot', domain: 'seeker', type: 'profile_1.0', id: ITEM_ID },
    itemState: { ...WRITTEN },
  },
  endpoints: { signalsApi: '', searchApi: 'http://search', keycloak: '', postgresUrl: '', redisUrl: '', aggregatorApi: '', mailpit: '' },
  seeded: {},
  http,
  auth: { apiKey: 'k', actingOrgId: 'org', participantToken: 't' },
});

/** signals-search echoes the request context alongside the results. */
const response = (items: { item_id: string; item_state?: Record<string, unknown> }[]) =>
  new Response(
    JSON.stringify({
      context: { messageId: `journey-${ITEM_ID}`, networkId: 'purple_dot' },
      message: { items, meta: { total: items.length, limit: 100, offset: 0 } },
    }),
    { status: 200 },
  );

/** Answers an unfiltered query with `row`, and a filtered one by matching it. */
const stubSearch = (row: { item_id: string; item_state: Record<string, unknown> } | null) => {
  const bodies: string[] = [];
  const http = (async (_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body));
    const filters = JSON.parse(String(init?.body)).message.intent.filters as {
      target: string;
      value: unknown;
    }[];
    if (!row) return response([]);
    if (filters.length === 0) return response([row]);
    const key = filters[0]!.target.replace('item_state.', '');
    return response(row.item_state[key] === filters[0]!.value ? [row] : []);
  }) as unknown as typeof fetch;
  return { http, bodies };
};

describe('expectFoundInSearch', () => {
  test('filters on a field search stores verbatim, not one it masks', async () => {
    // purple_dot masks its contact fields: search holds beneficiary_name as
    // "j***" and address as "***", so a filter on either matches nothing
    // however well ingestion worked. The create response is no guide -- it
    // echoes the unmasked values.
    const { http, bodies } = stubSearch({ item_id: ITEM_ID, item_state: STORED });

    await expectFoundInSearch().run(ctx(http));

    const filtered = bodies.map((b) => JSON.parse(b).message.intent.filters).filter((f) => f.length);
    expect(filtered).toHaveLength(1);
    expect(filtered[0][0].target).toBe('item_state.looking_for_details');
  });

  test('fails when search returned nothing, however the id appears elsewhere', async () => {
    // signals-search echoes the request context, and the request carries
    // messageId "journey-<item id>". A whole-body substring check therefore
    // matched its own echo and passed on zero results -- which is what run
    // 34581115232 did.
    const { http } = stubSearch(null);

    await expect(expectFoundInSearch().run(ctx(http))).rejects.toThrow(/not visible to search/i);
  });

  test('fails when the filter matches nothing though the item is there', async () => {
    // The chosen field is stored verbatim, so this can only happen if the
    // filter itself is broken -- a different fault from a missing item.
    const http = (async (_url: string, init?: RequestInit) => {
      const filters = JSON.parse(String(init?.body)).message.intent.filters as unknown[];
      return response(filters.length === 0 ? [{ item_id: ITEM_ID, item_state: STORED }] : []);
    }) as unknown as typeof fetch;

    await expect(expectFoundInSearch().run(ctx(http))).rejects.toThrow(/filter matched nothing/i);
  });

  test('names the masked values when no field survived', async () => {
    const { http } = stubSearch({
      item_id: ITEM_ID,
      item_state: { beneficiary_name: 'j***', address: '***' },
    });
    const c = ctx(http);
    c.state.itemState = {
      beneficiary_name: 'journey-beneficiary_name-abc123',
      address: 'journey-address-abc123',
    };

    await expect(expectFoundInSearch().run(c)).rejects.toThrow(/no identifying field/i);
    await expect(expectFoundInSearch().run(c)).rejects.toThrow(/j\*\*\*/);
  });

  test('issues its searches through ctx.http, so the report can show them', async () => {
    const calls: string[] = [];
    const http = (async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      const filters = JSON.parse(String(init?.body)).message.intent.filters as unknown[];
      return response(
        filters.length === 0 ? [{ item_id: ITEM_ID, item_state: STORED }] : [{ item_id: ITEM_ID, item_state: STORED }],
      );
    }) as unknown as typeof fetch;

    await expectFoundInSearch().run(ctx(http));

    expect(new Set(calls)).toEqual(new Set(['http://search/v1/search']));
  });

  test('does not claim the item is missing when it only saw one page', async () => {
    // total beyond the page means the probe cannot know. Saying "not
    // visible to search -- check lifecycle_status" there sends the reader
    // at the wrong subsystem.
    const http = (async () =>
      new Response(
        JSON.stringify({
          context: {},
          message: { items: [], meta: { total: 4000, limit: 100, offset: 0 } },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    await expect(expectFoundInSearch().run(ctx(http))).rejects.toThrow(/first 0 of 4000/);
  });
});
