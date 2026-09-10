import { CAPABILITIES, type Capability } from '../journey/guards.js';
import type { StepOutcome } from '../journey/journey.js';

export type JourneyRun = {
  id: string;
  title: string;
  capability: string;
  ok: boolean;
  trace: StepOutcome[];
};

export type RunInput = {
  releaseTag: string;
  target: string;
  startedAt: string;
  digests: Record<string, string>;
  realmMutations: string[];
  journeys: JourneyRun[];
};

/** The canonical record. Both renderers read this and nothing else. */
export type Summary = RunInput & { ok: boolean };

/** Business-language names for the closed capability set. */
const CAPABILITY_LABELS: Record<Capability, string> = {
  'participant-onboarding': 'Participant onboarding',
  'search-and-discovery': 'Search and discovery',
  notifications: 'Notifications',
  'consent-and-data-disclosure': 'Consent and data disclosure',
  'voice-assistant': 'Voice assistant',
};

export function buildSummary(run: RunInput): Summary {
  return { ...run, ok: run.journeys.every((j) => j.ok) };
}

/**
 * Tier 2 — for whoever has to fix it.
 *
 * Step labels are printed verbatim. Translating them here is exactly how a
 * report drifts from what the tests assert.
 */
export function renderTier2(summary: Summary): string {
  const lines = [
    `Release ${summary.releaseTag} — target ${summary.target}`,
    `Verified ${summary.startedAt}`,
    '',
  ];

  for (const journey of summary.journeys) {
    lines.push(`${journey.ok ? 'PASS' : 'FAIL'}  ${journey.id}  ${journey.title}`);
    for (const s of journey.trace) {
      lines.push(`  ${s.ok ? '✓' : '✗'} ${s.label}${s.error ? ` — ${s.error}` : ''}`);
    }
    lines.push('');
  }

  lines.push('Images verified');
  for (const [service, digest] of Object.entries(summary.digests).sort()) {
    lines.push(`  ${service.padEnd(22)} ${digest}`);
  }
  if (summary.realmMutations.length > 0) {
    // A mutated realm is not quite the realm the services deploy against.
    lines.push('', 'Realm changes made by the harness');
    for (const m of summary.realmMutations) lines.push(`  ${m}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Tier 3 — for whoever decides whether to ship.
 *
 * Rendered across every run carrying one release tag, because a run tests
 * one target while "did this RC pass?" spans all of them. It names the
 * targets it covers, and lists capabilities with no run under NOT COVERED:
 * a sheet listing only passes invites the reader to assume everything was
 * checked, and one covering a single target must not read like one covering
 * four.
 */
export function renderEvidenceSheet(summaries: Summary[]): string {
  const tag = summaries[0]?.releaseTag ?? '(unknown)';
  const targets = [...new Set(summaries.map((s) => s.target))];

  const lines = [
    `Release ${tag} — functional verification`,
    `Targets: ${targets.join(', ')}`,
    '',
    'CAPABILITY                          RESULT    CHECKS',
  ];

  const covered = new Set<string>();
  for (const capability of CAPABILITIES) {
    const journeys = summaries.flatMap((s) =>
      s.journeys.filter((j) => j.capability === capability),
    );
    if (journeys.length === 0) continue;
    covered.add(capability);

    const checks = journeys.flatMap((j) => j.trace);
    const passedChecks = checks.filter((c) => c.ok).length;
    const ok = journeys.every((j) => j.ok);
    lines.push(
      `${CAPABILITY_LABELS[capability].padEnd(36)}${(ok ? 'PASSED' : 'FAILED').padEnd(10)}` +
        `${passedChecks} of ${checks.length}`,
    );
    for (const j of journeys.filter((x) => !x.ok)) {
      const failed = j.trace.find((t) => !t.ok);
      if (failed) lines.push(`  └ ${failed.label}${failed.error ? ` — ${failed.error}` : ''}`);
    }
  }

  const uncovered = CAPABILITIES.filter((c) => !covered.has(c));
  if (uncovered.length > 0) {
    lines.push('', 'NOT COVERED BY THIS RUN');
    for (const c of uncovered) lines.push(`· ${CAPABILITY_LABELS[c]} — no automated journey yet`);
  }

  return lines.join('\n') + '\n';
}
