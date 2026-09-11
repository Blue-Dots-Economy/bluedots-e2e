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

export type HttpEntryView = {
  step: string | null;
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  error?: string;
};

export type RunReport = {
  releaseTag: string;
  target: string;
  provenance: Record<string, string>;
  suites: SuiteReport[];
  /** Recorded calls, so a failure can show the request and the response. */
  http?: HttpEntryView[];
  /**
   * Journey counts, from the registry rather than inferred from case names:
   * the runner knows which journeys ran, which passed and which were
   * skipped, and JUnit case names cannot be made to say so reliably.
   */
  scenarios?: { total: number; passed: number; failed: number };
};

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Requests are mostly sub-second, where "0.0s" says nothing. */
const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : seconds(ms));

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

  const http = report.http ?? [];
  const failedHttp = http.filter((h) => h.error || (h.status !== null && h.status >= 400));

  const card = (value: string | number, label: string, bad = false) => `
    <div class="card${bad && Number(value) > 0 ? ' bad' : ''}">
      <div class="value">${escape(String(value))}</div>
      <div class="label">${escape(label)}</div>
    </div>`;

  // Falls back to the check counts when the runner did not supply journey
  // counts, so a report rendered from JUnit alone still leads with numbers.
  const scenarios = report.scenarios ?? {
    total: cases.length,
    passed: cases.length - failed.length,
    failed: failed.length,
  };

  const overview = `
  <div class="cards">
    ${card(scenarios.total, report.scenarios ? 'scenarios' : 'checks')}
    ${card(scenarios.passed, 'passed')}
    ${card(scenarios.failed, 'failed', true)}
    ${card(http.length, 'requests')}
    ${card(failedHttp.length, 'failed requests', true)}
  </div>`;

  // Only failures: a passing call is noise here, and the run already says
  // it passed.
  const httpDetail = failedHttp.length
    ? `
  <section id="failed-requests">
    <h2>Failed requests</h2>
    ${failedHttp
      .map(
        (h) => `
      <div class="req">
        <div class="reqline">
          <span class="method">${escape(h.method)}</span>
          <span class="url">${escape(h.url)}</span>
          <span class="status">${h.error ? 'network error' : String(h.status)}</span>
          <span class="dur">${duration(h.durationMs)}</span>
        </div>
        ${h.step ? `<div class="instep">in step: ${escape(h.step)}</div>` : ''}
        ${h.requestBody ? `<div class="blk"><b>request</b><pre>${escape(h.requestBody)}</pre></div>` : ''}
        ${h.responseBody ? `<div class="blk"><b>response</b><pre>${escape(h.responseBody)}</pre></div>` : ''}
        ${h.error ? `<div class="blk"><b>error</b><pre>${escape(h.error)}</pre></div>` : ''}
      </div>`,
      )
      .join('')}
  </section>`
    : '';

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
  .cards { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
  .card { background: #137333; color: #fff; border-radius: 8px; padding: 0.9rem 1.4rem;
          min-width: 6.5rem; text-align: center; }
  .card.bad { background: #a50e0e; }
  .card .value { font-size: 1.9rem; font-weight: 700; line-height: 1.1; }
  .card .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em;
                 opacity: 0.9; }
  .req { border: 1px solid #f0c9c7; border-radius: 6px; margin-bottom: 0.75rem;
         overflow: hidden; }
  .reqline { display: flex; gap: 0.6rem; align-items: baseline; background: #fdf0ef;
             padding: 0.5rem 0.75rem; font-family: ui-monospace, Menlo, monospace;
             font-size: 13px; }
  .method { font-weight: 700; } .url { flex: 1; word-break: break-all; }
  .status { color: #a50e0e; font-weight: 700; }
  .instep { padding: 0.4rem 0.75rem; color: #5f6368; font-size: 13px; }
  .blk { padding: 0 0.75rem 0.6rem; } .blk b { font-size: 12px; color: #5f6368; }
  pre { margin: 0.25rem 0 0; padding: 0.6rem; background: #f6f8fa; border-radius: 4px;
        font-size: 12px; overflow-x: auto; white-space: pre-wrap; }
</style>
<div class="verdict ${ok ? 'ok' : 'bad'}">${ok ? 'PASSED' : 'FAILED'}</div>
<div class="meta">
  Release <strong>${escape(report.releaseTag)}</strong> ·
  target <strong>${escape(report.target)}</strong> ·
  ${cases.length - failed.length} of ${cases.length} checks passed
</div>
${overview}
${suites}
${httpDetail}
<section>
  <h2>What was verified</h2>
  <table>${provenance}</table>
</section>
</html>
`;
}
