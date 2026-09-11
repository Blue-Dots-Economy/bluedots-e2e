import { escapeHtml as escape } from './format.js';
import type { Summary } from './summary.js';


/**
 * JUnit XML, derived from the summary purely to feed GitHub's check UI.
 *
 * summary.json stays canonical: JUnit cannot carry a capability, a skip
 * reason, or which digests were verified, so producing the two
 * independently would let them disagree.
 */
export function renderJUnit(summary: Summary): string {
  const failures = summary.journeys.filter((j) => j.status === 'failed').length;
  const skipped = summary.journeys.filter((j) => j.status === 'not-covered').length;
  const cases = summary.journeys
    .map((j) => {
      const name = escape(`${j.id} ${j.title}`);
      if (j.status === 'not-covered') {
        // <skipped/>, never a pass: a journey nobody ran is missing
        // coverage, and the checks UI has a state for exactly that.
        return (
          `    <testcase classname="${escape(summary.target)}" name="${name}">\n` +
          `      <skipped/>\n    </testcase>`
        );
      }
      if (j.status === 'passed') {
        return `    <testcase classname="${escape(summary.target)}" name="${name}" />`;
      }
      const failed = j.trace.find((t) => !t.ok);
      const message = escape(
        failed ? `${failed.label}${failed.error ? `: ${failed.error}` : ''}` : 'failed',
      );
      return (
        `    <testcase classname="${escape(summary.target)}" name="${name}">\n` +
        `      <failure message="${message}" />\n` +
        `    </testcase>`
      );
    })
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites>\n` +
    `  <testsuite name="${escape(summary.releaseTag)}" tests="${summary.journeys.length}" failures="${failures}" skipped="${skipped}">\n` +
    `${cases}\n` +
    `  </testsuite>\n` +
    `</testsuites>\n`
  );
}
