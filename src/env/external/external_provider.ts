import type { Capability } from '../capabilities.js';
import type { EnvironmentContext, EnvironmentProvider } from '../provider.js';
import type { Endpoints } from '../compose/ports.js';
import type { ResolvedTarget } from '../../targets/target_discovery.js';

export type EnvironmentFile = {
  name: string;
  disposable: boolean;
  capabilities: Capability[];
  endpoints: Endpoints;
};

const REQUIRED_ENDPOINTS = ['signalsApi', 'searchApi', 'keycloak'] as const;

/**
 * A target environment is a config document. Nothing about a location, a
 * scheme, a port or a credential lives in code -- http versus https is a
 * field, not a branch in a client.
 */
export function parseEnvironmentFile(raw: string): EnvironmentFile {
  const parsed = JSON.parse(raw) as Partial<EnvironmentFile>;
  const endpoints = (parsed.endpoints ?? {}) as Endpoints;

  for (const key of REQUIRED_ENDPOINTS) {
    if (!endpoints[key]) throw new Error(`ENVIRONMENT_INVALID: endpoints.${key} is required`);
  }

  return {
    name: parsed.name ?? 'external',
    // Default false: seeding a shared environment creates real identities
    // in a database someone else is using, so it must be opted into.
    disposable: parsed.disposable === true,
    capabilities: parsed.capabilities ?? ['http'],
    endpoints,
  };
}

/**
 * Owns no lifecycle: it checks the declared endpoints answer and hands
 * phase 3 the same context the compose provider produces.
 *
 * Deliberately almost empty. If it ever needs more than this, something
 * below it was hardcoded and the seam has failed.
 */
export class ExternalProvider implements EnvironmentProvider {
  constructor(
    private readonly target: ResolvedTarget,
    private readonly config: EnvironmentFile,
    private readonly deps: { probe: (url: string) => Promise<boolean> },
  ) {}

  async up(): Promise<EnvironmentContext> {
    for (const key of REQUIRED_ENDPOINTS) {
      const url = this.config.endpoints[key];
      if (!(await this.deps.probe(url))) {
        throw new Error(`ENVIRONMENT_UNREACHABLE: endpoints.${key} (${url}) did not answer`);
      }
    }

    return {
      target: this.target,
      endpoints: this.config.endpoints,
      capabilities: this.config.capabilities,
      // No images were resolved because none were booted; the report says
      // so rather than implying provenance it does not have.
      digests: {},
      disposable: this.config.disposable,
      realmMutations: [],
    };
  }

  async down(): Promise<void> {
    // Nothing was started, so nothing is torn down. Tearing down someone
    // else's environment is the one thing this must never do.
  }
}
