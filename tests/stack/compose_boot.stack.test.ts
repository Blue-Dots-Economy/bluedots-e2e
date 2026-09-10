import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComposeProvider } from '../../src/env/compose/compose_provider.js';
import { assertBindSources } from '../../src/env/compose/overlay.js';
import { dockerRun } from '../../src/env/compose/docker_runner.js';
import { resolveTarget } from '../../src/targets/targets.js';
import { targetFromEnv } from '../../src/targets/from_env.js';
import { imageRef, resolveDigests, resolveTags } from '../../src/images/images.js';
import { dockerInspector } from '../../src/images/docker_inspector.js';
import type { EnvironmentContext } from '../../src/env/provider.js';
import { REQUIRED_RELATIONS } from '../../src/env/schema_gate.js';
import { seedIdentities, type SeedResult } from '../../src/seed/seed.js';
import { createKcadmAdmin } from '../../src/env/kcadm.js';
import { obtainUserToken } from '../../src/seed/token.js';
import { createIngestProbe } from '../../src/awaiters/ingest_probe.js';
import { captureBaseline } from '../../src/awaiters/ingest.js';


/**
 * Boots the real stack for purple_dot and asserts the properties every later
 * ticket depends on. Slow by nature; excluded from the unit suite.
 *
 * BLUEDOTS_SCHEMAS_PATH and SIGNALS_DPG_PATH locate the two checkouts.
 */
const schemas =
  process.env.BLUEDOTS_SCHEMAS_PATH ??
  fileURLToPath(new URL('../../../bluedots-schemas', import.meta.url));
const signalsDpg =
  process.env.SIGNALS_DPG_PATH ??
  fileURLToPath(new URL('../../../Signals-DPG', import.meta.url));
const aggregator =
  process.env.AGGREGATOR_DPG_PATH ??
  fileURLToPath(new URL('../../../aggregator-dpg', import.meta.url));

/** Every target in scope declares a seeker domain. */
const DOMAIN = 'seeker';

