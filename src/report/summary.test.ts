import { describe, expect, test } from 'vitest';
import { buildSummary, renderTier2, renderEvidenceSheet } from './summary.js';

const RUN = {
  releaseTag: '202608-s2-rc1',
  target: 'purple_dot',
  startedAt: '2026-09-10T14:22:00Z',
  digests: { 'signals-dpg': 'sha256:aaa', 'signals-search': 'sha256:bbb' },
  realmMutations: ['enabled directAccessGrants on signals-ui'],
  journeys: [
    {
      id: 'J2',
      title: 'A new profile becomes findable in search',
      capability: 'search-and-discovery',
      ok: true,
      trace: [
        { label: 'Created a seeker profile', ok: true, durationMs: 0 },
        { label: 'Found the profile in search', ok: true, durationMs: 0 },
      ],
    },
  ],
};

describe('buildSummary', () => {
  test('records the digests the run actually verified', () => {
    // A branch tag is mutable, so "it passed on develop" means nothing
    // later without the digest.
    const s = buildSummary(RUN);

    expect(s.digests['signals-dpg']).toBe('sha256:aaa');
  });

  test('records realm mutations, because a mutated realm is not the shipped one', () => {
    const s = buildSummary(RUN);

    expect(s.realmMutations).toContain('enabled directAccessGrants on signals-ui');
  });

  test('is red when any journey failed', () => {
    const s = buildSummary({
      ...RUN,
      journeys: [{ ...RUN.journeys[0]!, ok: false }],
    });

    expect(s.ok).toBe(false);
  });
});

describe('renderTier2', () => {
  test('prints the step labels verbatim, not a rendered translation', () => {
    // The label declared beside the step IS the line printed. Translating
    // here is how a report drifts from what the tests assert.
    const out = renderTier2(buildSummary(RUN));

    expect(out).toContain('Created a seeker profile');
  });

  test('marks the failing step so the eye lands on it', () => {
    const failed = buildSummary({
      ...RUN,
      journeys: [{
        ...RUN.journeys[0]!,
        ok: false,
        trace: [
          { label: 'Created a seeker profile', ok: true, durationMs: 0 },
          { label: 'Found the profile in search', ok: false, durationMs: 0, error: 'no match after 30s' },
        ],
      }],
    });

    const out = renderTier2(failed);

    expect(out).toMatch(/✗ Found the profile in search/);
    expect(out).toContain('no match after 30s');
  });
});

describe('renderEvidenceSheet', () => {
  test('groups by capability in business language', () => {
    const out = renderEvidenceSheet([buildSummary(RUN)]);

    expect(out).toContain('Search and discovery');
    expect(out).toContain('PASSED');
  });

  test('names the targets it covers', () => {
    // A sheet covering one target must not read like one covering four.
    const out = renderEvidenceSheet([buildSummary(RUN)]);

    expect(out).toContain('purple_dot');
  });

  test('lists capabilities with no run under NOT COVERED', () => {
    // A report listing only passes invites the reader to assume everything
    // was checked.
    const out = renderEvidenceSheet([buildSummary(RUN)]);

    expect(out).toContain('NOT COVERED');
    expect(out).toContain('Notifications');
  });

  test('spans several runs of the same release tag', () => {
    // A run tests one target; "did this RC pass?" spans every target it was
    // verified on.
    const blue = buildSummary({ ...RUN, target: 'blue_dot/ka-dhwd' });

    const out = renderEvidenceSheet([buildSummary(RUN), blue]);

    expect(out).toContain('purple_dot');
    expect(out).toContain('blue_dot/ka-dhwd');
  });
});
