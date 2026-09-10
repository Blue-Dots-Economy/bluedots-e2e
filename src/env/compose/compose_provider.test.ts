import { describe, expect, test } from 'vitest';
import { ComposeProvider } from './compose_provider.js';
import type { ResolvedTarget } from '../../targets/targets.js';

const TARGET: ResolvedTarget = {
  id: 'purple_dot', dot: 'purple_dot', instance: null,
  networkConfigPath: '/schemas/purple_dot/network.json',
  consentPath: null, brandPath: null,
  servedDomains: 'purple_dot/seeker',
};

function fakeDocker() {
  const calls: string[][] = [];
  let port = 55000;
  const run = async (args: string[]) => {
    calls.push(args);
    if (args.includes('port')) return `0.0.0.0:${++port}\n`;
    return '';
  };
  return { calls, run };
}

const DEPS = (run: (a: string[]) => Promise<string>) => ({
  run,
  writeFile: async () => {},
  assertBindSources: async () => {},
  digests: { 'signals-dpg': 'sha256:a', 'signals-search': 'sha256:b' },
  baseFile: '/repo/Signals-DPG/local-setup/docker-compose.yml',
  runDir: '/run',
});

describe('ComposeProvider', () => {
  test('reports the capabilities a compose stack actually offers', async () => {
    const { run } = fakeDocker();
    const ctx = await new ComposeProvider(TARGET, DEPS(run)).up();

    // Direct Redis and Postgres access is what lets a journey prove an event
    // crossed the stream rather than that the data arrived somehow.
    expect(ctx.capabilities).toEqual(['http', 'redis', 'postgres']);
  });

  test('discovers every endpoint from the ephemeral ports', async () => {
    const { run } = fakeDocker();
    const ctx = await new ComposeProvider(TARGET, DEPS(run)).up();

    expect(ctx.endpoints.signalsApi).toMatch(/^http:\/\/localhost:55\d\d\d$/);
    expect(ctx.endpoints.redisUrl).toMatch(/^redis:\/\/:.+@localhost:55\d\d\d$/);
  });

  test('records the digests the run booted, so a report can name them', async () => {
    const { run } = fakeDocker();
    const ctx = await new ComposeProvider(TARGET, DEPS(run)).up();

    expect(ctx.digests['signals-dpg']).toBe('sha256:a');
  });

  test('brings the stack up with both opt-in profiles', async () => {
    const { calls, run } = fakeDocker();
    await new ComposeProvider(TARGET, DEPS(run)).up();

    const up = calls.find((c) => c.includes('up'))!;
    expect(up).toContain('keycloak');
    expect(up).toContain('search');
    expect(up).toContain('-d');
  });

  test('removes volumes on teardown so the next run starts clean', async () => {
    const { calls, run } = fakeDocker();
    const p = new ComposeProvider(TARGET, DEPS(run));
    await p.up();
    await p.down();

    const down = calls.find((c) => c.includes('down'))!;
    // A surviving volume carries the previous run's realm and database, which
    // is how a hermetic suite quietly stops being hermetic.
    expect(down).toContain('-v');
  });

  test('uses a project name unique to the target', async () => {
    const { calls, run } = fakeDocker();
    await new ComposeProvider(TARGET, DEPS(run)).up();

    const i = calls[0]!.indexOf('-p');
    expect(calls[0]![i + 1]).toBe('journey-purple-dot');
  });
});
