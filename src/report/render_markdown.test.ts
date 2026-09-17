import { describe, expect, test } from 'vitest';
import { renderMarkdown } from './render_markdown.js';
import type { JourneyView } from './journey_views.js';
import type { RunReport } from './render_html.js';

const J2_PASS: JourneyView = {
  id: 'J2',
  title: 'A new profile becomes findable in search',
  capability: 'search-and-discovery',
  status: 'passed',
  durationMs: 3064,
  steps: [
    { label: 'Created a seeker profile', status: 'passed', durationMs: 1973, http: [] },
    { label: 'Found the profile in search', status: 'passed', durationMs: 34, http: [] },
  ],
};

const PASSING: RunReport = {
  releaseTag: '202609-s1-rc1',
  target: 'purple_dot',
  provenance: { signals_dpg_tag: 'sha-7958281' },
  suites: [
    {
      name: 'tests/stack/journeys.stack.test.ts',
      durationMs: 428200,
      cases: [{ name: 'J2 — A new profile becomes findable in search', ok: true, durationMs: 3064 }],
    },
  ],
  journeys: [J2_PASS],
  http: [],
  startedAt: '2026-09-11 08:58 UTC',
};

describe('renderMarkdown', () => {
  test('leads with the verdict, the release and the target', () => {
    const md = renderMarkdown(PASSING);

    expect(md.split('\n')[0]).toContain('PASSED');
    expect(md).toContain('202609-s1-rc1');
    expect(md).toContain('purple_dot');
  });

  test('puts the counts in one table row, as the report page does', () => {
    const erroring = {
      step: 'J3 — Tried it',
      method: 'POST',
      url: 'http://x/b',
      status: 400,
      durationMs: 1,
      requestHeaders: {},
    };
    const md = renderMarkdown({
      ...PASSING,
      journeys: [
        J2_PASS,
        {
          ...J2_PASS,
          id: 'J3',
          status: 'failed',
          steps: [{ label: 'Tried it', status: 'failed', durationMs: 1, http: [erroring] }],
        },
      ],
      http: [
        { step: null, method: 'POST', url: 'http://x/a', status: 200, durationMs: 1, requestHeaders: {} },
        erroring,
      ],
    });

    expect(md).toContain('| Scenarios | Passed | Failed | Skipped | Checks | Requests | Failed requests |');
    expect(md).toContain('| 2 | 1 | 1 | 0 | 1 | 2 | 1 |');
  });

  test('does not count an error a passing step asked for', () => {
    // The page and this table have to agree, or one run gets described two
    // ways. J9's 403 is the journey working.
    const refusal = {
      step: 'J9 — Refused it',
      method: 'POST',
      url: 'http://x/refused',
      status: 403,
      durationMs: 1,
      requestHeaders: {},
    };
    const md = renderMarkdown({
      ...PASSING,
      journeys: [
        {
          ...J2_PASS,
          steps: [{ label: 'Refused it', status: 'passed', durationMs: 1, http: [refusal] }],
        },
      ],
      http: [refusal],
    });

    expect(md).toContain('| 1 | 1 | 0 | 0 | 1 | 1 | 0 |');
  });

  test('names the duration and when the run happened', () => {
    const md = renderMarkdown(PASSING);

    expect(md).toContain('428.2s');
    expect(md).toContain('2026-09-11 08:58 UTC');
  });

  test('lists every scenario with its status', () => {
    const md = renderMarkdown(PASSING);

    expect(md).toContain('A new profile becomes findable in search');
    expect(md).toContain('search-and-discovery');
  });

  test('shows the failing step and the response behind it', () => {
    // The summary is the first thing a reader sees; making them download
    // an artifact to learn what the 400 said wastes the trip.
    const md = renderMarkdown({
      ...PASSING,
      journeys: [
        {
          ...J2_PASS,
          status: 'failed',
          steps: [
            { label: 'Created a seeker profile', status: 'passed', durationMs: 1973, http: [] },
            {
              label: 'Found the profile in search',
              status: 'failed',
              durationMs: 34,
              error: 'STEP_FAILED: search 400',
              http: [
                {
                  step: 'J2 — Found the profile in search',
                  method: 'POST',
                  url: 'http://127.0.0.1:54322/v1/search',
                  status: 400,
                  durationMs: 38,
                  requestHeaders: {},
                  responseBody: '{"error":"BAD_REQUEST"}',
                },
              ],
            },
          ],
        },
      ],
    });

    expect(md).toContain('FAILED');
    expect(md).toContain('Found the profile in search');
    expect(md).toContain('STEP_FAILED: search 400');
    expect(md).toContain('BAD_REQUEST');
    expect(md).toContain('POST http://127.0.0.1:54322/v1/search');
  });

  test('escapes a pipe, which would otherwise split a table cell', () => {
    const md = renderMarkdown({
      ...PASSING,
      journeys: [{ ...J2_PASS, title: 'A | B becomes findable' }],
    });

    expect(md).toContain('A \\| B becomes findable');
  });

  test('says nothing about failures when there are none', () => {
    expect(renderMarkdown(PASSING)).not.toContain('Failure detail');
  });

  test('says whether a failure blocks the release or blocks the run', () => {
    // FAILED alone makes the reader guess. A product failure stops the RC;
    // a harness failure means nothing was verified and the run has to be
    // repaired and repeated.
    const md = renderMarkdown({
      ...PASSING,
      suites: [
        {
          name: 's',
          durationMs: 1,
          cases: [
            {
              name: 'journeys > J2 — A new profile becomes findable in search',
              ok: false,
              durationMs: 1,
              failure: 'STACK_UNHEALTHY: container signals-mailpit is unhealthy',
            },
          ],
        },
      ],
      journeys: [{ ...J2_PASS, status: 'failed' }],
    });

    expect(md).toMatch(/harness/i);
    expect(md).toMatch(/nothing was verified/i);
  });
});
