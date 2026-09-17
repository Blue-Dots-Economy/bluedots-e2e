import type { CaseReport, RunReport } from './render_html.js';
import { duration, failedRequests } from './format.js';

/**
 * Newman-style console output.
 *
 * vitest names a case by its whole describe chain --
 * `a > b > c > what it checks` -- which is unreadable in a run log and
 * repeats the same prefix on every line. Newman's answer is to put the
 * hierarchy in the indentation and print each group once, then close with a
 * totals table and the failure detail, so a reader scrolling to the bottom
 * finds what broke without hunting back through the run.
 */

const ms = duration;

/** `a > b > c` becomes group `b` and name `c`; the outermost describe is noise. */
function split(name: string): { group: string; leaf: string } {
  const parts = name.split('>').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { group: '', leaf: name.trim() };
  return { group: parts.slice(1, -1).join(' / ') || parts[0]!, leaf: parts.at(-1)! };
}

/**
 * Three columns, not two. `not covered` earns one because a journey that
 * did not run is the one number a reader must not have to infer: purple_dot
 * runs 14 of 17, and a table saying "17 executed" for it describes a
 * verification that did not happen.
 */
function table(rows: [string, number, number, number][], footers: string[]): string {
  const label = Math.max(12, ...rows.map((r) => r[0].length)) + 2;
  const col = 13;
  const width = label + col * 3 + 3; // three inner separators
  const line = (l: string, m: string, r: string) =>
    `${l}${'─'.repeat(label)}${m}${'─'.repeat(col)}${m}${'─'.repeat(col)}${m}${'─'.repeat(col)}${r}`;
  const row = (a: string, b: string, c: string, d: string) =>
    `│${a.padStart(label - 1)} │${b.padStart(col - 1)} │${c.padStart(col - 1)} │${d.padStart(col - 1)} │`;
  // Footers span the full width, as newman does for run totals.
  const span = (text: string) => `│ ${text.padEnd(width - 2)} │`;
  const spanLine = (l: string, r: string) => `${l}${'─'.repeat(width)}${r}`;

  return [
    line('┌', '┬', '┐'),
    row('', 'executed', 'failed', 'not covered'),
    ...rows.flatMap((r) => [
      line('├', '┼', '┤'),
      row(r[0], String(r[1]), String(r[2]), String(r[3])),
    ]),
    ...(footers.length
      ? [
          `├${'─'.repeat(label)}┴${'─'.repeat(col)}┴${'─'.repeat(col)}┴${'─'.repeat(col)}┤`,
          ...footers.flatMap((f, i) => (i === 0 ? [span(f)] : [spanLine('├', '┤'), span(f)])),
          spanLine('└', '┘'),
        ]
      : [line('└', '┴', '┘')]),
  ].join('\n');
}

export function renderNewman(report: RunReport): string {
  const out: string[] = ['', 'release verification', ''];
  out.push(`Release ${report.releaseTag} · target ${report.target}`, '');

  const failures: { group: string; leaf: string; failure: string }[] = [];
  let executed = 0;
  let failed = 0;
  let journeysRun = 0;
  let notCovered = 0;
  let journeysNotCovered = 0;
  let journeysFailed = 0;

  for (const suite of report.suites) {
    let lastGroup: string | null = null;
    for (const c of suite.cases) {
      const { group, leaf } = split(c.name);

      // A skipped case carries ok: true -- vitest has nothing to report
      // against a test it never ran. Counting it as executed is how a
      // target that verified 14 journeys reported 17, and rendering it
      // with a tick is how that read as a pass.
      if (c.skipped) {
        notCovered++;
        if (/journeys?$/i.test(group)) journeysNotCovered++;
      } else {
        executed++;
        if (!c.ok) failed++;
      }
      // A journey case is one whose group is the journeys block; counting
      // them separately is what makes the table answer "did the release
      // pass" rather than "did the assertions pass".
      if (/journeys?$/i.test(group) && !c.skipped) {
        journeysRun++;
        if (!c.ok) journeysFailed++;
      }

      if (group !== lastGroup) {
        out.push(`❏ ${group}`);
        lastGroup = group;
      }
      out.push(
        c.skipped
          ? `  ⊘  ${leaf} ${dim('not covered here')}`
          : `  ${c.ok ? '✓' : '✗'}  ${leaf} ${dim(ms(c.durationMs))}`,
      );
      if (!c.skipped && !c.ok) failures.push({ group, leaf, failure: c.failure ?? 'failed' });
    }
    out.push('');
  }

  const total = report.suites.reduce((s, x) => s + x.durationMs, 0);
  out.push(
    table(
      [
        ['journeys', journeysRun, journeysFailed, journeysNotCovered],
        ['checks', executed, failed, notCovered],
        // Through the shared predicate, so the job log and report.html
        // cannot describe the same run with different numbers. A request is
        // either made or not, so it has nothing to put in the third column.
        ['requests', (report.http ?? []).length, failedRequests(report.http ?? []).length, 0],
      ],
      [`total run duration: ${ms(total)}`],
    ),
    '',
  );

  if (failures.length > 0) {
    out.push('  #  failure         detail', '');
    failures.forEach((f, i) => {
      out.push(` ${String(i + 1).padStart(2)}.  AssertionError  ${f.failure.split('\n')[0]}`);
      out.push(`                     inside "${f.group} / ${f.leaf}"`, '');
    });
  }

  return out.join('\n') + '\n';
}

/** Parenthesised timing, kept plain so it survives a log with no colour. */
function dim(text: string): string {
  return `(${text})`;
}