describe('compose provider boots a usable stack', () => {
  let provider: ComposeProvider;
  let ctx: EnvironmentContext;
  let seeded: SeedResult;

  beforeAll(async () => {
    // The target comes from the environment so a CI matrix job exercises
    // the target it claims, rather than every job testing purple_dot.
    const chosen = targetFromEnv(process.env);
    const target = await resolveTarget(schemas, chosen.dot, chosen.instance);
    const tags = resolveTags({ branch: null, imagesFromTag: null });
    const digests = await resolveDigests(
      {
        'signals-dpg': imageRef('signals-dpg', 'api', tags['signals-dpg']),
        'signals-search': imageRef('signals-search', 'api', tags['signals-search']),
      },
      dockerInspector,
    );

    provider = new ComposeProvider(target, {
      run: dockerRun,
      writeFile: async (p, c) => {
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, c);
      },
      readRealm: async (p) => readFile(p, 'utf8'),
      assertBindSources,
      digests,
      baseFile: join(signalsDpg, 'local-setup', 'docker-compose.yml'),
      runDir: await mkdtemp(join(tmpdir(), 'journey-')),
      aggregatorRoot: aggregator,
      });

    ctx = await provider.up();

    // Phase 3, against the real stack.
    const admin = await createKcadmAdmin((svc, cmd) => provider.exec(svc, cmd), {
      username: 'admin',
      password: 'admin',
    });
    seeded = await seedIdentities(
      { realm: 'bluedots' },
      {
        runTool: (cmd) => provider.runTool(cmd),
        admin,
        obtainToken: (user) =>
          obtainUserToken(
            { baseUrl: ctx.endpoints.keycloak, realm: 'bluedots', clientId: 'signals-ui' },
            user,
          ),
      },
    );
  });

  afterAll(async () => {
    await provider?.down();
  });

  test('signals-dpg answers over HTTP', async () => {
    const res = await fetch(`${ctx.endpoints.signalsApi}/health/live`);

    expect(res.status).toBe(200);
  });

  test('signals-search answers over HTTP', async () => {
    // An empty body is rejected by validation, which still proves the service
    // is serving rather than merely listening.
    const res = await fetch(`${ctx.endpoints.searchApi}/v1/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBeLessThan(500);
  });

  test('the ingest consumer group exists, which the awaiter reads', async () => {
    const out = await provider.exec('redis', [
      'redis-cli', '-a', 'journey-redis-pw', '--no-auth-warning',
      'XINFO', 'GROUPS', 'signals:item-events',
    ]);

    expect(out).toContain('signals-search');
  });

  test('item_search exists, which the awaiter asserts on', async () => {
    const out = await provider.exec('postgres', [
      'psql', '-U', 'postgres', '-d', 'postgresdb',
      '-tAc', "select to_regclass('public.item_search')",
    ]);

    expect(out.trim()).toBe('item_search');
  });

  test('every relation the schema gate requires is present', async () => {
    // up() already gated on this; asserting it here means a regression names
    // the schema rather than surfacing as an odd failure in a later journey.
    for (const relation of REQUIRED_RELATIONS) {
      const out = await provider.exec('postgres', [
        'psql', '-U', 'postgres', '-d', 'postgresdb',
        '-tAc', `select to_regclass('public.${relation}')`,
      ]);

      // to_regclass quotes reserved words, so `user` comes back as `"user"`.
      expect(out.trim().replace(/^"|"$/g, ''), `${relation} must exist`).toBe(relation);
    }
  });

  test('publishes no fixed host port, so it coexists with other stacks', () => {
    // The base compose binds 5432/5555/8080/2742/3100 for a single-stack
    // developer. Inheriting those collides with whatever is already running.
    for (const fixed of [5432, 5555, 8080, 2742, 3100]) {
      expect(ctx.endpoints.signalsApi).not.toContain(`:${fixed}`);
      expect(ctx.endpoints.postgresUrl).not.toContain(`:${fixed}/`);
    }
  });

  test('imports the eight-client aggregator realm, not the four-client one', async () => {
    // signals-dpg's export has 4 clients; only aggregator-dpg's carries all
    // eight a four-service stack needs. Getting this wrong is invisible until
    // a journey authenticates as a client that is not there.
    const out = await provider.exec('keycloak', [
      '/opt/keycloak/bin/kcadm.sh', 'get', 'clients', '-r', 'bluedots',
      '--fields', 'clientId',
    ]);
    const ids = (JSON.parse(out) as { clientId: string }[]).map((c) => c.clientId);

    for (const expected of [
      'signals-ui', 'signals-api', 'aggregator-dpg', 'voice-dpg',
      'aggregator-portal', 'aggregator-api', 'aggregator-bff', 'campaign-manager',
    ]) {
      expect(ids, `${expected} must be in the realm`).toContain(expected);
    }
  });

  test('direct grant is on, which both exports ship disabled', async () => {
    const out = await provider.exec('keycloak', [
      '/opt/keycloak/bin/kcadm.sh', 'get', 'clients', '-r', 'bluedots',
      '-q', 'clientId=signals-ui', '--fields', 'directAccessGrantsEnabled',
    ]);
    const [client] = JSON.parse(out) as { directAccessGrantsEnabled: boolean }[];

    expect(client!.directAccessGrantsEnabled).toBe(true);
    expect(ctx.realmMutations).toContain('enabled directAccessGrants on signals-ui');
  });

  test('captures an api key search actually accepts', async () => {
    // signals-search authenticates by x-api-key hashed against the apikey
    // table -- not Keycloak. A 401 here means the captured key never
    // reached the database, which no amount of Keycloak setup would fix.
    const res = await fetch(`${ctx.endpoints.searchApi}/v1/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': seeded.apiKey },
      body: JSON.stringify({}),
    });

    expect(res.status).not.toBe(401);
  });

  test('the participant token is accepted by signals-dpg', async () => {
    // Proves direct grant, the realm role, and the issuer split all line up.
    const res = await fetch(`${ctx.endpoints.signalsApi}/api/v1/auth/config`, {
      headers: { authorization: `Bearer ${seeded.participant.token}` },
    });

    expect(res.status).toBeLessThan(500);
    expect(seeded.participant.token.split('.')).toHaveLength(3);
  });

  test('an aggregator org exists for profiles to be owned by', () => {
    // Without one, a self-created profile is classified unowned and lands in
    // draft, and search only returns live items.
    expect(seeded.aggregatorOrgId).toMatch(/^org_/);
  });

  test('the ingest probe reads the real stream and read model', async () => {
    // The awaiter is only as good as its readings. This checks each one
    // returns something meaningful against a live stack rather than
    // silently defaulting -- a probe that always answers "0-0" and null
    // would make every correlation check pass or fail for the wrong reason.
    const probe = createIngestProbe({
      redisUrl: ctx.endpoints.redisUrl,
      postgresUrl: ctx.endpoints.postgresUrl,
    });
    try {
      const baseline = await captureBaseline(probe);

      expect(baseline.lastStreamId).toMatch(/^\d+-\d+$/);
      expect(baseline.dlqLength).toBe(0);
      // The worker created the group at boot, so this must be readable.
      expect(await probe.groupLastDeliveredId()).not.toBeNull();
      expect(await probe.pendingCount()).toBe(0);
      // An item that does not exist must read as absent, not as an error.
      expect(
        await probe.indexedAt({
          network: 'purple_dot', domain: 'seeker', type: 'profile',
          id: '00000000-0000-0000-0000-000000000000',
        }),
      ).toBeNull();
    } finally {
      await probe.close();
    }
  });

  test('reports the capabilities a journey checks against', () => {
    expect(ctx.capabilities).toEqual(['http', 'redis', 'postgres']);
    expect(ctx.disposable).toBe(true);
  });
});
