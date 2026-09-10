/**
 * Turn the run's JUnit XML into something a person reads.
 *
 * JUnit exists for the check UI and is close to unreadable by hand. This
 * writes reports/report.html for the artifact, and prints a plain-text
 * version to the job log and the Actions run summary so the result is
 * visible without downloading anything.
 */
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { renderHtml } from '../src/report/html.js';
import { parseJUnit } from '../src/report/parse_junit.js';

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

const report = {
  releaseTag: provenance.release_tag ?? process.env.JOURNEY_RELEASE_TAG ?? '(local run)',
  target: provenance.target ?? process.env.JOURNEY_TARGET ?? '(unspecified)',
  provenance,
  suites,
};

await writeFile(`${REPORTS}/report.html`, renderHtml(report));

// Plain text for the job log, and the same content as the run summary so
// the result is legible without downloading the artifact.
const all = suites.flatMap((s) => s.cases);
const failed = all.filter((c) => !c.ok);
const lines = [
  `${failed.length === 0 ? 'PASSED' : 'FAILED'} — ${report.releaseTag} · ${report.target}`,
  `${all.length - failed.length} of ${all.length} checks passed`,
  '',
];
for (const suite of suites) {
  lines.push(`${suite.name}`);
  for (const c of suite.cases) {
    lines.push(`  ${c.ok ? '✓' : '✗'} ${c.name} (${(c.durationMs / 1000).toFixed(1)}s)`);
    if (c.failure) lines.push(`      ${c.failure.split('\n')[0]}`);
  }
  lines.push('');
}
const text = lines.join('\n');
console.log(text);

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `## Journey verification\n\n\`\`\`\n${text}\`\`\`\n\n_Full report: \`report.html\` in the run artifact._\n`,
  );
}
