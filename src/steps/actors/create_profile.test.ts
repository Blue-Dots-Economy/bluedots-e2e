import { describe, expect, test } from 'vitest';
import { createProfile } from './create_profile.js';
import type { StepContext } from '../../journey/define_journey.js';
import type { IngestProbe } from '../../awaiters/ingest.js';

const probe: IngestProbe = {
  lastStreamId: async () => '1-0',
  dlqLength: async () => 0,
  groupLastDeliveredId: async () => '1-0',
  pendingCount: async () => 0,
  indexedAt: async () => null,
};

const okResponse = () =>
  new Response(
    JSON.stringify({
      items: [
        {
          item_network: 'purple_dot',
          item_domain: 'seeker',
          item_type: 'profile_1.0',
          item_id: 'itm_1',
          lifecycle_status: 'live',
          item_state: { headline: 'journey-abc123', beneficiary_name: '***' },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const ctx = (http: typeof fetch): StepContext => ({
  clients: {},
  state: { seed: 'abc123' },
  endpoints: { signalsApi: 'http://signals', searchApi: '', keycloak: '', postgresUrl: '', redisUrl: '' },
  seeded: {},
  http,
  probe,
  target: {
    network: 'purple_dot',
    domain: 'seeker',
    itemType: 'profile_1.0',
    itemSchema: { required: ['headline'], properties: { headline: { type: 'string' } } },
  },
  auth: { apiKey: 'k', actingOrgId: 'org', participantToken: 't' },
});

describe('createProfile', () => {
  test('issues its upsert through ctx.http, so the report can show the request', async () => {
    const calls: string[] = [];
    const http = (async (url: string) => {
      calls.push(String(url));
      return okResponse();
    }) as unknown as typeof fetch;

    await createProfile({ as: 'seeker' }).run(ctx(http));

    expect(calls).toEqual(['http://signals/api/v1/admin/participant']);
  });

  test('keeps the item_state the API stored, not only the one it sent', async () => {
    // signals-dpg rewrites some fields on the way in -- a masked contact
    // field is not the value the journey wrote. A later step that filters
    // on one of those can never match, so the search step needs to know
    // which fields survived the round trip.
    const http = (async () => okResponse()) as unknown as typeof fetch;
    const c = ctx(http);

    await createProfile({ as: 'seeker' }).run(c);

    expect(c.state.storedItemState).toEqual({
      headline: 'journey-abc123',
      beneficiary_name: '***',
    });
  });
});
