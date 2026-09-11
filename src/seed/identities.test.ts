import { describe, expect, test } from 'vitest';
import { seedIdentities } from './identities.js';

const DEPS = (over: Partial<Parameters<typeof seedIdentities>[1]> = {}) => ({
  runTool: async () => `
aggregator-dpg:
  org_id:    org_1
  user_id:   usr_1
  member_id: mbr_1
  apikey:    sk_signals_abc

seed complete.
`,
  admin: {
    getClients: async () => [],
    updateClient: async () => {},
    createUser: async () => 'participant-uuid',
    setPassword: async () => {},
    addRealmRole: async () => {},
  },
  obtainToken: async () => 'tok-123',
  ...over,
});

describe('seedIdentities', () => {
  test('captures the api key search authenticates with', async () => {
    const out = await seedIdentities({ realm: 'bluedots' }, DEPS());

    expect(out.apiKey).toBe('sk_signals_abc');
  });

  test('returns the aggregator org a profile needs an owner from', async () => {
    // Without an owning aggregator org, a self-created profile is classified
    // unowned and lands in draft -- and search only returns live items.
    const out = await seedIdentities({ realm: 'bluedots' }, DEPS());

    expect(out.aggregatorOrgId).toBe('org_1');
  });

  test('returns a usable participant token', async () => {
    const out = await seedIdentities({ realm: 'bluedots' }, DEPS());

    expect(out.participant.token).toBe('tok-123');
    expect(out.participant.userId).toBe('participant-uuid');
  });

  test('runs the product seed script rather than inserting rows itself', async () => {
    let cmd: readonly string[] = [];
    await seedIdentities(
      { realm: 'bluedots' },
      DEPS({
        runTool: async (c) => {
          cmd = c;
          return 'aggregator-dpg:\n  org_id: o\n  user_id: u\n  member_id: m\n  apikey: sk_1\n';
        },
      }),
    );

    // Inserting an apikey row directly would mean duplicating better-auth's
    // hash scheme here, and drifting from it silently.
    expect(cmd.join(' ')).toContain('db:seed:services');
  });
});
