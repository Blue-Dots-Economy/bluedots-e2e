import type { CaseReport, HttpEntryView } from './render_html.js';

export type StepView = {
  label: string;
  /** `not-reached` is a step the run never got to, not one that passed. */
  status: 'passed' | 'failed' | 'not-reached';
  durationMs: number;
  error?: string;
  http: HttpEntryView[];
};

export type JourneyView = {
  id: string;
  title: string;
  capability: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  steps: StepView[];
};

type JourneyInput = {
  id: string;
  title: string;
  capability: string;
  ok: boolean;
  trace: { label: string; ok: boolean; durationMs: number; error?: string }[];
  /**
   * Every step the journey declares, in order. The trace stops at the first
   * failure, so without this the report cannot distinguish a step that
   * passed from one the run never reached.
   */
  stepLabels?: string[];
};

/**
 * Turn the run's three flat records into the tree the report renders.
 *
 * The pieces arrive separately -- journeys and their traces from the
 * runner, durations and skips from JUnit, HTTP calls from the recorder --
 * and each is keyed differently. Joining them here, in one tested place,
 * keeps that reconciliation out of the renderer and out of the script.
 */
export function buildJourneyViews(input: {
  journeys: JourneyInput[];
  cases: CaseReport[];
  http: HttpEntryView[];
}): { journeys: JourneyView[]; orphanHttp: HttpEntryView[] } {
  const claimed = new Set<HttpEntryView>();

  const journeys = input.journeys.map((journey) => {
    const traced = new Map(journey.trace.map((t) => [t.label, t]));
    const labels = journey.stepLabels ?? journey.trace.map((t) => t.label);

    const steps: StepView[] = labels.map((label) => {
      const outcome = traced.get(label);
      // The recorder prefixes the journey id so one run's requests stay
      // distinguishable when two journeys share a step label.
      const http = input.http.filter(
        (h) => h.step === `${journey.id} — ${label}` || h.step === label,
      );
      for (const h of http) claimed.add(h);

      return {
        label,
        status: outcome ? (outcome.ok ? 'passed' : 'failed') : 'not-reached',
        durationMs: outcome?.durationMs ?? 0,
        ...(outcome?.error ? { error: outcome.error } : {}),
        http,
      };
    });

    const own = input.cases.filter((c) => c.name.includes(journey.id));
    const status: JourneyView['status'] =
      own.length > 0 && own.every((c) => c.skipped)
        ? 'skipped'
        : journey.ok
          ? 'passed'
          : 'failed';

    // The case measures the whole test, including the awaiting and teardown
    // no individual step accounts for; the step sum is the fallback.
    const durationMs =
      own.length > 0
        ? own.reduce((sum, c) => sum + c.durationMs, 0)
        : steps.reduce((sum, s) => sum + s.durationMs, 0);

    return { id: journey.id, title: journey.title, capability: journey.capability, status, durationMs, steps };
  });

  return { journeys, orphanHttp: input.http.filter((h) => !claimed.has(h)) };
}
