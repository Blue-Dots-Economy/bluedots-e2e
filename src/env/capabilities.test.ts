import { describe, expect, test } from 'vitest';
import { checkCapabilities } from './capabilities.js';

describe('checkCapabilities', () => {
  test('allows a journey whose needs the environment meets', () => {
    const r = checkCapabilities(['http', 'redis'], ['http', 'redis', 'postgres']);

    expect(r.runnable).toBe(true);
  });

  test('refuses to run a journey the environment cannot verify', () => {
    // A cluster typically offers http only. J2 asserts on the Redis stream
    // and on item_search, so without those it degrades to "the item became
    // findable" -- which the reconciliation sweep satisfies on its own.
    const r = checkCapabilities(['http', 'redis', 'postgres'], ['http']);

    expect(r.runnable).toBe(false);
  });

  test('names the missing capabilities so the report can say why', () => {
    const r = checkCapabilities(['http', 'redis', 'postgres'], ['http']);

    expect(r.runnable).toBe(false);
    if (!r.runnable) {
      expect(r.missing).toEqual(['redis', 'postgres']);
      expect(r.reason).toMatch(/redis/);
    }
  });
});
