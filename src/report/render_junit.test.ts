import { describe, expect, test } from 'vitest';
import { renderJUnit } from './render_junit.js';
import { buildSummary } from './summary.js';

const summary = buildSummary({
  releaseTag: '202608-s2-rc1',
  target: 'purple_dot',
  startedAt: '2026-09-10T14:22:00Z',
  digests: {},
  realmMutations: [],
  journeys: [
    {
      id: 'J2', title: 'A new profile becomes findable in search',
      capability: 'search-and-discovery', status: 'failed' as const,
      trace: [{ label: 'Found the profile in search', ok: false, durationMs: 0, error: 'no match' }],
    },
  ],
});

describe('renderJUnit', () => {
  test('is derived from the summary, not produced alongside it', () => {
    // summary.json is canonical; JUnit exists only to feed the check UI,
    // which cannot carry a capability, a skip reason or digest provenance.
    const xml = renderJUnit(summary);

    expect(xml).toContain('A new profile becomes findable in search');
  });

  test('marks a failed journey as a failure with its step', () => {
    const xml = renderJUnit(summary);

    expect(xml).toContain('<failure');
    expect(xml).toContain('Found the profile in search');
  });

  test('escapes text so a quote in a label cannot break the XML', () => {
    const odd = buildSummary({
      ...summary,
      journeys: [{ ...summary.journeys[0]!, title: 'A "quoted" & <odd> title', status: 'passed' as const, trace: [] }],
    });

    const xml = renderJUnit(odd);

    expect(xml).toContain('&quot;quoted&quot;');
    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('<odd>');
  });
});
