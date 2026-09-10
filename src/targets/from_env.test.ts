import { describe, expect, test } from 'vitest';
import { targetFromEnv } from './from_env.js';

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
