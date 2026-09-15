import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ComposeProvider } from '../../src/env/compose/compose_provider.js';
import { assertBindSources } from '../../src/env/compose/overlay.js';
import { dockerRun } from '../../src/env/compose/docker_runner.js';
import { buildStackEnv } from '../../src/env/compose/stack_env.js';
import { aggregatorRoot, schemasRoot, signalsDpgRoot } from '../../src/config/paths.js';
import { resolveTarget } from '../../src/targets/target_discovery.js';
import {
  buildTargetSchemas,
  type NetworkConfig,
  type TargetSchemas,
} from '../../src/targets/target_schemas.js';
import {
  imageTagsFromEnv,
  releaseTagFromEnv,
  seedFromEnv,
  targetFromEnv,
} from '../../src/targets/from_env.js';
import { imageRef, resolveDigests, resolveTags } from '../../src/images/image_resolution.js';
import { BOOTED_SERVICES, SERVICES } from '../../src/services/registry.js';
import { dockerInspector } from '../../src/images/docker_inspector.js';
import { createKcadmAdmin } from '../../src/env/kcadm.js';
import { seedIdentities, type SeedResult } from '../../src/seed/identities.js';
import { obtainUserToken } from '../../src/seed/token.js';
import { createIngestProbe } from '../../src/awaiters/ingest_probe.js';
import { createNotificationProbe } from '../../src/awaiters/notification_probe.js';
import type { StepContext } from '../../src/journey/define_journey.js';
import type { EnvironmentContext } from '../../src/env/provider.js';

export type BootedStack = {
  provider: ComposeProvider;
  env: EnvironmentContext;
  seeded: SeedResult;
  probe: ReturnType<typeof createIngestProbe>;
  notifications: ReturnType<typeof createNotificationProbe>;
  target: TargetSchemas;
  targetId: string;
  digests: Record<string, string>;
  seed: string;
  /** Distinguishes this stack's captured logs from another's. */
  name: string;
  /** The env the containers actually started with, for anything that has
   * to speak to them with the same credentials. */
  stackEnv: Record<string, string>;
  /** Everything a step needs except the per-journey state. */
  baseCtx: Omit<StepContext, 'state'>;
};

/**
 * Boot a stack and seed it, once, for whoever is asking.
 *
 * Both stack specs did this themselves in ~90 near-identical lines, and
 * they had already drifted: the negative control never got the HTTP
 * recorder, so its requests reached no report. A boot is also where the
 * subtle bugs live -- ephemeral ports, container names, realm preparation --
 * and those should be fixed and tested once rather than in whichever copy
 * someone remembers.
 *
 * The credentials come from buildStackEnv rather than being re-typed here:
 * they are the values the containers actually start with, so changing one
 * there cannot leave the seeding silently authenticating with the old one.
 */
export async function bootStack(
  opts: {
    /**
     * Distinguishes this stack from another for the same target -- the
     * negative control's from the real one. Names the compose project as
     * well as the run directory: a project directory is not a project.
     */
    name?: string;
    /** Deliberate misconfiguration, for a negative control. */
    searchOverrides?: Record<string, string>;
    /** Defaults to global fetch; a run passes its recorder. */
    http?: typeof fetch;
  } = {},
): Promise<BootedStack> {
  // From the environment, so a CI matrix job exercises the target it
  // claims rather than every job testing purple_dot.
  const chosen = targetFromEnv(process.env);
  const targetId = chosen.instance ? `${chosen.dot}/${chosen.instance}` : chosen.dot;
  const resolved = await resolveTarget(schemasRoot(), chosen.dot, chosen.instance);
  const target = buildTargetSchemas(
    JSON.parse(await readFile(resolved.networkConfigPath, 'utf8')) as NetworkConfig,
  );

  // Thread the release tag through, or a run triggered BY a release tag
  // would verify :develop and promote the RC on an unrelated build.
  const tags = resolveTags({
    branch: null,
    imagesFromTag: releaseTagFromEnv(process.env),
    perService: imageTagsFromEnv(process.env),
  });
  // All four are resolved, though only two boot: a run that says it
  // verified a release should name the digest of every service in it, and
  // resolving only inspects manifests -- it pulls nothing. Only the two
  // that boot are required, so a tag not cut fleet-wide does not stop a run
  // that never needed the other images.
  const digests = await resolveDigests(
    Object.fromEntries(SERVICES.map((s) => [s, imageRef(s, 'api', tags[s])])),
    dockerInspector,
    { required: [...BOOTED_SERVICES] },
  );

  const provider = new ComposeProvider(resolved, {
    run: dockerRun,
    writeFile: async (p, c) => {
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, c);
    },
    readRealm: async (p) => readFile(p, 'utf8'),
    readBaseFile: async (p) => readFile(p, 'utf8'),
    assertBindSources,
    digests,
    baseFile: join(signalsDpgRoot(), 'local-setup', 'docker-compose.yml'),
    runDir: await mkdtemp(join(tmpdir(), `journey-${opts.name ? `${opts.name}-` : ''}`)),
    ...(opts.name ? { projectSuffix: opts.name } : {}),
    aggregatorRoot: aggregatorRoot(),
    // Real TEI by default -- a standard runner was shown to hold it, and
    // its vectors are the ones production computes. EMBEDDER=stub trades
    // that for a much smaller, faster boot.
    embedder: process.env.EMBEDDER === 'stub' ? 'stub' : 'tei',
    ...(opts.searchOverrides ? { searchOverrides: opts.searchOverrides } : {}),
  });

  // Everything from here on runs with containers already up: the schema
  // gate, port discovery, kcadm, the realm mutation, seeding and the token
  // grant. A throw in any of them left `stack` unassigned, so afterAll's
  // teardownStack(stack) optional-chained to nothing and ten containers AND
  // their volumes survived -- and the next run died in parseSeedOutput with
  // "apikey already existed", pointing nowhere near the original failure.
  // src/cli/main.ts already documents this hazard; the path CI takes was
  // the one without the guard.
  try {
    return await seedBootedStack(provider, resolved, target, targetId, digests, opts);
  } catch (err) {
    await provider.down().catch(() => {
      // The original failure is the one worth reporting. A teardown that
      // also fails must not replace it.
    });
    throw err;
  }
}

