import { describe, expect, test } from 'vitest';
import { makeInspector } from './docker_inspector.js';

const MANIFEST = JSON.stringify([{ Descriptor: { digest: 'sha256:abc' } }]);

describe('makeInspector', () => {
  test('returns the digest', async () => {
    const inspect = makeInspector(async () => MANIFEST);

    expect(await inspect('ghcr.io/x/y:develop')).toBe('sha256:abc');
  });

  test('returns null only when the registry says the manifest is unknown', async () => {
    const inspect = makeInspector(async () => {
      throw new Error('manifest unknown');
    });

    expect(await inspect('ghcr.io/x/y:nope')).toBeNull();
  });

  test('retries a transient failure rather than calling the image missing', async () => {
    // A blip reported as IMAGE_NOT_FOUND sends the reader hunting for an
    // image that exists -- and the same image had booted minutes earlier.
    let calls = 0;
    const inspect = makeInspector(async () => {
      if (++calls < 3) throw new Error('error during connect: EOF');
      return MANIFEST;
    }, { retries: 3, backoffMs: 0 });

    expect(await inspect('ghcr.io/x/y:develop')).toBe('sha256:abc');
    expect(calls).toBe(3);
  });

  test('gives up with a distinct error, not a missing-image claim', async () => {
    const inspect = makeInspector(async () => {
      throw new Error('error during connect: EOF');
    }, { retries: 2, backoffMs: 0 });

    await expect(inspect('ghcr.io/x/y:develop')).rejects.toThrow(/REGISTRY_UNAVAILABLE/);
  });

  test('does not retry an auth failure, which will not fix itself', async () => {
    let calls = 0;
    const inspect = makeInspector(async () => {
      calls++;
      throw new Error('unauthorized: authentication required');
    }, { retries: 3, backoffMs: 0 });

    await expect(inspect('ghcr.io/x/y:develop')).rejects.toThrow(/REGISTRY_UNAUTHORIZED/);
    expect(calls).toBe(1);
  });
});
