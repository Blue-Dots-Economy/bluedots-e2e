/**
 * Which target a stack run tests.
 *
 * Read from the environment rather than hardcoded, so a CI matrix job
 * actually exercises the target it claims. A suite that pins one target
 * while the matrix reports several is a green for something never run --
 * the same class of fault the journeys themselves guard against.
 */
export function targetFromEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): {
  dot: string;
  instance: string | null;
} {
  const raw = env.JOURNEY_TARGET?.trim();
  if (!raw) return { dot: 'purple_dot', instance: null };

  const parts = raw.split('/');
  if (parts.length > 2 || parts.some((p) => p.length === 0)) {
    throw new Error(`JOURNEY_TARGET must be "<dot>" or "<dot>/<instance>", got "${raw}"`);
  }
  return { dot: parts[0]!, instance: parts[1] ?? null };
}
