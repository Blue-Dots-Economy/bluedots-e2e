import { describe, expect, test } from 'vitest';
import { renderNewman } from './render_console.js';
import type { RunReport } from './render_html.js';

const REPORT: RunReport = {
  releaseTag: '202609-s1-rc1',
  target: 'blue_dot/ka-dhwd',
  provenance: { signals_dpg_sha: 'abc1234' },
  suites: [
    {
      name: 'tests/stack/journeys.stack.test.ts',
      durationMs: 130000,
      cases: [
        { name: 'journeys against a real stack > the environment the journeys run against > signals-dpg answers over HTTP', ok: true, durationMs: 40 },
        { name: 'journeys against a real stack > the environment the journeys run against > the captured api key is accepted by search', ok: true, durationMs: 120 },
        { name: 'journeys against a real stack > journeys > J2 — A new profile becomes findable in search', ok: true, durationMs: 700 },
      ],
    },
    {
      name: 'tests/stack/negative_controls.stack.test.ts',
      durationMs: 31000,
      cases: [
        { name: 'negative control > J2 fails when only the sweep indexed the item', ok: false, durationMs: 30900, failure: 'expected false to be true' },
      ],
    },
  ],
};

describe('renderNewman', () => {
  test('shows the leaf name, not the whole describe chain', () => {
    // `a > b > c > actual name` is how vitest reports it and is unreadable;
    // the hierarchy belongs in the indentation.
    const out = renderNewman(REPORT);

    expect(out).toContain('signals-dpg answers over HTTP');
    expect(out).not.toContain('journeys against a real stack > the environment');
  });

  test('groups cases under their parent, printed once', () => {
    const out = renderNewman(REPORT);
    const occurrences = out.split('the environment the journeys run against').length - 1;

    expect(occurrences).toBe(1);
  });

  test('draws a totals table with executed and failed', () => {
    const out = renderNewman(REPORT);

    expect(out).toMatch(/┌|─/);
    expect(out).toContain('executed');
    expect(out).toContain('failed');
  });

  test('counts failures, not just totals', () => {
    const out = renderNewman(REPORT);
    const line = out.split('\n').find((l) => l.includes('checks'))!;

    // 4 executed, 1 failed.
    expect(line).toMatch(/\b4\b/);
    expect(line).toMatch(/\b1\b/);
  });

  test('lists failure detail at the end, numbered', () => {
    // A reader scrolling to the bottom should find what broke without
    // hunting back through the run.
    const out = renderNewman(REPORT);

    expect(out).toMatch(/failure\s+detail/i);
    expect(out).toContain('expected false to be true');
    expect(out).toContain('J2 fails when only the sweep indexed the item');
  });

  test('reports total run duration', () => {
    const out = renderNewman(REPORT);

    expect(out).toMatch(/total run duration/i);
  });

  test('says nothing about failures when everything passed', () => {
    const passing = { ...REPORT, suites: [REPORT.suites[0]!] };

    expect(renderNewman(passing)).not.toMatch(/failure\s+detail/i);
  });
});

describe('renderNewman — a journey nobody ran', () => {
  // purple_dot runs 14 of the 17 journeys: J9, J18 and J19 declare
  // blue_dot only, because purple_dot's action is `connect` rather than
  // `apply`. The job log printed all three with a tick at 0ms and counted
  // them as executed, so the summary read "17 executed, 0 failed" for a
  // target that verified 14. A journey nobody ran must never look like one
  // that passed -- it is the whole failure this suite exists to catch.
  const withSkips: RunReport = {
    ...REPORT,
    suites: [
      {
        name: 'tests/stack/journeys.stack.test.ts',
        durationMs: 1000,
        cases: [
          { name: 'x > journeys > J2 — A new profile becomes findable in search', ok: true, durationMs: 700 },
          { name: 'x > journeys > J19 — An accepted request reveals contact details', ok: true, skipped: true, durationMs: 0 },
        ],
      },
    ],
  };

  test('marks it as not covered, never with a tick', () => {
    const lines = renderNewman(withSkips).split('\n');
    const line = lines.find((l) => l.includes('J19'))!;

    expect(line).not.toContain('✓');
    expect(line).toContain('not covered');
  });

  test('keeps it out of the executed count', () => {
    const out = renderNewman(withSkips);
    const journeys = out.split('\n').find((l) => l.includes('journeys') && l.includes('│'))!;

    // One journey ran, not two.
    expect(journeys).toMatch(/│\s+1 │/);
  });

  test('counts it in its own column, so the gap is visible rather than absent', () => {
    const out = renderNewman(withSkips);

    expect(out).toContain('not covered');
    expect(out.split('\n').find((l) => l.includes('journeys') && l.includes('│'))).toMatch(
      /1 │\s+0 │\s+1 │/,
    );
  });
});

test('counts requests the same way the html does', () => {
  // The console renderer had no request row and no failed-request test of
  // its own, so the job log and report.html could describe the same run
  // with different numbers.
  const http = [
    { step: null, method: 'POST', url: 'http://x/a', status: 200, durationMs: 1, requestHeaders: {} },
    { step: null, method: 'POST', url: 'http://x/b', status: 400, durationMs: 1, requestHeaders: {} },
    { step: null, method: 'POST', url: 'http://x/c', status: null, durationMs: 1, requestHeaders: {}, error: 'ECONNREFUSED' },
  ];

  const text = renderNewman({
    releaseTag: 'v1', target: 'purple_dot', provenance: {},
    suites: [{ name: 's', durationMs: 10, cases: [{ name: 'a > b', ok: true, durationMs: 10 }] }],
    http,
  });

  expect(text).toMatch(/requests\s*│\s*3\s*│\s*2/);
});
