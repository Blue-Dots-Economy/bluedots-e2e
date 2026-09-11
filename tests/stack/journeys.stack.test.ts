import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComposeProvider } from '../../src/env/compose/compose_provider.js';
import { assertBindSources } from '../../src/env/compose/overlay.js';
import { dockerRun } from '../../src/env/compose/docker_runner.js';
import { resolveTarget } from '../../src/targets/targets.js';
import { imageTagsFromEnv, releaseTagFromEnv, seedFromEnv, targetFromEnv } from '../../src/targets/from_env.js';
import { imageRef, resolveDigests, resolveTags } from '../../src/images/images.js';
import { SERVICES } from '../../src/cli/args.js';
import { dockerInspector } from '../../src/images/docker_inspector.js';
import { createKcadmAdmin } from '../../src/env/kcadm.js';
import { seedIdentities, type SeedResult } from '../../src/seed/seed.js';
import { obtainUserToken } from '../../src/seed/token.js';
import { createIngestProbe } from '../../src/awaiters/ingest_probe.js';
import { REQUIRED_RELATIONS } from '../../src/env/schema_gate.js';
import { runJourney, type StepContext } from '../../src/journey/journey.js';
import { selectJourneys } from '../../src/journey/select.js';
import { ALL_JOURNEYS } from '../../journeys/index.js';
import type { EnvironmentContext } from '../../src/env/provider.js';

/**
 * One stack, every journey.
 *
 * Boot and seed cost ~145s; a journey's own assertions cost seconds. A file
 * per journey would therefore make each new scenario cost a boot, which is
 * precisely the marginal cost the design says must stay near zero. So this
 * file brings the stack up once and iterates the journey registry against
 * it: adding a journey is a line in journeys/index.ts.
 *
 * The negative controls keep their own file because they need a
 * deliberately misconfigured stack.
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

describe('journeys against a real stack', () => {
  let provider: ComposeProvider;
  let env: EnvironmentContext;
  let seeded: SeedResult;
  let probe: ReturnType<typeof createIngestProbe>;
  let baseCtx: Omit<StepContext, 'state'>;
  let targetId: string;

  beforeAll(async () => {
    const chosen = targetFromEnv(process.env);
    targetId = chosen.instance ? `${chosen.dot}/${chosen.instance}` : chosen.dot;
    const target = await resolveTarget(schemas, chosen.dot, chosen.instance);

    const networkConfig = JSON.parse(await readFile(target.networkConfigPath, 'utf8')) as {
      id: string;
      domains: { id: string; item_schemas: Record<string, unknown> }[];
    };
    const domainSchemas = networkConfig.domains.find((d) => d.id === DOMAIN)!.item_schemas;
    const itemType = Object.keys(domainSchemas)[0]!;

    const tags = resolveTags({
      branch: null,
      imagesFromTag: releaseTagFromEnv(process.env),
      perService: imageTagsFromEnv(process.env),
    });
    // All four are resolved, though only signals-dpg and signals-search
    // boot for J2: a run that says it verified a release should be able to
    // name the digest of every service in it, and resolving only inspects
    // manifests -- it pulls nothing.
    const digests = await resolveDigests(
      Object.fromEntries(
        SERVICES.map((s) => [s, imageRef(s, s === 'aggregator-dpg' ? 'api' : 'api', tags[s])]),
      ),
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
      embedder: process.env.EMBEDDER === 'stub' ? 'stub' : 'tei',
    });

    env = await provider.up();

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
            { baseUrl: env.endpoints.keycloak, realm: 'bluedots', clientId: 'signals-ui' },
            user,
          ),
      },
    );

    probe = createIngestProbe({
      redisUrl: env.endpoints.redisUrl,
      postgresUrl: env.endpoints.postgresUrl,
    });

    baseCtx = {
      clients: {},
      endpoints: env.endpoints,
      seeded: seeded as unknown as Record<string, unknown>,
      target: {
        network: networkConfig.id,
        domain: DOMAIN,
        itemType,
        itemSchema: domainSchemas[itemType] as never,
      },
      probe,
      auth: {
        apiKey: seeded.apiKey,
        actingOrgId: seeded.aggregatorOrgId,
        participantToken: seeded.participant.token,
      },
    };
  });

  afterAll(async () => {
    await probe?.close();
    await provider?.down();
  });

  describe('the environment the journeys run against', () => {
    test('signals-dpg answers over HTTP', async () => {
      expect((await fetch(`${env.endpoints.signalsApi}/health/live`)).status).toBe(200);
    });

    test('every relation the schema gate requires is present', async () => {
      for (const relation of REQUIRED_RELATIONS) {
        const out = await provider.exec('postgres', [
          'psql', '-U', 'postgres', '-d', 'postgresdb',
          '-tAc', `select to_regclass('public.${relation}')`,
        ]);
        // to_regclass quotes reserved words, so `user` comes back as `"user"`.
        expect(out.trim().replace(/^"|"$/g, ''), `${relation} must exist`).toBe(relation);
      }
    });

    test('the ingest consumer group exists, which the awaiter reads', async () => {
      const out = await provider.exec('redis', [
        'redis-cli', '-a', 'journey-redis-pw', '--no-auth-warning',
        'XINFO', 'GROUPS', 'signals:item-events',
      ]);

      expect(out).toContain('signals-search');
    });

    test('publishes no fixed host port, so it coexists with other stacks', () => {
      for (const fixed of [5432, 5555, 8080, 2742, 3100]) {
        expect(env.endpoints.signalsApi).not.toContain(`:${fixed}`);
      }
    });

    test('the captured api key is accepted by search', async () => {
      const res = await fetch(`${env.endpoints.searchApi}/v1/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': seeded.apiKey },
        body: JSON.stringify({}),
      });

      expect(res.status).not.toBe(401);
    });
  });

  describe('journeys', () => {
    test('every journey is accounted for as run or skipped', () => {
      const { run, skipped } = selectJourneys(ALL_JOURNEYS, targetId, env.capabilities);

      // A journey that is neither would be missing coverage that the report
      // still counts as a clean run.
      expect(run.length + skipped.length).toBe(ALL_JOURNEYS.length);
      for (const s of skipped) console.log(`NOT COVERED: ${s.id} — ${s.reason}`);
    });

    // One test per journey, all sharing the single stack above. Adding a
    // journey to journeys/index.ts adds a case here automatically.
    for (const journey of ALL_JOURNEYS) {
      test(`${journey.id} — ${journey.title}`, async (ctx) => {
        const { run } = selectJourneys([journey], targetId, env.capabilities);
        if (run.length === 0) {
          ctx.skip();
          return;
        }

        // Seeded per run and printed, so a red run can be replayed exactly.
        const seed = seedFromEnv(process.env);
        const result = await runJourney(journey, { ...baseCtx, state: { seed } });

        expect(result.ok, JSON.stringify(result.trace, null, 2)).toBe(true);
      });
    }
  });
});
