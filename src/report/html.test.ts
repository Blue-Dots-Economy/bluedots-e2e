import { describe, expect, test } from 'vitest';
import { renderHtml, type RunReport } from './html.js';

const REPORT: RunReport = {
  releaseTag: '202608-s2-rc1',
  target: 'blue_dot/ka-dhwd',
  provenance: { signals_dpg_sha: 'abc1234', bluedots_schemas_sha: 'def5678' },
  suites: [
    {
      name: 'J2 — a new profile becomes findable in search',
      durationMs: 17800,
      cases: [
        { name: 'runs end to end on the configured target', ok: true, durationMs: 17800 },
      ],
    },
    {
      name: 'negative control',
      durationMs: 33000,
      cases: [
        { name: 'J2 fails when only the sweep indexed the item', ok: true, durationMs: 33000 },
        { name: 'a broken thing', ok: false, durationMs: 12, failure: 'no match after 30s' },
      ],
    },
  ],
};

describe('renderHtml', () => {
  test('leads with the verdict, not the detail', () => {
    // Whoever opens this wants "did the release pass" in the first line.
    const html = renderHtml(REPORT);

    expect(html.indexOf('FAILED')).toBeLessThan(html.indexOf('a broken thing'));
  });

  test('names the release and the target it verified', () => {
    const html = renderHtml(REPORT);

    expect(html).toContain('202608-s2-rc1');
    expect(html).toContain('blue_dot/ka-dhwd');
  });

  test('shows the failure message, not just that something failed', () => {
    const html = renderHtml(REPORT);

    expect(html).toContain('no match after 30s');
  });

  test('records provenance, so a re-run is attributable', () => {
    const html = renderHtml(REPORT);

    expect(html).toContain('abc1234');
  });

  test('escapes text so a quote or bracket cannot break the page', () => {
    const odd = renderHtml({
      ...REPORT,
      suites: [{ name: 'A <script>alert("x")</script> suite', durationMs: 1, cases: [] }],
    });

    expect(odd).not.toContain('<script>alert');
    expect(odd).toContain('&lt;script&gt;');
  });

  test('is self-contained, so it opens from an artifact with no network', () => {
    const html = renderHtml(REPORT);

    expect(html).not.toMatch(/<link[^>]+href=|<script[^>]+src=/);
  });

  test('says PASSED when everything passed', () => {
    const html = renderHtml({ ...REPORT, suites: [REPORT.suites[0]!] });

    expect(html).toContain('PASSED');
  });
});
