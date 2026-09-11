import { describe, expect, test } from 'vitest';
import { imageTagsFromEnv, releaseTagFromEnv, seedFromEnv, targetFromEnv } from './from_env.js';

describe('targetFromEnv', () => {
  test('reads a dot-only target', () => {
    expect(targetFromEnv({ JOURNEY_TARGET: 'purple_dot' })).toEqual({
      dot: 'purple_dot', instance: null,
    });
  });

  test('reads a dot/instance target', () => {
    expect(targetFromEnv({ JOURNEY_TARGET: 'blue_dot/ka-dhwd' })).toEqual({
      dot: 'blue_dot', instance: 'ka-dhwd',
    });
  });

  test('defaults to purple_dot when unset, for a bare local run', () => {
    expect(targetFromEnv({})).toEqual({ dot: 'purple_dot', instance: null });
  });

  test('refuses a malformed value rather than testing something else', () => {
    // Silently falling back would run purple and report the value asked
    // for, which is a green for a target that was never exercised.
    expect(() => targetFromEnv({ JOURNEY_TARGET: 'a/b/c' })).toThrow(/JOURNEY_TARGET/);
  });
});

describe('releaseTagFromEnv', () => {
  test('reads the release tag CI is verifying', () => {
    expect(releaseTagFromEnv({ JOURNEY_RELEASE_TAG: '202609-s1-rc1' })).toBe('202609-s1-rc1');
  });

  test('is null when unset, so a local run uses the default tags', () => {
    expect(releaseTagFromEnv({})).toBeNull();
  });

  test('refuses a value that is not a release tag', () => {
    // A branch name here would boot that branch's images while the report
    // says a release was verified.
    expect(() => releaseTagFromEnv({ JOURNEY_RELEASE_TAG: 'develop' })).toThrow(
      /JOURNEY_RELEASE_TAG/,
    );
  });

  test('accepts the fleet-wide release tag shape', () => {
    expect(releaseTagFromEnv({ JOURNEY_RELEASE_TAG: '202608-s2-rc11' })).toBe('202608-s2-rc11');
  });
});

describe('seedFromEnv', () => {
  test('uses an explicit seed when given', () => {
    expect(seedFromEnv({ JOURNEY_SEED: 'abc123' })).toBe('abc123');
  });

  test('derives a stable seed from the run when not given', () => {
    // Stable WITHIN a run so every journey in it shares fixtures, and
    // printed so a failure can be reproduced exactly.
    const env = { JOURNEY_RELEASE_TAG: '202609-s1-rc1', JOURNEY_TARGET: 'purple_dot' };

    expect(seedFromEnv(env)).toBe(seedFromEnv(env));
  });

  test('differs between targets, so two targets do not collide', () => {
    const a = seedFromEnv({ JOURNEY_RELEASE_TAG: 't', JOURNEY_TARGET: 'purple_dot' });
    const b = seedFromEnv({ JOURNEY_RELEASE_TAG: 't', JOURNEY_TARGET: 'blue_dot/ka-dhwd' });

    expect(a).not.toBe(b);
  });

  test('is never empty, since an empty seed silently disables determinism', () => {
    expect(seedFromEnv({}).length).toBeGreaterThan(0);
  });
});

describe('imageTagsFromEnv', () => {
  test('reads per-service tags', () => {
    const tags = imageTagsFromEnv({
      JOURNEY_IMAGE_TAGS: 'signals-dpg=202609-s1-rc2,signals-search=202609-s1-rc1',
    });

    expect(tags).toEqual({
      'signals-dpg': '202609-s1-rc2',
      'signals-search': '202609-s1-rc1',
    });
  });

  test('is empty when unset', () => {
    expect(imageTagsFromEnv({})).toEqual({});
  });

  test('rejects an unknown service rather than ignoring it', () => {
    // A typo'd service name would otherwise be silently dropped and that
    // service would quietly run on its default tag.
    expect(() => imageTagsFromEnv({ JOURNEY_IMAGE_TAGS: 'signals-dgp=x' })).toThrow(
      /signals-dgp/,
    );
  });

  test('ignores empty entries, which a dispatch form produces', () => {
    expect(imageTagsFromEnv({ JOURNEY_IMAGE_TAGS: 'signals-dpg=,,signals-search=x' }))
      .toEqual({ 'signals-search': 'x' });
  });
});

describe('seedFromEnv run distinctness', () => {
  test('differs between two runs of the same tag and target', () => {
    // The seed now derives the participant address, and the upsert is keyed
    // on it. Without a per-run component, re-verifying the same tag would
    // update the previous run's participant rather than create one.
    const base = { JOURNEY_RELEASE_TAG: '202609-s1-rc1', JOURNEY_TARGET: 'purple_dot' };

    expect(seedFromEnv({ ...base, GITHUB_RUN_ID: '1' })).not.toBe(
      seedFromEnv({ ...base, GITHUB_RUN_ID: '2' }),
    );
  });

  test('an explicit seed still reproduces exactly, which is the point of it', () => {
    expect(seedFromEnv({ JOURNEY_SEED: 'abc', GITHUB_RUN_ID: '1' })).toBe(
      seedFromEnv({ JOURNEY_SEED: 'abc', GITHUB_RUN_ID: '2' }),
    );
  });
});
