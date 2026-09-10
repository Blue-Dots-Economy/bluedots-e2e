import { describe, expect, test } from 'vitest';
import { embeddingFor, STUB_EMBEDDER_SOURCE } from './stub_embedder.js';

describe('embeddingFor', () => {
  test('returns the dimension the column requires', () => {
    // item_search.embedding is vector(1024) and the worker throws at boot on
    // any mismatch.
    expect(embeddingFor('hello', 1024)).toHaveLength(1024);
  });

  test('is deterministic for the same text', () => {
    // content_hash feeds off the vector; a non-deterministic stub would make
    // every re-index look like a change.
    expect(embeddingFor('a seeker profile', 8)).toEqual(embeddingFor('a seeker profile', 8));
  });

  test('gives different text different vectors', () => {
    // Two fixtures embedding identically would make a search assertion
    // ambiguous about which item it matched.
    expect(embeddingFor('alpha', 8)).not.toEqual(embeddingFor('beta', 8));
  });

  test('is unit-normalised, since search ranks by cosine distance', () => {
    const v = embeddingFor('anything', 64);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));

    expect(norm).toBeCloseTo(1, 6);
  });

  test('produces finite numbers only', () => {
    // A NaN reaches pgvector as an error at insert time, far from here.
    expect(embeddingFor('x', 32).every(Number.isFinite)).toBe(true);
  });
});

describe('STUB_EMBEDDER_SOURCE', () => {
  test('serves the OpenAI-shaped route signals-search calls', () => {
    // The client requests `${EMBEDDING_BASE_URL}/embeddings` and reads
    // json.data[].embedding.
    expect(STUB_EMBEDDER_SOURCE).toContain('/embeddings');
    expect(STUB_EMBEDDER_SOURCE).toContain('data');
  });

  test('depends only on node builtins, so it runs with no install', () => {
    // It runs inside an image pulled for another purpose, so a third-party
    // dependency would mean another image to build and pull -- which is the
    // cost this exists to avoid. node: builtins are fine.
    const requires = [...STUB_EMBEDDER_SOURCE.matchAll(/require\(['"]([^'"]+)['"]\)/g)]
      .map((m) => m[1]!);

    expect(requires.length).toBeGreaterThan(0);
    expect(requires.every((r) => r.startsWith('node:'))).toBe(true);
  });
});
