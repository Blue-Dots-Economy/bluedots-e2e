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

/** The fleet-wide release tag shape: <YYYYMM>-s<sprint>-rc<candidate>. */
const RELEASE_TAG = /^20\d{4}-s\d+-rc\d+$/;

/**
 * Which release a run is verifying.
 *
 * Without this the stack tests fall through to DEFAULT_TAG and boot
 * `:develop`, so a run triggered by a release tag would verify whatever
 * develop pointed at that minute and the release would be promoted on an
 * unrelated build's result.
 *
 * A non-release value is rejected rather than passed through: a branch name
 * here boots that branch's images while the report says a release was
 * verified.
 */
export function releaseTagFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string | null {
  const raw = env.JOURNEY_RELEASE_TAG?.trim();
  if (!raw) return null;
  if (!RELEASE_TAG.test(raw)) {
    throw new Error(
      `JOURNEY_RELEASE_TAG must look like 202609-s1-rc1, got "${raw}". ` +
        `Leave it unset to use the default per-service tags.`,
    );
  }
  return raw;
}

/**
 * The fixture seed for this run.
 *
 * Fixtures are deterministic per seed so a failure can be reproduced, but
 * that is worthless if nothing sets one -- the generator was falling back
 * to Date.now(), which made every run unreproducible while a unit test
 * asserted determinism. The seed is recorded in the run's provenance, so a
 * red run can be replayed with JOURNEY_SEED=<value>.
 */
export function seedFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string {
  const explicit = env.JOURNEY_SEED?.trim();
  if (explicit) return explicit;

  // Distinct between targets, so two targets' fixture values cannot make a
  // search assertion ambiguous about which run's item it matched -- and
  // distinct between runs, because the seed derives the participant address
  // and the upsert is keyed on it, so re-verifying a tag would otherwise
  // update the previous run's participant instead of creating one.
  // JOURNEY_SEED above overrides all of this: that is what a replay sets.
  return [
    env.JOURNEY_RELEASE_TAG ?? 'local',
    env.JOURNEY_TARGET ?? 'default',
    env.GITHUB_RUN_ID ?? String(Date.now()),
  ]
    .join('-')
    .replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Per-service image tags, as `service=tag` pairs.
 *
 * A release is not always one tag across four repos: a fix for an issue
 * found in rc1 ships as rc2 for that service alone, and a run needs to be
 * able to say exactly which candidate of each service it verified.
 *
 * An unknown service name is rejected rather than dropped -- silently
 * ignoring a typo would leave that service on its default tag while the
 * report claimed the release was verified.
 */
export function imageTagsFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string> {
  const raw = env.JOURNEY_IMAGE_TAGS?.trim();
  if (!raw) return {};

  const known = ['signals-dpg', 'aggregator-dpg', 'signals-search', 'notification-service'];
  const out: Record<string, string> = {};

  for (const entry of raw.split(',').map((e) => e.trim()).filter(Boolean)) {
    const [service, tag] = entry.split('=').map((p) => p.trim());
    if (!service) continue;
    if (!known.includes(service)) {
      throw new Error(
        `JOURNEY_IMAGE_TAGS names unknown service "${service}". Known: ${known.join(', ')}`,
      );
    }
    // A dispatch form submits an empty value for an untouched field.
    if (tag) out[service] = tag;
  }

  return out;
}
