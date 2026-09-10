import { join } from 'node:path';
import type { EnvironmentContext, EnvironmentProvider } from '../provider.js';
import type { ResolvedTarget } from '../../targets/targets.js';
import { buildStackEnv, renderEnvFile } from './stack_env.js';
import { renderOverlay } from './overlay.js';
import { composeArgs, projectName } from './compose_cmd.js';
import { buildEndpoints, parsePublishedPort, type DiscoveredPorts } from './ports.js';
import { assertSchemaReady } from '../schema_gate.js';

export type ComposeDeps = {
  run: (args: string[]) => Promise<string>;
  writeFile: (path: string, contents: string) => Promise<void>;
  assertBindSources: (paths: readonly string[]) => Promise<void>;
  digests: Record<string, string>;
  baseFile: string;
  runDir: string;
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
    this.project = projectName(target);
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

    await this.deps.writeFile(this.envFile, renderEnvFile(env));
    await this.deps.writeFile(
      this.overlayFile,
      renderOverlay({ target: this.target, digests: this.deps.digests, timing: env }),
    );

    await this.deps.run(this.args(['up', '-d', '--wait']));

    // Phase 2's second gate. `--wait` only proves the bootstrap container
    // exited 0; this proves it created what the journeys read. Addressed
    // through compose rather than the container_name, which is global to the
    // daemon and would hit the developer's own stack.
    await assertSchemaReady(async (relation) => {
      const out = await this.deps.run(
        this.args([
          'exec', '-T', 'postgres',
          'psql', '-U', 'postgres', '-d', 'postgresdb',
          '-tAc', `select to_regclass('public.${relation}')`,
        ]),
      );
      return out.trim().length > 0;
    });

    const discovered = {} as DiscoveredPorts;
    for (const [key, [service, port]] of Object.entries(PORTS)) {
      const out = await this.deps.run(this.args(['port', service, String(port)]));
      discovered[key as keyof DiscoveredPorts] = parsePublishedPort(out);
    }

    return {
      target: this.target,
      endpoints: buildEndpoints(discovered, {
        postgresUser: 'postgres',
        postgresPassword: env.POSTGRES_PASSWORD!,
        postgresDb: 'postgresdb',
        redisPassword: env.REDIS_PASSWORD!,
      }),
      // A compose stack exposes the ingest stream and the read model, which
      // is what lets a journey prove an event crossed the spine.
      capabilities: ['http', 'redis', 'postgres'],
      digests: this.deps.digests,
      disposable: true,
    };
  }

  async down(): Promise<void> {
    // -v removes volumes. A surviving volume carries the previous run's realm
    // and database, which is how a hermetic suite quietly stops being one.
    await this.deps.run(this.args(['down', '-v', '--remove-orphans']));
  }
}
