import { describe, expect, test } from 'vitest';
import { buildSummary, renderTier2, renderEvidenceSheet } from './summary.js';
import type { JourneyRun, RunInput } from './summary.js';

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
      status: 'passed' as const,
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
      journeys: [{ ...RUN.journeys[0]!, status: 'failed' as const }],
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
        status: 'failed' as const,
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

describe('buildSummary counts everything the run asserted', () => {
  const journey = (over: Partial<JourneyRun> = {}): JourneyRun => ({
    id: 'J2',
    title: 'A new profile becomes findable in search',
    capability: 'search-and-discovery',
    status: 'passed',
    trace: [{ label: 'did a thing', ok: true, durationMs: 1 }],
    ...over,
  });

  const run = (over: Partial<RunInput> = {}): RunInput => ({
    releaseTag: 'v1',
    target: 'purple_dot',
    startedAt: '2026-09-11T00:00:00Z',
    digests: {},
    realmMutations: [],
    journeys: [journey()],
    ...over,
  });

  test('fails when a harness check failed, even with every journey green', () => {
    // The negative control is what makes J2's green mean anything. Reading
    // ok from the journey registry alone let a run where the control FAILED
    // publish PASSED in summary.json, trace.txt, the evidence sheet and the
    // derived JUnit -- while report.html, reading the JUnit cases, showed
    // red. The four that disagreed are the ones the promotion checklist
    // reads.
    const summary = buildSummary(
      run({
        harness: [
          { name: 'Negative control > J2 fails when only the sweep indexed it', ok: false },
        ],
      }),
    );

    expect(summary.ok).toBe(false);
  });

  test('does not report a journey nobody ran as a failure', () => {
    // selectJourneys skips a journey the environment cannot verify. Reading
    // that as FAILED is the inverse of what capabilities.ts promises, and it
    // would declare a whole release failed on the http-only external
    // provider, which runs a subset by design.
    const summary = buildSummary(
      run({ journeys: [journey(), journey({ id: 'J3', status: 'not-covered' })] }),
    );

    expect(summary.ok).toBe(true);
  });

  test('does not call a run where everything was skipped a pass either', () => {
    // Nothing was verified. Not a failure of the release, but not evidence
    // for shipping it.
    expect(buildSummary(run({ journeys: [journey({ status: 'not-covered' })] })).ok).toBe(false);
  });

  test('does not call a run that executed nothing a pass', () => {
    // every() on an empty list is true, so a run that resolved no journeys
    // at all reported PASSED.
    expect(buildSummary(run({ journeys: [] })).ok).toBe(false);
  });

  test('still fails on a failed journey', () => {
    expect(buildSummary(run({ journeys: [journey({ status: 'failed' })] })).ok).toBe(false);
  });
});

describe('the limits of a pass', () => {
  test('names what a green run still does not prove', () => {
    // A report that lists only what passed invites the reader to assume
    // everything was checked. The NOT COVERED block names capabilities with
    // no journey at all; this names the limits of the ones that DID run.
    const sheet = renderEvidenceSheet([buildSummary(RUN)]);

    expect(sheet).toMatch(/does not prove/i);
    expect(sheet).toContain('purple_dot');
  });

  test('says a target that was not verified was not verified', () => {
    // One target's green says nothing about another's: they serve
    // different domains from different schemas.
    const sheet = renderEvidenceSheet([buildSummary(RUN)]);

    expect(sheet).toMatch(/other targets|another target|targets not run/i);
  });
});
