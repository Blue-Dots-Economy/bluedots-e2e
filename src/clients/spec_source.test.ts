import { describe, expect, test } from 'vitest';
import { SPEC_SOURCES, fetchSpecs, specsWithoutOpenapi } from './spec_source.js';

describe('SPEC_SOURCES', () => {
  test('covers the three services that publish a spec', () => {
    expect(Object.keys(SPEC_SOURCES).sort()).toEqual([
      'aggregator-dpg', 'signals-dpg', 'signals-search',
    ]);
  });

  test('names notification-service as knowingly absent, not forgotten', () => {
    // It publishes no openapi.json. Recording that explicitly stops someone
    // "fixing" the omission by vendoring a hand-written spec.
    expect(specsWithoutOpenapi).toContain('notification-service');
  });
});

describe('fetchSpecs', () => {
  test('pins each spec to a commit sha rather than a moving ref', async () => {
    // A branch tag moves. Generating from `develop` twice can yield different
    // clients with no record of why, so the sha is resolved and recorded.
    const fetcher = {
      resolveSha: async () => 'abc1234',
      readFile: async () => '{"openapi":"3.1.0"}',
    };

    const out = await fetchSpecs({ 'signals-dpg': 'develop' }, fetcher);

    expect(out['signals-dpg']!.sha).toBe('abc1234');
  });

  test('returns the spec body for generation', async () => {
    const fetcher = {
      resolveSha: async () => 'abc1234',
      readFile: async () => '{"openapi":"3.1.0"}',
    };

    const out = await fetchSpecs({ 'signals-search': 'develop' }, fetcher);

    expect(out['signals-search']!.body).toContain('openapi');
  });

  test('fails naming the service when a spec is missing', async () => {
    const fetcher = {
      resolveSha: async () => 'abc1234',
      readFile: async () => null,
    };

    await expect(fetchSpecs({ 'aggregator-dpg': 'develop' }, fetcher)).rejects.toThrow(
      /SPEC_NOT_FOUND.*aggregator-dpg/s,
    );
  });
});
