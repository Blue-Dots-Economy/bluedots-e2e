import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EnvironmentContext, EnvironmentProvider } from '../provider.js';
import type { ResolvedTarget } from '../../targets/target_discovery.js';
import { buildStackEnv, renderEnvFile } from './stack_env.js';
import { renderOverlay } from './overlay.js';
import { assertCoversBaseServices } from './base_services.js';
import { composeArgs, projectName } from './compose_command.js';
import { buildEndpoints, parsePublishedPort, type DiscoveredPorts } from './ports.js';
import { assertSchemaReady } from '../schema_gate.js';
import { enableDirectGrant, type KeycloakAdmin } from '../keycloak_setup.js';
import { createKcadmAdmin } from '../kcadm.js';
import { prepareRealm } from '../realm_prepare.js';


export type ComposeDeps = {
  run: (args: string[]) => Promise<string>;
  writeFile: (path: string, contents: string) => Promise<void>;
  assertBindSources: (paths: readonly string[]) => Promise<void>;
  digests: Record<string, string>;
  baseFile: string;
  runDir: string;
  /** Absolute path to the aggregator-dpg checkout (realm + themes source). */
  aggregatorRoot?: string;
  /** Reads the checked-in realm export; injected for testability. */
  readRealm?: (path: string) => Promise<string>;
  /** Reads the base compose, so its service list can be checked. */
  readBaseFile?: (path: string) => Promise<string>;
  /**
   * Distinguishes two stacks booted for the same target -- the negative
   * control's and the real one. Without it both land in one compose
   * project and fight over each other's containers and volumes.
   */
  projectSuffix?: string;
  /** Deliberate breakage for the negative controls. */
  searchOverrides?: Record<string, string>;
  /** 'tei' (default) or 'stub'; see renderOverlay. */
  embedder?: 'tei' | 'stub';
  /** Injected so the realm mutation is testable without a live Keycloak. */
  createAdmin?: (
    exec: (service: string, cmd: readonly string[]) => Promise<string>,
    creds: { username: string; password: string },
  ) => Promise<KeycloakAdmin>;
};

/** Container ports to discover, by compose service name. */
const PORTS: Record<keyof DiscoveredPorts, [service: string, port: number]> = {
  signalsApi: ['signals-api', 2742],
  searchApi: ['signals-search-api', 3100],
  keycloak: ['keycloak', 8080],
  postgres: ['postgres', 5432],
  redis: ['redis', 6379],
};

/**
 * Owns phases 1-2 for a locally booted stack: generate config, bring the
 * stack up, discover where it landed, and tear it down.
 */
export class ComposeProvider implements EnvironmentProvider {
  private readonly project: string;
  private readonly envFile: string;
  private readonly overlayFile: string;

  constructor(
    private readonly target: ResolvedTarget,
    private readonly deps: ComposeDeps,
  ) {
    this.project = projectName(target, deps.projectSuffix);
    this.envFile = join(deps.runDir, '.env');
    this.overlayFile = join(deps.runDir, 'overlay.yml');
  }

  private args(command: readonly string[]): string[] {
    return composeArgs({
      project: this.project,
      baseFile: this.deps.baseFile,
      overlayFile: this.overlayFile,
      envFile: this.envFile,
      command,
    });
  }

