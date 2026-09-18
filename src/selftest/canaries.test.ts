import { describe, expect, test } from 'vitest';
import { CANARIES, runSelftest } from './canaries.js';

const ctx = () => ({
  clients: {},
  // Unused by these scenarios; present because every step context carries
  // the recorded fetch.
  http: (async () => new Response('{}')) as unknown as typeof fetch,
  state: {} as Record<string, unknown>,
  endpoints: { signalsApi: '', searchApi: '', keycloak: '', postgresUrl: '', redisUrl: '', aggregatorApi: '', mailpit: '' },
  seeded: {},
});

describe('CANARIES', () => {
  test('are one built to pass and one built to fail', () => {
    // A runner that silently swallowed failures, or one that failed
    // everything, would look identical to a working runner without these.
    expect(CANARIES).toHaveLength(2);
    expect(CANARIES.map((c) => c.id).sort()).toEqual(['CANARY-FAIL', 'CANARY-PASS']);
  });
});

describe('runSelftest', () => {
  test('reports exactly one pass and one fail', async () => {
    const r = await runSelftest(CANARIES, ctx);

    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
  });

  test('exits non-zero, because a failing canary must be visible to CI', async () => {
    const r = await runSelftest(CANARIES, ctx);

    expect(r.exitCode).not.toBe(0);
  });

  test('names the step that failed, not just the journey', async () => {
    const r = await runSelftest(CANARIES, ctx);

    const failing = r.results.find((x) => !x.ok)!;
    expect(failing.failedStep).toBeTruthy();
  });

  test('fails the selftest when the failing canary unexpectedly passes', async () => {
    // The whole point: this catches a runner that reports green regardless.
    const brokenRunner = CANARIES.map((c) =>
      c.id === 'CANARY-FAIL'
        ? { ...c, steps: [{ label: 'Did nothing', run: async () => {}, isCustom: false }] }
        : c,
    );

    const r = await runSelftest(brokenRunner, ctx);

    expect(r.selftestOk).toBe(false);
    expect(r.reason).toMatch(/CANARY-FAIL/);
  });

  test('is green only when both canaries behave as designed', async () => {
    const r = await runSelftest(CANARIES, ctx);

    expect(r.selftestOk).toBe(true);
  });
});
