import { describe, expect, test } from 'vitest';
import { renderHtml, type HttpEntryView, type RunReport } from './render_html.js';

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

describe('renderHtml overview and http detail', () => {
  const WITH_HTTP: RunReport = {
    ...REPORT,
    http: [
      {
        step: 'Found the profile in search' as string | null, method: 'POST',
        url: 'http://localhost:3100/v1/search', status: 400, durationMs: 42,
        requestHeaders: { 'x-api-key': 'REDACTED' },
        requestBody: '{"context":{"domain":"seeker"}}',
        responseBody: '{"error":"VALIDATION_ERROR"}',
      },
      {
        step: 'Created a seeker profile', method: 'POST',
        url: 'http://localhost:2742/api/v1/admin/participant', status: 200,
        durationMs: 120, requestHeaders: {},
      },
    ],
  };

  test('leads with counts a reader scans first', () => {
    const html = renderHtml({ ...WITH_HTTP, scenarios: { total: 1, passed: 0, failed: 1 } });

    // scenarios / passed / failed / requests, as newman's overview does.
    expect(html).toMatch(/scenarios/i);
    expect(html).toMatch(/passed/i);
    expect(html).toMatch(/requests/i);
  });

  test('labels the fallback counts as checks, not as scenarios', () => {
    // Without journey counts the only numbers available are test cases.
    // Calling those "scenarios" would overstate coverage in exactly the
    // report someone uses to decide whether to ship.
    const html = renderHtml(WITH_HTTP);

    expect(html.slice(0, html.indexOf('</div>\n  </div>'))).not.toMatch(/scenarios/i);
  });

  test('counts scenarios from the journey registry, not from case names', () => {
    // Deriving the count from the test names guesses: an environment check
    // whose name happens to carry an em dash would be counted as a journey,
    // and a journey the runner skipped would not be counted at all.
    const html = renderHtml({ ...WITH_HTTP, scenarios: { total: 5, passed: 3, failed: 2 } });
    const overview = html.slice(0, html.indexOf('</div>\n  </div>'));

    expect(overview).toMatch(/>5<[^]*?scenarios/);
    expect(overview).toMatch(/>3<[^]*?passed/);
    expect(overview).toMatch(/>2<[^]*?failed/);
  });

  test('shows a sub-second request duration in milliseconds', () => {
    // Every HTTP call rounds to "0.0s" otherwise, which hides the one
    // number that distinguishes a slow call from a fast rejection.
    const html = renderHtml(WITH_HTTP);

    expect(html.slice(html.indexOf('failed-requests'))).toContain('42ms');
  });

  test('shows the failing request and its response', () => {
    // "A step failed" is not actionable; the 400 body is.
    const html = renderHtml(WITH_HTTP);

    expect(html).toContain('VALIDATION_ERROR');
    expect(html).toContain('/v1/search');
  });

  test('does not show successful requests in the failure detail', () => {
    // A passing call is noise there; the run already says it passed.
    const html = renderHtml(WITH_HTTP);
    const detail = html.slice(html.indexOf('failed-requests'));

    expect(detail).not.toContain('/api/v1/admin/participant');
  });

  test('never prints a credential, even one recorded by mistake', () => {
    const leaked = {
      ...WITH_HTTP,
      http: [
        { ...(WITH_HTTP.http![0] as HttpEntryView), requestHeaders: { 'x-api-key': 'sk_signals_live' } },
      ],
    };

    expect(renderHtml(leaked)).not.toContain('sk_signals_live');
  });

  test('omits the http section entirely when nothing was recorded', () => {
    expect(renderHtml(REPORT)).not.toContain('failed-requests');
  });
});