  async up(): Promise<EnvironmentContext> {
    const env = buildStackEnv(this.target);

    // Fail before boot: Docker turns a missing bind source into an empty
    // directory, which surfaces as EISDIR inside a container much later.
    await this.deps.assertBindSources([this.target.networkConfigPath]);

    // And fail before boot on a service the base compose has grown that
    // the overlay does not neutralise. Left alone it keeps its fixed
    // container_name, which is global to the docker daemon -- caught
    // otherwise as a collision minutes in, or not at all until a second
    // run silently reuses the first one's container.
    if (this.deps.readBaseFile) {
      assertCoversBaseServices(await this.deps.readBaseFile(this.deps.baseFile));
    }

    // The checked-in export is prepared before import: aggregator-dpg's
    // currently carries a 343-char client description that exceeds
    // Keycloak's column and fails the whole import. Anything changed is
    // reported rather than absorbed.
    const realmMutations: string[] = [];
    let realmDir: string | undefined;
    if (this.deps.aggregatorRoot && this.deps.readRealm) {
      const raw = await this.deps.readRealm(
        join(this.deps.aggregatorRoot, 'infra', 'keycloak', 'realms', 'realm.json'),
      );
      const prepared = prepareRealm(JSON.parse(raw) as Record<string, unknown>);
      realmMutations.push(...prepared.mutations);
      realmDir = join(this.deps.runDir, 'realms');
      await this.deps.writeFile(
        join(realmDir, 'realm.json'),
        JSON.stringify(prepared.realm, null, 2),
      );
    }

    // Mount the real file rather than writing a copy: the container then
    // runs exactly the module the tests import, so the two cannot drift.
    const stubDir =
      this.deps.embedder === 'stub'
        ? fileURLToPath(new URL('../../fixtures', import.meta.url))
        : undefined;

    await this.deps.writeFile(this.envFile, renderEnvFile(env));
    await this.deps.writeFile(
      this.overlayFile,
      renderOverlay({
        target: this.target,
        digests: this.deps.digests,
        timing: env,
        aggregatorRoot: this.deps.aggregatorRoot,
        realmDir,
        searchOverrides: this.deps.searchOverrides,
        embedder: this.deps.embedder,
        stubDir,
      }),
    );

    await this.deps.run(this.args(['up', '-d', '--wait']));

    // Phase 2's second gate. `--wait` only proves the bootstrap container
    // exited 0; this proves it created what the journeys read. Addressed
    // through compose rather than the container_name, which is global to the
    // daemon and would hit the developer's own stack.
    await assertSchemaReady(async (relation) => {
      const out = await this.exec('postgres', [
        'psql', '-U', 'postgres', '-d', 'postgresdb',
        '-tAc', `select to_regclass('public.${relation}')`,
      ]);
      return out.trim().length > 0;
    });

    const discovered = {} as DiscoveredPorts;
    for (const [key, [service, port]] of Object.entries(PORTS)) {
      const out = await this.deps.run(this.args(['port', service, String(port)]));
      discovered[key as keyof DiscoveredPorts] = parsePublishedPort(out);
    }

    const endpoints = buildEndpoints(discovered, {
      postgresUser: 'postgres',
      postgresPassword: env.POSTGRES_PASSWORD!,
      postgresDb: 'postgresdb',
      redisPassword: env.REDIS_PASSWORD!,
    });

    // Direct grant is disabled on every client the harness could use, so a
    // user token is unobtainable without turning it on. This mutates the
    // imported realm; the design owns that rather than claiming the realm is
    // untouched, and records whether anything actually changed.
    const makeAdmin = this.deps.createAdmin ?? createKcadmAdmin;
    const admin = await makeAdmin((service, cmd) => this.exec(service, cmd), {
      username: env.KC_BOOTSTRAP_ADMIN_USERNAME!,
      password: env.KC_BOOTSTRAP_ADMIN_PASSWORD!,
    });
    if (await enableDirectGrant(admin, env.KEYCLOAK_REALM!, 'signals-ui')) {
      realmMutations.push('enabled directAccessGrants on signals-ui');
    }

    return {
      target: this.target,
      endpoints,
      realmMutations,
      // A compose stack exposes the ingest stream and the read model, which
      // is what lets a journey prove an event crossed the spine.
      capabilities: ['http', 'redis', 'postgres'],
      digests: this.deps.digests,
      disposable: true,
    };
  }

  /**
   * Run a command inside one of this project's services.
   *
   * Addressed by compose service name, never by container_name: those are
   * global to the docker daemon and would reach a stale run or the
   * developer's own stack.
   */
  async exec(service: string, command: readonly string[]): Promise<string> {
    return this.deps.run(this.args(['exec', '-T', service, ...command]));
  }

  /**
   * Run a one-off command in the tools image.
   *
   * The published api image is pruned to prod-only dependencies and has
   * neither tsx nor drizzle-kit, so the seed and migration scripts can only
   * run in the bootstrap image. `run --rm` gives a fresh container that does
   * not linger to collide with the next run.
   */
  async runTool(command: readonly string[]): Promise<string> {
    return this.deps.run(
      this.args(['run', '--rm', '--no-deps', 'signals-bootstrap', ...command]),
    );
  }

  async down(): Promise<void> {
    // -v removes volumes. A surviving volume carries the previous run's realm
    // and database, which is how a hermetic suite quietly stops being one.
    await this.deps.run(this.args(['down', '-v', '--remove-orphans']));
  }
}