async function seedBootedStack(
  provider: ComposeProvider,
  resolved: Awaited<ReturnType<typeof resolveTarget>>,
  target: TargetSchemas,
  targetId: string,
  digests: Record<string, string>,
  opts: { http?: typeof fetch; name?: string },
): Promise<BootedStack> {
  const env = await provider.up();
  const stackEnv = buildStackEnv(resolved);

  const admin = await createKcadmAdmin((svc, cmd) => provider.exec(svc, cmd), {
    username: stackEnv.KC_BOOTSTRAP_ADMIN_USERNAME!,
    password: stackEnv.KC_BOOTSTRAP_ADMIN_PASSWORD!,
  });
  const seeded = await seedIdentities(
    { realm: stackEnv.KEYCLOAK_REALM! },
    {
      runTool: (cmd) => provider.runTool(cmd),
      admin,
      obtainToken: (user) =>
        obtainUserToken(
          {
            baseUrl: env.endpoints.keycloak,
            realm: stackEnv.KEYCLOAK_REALM!,
            clientId: stackEnv.KEYCLOAK_UI_CLIENT_ID!,
          },
          user,
        ),
    },
  );

  const probe = createIngestProbe({
    redisUrl: env.endpoints.redisUrl,
    postgresUrl: env.endpoints.postgresUrl,
  });
  // Same Redis, different keys: notification-service shares the stack's
  // instance and writes its jobs to plain lists.
  const notifications = createNotificationProbe({ redisUrl: env.endpoints.redisUrl });

  return {
    provider,
    env,
    seeded,
    probe,
    notifications,
    target,
    targetId,
    digests,
    seed: seedFromEnv(process.env),
    name: opts.name ?? 'journeys',
    stackEnv,
    baseCtx: {
      clients: {},
      http: opts.http ?? fetch,
      endpoints: env.endpoints,
      seeded: seeded as unknown as Record<string, unknown>,
      target,
      probe,
      notifications,
      auth: {
        apiKey: seeded.apiKey,
        actingOrgId: seeded.aggregatorOrgId,
        participantToken: seeded.participant.token,
      },
    },
  };
}

/**
 * Capture the logs, then close the probes, then take the stack down.
 *
 * The order is the point. The workflow's triage step runs after this
 * process has exited, so anything it wants from a container is already
 * gone -- the bundle from a failing run held a docker-ps header row and
 * nothing else. A service log is where "did signals-dpg even call
 * /notify" is answered, so it is captured here, while the containers
 * still exist.
 */
export async function teardownStack(stack: BootedStack | undefined): Promise<void> {
  if (stack?.provider) {
    try {
      await mkdir('reports', { recursive: true });
      await writeFile(`reports/compose-logs-${stack.name}.txt`, await stack.provider.logs());
    } catch (err) {
      // Never let capturing evidence be the reason a run fails.
      console.warn('could not capture compose logs:', err);
    }
  }
  await stack?.probe?.close();
  await stack?.notifications?.close();
  await stack?.provider?.down();
}
