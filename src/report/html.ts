export type CaseReport = {
  name: string;
  ok: boolean;
  durationMs: number;
  failure?: string;
};

export type SuiteReport = {
  name: string;
  durationMs: number;
  cases: CaseReport[];
};

export type RunReport = {
  releaseTag: string;
  target: string;
  provenance: Record<string, string>;
  suites: SuiteReport[];
};

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * A page someone can open from an artifact and read.
 *
 * JUnit XML exists for the check UI and is close to unreadable by a person;
 * this is the same run for the human who has to decide whether to ship.
 * Self-contained on purpose -- an artifact is opened from a local download
 * with no network, so a stylesheet link would render it unstyled.
 */
export function renderHtml(report: RunReport): string {
  const cases = report.suites.flatMap((s) => s.cases);
  const failed = cases.filter((c) => !c.ok);
  const ok = failed.length === 0;

  const suites = report.suites
    .map((suite) => {
      const rows = suite.cases
        .map(
          (c) => `
        <tr class="${c.ok ? 'pass' : 'fail'}">
          <td class="mark">${c.ok ? '✓' : '✗'}</td>
          <td>${escape(c.name)}${
            c.failure ? `<div class="err">${escape(c.failure)}</div>` : ''
          }</td>
          <td class="dur">${seconds(c.durationMs)}</td>
        </tr>`,
        )
        .join('');
      return `
      <section>
        <h2>${escape(suite.name)} <span class="dur">${seconds(suite.durationMs)}</span></h2>
        <table>${rows}</table>
      </section>`;
    })
    .join('');

  const provenance = Object.entries(report.provenance)
    .map(([k, v]) => `<tr><td>${escape(k)}</td><td><code>${escape(v)}</code></td></tr>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Journey verification — ${escape(report.releaseTag)}</title>
<style>
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         margin: 0; padding: 2rem; color: #1a1a1a; background: #fafafa; }
  .verdict { font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; }
  .verdict.ok { color: #137333; } .verdict.bad { color: #a50e0e; }
  .meta { color: #5f6368; margin: 0.25rem 0 1.5rem; }
  section { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px;
            padding: 1rem 1.25rem; margin-bottom: 1rem; }
  h2 { font-size: 1rem; margin: 0 0 0.5rem; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.35rem 0.5rem; border-top: 1px solid #f0f0f0; vertical-align: top; }
  .mark { width: 1.5rem; font-weight: 700; }
  .pass .mark { color: #137333; } .fail .mark { color: #a50e0e; }
  .fail td { background: #fdf0ef; }
  .dur { color: #5f6368; font-variant-numeric: tabular-nums; text-align: right;
         white-space: nowrap; font-weight: 400; }
  .err { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
         font-size: 13px; color: #a50e0e; margin-top: 0.35rem; white-space: pre-wrap; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
</style>
<div class="verdict ${ok ? 'ok' : 'bad'}">${ok ? 'PASSED' : 'FAILED'}</div>
<div class="meta">
  Release <strong>${escape(report.releaseTag)}</strong> ·
  target <strong>${escape(report.target)}</strong> ·
  ${cases.length - failed.length} of ${cases.length} checks passed
</div>
${suites}
<section>
  <h2>What was verified</h2>
  <table>${provenance}</table>
</section>
</html>
`;
}
