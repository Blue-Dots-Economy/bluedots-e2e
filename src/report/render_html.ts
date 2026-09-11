import { SECRET_HEADERS } from './http_recorder.js';
import type { JourneyView, StepView } from './journey_views.js';

export type CaseReport = {
  name: string;
  ok: boolean;
  durationMs: number;
  /** The runner declined to run it -- neither a pass nor a failure. */
  skipped?: boolean;
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
  http?: HttpEntryView[];
  /**
   * The scenario tree, joined by buildJourneyViews. Absent when the report
   * is rendered from JUnit alone, in which case each suite becomes a block
   * so the page still has a tree rather than a flat table.
   */
  journeys?: JourneyView[];
  /** Recorded calls that matched no step. Shown rather than dropped. */
  orphanHttp?: HttpEntryView[];
  /** Rendered verbatim, so the page stays deterministic to test. */
  startedAt?: string;
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

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The recorder marks what it cut; the page repeats that rather than lying by omission. */
const TRUNCATED = /\n… truncated, (\d+) more characters$/;

/**
 * Readable when it is JSON, verbatim when it is not.
 *
 * An API error body is the thing the reader came for, and one long line of
 * minified JSON is close to unreadable.
 */
function body(raw: string): string {
  const cut = TRUNCATED.exec(raw);
  const text = cut ? raw.slice(0, cut.index) : raw;
  let shown = text;
  try {
    shown = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Not JSON. HTML error pages and plain text are shown as they arrived.
  }
  return (
    `<pre>${escape(shown)}</pre>` +
    (cut ? `<div class="trunc-note">truncated, ${escape(cut[1] ?? '')} more characters</div>` : '')
  );
}

function headerTable(headers: Record<string, string>): string {
  const rows = Object.entries(headers)
    .map(([k, v]) => {
      // Redacted a second time on the way out. The recorder already does
      // it, but this page is downloadable by anyone who can see the run.
      const shown = SECRET_HEADERS.includes(k.toLowerCase()) ? 'REDACTED' : v;
      return `<tr><td>${escape(k)}</td><td>${escape(shown)}</td></tr>`;
    })
    .join('');
  return `<table class="hdr-table"><tbody>${rows}</tbody></table>`;
}

function statusClass(h: HttpEntryView): string {
  if (h.error || h.status === null) return 'neterr';
  return `s${Math.floor(h.status / 100)}`;
}

function renderHttp(h: HttpEntryView): string {
  const failed = Boolean(h.error) || (h.status !== null && h.status >= 400);
  const detail = [
    Object.keys(h.requestHeaders).length
      ? `<div><div class="blk-label">Request headers</div>${headerTable(h.requestHeaders)}</div>`
      : '',
    h.requestBody ? `<div><div class="blk-label">Request body</div>${body(h.requestBody)}</div>` : '',
    h.responseBody
      ? `<div><div class="blk-label">Response body</div>${body(h.responseBody)}</div>`
      : '',
    h.error ? `<div><div class="blk-label">Error</div><pre>${escape(h.error)}</pre></div>` : '',
  ].join('');

  return `
              <div class="http">
                <div class="http-head${failed ? ' err' : ''}">
                  <span class="method ${escape(h.method.toLowerCase())}">${escape(h.method)}</span>
                  <span class="http-url" title="${escape(h.url)}">${escape(h.url)}</span>
                  <span class="http-status ${statusClass(h)}">${h.error || h.status === null ? 'ERR' : String(h.status)}</span>
                  <span class="http-dur">${duration(h.durationMs)}</span>
                </div>
                ${detail ? `<div class="http-detail">${detail}</div>` : ''}
              </div>`;
}

const STEP_MARK = {
  passed: ['ok', '✓'],
  failed: ['bad', '✕'],
  'not-reached': ['skip', '–'],
} as const;

function renderStep(step: StepView): string {
  const [cls, glyph] = STEP_MARK[step.status];
  // The failing step opens with the journey: it is the one a reader wants.
  const open = step.status === 'failed' ? ' open' : '';
  const count = step.http.length ? plural(step.http.length, 'request') : 'no request';

  const inner =
    (step.error ? `<div class="s-error">${escape(step.error)}</div>` : '') +
    (step.http.length
      ? step.http.map(renderHttp).join('')
      : `<div class="s-empty">${
          step.status === 'not-reached'
            ? 'The run stopped before reaching this step.'
            : 'This step made no HTTP call.'
        }</div>`);

  return `
          <details class="step${step.status === 'failed' ? ' fail' : ''}"${open}>
            <summary class="s-summary">
              <span class="s-mark ${cls}">${glyph}</span>
              <span class="s-label">${escape(step.label)}</span>
              <span class="s-req-count">${count}</span>
              <span class="s-dur">${duration(step.durationMs)}</span>
            </summary>
            <div class="s-body">${inner}</div>
          </details>`;
}

const CHEVRON =
  '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="9 18 15 12 9 6"></polyline></svg>';

const JOURNEY_MARK = {
  passed: ['ok', '✓'],
  failed: ['bad', '✕'],
  skipped: ['skip', '–'],
} as const;

function renderJourney(journey: JourneyView, anchor: string): string {
  const [cls, glyph] = JOURNEY_MARK[journey.status];
  const requests = journey.steps.reduce((n, s) => n + s.http.length, 0);
  // Failures open, passes closed: whoever opens this page is triaging a
  // failure, and a fully expanded tree buries it.
  const open = journey.status === 'failed' ? ' open' : '';

  return `
    <details class="journey ${journey.status}" id="${escape(anchor)}"${open}>
      <summary class="j-summary">
        <span class="j-mark ${cls}">${glyph}</span>
        <span class="j-id">${escape(journey.id)}</span>
        <span class="j-title">${escape(journey.title)}</span>
        <span class="j-cap">${escape(journey.capability)}</span>
        <span class="j-stats"><span>${plural(journey.steps.length, 'step')}</span><span>${plural(requests, 'request')}</span><span class="mono">${seconds(journey.durationMs)}</span></span>
        ${CHEVRON}
      </summary>
      <div class="j-body">
        <div class="steps">${journey.steps.map(renderStep).join('')}</div>
      </div>
    </details>`;
}

/** A JUnit case rendered as a step, for checks that belong to no journey. */
function caseAsStep(c: CaseReport): StepView {
  return {
    label: c.name,
    status: c.skipped ? 'not-reached' : c.ok ? 'passed' : 'failed',
    durationMs: c.durationMs,
    ...(c.failure ? { error: c.failure } : {}),
    http: [],
  };
}

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
  const failedCases = cases.filter((c) => !c.ok);
  const ok = failedCases.length === 0;
  const http = report.http ?? [];
  const failedHttp = http.filter((h) => h.error || (h.status !== null && h.status >= 400));
  const totalMs = report.suites.reduce((sum, s) => sum + s.durationMs, 0);

  const journeys = report.journeys;
  // Checks belonging to no journey -- the environment and harness
  // assertions -- still have to appear somewhere, so they get a block in
  // the same tree rather than a second, differently-shaped table.
  const looseCases = journeys
    ? cases.filter((c) => !journeys.some((j) => c.name.includes(j.id)))
    : [];

  const blocks: { view: JourneyView; anchor: string }[] = (
    journeys
      ? [
          ...journeys,
          ...(looseCases.length
            ? [
                {
                  id: 'CHECKS',
                  title: 'Environment and harness checks',
                  capability: 'harness',
                  status: looseCases.every((c) => c.ok) ? 'passed' : 'failed',
                  durationMs: looseCases.reduce((sum, c) => sum + c.durationMs, 0),
                  steps: looseCases.map(caseAsStep),
                } satisfies JourneyView,
              ]
            : []),
        ]
      : // No tree supplied: each suite becomes a block, so the page has the
        // same shape whether or not the runner joined its records.
        report.suites.map(
          (s): JourneyView => ({
            id: 'SUITE',
            title: s.name,
            capability: 'suite',
            status: s.cases.every((c) => c.ok) ? 'passed' : 'failed',
            durationMs: s.durationMs,
            steps: s.cases.map(caseAsStep),
          }),
        )
  ).map((view, i) => ({ view, anchor: `scenario-${i}` }));

  const orphans = report.orphanHttp ?? [];
  const orphanBlock = orphans.length
    ? `
    <details class="journey passed" id="unattributed">
      <summary class="j-summary">
        <span class="j-mark skip">–</span>
        <span class="j-id">—</span>
        <span class="j-title">Requests outside a journey step</span>
        <span class="j-cap">unattributed</span>
        <span class="j-stats"><span>${plural(orphans.length, 'request')}</span></span>
        ${CHEVRON}
      </summary>
      <div class="j-body"><div class="steps">${renderStep({
        label: 'Recorded before or between steps',
        status: 'passed',
        durationMs: orphans.reduce((sum, h) => sum + h.durationMs, 0),
        http: orphans,
      })}</div></div>
    </details>`
    : '';

  const counts = {
    scenarios: blocks.length,
    passed: blocks.filter((b) => b.view.status === 'passed').length,
    failed: blocks.filter((b) => b.view.status === 'failed').length,
    skipped: blocks.filter((b) => b.view.status === 'skipped').length,
  };

  const card = (n: number, label: string, tone = '') =>
    `<div class="ocard${tone && n > 0 ? ` ${tone}` : ''}"><div class="n">${n}</div><div class="l">${escape(label)}</div></div>`;

  const failedBlocks = blocks.filter((b) => b.view.status === 'failed');
  const failSummary = failedBlocks.length
    ? `
  <div class="fail-summary">
    <h3>${plural(failedBlocks.length, 'scenario')} failed</h3>
    <ul>
      ${failedBlocks
        .map(
          (b) =>
            `<li><a href="#${escape(b.anchor)}"><span>→</span> ${escape(b.view.id)} — ${escape(b.view.title)} <span class="tag">${escape(b.view.capability)} · ${seconds(b.view.durationMs)}</span></a></li>`,
        )
        .join('\n      ')}
    </ul>
  </div>
`
    : '';

  const provenance = Object.entries(report.provenance)
    .map(([k, v]) => `<tr><td>${escape(k)}</td><td>${escape(v)}</td></tr>`)
    .join('\n      ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Release verification — ${escape(report.releaseTag)}</title>
<style>
:root{
  --bg:#F5F6F8;--panel:#fff;--line:#E4E7ED;--line-2:#EEF0F4;
  --ink:#14171F;--ink-2:#3B3F4C;--muted:#6B7180;--muted-2:#9AA0AE;
  --green:#0E8A46;--green-bg:#E9F7EF;--green-line:#BFE7CE;
  --red:#C7292F;--red-bg:#FDECEC;--red-line:#F3C6C6;
  --amber:#B4740E;--amber-bg:#FFF4E0;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--ink)}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
button,input{font-family:inherit}
code,.mono{font-family:var(--mono)}

.wrap{max-width:1180px;margin:0 auto;padding:28px 24px 60px}

/* ===== HEADER ===== */
.header{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:26px 30px;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.verdict{display:flex;align-items:center;gap:16px}
.verdict-badge{font-size:13px;font-weight:800;letter-spacing:0.08em;padding:8px 16px;border-radius:8px}
.verdict-badge.fail{background:var(--red);color:#fff}
.verdict-badge.pass{background:var(--green);color:#fff}
.verdict-meta{font-size:13px;color:var(--muted)}
.verdict-meta b{color:var(--ink-2);font-weight:700}
.run-meta{display:flex;gap:22px;flex-wrap:wrap}
.run-meta .item{text-align:right}
.run-meta .l{font-size:10.5px;font-weight:700;letter-spacing:0.08em;color:var(--muted-2)}
.run-meta .v{font-size:13px;color:var(--ink-2);font-weight:600;margin-top:2px}

/* ===== OVERVIEW CARDS ===== */
.cards{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;margin-top:16px}
.ocard{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 14px;text-align:center}
.ocard .n{font-size:26px;font-weight:800;letter-spacing:-0.02em;color:var(--ink)}
.ocard.bad .n{color:var(--red)}
.ocard.good .n{color:var(--green)}
.ocard .l{font-size:11px;color:var(--muted);font-weight:600;letter-spacing:0.02em;margin-top:4px;text-transform:uppercase}

/* ===== FAILURES SUMMARY ===== */
.fail-summary{margin-top:20px;background:var(--red-bg);border:1px solid var(--red-line);border-radius:12px;padding:16px 20px}
.fail-summary h3{margin:0 0 10px;font-size:13px;color:var(--red);font-weight:800;letter-spacing:0.02em;text-transform:uppercase}
.fail-summary ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.fail-summary a{color:var(--ink-2);text-decoration:none;font-size:13.5px;font-weight:600;display:flex;gap:8px;align-items:center}
.fail-summary a:hover{color:var(--red);text-decoration:underline}
.fail-summary a .tag{font-size:11px;color:var(--muted);font-weight:500}

/* ===== CONTROLS ===== */
.controls{display:flex;align-items:center;gap:10px;margin-top:22px;flex-wrap:wrap}
.controls input[type="search"]{flex:1;min-width:200px;padding:9px 14px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff}
.controls input[type="search"]:focus{outline:2px solid #B9C2FF;border-color:#7C89E8}
.ctrl-btn{padding:9px 14px;border-radius:8px;border:1px solid var(--line);background:#fff;font-size:13px;font-weight:600;color:var(--ink-2);cursor:pointer}
.ctrl-btn:hover{background:var(--line-2)}
.ctrl-btn.on{background:var(--ink);color:#fff;border-color:var(--ink)}

/* ===== SCENARIO TREE ===== */
.section-title{font-size:13px;font-weight:800;letter-spacing:0.06em;color:var(--muted);text-transform:uppercase;margin:28px 0 10px}
.tree{display:flex;flex-direction:column;gap:10px}

details.journey{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
details.journey[open]>summary{border-bottom:1px solid var(--line)}
details.journey.failed{border-color:var(--red-line)}
summary.j-summary{list-style:none;cursor:pointer;padding:16px 20px;display:flex;align-items:center;gap:14px}
summary.j-summary::-webkit-details-marker{display:none}
.j-mark{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;font-size:13px;font-weight:800}
.j-mark.ok{background:var(--green-bg);color:var(--green)}
.j-mark.bad{background:var(--red-bg);color:var(--red)}
.j-mark.skip{background:var(--line-2);color:var(--muted-2)}
.j-id{font-family:var(--mono);font-size:12px;color:var(--muted);flex-shrink:0}
.j-title{font-weight:700;color:var(--ink);flex:1;min-width:0}
.j-cap{font-size:11.5px;color:var(--muted);background:var(--line-2);padding:3px 9px;border-radius:999px;flex-shrink:0}
.j-stats{display:flex;gap:14px;font-size:12px;color:var(--muted);flex-shrink:0}
.chev{transition:transform .15s;color:var(--muted-2);flex-shrink:0}
details[open]>summary .chev{transform:rotate(90deg)}

.j-body{padding:6px 20px 18px}
.steps{display:flex;flex-direction:column;gap:6px;margin-top:6px}
details.step{border:1px solid var(--line-2);border-radius:9px;background:var(--bg)}
details.step.fail{border-color:var(--red-line);background:var(--red-bg)}
summary.s-summary{list-style:none;cursor:pointer;padding:11px 14px;display:flex;align-items:center;gap:12px}
summary.s-summary::-webkit-details-marker{display:none}
.s-mark{width:16px;height:16px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;font-size:10px;font-weight:800}
.s-mark.ok{background:var(--green-bg);color:var(--green)}
.s-mark.bad{background:var(--red-bg);color:var(--red)}
.s-mark.skip{background:var(--line-2);color:var(--muted-2)}
.s-label{flex:1;font-size:13px;color:var(--ink-2);font-weight:600}
.s-dur{font-size:11.5px;color:var(--muted);font-family:var(--mono)}
.s-req-count{font-size:11px;color:var(--muted);background:#fff;border:1px solid var(--line);padding:2px 8px;border-radius:999px}

.s-body{padding:0 14px 14px 42px}
.s-error{font-family:var(--mono);font-size:12px;color:var(--red);background:#fff;border:1px solid var(--red-line);border-radius:7px;padding:9px 12px;margin-bottom:10px;white-space:pre-wrap;word-break:break-word}
.s-empty{font-size:12.5px;color:var(--muted-2);font-style:italic;padding:6px 0}

.http{border:1px solid var(--line);border-radius:9px;background:#fff;margin-bottom:8px;overflow:hidden}
.http-head{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--line-2)}
.http-head.err{background:var(--red-bg)}
.method{font-family:var(--mono);font-size:11.5px;font-weight:800;padding:2px 7px;border-radius:5px;background:var(--ink);color:#fff}
.method.get{background:#1E66C2}
.method.post{background:#0E8A46}
.method.put,.method.patch{background:#B4740E}
.method.delete{background:#C7292F}
.http-url{font-family:var(--mono);font-size:12.5px;color:var(--ink-2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.http-status{font-family:var(--mono);font-size:12px;font-weight:800}
.http-status.s2{color:var(--green)}
.http-status.s3{color:var(--amber)}
.http-status.s4,.http-status.s5,.http-status.neterr{color:var(--red)}
.http-dur{font-family:var(--mono);font-size:11.5px;color:var(--muted)}

.http-detail{padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.http-detail .blk-label{font-size:10.5px;font-weight:700;letter-spacing:0.06em;color:var(--muted);text-transform:uppercase;margin-bottom:5px}
.http-detail pre{margin:0;background:var(--bg);border:1px solid var(--line-2);border-radius:7px;padding:10px 12px;font-family:var(--mono);font-size:12px;color:var(--ink-2);overflow-x:auto;white-space:pre-wrap;word-break:break-word}
.trunc-note{font-size:11px;color:var(--muted-2);font-style:italic;margin-top:4px}
.hdr-table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11.5px}
.hdr-table td{padding:3px 8px;border-bottom:1px solid var(--line-2);color:var(--ink-2)}
.hdr-table td:first-child{color:var(--muted);width:180px}

/* ===== PROVENANCE ===== */
.prov-table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:13px}
.prov-table th{text-align:left;background:var(--line-2);font-size:11px;font-weight:700;letter-spacing:0.06em;color:var(--muted);text-transform:uppercase;padding:10px 16px}
.prov-table td{padding:10px 16px;border-top:1px solid var(--line-2);font-family:var(--mono);font-size:12.5px;color:var(--ink-2);word-break:break-all}
.prov-table td:first-child{font-family:inherit;font-weight:600;color:var(--ink);white-space:nowrap;width:220px}

@media (max-width:900px){
  .cards{grid-template-columns:repeat(3,1fr)}
  .run-meta{justify-content:flex-start}
}
@media (max-width:700px){
  .wrap{padding:16px 12px 40px}
  /* The title is the thing being read; on a narrow screen the pill and
     the stats squeeze it to one word per line unless it gets its own row. */
  summary.j-summary{flex-wrap:wrap;gap:8px 10px;padding:14px}
  .j-title{flex:1 0 100%;order:2}
  .j-cap,.j-stats{order:3}
  .chev{order:4;margin-left:auto}
  summary.s-summary{flex-wrap:wrap;gap:6px 10px}
  .s-label{flex:1 0 100%}
  .s-body{padding-left:14px}
  .http-url{white-space:normal;word-break:break-all;text-overflow:clip}
  .hdr-table td:first-child{width:auto}
}
@media print{
  .controls{display:none}
  details{break-inside:avoid}
}
</style>
</head>
<body>
<div class="wrap">

  <div class="header">
    <div class="verdict">
      <span class="verdict-badge ${ok ? 'pass' : 'fail'}">${ok ? 'PASSED' : 'FAILED'}</span>
      <div class="verdict-meta">Release <b>${escape(report.releaseTag)}</b> · target <b>${escape(report.target)}</b> · ${cases.length - failedCases.length} of ${cases.length} checks passed</div>
    </div>
    <div class="run-meta">
      <div class="item"><div class="l">DURATION</div><div class="v">${seconds(totalMs)}</div></div>
      ${report.startedAt ? `<div class="item"><div class="l">RUN AT</div><div class="v">${escape(report.startedAt)}</div></div>` : ''}
    </div>
  </div>

  <div class="cards">
    ${card(counts.scenarios, 'Scenarios')}
    ${card(counts.passed, 'Passed', 'good')}
    ${card(counts.failed, 'Failed', 'bad')}
    ${card(counts.skipped, 'Skipped')}
    ${card(cases.length, 'Checks')}
    ${card(http.length, 'Requests')}
    ${card(failedHttp.length, 'Failed requests', 'bad')}
  </div>
${failSummary}
  <div class="controls">
    <input type="search" id="filterText" placeholder="Filter scenarios or steps…">
    <button class="ctrl-btn" id="failuresOnly">Failures only</button>
    <button class="ctrl-btn" id="expandAll">Expand all</button>
    <button class="ctrl-btn" id="collapseAll">Collapse all</button>
  </div>

  <div class="section-title">Scenarios</div>
  <div class="tree" id="tree">${blocks.map((b) => renderJourney(b.view, b.anchor)).join('')}${orphanBlock}
  </div>

  <div class="section-title">Provenance</div>
  <table class="prov-table">
    <thead><tr><th>Key</th><th>Value</th></tr></thead>
    <tbody>
      ${provenance}
    </tbody>
  </table>

</div>

<script>
document.getElementById('failuresOnly').addEventListener('click', function(){
  this.classList.toggle('on');
  var only = this.classList.contains('on');
  document.querySelectorAll('.journey').forEach(function(j){
    j.style.display = (only && !j.classList.contains('failed')) ? 'none' : '';
  });
});
document.getElementById('expandAll').addEventListener('click', function(){
  document.querySelectorAll('#tree details').forEach(function(d){ d.open = true; });
});
document.getElementById('collapseAll').addEventListener('click', function(){
  document.querySelectorAll('#tree details').forEach(function(d){ d.open = false; });
});
document.getElementById('filterText').addEventListener('input', function(){
  var q = this.value.trim().toLowerCase();
  document.querySelectorAll('.journey').forEach(function(j){
    var text = j.textContent.toLowerCase();
    j.style.display = (q && text.indexOf(q) === -1) ? 'none' : '';
  });
});
</script>

</body>
</html>
`;
}
