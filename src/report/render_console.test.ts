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
