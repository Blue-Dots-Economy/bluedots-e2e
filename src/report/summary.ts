import { CAPABILITIES, type Capability } from '../journey/guards.js';
import type { StepOutcome } from '../journey/define_journey.js';

export type JourneyStatus = 'passed' | 'failed' | 'not-covered';

export type JourneyRun = {
  id: string;
  title: string;
  capability: string;
  /**
   * Three states, not two. A journey the environment cannot verify is NOT
   * COVERED there -- reading that as a failure is the inverse of what
   * capabilities.ts promises, and would declare a whole release failed on
   * the http-only external provider.
   */
  status: JourneyStatus;
  trace: StepOutcome[];
};

/**
 * Everything the run asserted that is not a journey: the negative control,
 * the stack preconditions, the registry-coverage check.
 *
 * Carried here because summary.ok was read from the journey registry alone,
 * so a run where the negative control FAILED -- meaning the awaiter can no
 * longer detect a dead ingest spine, and J2's green is worthless -- still
 * published PASSED in summary.json, trace.txt, the evidence sheet and the
 * derived JUnit.
 */
export type HarnessCheck = { name: string; ok: boolean };

export type RunInput = {
  releaseTag: string;
  target: string;
  startedAt: string;
  digests: Record<string, string>;
  realmMutations: string[];
  journeys: JourneyRun[];
  harness?: HarnessCheck[];
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
  const ran = run.journeys.filter((j) => j.status !== 'not-covered');
  return {
    ...run,
    // every() on an empty list is true, so a run that resolved no journeys
    // at all used to report PASSED.
    ok:
      ran.length > 0 &&
      ran.every((j) => j.status === 'passed') &&
      (run.harness ?? []).every((h) => h.ok),
  };
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
    const mark =
      journey.status === 'passed' ? 'PASS' : journey.status === 'failed' ? 'FAIL' : 'SKIP';
    lines.push(`${mark}  ${journey.id}  ${journey.title}`);
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
    const ran = journeys.filter((j) => j.status !== 'not-covered');
    // A capability whose only journeys were skipped is NOT COVERED by this
    // run, not passed and not failed.
    const verdict =
      ran.length === 0
        ? 'NOT RUN'
        : ran.every((j) => j.status === 'passed')
          ? 'PASSED'
          : 'FAILED';
    lines.push(
      `${CAPABILITY_LABELS[capability].padEnd(36)}${verdict.padEnd(10)}` +
        `${passedChecks} of ${checks.length}`,
    );
    for (const j of journeys.filter((x) => x.status === 'failed')) {
      const failed = j.trace.find((t) => !t.ok);
      if (failed) lines.push(`  └ ${failed.label}${failed.error ? ` — ${failed.error}` : ''}`);
    }
  }

  const uncovered = CAPABILITIES.filter((c) => !covered.has(c));
  if (uncovered.length > 0) {
    lines.push('', 'NOT COVERED BY THIS RUN');
    for (const c of uncovered) lines.push(`· ${CAPABILITY_LABELS[c]} — no automated journey yet`);
  }

  // A sheet that lists only what passed invites the reader to assume
  // everything was checked. NOT COVERED above names capabilities with no
  // journey; this names the limits of the journeys that DID run, so a green
  // sheet cannot be over-read into a guarantee nobody made.
  const runTargets = [...new Set(summaries.map((s) => s.target))];
  const skipped = summaries.flatMap((s) =>
    s.journeys.filter((j) => j.status === 'not-covered').map((j) => `${j.id} ${j.title}`),
  );
  lines.push(
    '',
    'WHAT A PASS HERE STILL DOES NOT PROVE',
    `· Targets not run. This covers ${runTargets.join(', ')}. Another target serves`,
    '  different domains from a different schema, and its result is unknown.',
    '· Anything outside a journey step. A journey asserts the steps it names',
    '  and nothing else — no ranking, no pagination, no UI.',
    '· That the services agree on their contracts. The generated clients are',
    '  checked against the committed specs, not against a live provider.',
  );
  for (const s of skipped) lines.push(`· ${s} — declared but not run here.`);

  return lines.join('\n') + '\n';
}
