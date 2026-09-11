import { describe, expect, test } from 'vitest';
import { renderHtml, type HttpEntryView, type RunReport } from './render_html.js';
import type { JourneyView } from './journey_views.js';

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

  test('renders a tree even with no journeys, so the page has one shape', () => {
    // A report rendered from JUnit alone still gets a block per suite
    // rather than falling back to a differently-shaped flat table.
    const html = renderHtml(REPORT);

    expect(html).toContain('class="tree"');
    expect((html.match(/details class="journey/g) ?? [])).toHaveLength(REPORT.suites.length);
  });
});

const failing: HttpEntryView = {
  step: 'J2 — Found the profile in search',
  method: 'POST',
  url: 'http://localhost:3100/v1/search',
  status: 400,
  durationMs: 42,
  requestHeaders: { 'x-api-key': 'REDACTED', 'content-type': 'application/json' },
  requestBody: '{"context":{"domain":"seeker"}}',
  responseBody: '{"error":"VALIDATION_ERROR"}',
};

const passing: HttpEntryView = {
  step: 'J2 — Created a seeker profile',
  method: 'POST',
  url: 'http://localhost:2742/api/v1/admin/participant',
  status: 200,
  durationMs: 120,
  requestHeaders: {},
  responseBody: '{"items":[{"item_id":"itm_1"}]}',
};

const J2: JourneyView = {
  id: 'J2',
  title: 'A new profile becomes findable in search',
  capability: 'search-and-discovery',
  status: 'failed',
  durationMs: 12500,
  steps: [
    { label: 'Created a seeker profile', status: 'passed', durationMs: 300, http: [passing] },
    {
      label: 'Found the profile in search',
      status: 'failed',
      durationMs: 9000,
      error: 'STEP_FAILED: search 400',
      http: [failing],
    },
    { label: 'Checked the notification', status: 'not-reached', durationMs: 0, http: [] },
  ],
};

const PASSING_J1: JourneyView = {
  id: 'J1',
  title: 'A participant is onboarded',
  capability: 'participant-onboarding',
  status: 'passed',
  durationMs: 4000,
  steps: [{ label: 'Onboarded them', status: 'passed', durationMs: 4000, http: [] }],
};

const TREE: RunReport = {
  ...REPORT,
  suites: [{ name: 'tests/stack/journeys.stack.test.ts', durationMs: 140000, cases: [] }],
  journeys: [J2, PASSING_J1],
  http: [passing, failing],
  startedAt: '2026-09-11 13:04 UTC',
};

describe('the scenario tree', () => {
  test('opens a failed scenario and leaves a passing one collapsed', () => {
    // Whoever opens this page is triaging a failure. An all-open tree
    // buries it; an all-closed one hides it behind a click.
    const html = renderHtml(TREE);
    const failed = html.slice(html.indexOf('id="scenario-0"'), html.indexOf('id="scenario-1"'));
    const passed = html.slice(html.indexOf('id="scenario-1"'));

    expect(failed).toMatch(/^id="scenario-0" open/);
    expect(passed).not.toMatch(/^id="scenario-1" open/);
  });

  test('nests each request under the step that made it', () => {
    const html = renderHtml(TREE);
    const firstStep = html.slice(
      html.indexOf('Created a seeker profile'),
      html.indexOf('Found the profile in search'),
    );

    expect(firstStep).toContain('/api/v1/admin/participant');
    expect(firstStep).not.toContain('/v1/search');
  });

  test('shows a successful request too, since it is evidence of what ran', () => {
    const html = renderHtml(TREE);

    expect(html).toContain('/api/v1/admin/participant');
    expect(html).toContain('itm_1');
  });

  test('opens the failing step and shows its error with the response', () => {
    const html = renderHtml(TREE);
    const step = html.slice(html.indexOf('class="step fail"'));

    expect(step).toMatch(/^class="step fail" open/);
    expect(step).toContain('STEP_FAILED: search 400');
    expect(step).toContain('VALIDATION_ERROR');
  });

  test('says a step made no call rather than rendering an empty box', () => {
    const html = renderHtml(TREE);

    expect(html).toContain('This step made no HTTP call.');
  });

  test('distinguishes a step the run never reached from one that passed', () => {
    // Omitting it would read as though the journey asserted everything.
    const html = renderHtml(TREE);

    expect(html).toContain('The run stopped before reaching this step.');
  });

  test('links each failure to its scenario, so nobody scrolls hunting', () => {
    const html = renderHtml(TREE);

    expect(html).toContain('href="#scenario-0"');
    expect(html).toContain('1 scenario failed');
  });

  test('counts scenarios, passes, failures and skips from the tree', () => {
    const skipped: JourneyView = { ...PASSING_J1, id: 'J4', status: 'skipped' };
    const html = renderHtml({ ...TREE, journeys: [J2, PASSING_J1, skipped] });
    const cards = html.slice(html.indexOf('class="cards"'), html.indexOf('class="controls"'));

    expect(cards).toMatch(/>3<[^]*?Scenarios/);
    expect(cards).toMatch(/>1<[^]*?Passed/);
    expect(cards).toMatch(/>1<[^]*?Failed</);
    expect(cards).toMatch(/>1<[^]*?Skipped/);
    expect(cards).toMatch(/>2<[^]*?Requests/);
    expect(cards).toMatch(/>1<[^]*?Failed requests/);
  });

  test('keeps checks that belong to no journey in the same tree', () => {
    // The environment assertions are real coverage; dropping them from the
    // page would make the run look narrower than it was.
    const html = renderHtml({
      ...TREE,
      suites: [
        {
          name: 'tests/stack/journeys.stack.test.ts',
          durationMs: 140000,
          cases: [{ name: 'signals-dpg answers over HTTP', ok: true, durationMs: 400 }],
        },
      ],
    });

    expect(html).toContain('Environment and harness checks');
    expect(html).toContain('signals-dpg answers over HTTP');
  });

  test('shows a request that matched no step rather than dropping it', () => {
    const orphan = { ...passing, step: null };
    const html = renderHtml({ ...TREE, orphanHttp: [orphan] });

    expect(html).toContain('Requests outside a journey step');
  });
});

describe('request and response detail', () => {
  test('never prints a credential, even one recorded by mistake', () => {
    const leaked: RunReport = {
      ...TREE,
      journeys: [
        {
          ...J2,
          steps: [
            {
              ...J2.steps[1]!,
              http: [{ ...failing, requestHeaders: { 'x-api-key': 'sk_signals_live' } }],
            },
          ],
        },
      ],
    };

    expect(renderHtml(leaked)).not.toContain('sk_signals_live');
  });

  test('escapes a response body, which is the least trusted text on the page', () => {
    const nasty: RunReport = {
      ...TREE,
      journeys: [
        {
          ...J2,
          steps: [
            { ...J2.steps[1]!, http: [{ ...failing, responseBody: '<script>alert(1)</script>' }] },
          ],
        },
      ],
    };

    const html = renderHtml(nasty);

    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;alert(1)');
  });

  test('pretty-prints a JSON body, since minified JSON is unreadable', () => {
    const html = renderHtml(TREE);

    expect(html).toContain('&quot;error&quot;: &quot;VALIDATION_ERROR&quot;');
  });

  test('leaves a non-JSON body exactly as it arrived', () => {
    const html = renderHtml({
      ...TREE,
      journeys: [
        {
          ...J2,
          steps: [{ ...J2.steps[1]!, http: [{ ...failing, responseBody: '502 Bad Gateway' }] }],
        },
      ],
    });

    expect(html).toContain('502 Bad Gateway');
  });

  test('says how much of a truncated body is missing', () => {
    const html = renderHtml({
      ...TREE,
      journeys: [
        {
          ...J2,
          steps: [
            {
              ...J2.steps[1]!,
              http: [{ ...failing, responseBody: 'aaa\n… truncated, 9001 more characters' }],
            },
          ],
        },
      ],
    });

    expect(html).toContain('truncated, 9001 more characters');
  });

  test('shows a connection failure, which has no status to show', () => {
    const html = renderHtml({
      ...TREE,
      journeys: [
        {
          ...J2,
          steps: [
            {
              ...J2.steps[1]!,
              http: [{ ...failing, status: null, error: 'fetch failed: ECONNREFUSED' }],
            },
          ],
        },
      ],
    });

    expect(html).toContain('ECONNREFUSED');
    expect(html).toContain('neterr');
  });

  test('shows a sub-second request duration in milliseconds', () => {
    // Every HTTP call rounds to "0.0s" otherwise, which hides the one
    // number that distinguishes a slow call from a fast rejection.
    expect(renderHtml(TREE)).toContain('42ms');
  });
});
