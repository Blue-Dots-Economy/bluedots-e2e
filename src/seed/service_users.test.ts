import { describe, expect, test } from 'vitest';
import { parseSeedOutput } from './service_users.js';

const MINTED = `
aggregator-dpg:
  org_id:    org_7f3c1e2a-1111-2222-3333-444455556666
  user_id:   usr_aaaa
  member_id: mbr_bbbb
  apikey:    sk_signals_deadbeefcafe
             ↑ raw key — NOT SHOWN AGAIN. Capture now.

seed complete.
`;

const EXISTING = `
aggregator-dpg:
  org_id:    org_7f3c1e2a-1111-2222-3333-444455556666
  user_id:   usr_aaaa
  member_id: mbr_bbbb
  apikey:    (existing — capture from first-run logs, or rotate via TRUNCATE apikey + reseed)

seed complete.
`;

describe('parseSeedOutput', () => {
  test('captures the ids and the raw key on first mint', () => {
    const out = parseSeedOutput(MINTED);

    expect(out['aggregator-dpg']).toEqual({
      orgId: 'org_7f3c1e2a-1111-2222-3333-444455556666',
      userId: 'usr_aaaa',
      memberId: 'mbr_bbbb',
      apiKey: 'sk_signals_deadbeefcafe',
    });
  });

  test('refuses a re-run that yields no key, rather than proceeding', () => {
    // The script prints the raw key ONLY on first mint. Every hermetic run
    // starts from a fresh volume so this should not happen -- but if a run
    // ever reuses a volume, proceeding means every search call 401s with
    // nothing pointing at the cause.
    expect(() => parseSeedOutput(EXISTING)).toThrow(/SEED_FAILED.*existing/s);
  });

  test('refuses output with no services at all', () => {
    expect(() => parseSeedOutput('seed complete.\n')).toThrow(/SEED_FAILED/);
  });
});
