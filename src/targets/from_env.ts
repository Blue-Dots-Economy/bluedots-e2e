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
 * What a run is verifying -- a release candidate, or a branch.
 *
 * Without this the stack tests fall through to DEFAULT_TAG and boot
 * `:develop`, so a run triggered by a release tag would verify whatever
 * develop pointed at that minute and the release would be promoted on an
 * unrelated build's result.
 *
 * A branch is accepted, and used to be refused. The refusal was guarding a
 * real hazard -- a branch name here boots that branch's images while the
 * report claims a release was verified -- but it was guarding it in the
 * wrong place: verifying a change BEFORE it is cut is ordinary work, and
 * blocking it did not stop anyone, it just pushed them to pass the branch
 * through the per-service tag inputs where the headline still said
 * "release". The hazard is the LABEL, so the label is where it is now
 * handled; see describeSource.
 *
 * What stays rejected is a value with whitespace or a shell metacharacter
 * in it. This ends up in an image reference and a git ref.
 */
export function releaseTagFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string | null {
  const raw = env.JOURNEY_RELEASE_TAG?.trim();
  if (!raw) return null;
  if (!RELEASE_TAG.test(raw) && !/^[A-Za-z0-9._\/-]+$/.test(raw)) {
    throw new Error(
      `JOURNEY_RELEASE_TAG must be a release tag like 202609-s1-rc1, or a plain branch or ` +
        `commit ref. Got "${raw}", which is neither -- it reaches an image reference and a ` +
        `git ref, so it cannot carry whitespace or shell characters.`,
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
/**
 * Distinguishes this process from another run of the same tag and target.
 *
 * Fixed at module load, not per call: seedFromEnv has to return the same
 * value every time it is asked within a run, or two journeys in one run
 * build fixtures nothing can correlate. GITHUB_RUN_ID supplies it in CI.
 */
const PROCESS_NONCE = String(Date.now());

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
    env.GITHUB_RUN_ID ?? PROCESS_NONCE,
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

/**
 * The seed one journey builds its fixtures from.
 *
 * Per journey, not per run. Every journey used to take the run's seed
 * directly, so two that both create a seeker profile minted the same
 * participant address -- and the upsert is keyed on that address, so the
 * second updated the first's participant rather than creating one. Their
 * item_state matched too, which left the search assertion unable to say
 * which journey's item it had found.
 *
 * Latent while one journey exists, and exactly the collision signals-dpg's
 * own e2e suite hit as every parallel worker minting one phone number
 * (signals-dpg#663). Derived rather than random, so JOURNEY_SEED still
 * reproduces a run exactly.
 */
export function seedForJourney(runSeed: string, journeyId: string): string {
  return `${runSeed}-${journeyId.toLowerCase()}`;
}
