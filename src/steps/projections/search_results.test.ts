import { describe, expect, test } from 'vitest';
import { expectFoundInSearch } from './search_results.js';
import type { StepContext } from '../../journey/define_journey.js';

const ctx = (http: typeof fetch): StepContext => ({
  clients: {},
  state: {
    itemKey: { network: 'purple_dot', domain: 'seeker', type: 'profile_1.0', id: 'itm_1' },
    itemState: { headline: 'journey-abc123' },
  },
  endpoints: { signalsApi: '', searchApi: 'http://search', keycloak: '', postgresUrl: '', redisUrl: '' },
  seeded: {},
  http,
  auth: { apiKey: 'k', actingOrgId: 'org', participantToken: 't' },
});

describe('expectFoundInSearch', () => {
  test('issues its search through ctx.http, so the report can show the request', async () => {
    const calls: string[] = [];
    const http = (async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ results: [{ item_id: 'itm_1' }] }), { status: 200 });
    }) as unknown as typeof fetch;

    await expectFoundInSearch().run(ctx(http));

    expect(calls).toEqual(['http://search/v1/search']);
  });
});
