import { describe, expect, test } from 'vitest';
import { buildJourneyViews } from './journey_views.js';
import type { HttpEntryView } from './render_html.js';

const req = (step: string | null, url: string, status = 200): HttpEntryView => ({
  step, method: 'POST', url, status, durationMs: 10, requestHeaders: {},
});

const j2 = {
  id: 'J2',
  title: 'A new profile becomes findable in search',
  capability: 'search-and-discovery',
  ok: false,
  stepLabels: ['Created a seeker profile', 'Waited for indexing', 'Found the profile in search'],
  trace: [
    { label: 'Created a seeker profile', ok: true, durationMs: 300 },
    { label: 'Waited for indexing', ok: false, durationMs: 9000, error: 'STEP_FAILED: timed out' },
  ],
};

describe('buildJourneyViews', () => {
  test('files each request under the step that made it', () => {
    const { journeys } = buildJourneyViews({
      journeys: [j2],
      cases: [],
      http: [
        req('J2 — Created a seeker profile', 'http://signals/api/v1/admin/participant'),
        req('J2 — Waited for indexing', 'http://search/v1/search', 400),
      ],
    });

    expect(journeys[0]?.steps[0]?.http.map((h) => h.url)).toEqual([
      'http://signals/api/v1/admin/participant',
    ]);
    expect(journeys[0]?.steps[1]?.http.map((h) => h.url)).toEqual(['http://search/v1/search']);
  });

  test('shows the steps a failure stopped the run from reaching', () => {
    // A trace ends at the first failure. Dropping the rest would hide that
    // the journey never got as far as asserting anything.
    const { journeys } = buildJourneyViews({ journeys: [j2], cases: [], http: [] });

    expect(journeys[0]?.steps.map((s) => s.status)).toEqual(['passed', 'failed', 'not-reached']);
  });

  test('keeps a request that matches no step rather than dropping it', () => {
    // Silently discarding evidence is worse than showing it unattributed.
    const { orphanHttp } = buildJourneyViews({
      journeys: [j2],
      cases: [],
      http: [req(null, 'http://keycloak/token')],
    });

    expect(orphanHttp.map((h) => h.url)).toEqual(['http://keycloak/token']);
  });

  test('reports a journey the runner skipped as skipped, not as passed', () => {
    const { journeys } = buildJourneyViews({
      journeys: [{ id: 'J3', title: 'Not run here', capability: 'notifications', ok: false, trace: [] }],
      cases: [{ name: 'J3 — Not run here', ok: true, durationMs: 0, skipped: true }],
      http: [],
    });

    expect(journeys[0]?.status).toBe('skipped');
  });

  test('takes a journey duration from its test case, not from its steps', () => {
    // Step timings exclude the awaiting and teardown the case measures.
    const { journeys } = buildJourneyViews({
      journeys: [j2],
      cases: [{ name: 'journeys > J2 — A new profile becomes findable in search', ok: false, durationMs: 12500 }],
      http: [],
    });

    expect(journeys[0]?.durationMs).toBe(12500);
  });

  test('falls back to the sum of its steps when no case matches', () => {
    const { journeys } = buildJourneyViews({ journeys: [j2], cases: [], http: [] });

    expect(journeys[0]?.durationMs).toBe(9300);
  });
});
