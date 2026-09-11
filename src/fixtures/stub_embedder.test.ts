import { describe, expect, test } from 'vitest';
// Imports the SAME file the container runs. The point of this test is lost
// if it exercises a TypeScript copy of the algorithm instead.
import { embeddingFor, createServer } from './stub_embedder.js';

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
    expect(embeddingFor('alpha', 8)).not.toEqual(embeddingFor('beta', 8));
  });

  test('is unit-normalised, since search ranks by cosine distance', () => {
    const v = embeddingFor('anything', 64);
    const norm = Math.sqrt(v.reduce((s: number, x: number) => s + x * x, 0));

    expect(norm).toBeCloseTo(1, 6);
  });

  test('spans negative and positive, not one orthant', () => {
    // An all-positive vector puts every fixture in the same orthant and
    // collapses the distances between them.
    const v = embeddingFor('anything', 256);

    expect(v.some((x: number) => x < 0)).toBe(true);
    expect(v.some((x: number) => x > 0)).toBe(true);
  });

  test('produces finite numbers only', () => {
    // A NaN reaches pgvector as an error at insert time, far from here.
    expect(embeddingFor('x', 32).every(Number.isFinite)).toBe(true);
  });
});

describe('createServer', () => {
  test('answers the OpenAI-shaped route signals-search calls', async () => {
    // The client requests `${EMBEDDING_BASE_URL}/embeddings` and reads
    // json.data[].embedding. Exercising the real server, not a description
    // of one.
    const http = await import('node:http');
    const server = createServer(http.default, 8);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'stub', input: ['one', 'two'] }),
      });
      const body = (await res.json()) as { data: { embedding: number[] }[] };

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(2);
      expect(body.data[0]!.embedding).toHaveLength(8);
    } finally {
      server.close();
    }
  });

  test('404s an unrelated path rather than embedding it', async () => {
    const http = await import('node:http');
    const server = createServer(http.default, 8);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    try {
      expect((await fetch(`http://127.0.0.1:${port}/v1/models`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
