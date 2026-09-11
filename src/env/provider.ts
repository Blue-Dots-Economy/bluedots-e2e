import type { Capability } from './capabilities.js';
import type { ResolvedTarget } from '../targets/target_discovery.js';
import type { Endpoints } from './compose/ports.js';

/**
 * What phases 3-5 receive. They must not be able to tell which provider
 * produced it: that is the whole point of the seam, and the reason pointing
 * the suite at a test cluster is a config change rather than a rewrite.
 */
export type EnvironmentContext = {
  target: ResolvedTarget;
  endpoints: Endpoints;
  capabilities: Capability[];
  /** Empty for providers that do not own image lifecycle (e.g. a cluster). */
  digests: Record<string, string>;
  /**
   * Whether destructive seeding is permitted. A stack that dies in minutes is
   * not the same as a shared cluster holding someone else's data.
   */
  disposable: boolean;
  /**
   * Realm changes the harness made after import. Empty is the good case;
   * anything here belongs in the run report, because a mutated realm is not
   * quite the realm the services deploy against.
   */
  realmMutations: string[];
};

export interface EnvironmentProvider {
  up(): Promise<EnvironmentContext>;
  down(): Promise<void>;
}
