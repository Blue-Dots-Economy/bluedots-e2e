import { describe, expect, test } from 'vitest';
import { registerAccount } from './register_account.js';
import { createProfileAsSelf } from './create_profile_as_self.js';
import { applyTo } from './apply_to.js';
import { respondToRequest } from './respond_to_request.js';
import type { StepContext } from '../../journey/define_journey.js';
import type { IngestProbe } from '../../awaiters/ingest.js';
import { buildTargetSchemas } from '../../targets/target_schemas.js';

const probe = (lifecycle: string | null = 'live'): IngestProbe => ({
  lastStreamId: async () => '1-0',
  dlqLength: async () => 0,
  groupLastDeliveredId: async () => '1-0',
  pendingCount: async () => 0,
  indexedAt: async () => null,
  lifecycleStatus: async () => lifecycle,
  instanceUrl: async () => 'http://signals:2742',
});

const target = buildTargetSchemas({
  id: 'blue_dot',
  domains: [
    {
      id: 'seeker',
      item_schemas: {
        'profile_1.0': { required: ['name'], properties: { name: { type: 'string' } } },
      },
    },
    {
      id: 'provider',
      item_schemas: {
        'job_posting_1.0': { required: ['role'], properties: { role: { type: 'string' } } },
      },
    },
  ],
});

/** The state object is used BY REFERENCE, so a test can assert what a step recorded. */
const ctx = (
  http: typeof fetch,
  state: Record<string, unknown> = {},
  lifecycle: string | null = 'live',
): StepContext => ({
  clients: {},
  state: Object.assign(state, { seed: state.seed ?? 'abc123' }),
  endpoints: { signalsApi: 'http://signals', searchApi: '', keycloak: '', postgresUrl: '', redisUrl: '', aggregatorApi: '', mailpit: '' },
  seeded: {},
  http,
  probe: probe(lifecycle),
  keys: { issueFor: async (userId) => `key-for-${userId}` },
  target,
  auth: { apiKey: 'k', actingOrgId: 'org', participantToken: 't' },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('registerAccount', () => {
  test('omits item_state, which is what puts the route in account-only mode', async () => {
    let sent: Record<string, unknown> = {};
    const http = (async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return json({ user_id: 'usr_1', items: [] });
    }) as unknown as typeof fetch;

    const state: Record<string, unknown> = {};
    await registerAccount({ as: 'seeker' }).run(ctx(http, state));

    expect(sent).not.toHaveProperty('item_state');
    expect((state as { accounts: Record<string, unknown> }).accounts.seeker).toEqual({
      userId: 'usr_1',
      email: 'journey-account-seeker-abc123@example.test',
    });
  });

  test('fails when an item came back, because then this is not the account-only path', async () => {
    // Silent regression shape: the route writes a profile, the self-create
    // that follows makes a SECOND one, and the journey still passes while
    // asserting nothing about self-service.
    const http = (async () => json({ user_id: 'usr_1', items: [{ item_id: 'i' }] })) as unknown as typeof fetch;

    await expect(registerAccount({ as: 'seeker' }).run(ctx(http, {}))).rejects.toThrow(
      /account-only path/,
    );
  });
});

describe('createProfileAsSelf', () => {
  const accounts = { accounts: { seeker: { userId: 'usr_1', email: 'a@b.test' } } };

  test('authenticates as the person and never sends created_by', async () => {
    let headers: Record<string, string> = {};
    let sent: Record<string, unknown> = {};
    const http = (async (_url: string, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>;
      sent = JSON.parse(String(init?.body));
      return json({ item_id: 'itm_1', item_type: 'profile_1.0' }, 201);
    }) as unknown as typeof fetch;

    await createProfileAsSelf({ as: 'seeker' }).run(ctx(http, accounts));

    expect(headers['x-api-key']).toBe('key-for-usr_1');
    // created_by is what makes it the aggregator path; the route refuses it
    // from a non-admin caller, and sending it would turn a green run into a
    // test of a different route.
    expect(sent).not.toHaveProperty('created_by');
    expect(sent.consent).toEqual({ category: 'profile_creation', version: 1 });
  });

  test('fails when the profile landed draft, not three steps later at the search', async () => {
    const http = (async () => json({ item_id: 'itm_1' }, 201)) as unknown as typeof fetch;

    await expect(
      createProfileAsSelf({ as: 'seeker' }).run(ctx(http, accounts, 'draft')),
    ).rejects.toThrow(/is draft, not live/);
  });
});

const twoProfiles = {
  profiles: {
    seeker: {
      key: { network: 'blue_dot', domain: 'seeker', type: 'profile_1.0', id: 'itm_s' },
      itemState: {},
      email: 's@b.test',
      userId: 'usr_s',
    },
    provider: {
      key: { network: 'blue_dot', domain: 'provider', type: 'job_posting_1.0', id: 'itm_p' },
      itemState: {},
      email: 'p@b.test',
      userId: 'usr_p',
    },
  },
};

describe('applyTo', () => {
  test('names the instance the target actually lives on, rather than guessing one', async () => {
    // A guess does not fail here: it fails at the reveal, with
    // CROSS_INSTANCE_REVEAL_NOT_SUPPORTED, two steps and one subsystem away.
    // Read from the write model, because /item/fetch is scoped to the
    // caller's own items and answers "absent" for a counterparty's.
    let sent: { target_item?: { item_instance_url?: string } } = {};
    const http = (async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return json({ summary: { total: 1, succeeded: 1, failed: 0 }, results: [{ action_id: 'act_1' }] }, 201);
    }) as unknown as typeof fetch;

    const state: Record<string, unknown> = { ...twoProfiles };
    await applyTo({ action: 'apply', from: 'seeker', to: 'provider' }).run(ctx(http, state));

    expect(sent.target_item?.item_instance_url).toBe('http://signals:2742');
    expect((state as { actionId?: string }).actionId).toBe('act_1');
  });

  test('reports the bulk row error, not just the status code', async () => {
    const http = (async () =>
      json(
        { results: [{ status: 'error', error: 'CONSENT_REQUIRED', message: 'no consent' }] },
        422,
      )) as unknown as typeof fetch;

    await expect(
      applyTo({ action: 'apply', from: 'seeker', to: 'provider' }).run(ctx(http, { ...twoProfiles })),
    ).rejects.toThrow(/CONSENT_REQUIRED/);
  });
});

describe('respondToRequest', () => {
  test('sends a batch, because the route rejects a bare object', async () => {
    let sent: unknown;
    const http = (async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return json({ summary: { total: 1, succeeded: 1, failed: 0 }, results: [{}] });
    }) as unknown as typeof fetch;

    await respondToRequest({ as: 'provider', status: 'accepted' }).run(
      ctx(http, { ...twoProfiles, actionId: 'act_1' }),
    );

    expect(Array.isArray(sent)).toBe(true);
  });

  test('fails on a 200 whose single row failed', async () => {
    // The shape that makes bulk routes dangerous to assert on: HTTP 200,
    // nothing accepted.
    const http = (async () =>
      json({
        summary: { total: 1, succeeded: 0, failed: 1 },
        results: [{ status: 'error', error: 'NOT_ACTION_PARTICIPANT' }],
      })) as unknown as typeof fetch;

    await expect(
      respondToRequest({ as: 'provider', status: 'accepted' }).run(
        ctx(http, { ...twoProfiles, actionId: 'act_1' }),
      ),
    ).rejects.toThrow(/NOT_ACTION_PARTICIPANT/);
  });
});
