import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComposeProvider } from '../../src/env/compose/compose_provider.js';
import { assertBindSources } from '../../src/env/compose/overlay.js';
import { dockerRun } from '../../src/env/compose/docker_runner.js';
import { resolveTarget } from '../../src/targets/target_discovery.js';
import { imageTagsFromEnv, releaseTagFromEnv, targetFromEnv } from '../../src/targets/from_env.js';
import { imageRef, resolveDigests, resolveTags } from '../../src/images/image_resolution.js';
import { SERVICES } from '../../src/cli/args.js';
import { dockerInspector } from '../../src/images/docker_inspector.js';
import { createKcadmAdmin } from '../../src/env/kcadm.js';
import { seedIdentities } from '../../src/seed/identities.js';
import { obtainUserToken } from '../../src/seed/token.js';
import { createIngestProbe } from '../../src/awaiters/ingest_probe.js';
import { runJourney, type StepContext } from '../../src/journey/define_journey.js';
import { seedFromEnv } from '../../src/targets/from_env.js';
import { profileBecomesFindable } from '../../journeys/search/profile_becomes_findable.js';

const schemas =
  process.env.BLUEDOTS_SCHEMAS_PATH ??
  fileURLToPath(new URL('../../../bluedots-schemas', import.meta.url));
const signalsDpg =
  process.env.SIGNALS_DPG_PATH ??
  fileURLToPath(new URL('../../../Signals-DPG', import.meta.url));
const aggregator =
  process.env.AGGREGATOR_DPG_PATH ??
  fileURLToPath(new URL('../../../aggregator-dpg', import.meta.url));

/**
 * The control that decides whether J2's green means anything.
 *
 * The worker is pointed at a DECOY consumer group and the reconciliation
 * sweep is left running fast. The item therefore still reaches item_search
 * -- straight from Postgres, exactly as the sweep is designed to do -- while
 * nothing ever crosses the group the awaiter watches.
 *
 * A naive awaiter ("wait until the item is findable") passes here. This one
 * must fail. If it ever passes, the suite is reporting that ingestion works
 * when it demonstrably does not, and every J2 green is worthless.
 */
/** Every target in scope declares a seeker domain. */
const DOMAIN = 'seeker';

describe('Negative control: the sweep must not be able to fake a pass', () => {
  let provider: ComposeProvider;
  let ctx: StepContext;
  let probe: ReturnType<typeof createIngestProbe>;

  beforeAll(async () => {
    // The target comes from the environment so a CI matrix job exercises
    // the target it claims, rather than every job testing purple_dot.
    const chosen = targetFromEnv(process.env);
    const target = await resolveTarget(schemas, chosen.dot, chosen.instance);
    const networkConfig = JSON.parse(
      await readFile(target.networkConfigPath, 'utf8'),
    ) as { id: string; domains: { id: string; item_schemas: Record<string, unknown> }[] };
    const domainSchemas = networkConfig.domains.find((d) => d.id === DOMAIN)!.item_schemas;
    const itemType = Object.keys(domainSchemas)[0]!;

    // Thread the release tag through, or a run triggered BY a release tag
    // would verify :develop and promote the RC on an unrelated build.
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
      runDir: await mkdtemp(join(tmpdir(), 'journey-control-')),
      aggregatorRoot: aggregator,
      // Real TEI by default -- a standard runner was shown to hold it, and
      // its vectors are the ones production computes. EMBEDDER=stub trades
      // that for a much smaller, faster boot.
      embedder: process.env.EMBEDDER === 'stub' ? 'stub' : 'tei',
      searchOverrides: {
        // Consume a group nobody is watching: the stream path is dead as
        // far as the awaiter is concerned.
        INGEST_CONSUMER_GROUP: 'decoy-control-group',
        // ...but leave the backstop running fast, so the item DOES get
        // indexed. This is precisely the situation a naive awaiter cannot
        // distinguish from success.
        SWEEP_INTERVAL_MS: '2000',
      },
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
      // Unrecorded on purpose: this file boots a deliberately broken stack
      // and its failures are the expected result, so they are not evidence
      // anyone reads in the release report.
      http: fetch,
      endpoints: env.endpoints,
      seeded: seeded as unknown as Record<string, unknown>,
      state: { seed: seedFromEnv(process.env) },
      target: { network: networkConfig.id, domain: DOMAIN, itemType, itemSchema: domainSchemas[itemType] as never },
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

  test('J2 fails when only the sweep indexed the item', async () => {
    const result = await runJourney(profileBecomesFindable, ctx);

    expect(result.ok, `control PASSED, which means the suite cannot detect a dead ingest spine:\n${JSON.stringify(result.trace, null, 2)}`).toBe(false);
    expect(result.failedStep).toBe('Waited until the new profile was picked up for search');
  });

  test('and the item really was indexed, so the failure is about the path not the data', async () => {
    // Without this, a failure here could just mean nothing was written at
    // all -- which would make the control pass for the wrong reason.
    const indexed = await probe.indexedAt(ctx.state.itemKey as never);

    expect(indexed).not.toBeNull();
  });
});
