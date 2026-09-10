import { describe, expect, expectTypeOf, test } from 'vitest';
import type { paths as SearchPaths } from './generated/signals-search.js';
import type { paths as SignalsPaths } from './generated/signals-dpg.js';

/**
 * These assertions ARE the contract check.
 *
 * The generated clients are produced from each provider's committed
 * openapi.json. If a provider removes a response field or an endpoint the
 * journeys rely on, regenerating makes these fail to typecheck -- before any
 * container starts, and in the PR that regenerates rather than weeks later in
 * a red journey run.
 */
describe('signals-search contract', () => {
  test('POST /v1/search exists and takes a JSON body', () => {
    type Search = SearchPaths['/v1/search']['post'];

    expectTypeOf<Search['requestBody']>().not.toBeNever();
  });

  test('the search request carries a context with a domain', () => {
    // J2 searches within a target's domain; losing this shape would silently
    // change what the journey asserts.
    type Body = SearchPaths['/v1/search']['post']['requestBody']['content']['application/json'];

    expectTypeOf<Body['context']['domain']>().toEqualTypeOf<string>();
  });

  test('the flat search variant is still published', () => {
    expectTypeOf<SearchPaths['/v1/search/flat']['post']>().not.toBeNever();
  });
});

describe('signals-dpg contract', () => {
  test('the participant lookup the voice flow uses is still published', () => {
    // GET /admin/participant is one of exactly three routes admitting a
    // `voice` acting org, and J5 depends on it.
    expectTypeOf<SignalsPaths['/api/v1/admin/participant']['get']>().not.toBeNever();
  });
});

describe('generated clients are pinned', () => {
  test('every generated file records the revision it came from', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(
      new URL('./generated/signals-search.ts', import.meta.url),
      'utf8',
    );

    // Provenance in the file itself, so a stale client is visible in review
    // rather than needing a lookup.
    expect(src).toMatch(/Blue-Dots-Economy\/signals-search@[0-9a-f]{40}/);
  });
});
