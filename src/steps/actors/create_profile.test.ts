import { describe, expect, test } from 'vitest';
import { createProfile } from './create_profile.js';
import type { StepContext } from '../../journey/define_journey.js';
import type { IngestProbe } from '../../awaiters/ingest.js';
import { buildTargetSchemas } from '../../targets/target_schemas.js';

const probe: IngestProbe = {
  lastStreamId: async () => '1-0',
  dlqLength: async () => 0,
  groupLastDeliveredId: async () => '1-0',
  pendingCount: async () => 0,
  indexedAt: async () => null,
  lifecycleStatus: async () => 'live',
  instanceUrl: async () => 'http://signals:2742',
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
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const ctx = (http: typeof fetch): StepContext => ({
  clients: {},
  state: { seed: 'abc123' },
  endpoints: { signalsApi: 'http://signals', searchApi: '', keycloak: '', postgresUrl: '', redisUrl: '', aggregatorApi: '', mailpit: '' },
  seeded: {},
  http,
  probe,
  target: buildTargetSchemas({
    id: 'purple_dot',
    domains: [
      {
        id: 'seeker',
        item_schemas: {
          'profile_1.0': { required: ['headline'], properties: { headline: { type: 'string' } } },
        },
      },
    ],
  }),
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


  test('derives the participant address from the seed, so a replay replays', async () => {
    // Date.now() in the address meant JOURNEY_SEED reproduced the fixture
    // but not the participant: the upsert is keyed on the address, so a
    // replay created a new one instead of re-running against the same.
    const seen: string[] = [];
    const http = (async (_url: string, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)).email);
      return okResponse();
    }) as unknown as typeof fetch;

    await createProfile({ as: 'seeker' }).run(ctx(http));
    await createProfile({ as: 'seeker' }).run(ctx(http));

    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toContain('abc123');
  });

  test('reads a snake_case domain as words, so the label passes its own guard', () => {
    // checkLabel rejects identifiers and defineJourney runs the guards at
    // definition time, so `Created a service_provider profile` throws at
    // module load and takes the whole suite with it. blue_dot/ka-dhwd
    // declares service_provider -- the domain the dynamic label was written
    // for in the first place.
    expect(createProfile({ as: 'service_provider' }).label).toBe(
      'Created a service provider profile',
    );
  });

  test('still reads naturally for a one-word domain', () => {
    expect(createProfile({ as: 'seeker' }).label).toBe('Created a seeker profile');
  });
});
