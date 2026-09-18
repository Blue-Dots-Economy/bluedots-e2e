import { describe, expect, test } from 'vitest';
import { ComposeProvider } from './compose_provider.js';
import type { ResolvedTarget } from '../../targets/target_discovery.js';

const TARGET: ResolvedTarget = {
  id: 'purple_dot', dot: 'purple_dot', instance: null,
  networkConfigPath: '/schemas/purple_dot/network.json',
  consentPath: null, brandPath: null,
  servedDomains: 'purple_dot/seeker',
};

/**
 * What `docker compose config --format json` renders for a stack whose
 * overlay is correct. The provider asserts against this before it boots,
 * so a fake that answered '' would fail the guard rather than the test.
 */
const RENDERED_CONFIG = JSON.stringify({
  services: {
    'aggregator-api': {
      environment: {
        KEYCLOAK_ALLOWED_AZP: 'aggregator-bff',
        ORG_HIERARCHY_ENABLED: 'true',
        ADMIN_EMAILS: 'admin@journey.test',
        APPROVAL_TOKEN_SECRET: 'x'.repeat(40),
        SIGNALSTACK_BASE_URL: 'http://signals-api:2742',
        SIGNALSTACK_AUTH_MODE: 'bearer',
        SIGNALSTACK_CLIENT_ID: 'aggregator-dpg',
        SIGNALSTACK_CLIENT_SECRET: 's',
        SIGNALSTACK_ACTING_ORG_ID: 'org_x',
      },
    },
    'signals-api': {
      environment: {
        KEYCLOAK_SERVICE_CLIENT_IDS: 'aggregator-dpg',
        KEYCLOAK_REALM: 'bluedots',
        SIGNALS_SEARCH_URL: 'http://signals-search-api:3100',
        SIGNALS_SEARCH_API_KEY: 'sk_x',
        NOTIFICATION_SERVICE_ENDPOINT: 'http://notification-service:4000',
        NOTIFICATION_SERVICE_KEY_ID: 'k',
        NOTIFICATION_SERVICE_SECRET: 's',
        NOTIFICATION_FROM_EMAIL: 'no-reply@journey.local',
        FRONTEND_BASE_URL: 'http://localhost:3000',
      },
    },
  },
});

function fakeDocker(config: string = RENDERED_CONFIG) {
  const calls: string[][] = [];
  let port = 55000;
  const run = async (args: string[]) => {
    calls.push(args);
    if (args.includes('config')) return config;
    if (args.includes('port')) return `0.0.0.0:${++port}\n`;
    // to_regclass returns the relation name when it exists.
    if (args.includes('psql')) return 'relation\n';
    return '';
  };
  return { calls, run };
}

const STUB_ADMIN = async () => ({
  getClients: async () => [
    { id: 'u1', clientId: 'signals-ui', directAccessGrantsEnabled: true },
  ],
  updateClient: async () => {},
  createUser: async () => 'user-uuid',
  setPassword: async () => {},
  addRealmRole: async () => {},
  findUsersByEmail: async () => [],
  realmRolesOf: async () => [],
  groupsOf: async () => [],
});

const DEPS = (run: (a: string[]) => Promise<string>) => ({
  run,
  createAdmin: STUB_ADMIN,
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

describe('ComposeProvider.exec', () => {
  test('runs a command in a service through compose, not by container name', async () => {
    const { calls, run } = fakeDocker();
    const p = new ComposeProvider(TARGET, DEPS(run));

    await p.exec('postgres', ['psql', '-c', 'select 1']);

    const call = calls.find((c) => c.includes('select 1'))!;
    expect(call).toContain('exec');
    expect(call).toContain('postgres');
    // Fixed container names are global to the daemon; the project scopes it.
    expect(call).not.toContain('signals-postgres');
  });
});

describe('ComposeProvider realm mutation', () => {
  test('enables direct grant and records that it did', async () => {
    const { run } = fakeDocker();
    const ctx = await new ComposeProvider(TARGET, {
      ...DEPS(run),
      createAdmin: async () => ({
        ...(await STUB_ADMIN()),
        getClients: async () => [
          { id: 'u1', clientId: 'signals-ui', directAccessGrantsEnabled: false },
        ],
      }),
    }).up();

    // A mutated realm is not quite the realm the services deploy against, so
    // the run has to be able to say what it changed.
    expect(ctx.realmMutations).toContain('enabled directAccessGrants on signals-ui');
  });

  test('records nothing when the realm already allowed direct grant', async () => {
    const { run } = fakeDocker();
    const ctx = await new ComposeProvider(TARGET, {
      ...DEPS(run),
      createAdmin: STUB_ADMIN,
    }).up();

    expect(ctx.realmMutations).toEqual([]);
  });
});

describe('ComposeProvider container env gate', () => {
  test('refuses to boot a stack whose service will not receive what it reads', async () => {
    // The failure this catches does not stop a boot: the service starts,
    // answers health checks, and degrades in one level-40 log line. So the
    // guard has to run BEFORE up, or the run goes green having proved less
    // than it claimed.
    const broken = JSON.parse(RENDERED_CONFIG);
    delete broken.services['signals-api'].environment.SIGNALS_SEARCH_URL;
    const { calls, run } = fakeDocker(JSON.stringify(broken));

    await expect(new ComposeProvider(TARGET, DEPS(run)).up()).rejects.toThrow(
      /CONTAINER_ENV_MISSING[\s\S]*SIGNALS_SEARCH_URL/,
    );
    expect(calls.some((c) => c.includes('up'))).toBe(false);
  });
});

describe('ComposeProvider schema gate', () => {
  test('refuses a stack whose schema never got created', async () => {
    // The bootstrap exiting 0 is only a proxy. If the relations are absent,
    // every later failure would look like an application bug instead of a
    // migration that did not run.
    const run = async (args: string[]) => {
      if (args.includes('config')) return RENDERED_CONFIG;
      if (args.includes('port')) return '0.0.0.0:55001\n';
      if (args.includes('psql')) return '\n'; // to_regclass -> null
      return '';
    };

    await expect(new ComposeProvider(TARGET, DEPS(run)).up()).rejects.toThrow(
      /MIGRATIONS_INCOMPLETE/,
    );
  });

  test('queries postgres through compose, not a fixed container name', async () => {
    // container_name is global to the docker daemon, so addressing
    // signals-postgres directly would collide with the developer's own stack.
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
      if (args.includes('config')) return RENDERED_CONFIG;
      if (args.includes('port')) return '0.0.0.0:55001\n';
      if (args.includes('psql')) return 'items\n';
      return '';
    };

    await new ComposeProvider(TARGET, DEPS(run)).up();

    const psql = calls.find((c) => c.includes('psql'))!;
    expect(psql).toContain('exec');
    expect(psql).toContain('postgres');
    expect(psql).not.toContain('signals-postgres');
  });
});

describe('ComposeProvider.runTool', () => {
  test('runs a one-off container from the bootstrap service', async () => {
    // seed_service_users.ts is TypeScript and needs tsx, which the published
    // api image is pruned of. Only the tools image can run it.
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
      if (args.includes('port')) return '0.0.0.0:55001\n';
      if (args.includes('psql')) return 'relation\n';
      return '';
    };
    const p = new ComposeProvider(TARGET, DEPS(run));

    await p.runTool(['pnpm', '--filter', 'api', 'db:seed:services']);

    const call = calls.find((c) => c.includes('db:seed:services'))!;
    expect(call).toContain('run');
    // --rm so a one-off does not linger and collide with the next run.
    expect(call).toContain('--rm');
    expect(call).toContain('signals-bootstrap');
  });
});
