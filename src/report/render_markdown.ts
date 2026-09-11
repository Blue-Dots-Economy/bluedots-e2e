import { caseNameOf, type JourneyView } from './journey_views.js';
import { duration, failedRequests, isFailedRequest, seconds } from './format.js';
import type { HttpEntryView, RunReport } from './render_html.js';

/** A pipe ends a table cell, so any text going into one has to lose it. */
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');


const MARK = { passed: '✅', failed: '❌', skipped: '⏭️' } as const;
const STEP_MARK = { passed: '✅', failed: '❌', 'not-reached': '⏭️' } as const;

/** Trim to the part worth reading in a summary; the artifact holds the rest. */
function excerpt(text: string, max = 600): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… see report.html in the artifact`;
}

function failedRequest(h: HttpEntryView): string {
  const status = h.error ?? String(h.status);
  return [
    `\`${h.method} ${h.url}\` → **${status}** (${duration(h.durationMs)})`,
    ...(h.requestBody ? ['', 'Request', '```json', excerpt(h.requestBody), '```'] : []),
    ...(h.responseBody ? ['', 'Response', '```json', excerpt(h.responseBody), '```'] : []),
  ].join('\n');
}

function failureDetail(journey: JourneyView): string {
  const lines: string[] = [`<details open><summary><b>${cell(journey.id)} — ${cell(journey.title)}</b></summary>`, ''];

  for (const step of journey.steps) {
    lines.push(`${STEP_MARK[step.status]} ${step.label} — ${duration(step.durationMs)}`);
    if (step.error) lines.push('', '```', excerpt(step.error), '```');
    for (const h of step.http.filter(isFailedRequest)) {
      lines.push('', failedRequest(h));
    }
    lines.push('');
  }

  lines.push('</details>');
  return lines.join('\n');
}

/**
 * The run's headline for the Actions summary page.
 *
 * The same numbers as report.html, in the one place a reader sees without
 * downloading anything. Everything below the counts is failure detail:
 * a green run should be a glance, and a red one should say what broke
 * before anyone opens the artifact.
 */
export function renderMarkdown(report: RunReport): string {
  const cases = report.suites.flatMap((s) => s.cases);
  const journeys = report.journeys ?? [];
  const http = report.http ?? [];
  const failedHttp = failedRequests(http);
  const failedCases = cases.filter((c) => !c.ok);
  const ok = failedCases.length === 0;
  const totalMs = report.suites.reduce((sum, s) => sum + s.durationMs, 0);

  const counts = {
    scenarios: journeys.length,
    passed: journeys.filter((j) => j.status === 'passed').length,
    failed: journeys.filter((j) => j.status === 'failed').length,
    skipped: journeys.filter((j) => j.status === 'skipped').length,
  };

  const scenarioRows = journeys
    .map((j) => {
      const requests = j.steps.reduce((n, s) => n + s.http.length, 0);
      return `| ${MARK[j.status]} | ${cell(j.id)} | ${cell(j.title)} | ${cell(j.capability)} | ${j.steps.length} | ${requests} | ${seconds(j.durationMs)} |`;
    })
    .join('\n');

  const failed = journeys.filter((j) => j.status === 'failed');
  // A check that failed outside any journey still has to be named, or the
  // summary reads green while the job is red.
  const looseFailures = failedCases.filter((c) => !journeys.some((j) => c.name.includes(caseNameOf(j))));

  return [
    `## ${ok ? '✅ PASSED' : '❌ FAILED'} — release \`${report.releaseTag}\` · target \`${report.target}\``,
    '',
    '| Scenarios | Passed | Failed | Skipped | Checks | Requests | Failed requests |',
    '| --: | --: | --: | --: | --: | --: | --: |',
    `| ${counts.scenarios} | ${counts.passed} | ${counts.failed} | ${counts.skipped} | ${cases.length} | ${http.length} | ${failedHttp.length} |`,
    '',
    `Duration ${seconds(totalMs)}${report.startedAt ? ` · run at ${report.startedAt}` : ''} · ${cases.length - failedCases.length} of ${cases.length} checks passed`,
    ...(scenarioRows
      ? [
          '',
          '| | ID | Scenario | Capability | Steps | Requests | Duration |',
          '| :-: | --- | --- | --- | --: | --: | --: |',
          scenarioRows,
        ]
      : []),
    ...(failed.length || looseFailures.length
      ? [
          '',
          '### Failure detail',
          '',
          ...failed.map(failureDetail),
          ...looseFailures.map((c) => `❌ ${cell(c.name)}\n\n\`\`\`\n${excerpt(c.failure ?? '')}\n\`\`\``),
        ]
      : []),
    '',
    '_Full report: `report.html` in the run artifact._',
    '',
  ].join('\n');
}
