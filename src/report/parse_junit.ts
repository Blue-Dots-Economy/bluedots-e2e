import type { SuiteReport } from './render_html.js';

// (?:^|\s) matters: a bare /name="/ also matches the tail of
// classname="...", so every case would take the file name instead of the
// test name.
const attr = (tag: string, name: string) =>
  new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1] ?? '';

const unescape = (t: string) =>
  t.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Read vitest's JUnit output into something renderable. */
export function parseJUnit(xml: string): SuiteReport[] {
  const suites: SuiteReport[] = [];
  for (const block of xml.split('<testsuite ').slice(1)) {
    const head = block.slice(0, block.indexOf('>'));
    const cases = [
      ...block.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g),
    ].map((m) => {
      const tag = m[1] ?? m[3] ?? '';
      const body = m[2] ?? '';
      const skipped = /<skipped/.test(body);
      // The element's presence is the signal, never its message: a
      // <failure message=""> is falsy as a string, and reading ok from the
      // text rendered a red job all-green.
      const didFail = /<failure/.test(body);
      const failure = didFail
        ? unescape(attr(/<failure[^>]*/.exec(body)?.[0] ?? '', 'message')) || '(no message)'
        : undefined;
      return {
        name: unescape(attr(tag, 'name')),
        ok: !didFail,
        durationMs: Number(attr(tag, 'time') || 0) * 1000,
        ...(skipped ? { skipped } : {}),
        ...(failure ? { failure } : {}),
      };
    });
    suites.push({
      name: unescape(attr(head, 'name')),
      durationMs: Number(attr(head, 'time') || 0) * 1000,
      cases,
    });
  }
  return suites;
}
