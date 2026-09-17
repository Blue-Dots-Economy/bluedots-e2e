/**
 * What an environment lets a journey observe.
 *
 * `http` alone means assertions can only go through service APIs. `redis`
 * and `postgres` mean the harness can observe the ingest stream and the read
 * model directly, which is what lets a journey prove an event actually
 * traversed the spine rather than that the data arrived somehow.
 */
export type Capability = 'http' | 'redis' | 'postgres';

export type CapabilityCheck =
  | { runnable: true }
  | { runnable: false; missing: Capability[]; reason: string };

/**
 * A journey that cannot be verified in an environment is reported NOT
 * COVERED for that environment, with the reason -- never silently downgraded
 * to a weaker assertion that passes. A green result has to mean the same
 * thing everywhere it appears.
 */
export function checkCapabilities(
  required: readonly Capability[],
  available: readonly Capability[],
): CapabilityCheck {
  const missing = required.filter((c) => !available.includes(c));
  if (missing.length === 0) return { runnable: true };

  return {
    runnable: false,
    missing,
    reason: `environment lacks ${missing.join(', ')}`,
  };
}
