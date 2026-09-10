import { describe, expect, test } from 'vitest';
import { releaseTagFromEnv, targetFromEnv } from './from_env.js';

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
