import type { Summary } from './summary.js';

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * JUnit XML, derived from the summary purely to feed GitHub's check UI.
 *
 * summary.json stays canonical: JUnit cannot carry a capability, a skip
 * reason, or which digests were verified, so producing the two
 * independently would let them disagree.
 */
export function renderJUnit(summary: Summary): string {
  const failures = summary.journeys.filter((j) => !j.ok).length;
  const cases = summary.journeys
    .map((j) => {
      const name = escape(`${j.id} ${j.title}`);
      if (j.ok) return `    <testcase classname="${escape(summary.target)}" name="${name}" />`;
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
    `  <testsuite name="${escape(summary.releaseTag)}" tests="${summary.journeys.length}" failures="${failures}">\n` +
    `${cases}\n` +
    `  </testsuite>\n` +
    `</testsuites>\n`
  );
}
