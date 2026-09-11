/**
 * Whether a failure blocks the release or blocks the run.
 *
 * A report that says only FAILED makes a release manager guess which, and
 * the two need opposite responses: a product failure stops the RC, a
 * harness failure means nothing was verified and the run must be repaired
 * and repeated. signals-dpg's own e2e signoff separates these for the same
 * reason (signals-dpg#663).
 */
export type FailureClass = 'product' | 'harness';

/**
 * Failures raised by the harness about itself, never by a service under
 * test. Everything else is the services' -- including anything
 * unrecognised, because calling an unknown failure the suite's fault is how
 * a real defect gets waved through.
 */
const HARNESS_PREFIXES = [
  'STACK_UNHEALTHY',
  'IMAGE_NOT_FOUND',
  'REGISTRY_UNAUTHORIZED',
  'REGISTRY_UNAVAILABLE',
  'TARGET_UNUSABLE',
  'FIXTURE_INVALID',
  'FIXTURE_UNSUPPORTED',
  'SEED_FAILED',
  'ENVIRONMENT_INVALID',
  'ENVIRONMENT_UNREACHABLE',
  'MIGRATIONS_INCOMPLETE',
  'OVERLAY_INCOMPLETE',
  'OVERLAY_UNKNOWN_SERVICE',
  'INGEST_PROBE_UNREADABLE',
  'BIND_SOURCE_MISSING',
];

export function classifyFailure(message: string): FailureClass {
  const prefix = /^([A-Z][A-Z_]+):/.exec(message.trim())?.[1];
  return prefix && HARNESS_PREFIXES.includes(prefix) ? 'harness' : 'product';
}
