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
import { createKcadmAdmin } from '../../src/env/kcadm.js';
import { seedIdentities } from '../../src/seed/seed.js';
import { obtainUserToken } from '../../src/seed/token.js';
import { createIngestProbe } from '../../src/awaiters/ingest_probe.js';
import { runJourney, type StepContext } from '../../src/journey/journey.js';
import { J2 } from '../../journeys/search/j2.js';

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

describe('J2 — a new profile becomes findable in search', () => {
  let provider: ComposeProvider;
  let ctx: StepContext;
  let probe: ReturnType<typeof createIngestProbe>;

  beforeAll(async () => {
    // The target comes from the environment so a CI matrix job exercises
    // the target it claims, rather than every job testing purple_dot.
    const chosen = targetFromEnv(process.env);
    const target = await resolveTarget(schemas, chosen.dot, chosen.instance);
    // The item schema travels with the target: item_state differs per
    // network, so the fixture is generated from the config the stack serves.
    const networkConfig = JSON.parse(
      await readFile(target.networkConfigPath, 'utf8'),
    ) as { id: string; domains: { id: string; item_schemas: Record<string, unknown> }[] };
    const domainSchemas = networkConfig.domains.find((d) => d.id === DOMAIN)!.item_schemas;
    const itemType = Object.keys(domainSchemas)[0]!;
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

    const env = await provider.up();

    const admin = await createKcadmAdmin((svc, cmd) => provider.exec(svc, cmd), {
      username: 'admin',
      password: 'admin',
    });
    const seeded = await seedIdentities(
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

    ctx = {
      clients: {},
      endpoints: env.endpoints,
      seeded: seeded as unknown as Record<string, unknown>,
      state: {},
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

  test('runs end to end on the configured target', async () => {
    const result = await runJourney(J2, ctx);

    // Attach the trace to the assertion that actually fails, so the report
    // names the step AND its error. Attaching it to a passing assertion
    // hides exactly the information the trace exists to carry.
    expect(result.ok, JSON.stringify(result.trace, null, 2)).toBe(true);
  });
});
