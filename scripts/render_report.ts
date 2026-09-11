/**
 * Turn the run's JUnit XML into something a person reads.
 *
 * JUnit exists for the check UI and is close to unreadable by hand. This
 * writes reports/report.html for the artifact, and prints a plain-text
 * version to the job log and the Actions run summary so the result is
 * visible without downloading anything.
 */
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { renderHtml, type HttpEntryView } from '../src/report/render_html.js';
import { buildJourneyViews, caseNameOf } from '../src/report/journey_views.js';
import type { StepOutcome } from '../src/journey/define_journey.js';
import { renderNewman } from '../src/report/render_console.js';
import { parseJUnit } from '../src/report/parse_junit.js';
import { buildSummary, renderEvidenceSheet, renderTier2 } from '../src/report/summary.js';
import { renderJUnit } from '../src/report/render_junit.js';
import { ALL_JOURNEYS } from '../journeys/index.js';

const REPORTS = 'reports';

async function read(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

const xml = await read(`${REPORTS}/junit.xml`);
if (!xml) {
  console.log('No junit.xml — the suite produced no results to render.');
  process.exit(0);
}

// (?:^|\s) matters: a bare /name="/ also matches the tail of
// classname="...", so every case would take the file name instead of the
// test name.
const suites = parseJUnit(xml);

const provenanceRaw = (await read(`${REPORTS}/provenance.txt`)) ?? '';
const provenance = Object.fromEntries(
  provenanceRaw.split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

// Recorded by the suite (tests/stack/journeys.stack.test.ts). Absent when
// the suite never got as far as making a request, which is itself fine --
// the report then simply has no request section.
// Written by the suite: the real step traces. Without it the report falls
// back to one line per journey, which is what JUnit can express.
const runsRaw = await read(`${REPORTS}/journeys.json`);
const runs = runsRaw
  ? (JSON.parse(runsRaw) as { id: string; ok: boolean; trace: StepOutcome[] }[])
  : [];

const httpRaw = await read(`${REPORTS}/http.json`);
const http = httpRaw ? (JSON.parse(httpRaw) as HttpEntryView[]) : undefined;

const report = {
  releaseTag: provenance.release_tag ?? process.env.JOURNEY_RELEASE_TAG ?? '(local run)',
  target: provenance.target ?? process.env.JOURNEY_TARGET ?? '(unspecified)',
  provenance,
  suites,
  ...(http ? { http } : {}),
};

// summary.json is the canonical record the tiered renderers read. Without
// this the evidence sheet and the derived JUnit were unreachable from a
// real run -- tested code that nothing called.
const cases = suites.flatMap((s) => s.cases);
const summary = buildSummary({
  releaseTag: report.releaseTag,
  target: report.target,
  startedAt: new Date().toISOString(),
  digests: Object.fromEntries(
    Object.entries(provenance).filter(([k]) => k.endsWith('_sha')),
  ),
  realmMutations: (provenance.realm_mutations ?? '').split(';').filter(Boolean),
  // Capability comes from the journey registry: JUnit cannot carry one,
  // which is why summary.json rather than JUnit is canonical.
  journeys: ALL_JOURNEYS.map((journey) => {
    const own = cases.filter((c) => c.name.includes(caseNameOf(journey)));
    const run = runs.find((r) => r.id === journey.id);
    return {
      id: journey.id,
      title: journey.title,
      capability: journey.capability,
      ok: run ? run.ok : own.length > 0 && own.every((c) => c.ok),
      // Prefer the recorded steps; fall back to the JUnit case, which is
      // all a report rendered outside a run can see.
      trace:
        run?.trace ??
        own.map((c) => ({
          label: c.name,
          ok: c.ok,
          durationMs: c.durationMs,
          ...(c.failure ? { error: c.failure } : {}),
        })),
    };
  }),
});

// Rendered after the summary because the page is a tree of journeys and
// only the registry knows what they are -- JUnit case names do not.
const { journeys: journeyViews, orphanHttp } = buildJourneyViews({
  journeys: summary.journeys.map((j) => ({
    ...j,
    // The declared step list, so the page can show the steps a failure
    // stopped the run from reaching.
    stepLabels: ALL_JOURNEYS.find((registered) => registered.id === j.id)?.steps.map((s) => s.label),
  })),
  cases,
  http: http ?? [],
});

await writeFile(
  `${REPORTS}/report.html`,
  renderHtml({
    ...report,
    journeys: journeyViews,
    orphanHttp,
    startedAt: `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  }),
);

await writeFile(`${REPORTS}/summary.json`, JSON.stringify(summary, null, 2));
await writeFile(`${REPORTS}/trace.txt`, renderTier2(summary));
await writeFile(`${REPORTS}/evidence-sheet.txt`, renderEvidenceSheet([summary]));
await writeFile(`${REPORTS}/junit-derived.xml`, renderJUnit(summary));

// Newman-style for the job log and the run summary: hierarchy in the
// indentation rather than repeated describe chains, then totals and the
// failure detail at the end.
const text = renderNewman(report);
console.log(text);

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `## Journey verification\n\n\`\`\`\n${text}\`\`\`\n\n_Full report: \`report.html\` in the run artifact._\n`,
  );
}
