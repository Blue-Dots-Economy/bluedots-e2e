import { describe, expect, test } from 'vitest';
import { parseJUnit } from './parse_junit.js';

const XML = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="2" failures="1" time="51.1">
  <testsuite name="tests/stack/j2.stack.test.ts" tests="1" failures="0" time="17.8">
    <testcase classname="tests/stack/j2.stack.test.ts" name="J2 &gt; runs end to end" time="17.8">
    </testcase>
  </testsuite>
  <testsuite name="tests/stack/negative_controls.stack.test.ts" tests="1" failures="1" time="33.3">
    <testcase classname="tests/stack/negative_controls.stack.test.ts" name="control &gt; sweep cannot fake a pass" time="33.3">
      <failure message="expected false to be true" type="AssertionError"></failure>
    </testcase>
  </testsuite>
</testsuites>`;

describe('parseJUnit', () => {
  test('reads the test name, not the classname', () => {
    // A bare /name="/ also matches the tail of classname="...", which made
    // every case report the file it lived in instead of what it checked.
    const suites = parseJUnit(XML);

    expect(suites[0]!.cases[0]!.name).toBe('J2 > runs end to end');
  });

  test('marks a case with a <failure> as failed and keeps the message', () => {
    const suites = parseJUnit(XML);

    expect(suites[1]!.cases[0]!.ok).toBe(false);
    expect(suites[1]!.cases[0]!.failure).toBe('expected false to be true');
  });

  test('treats a case with no failure as passed', () => {
    expect(parseJUnit(XML)[0]!.cases[0]!.ok).toBe(true);
  });

  test('converts seconds to milliseconds', () => {
    expect(parseJUnit(XML)[0]!.cases[0]!.durationMs).toBeCloseTo(17800, 0);
  });

  test('unescapes entities, so a > in a test name reads correctly', () => {
    expect(parseJUnit(XML)[0]!.cases[0]!.name).not.toContain('&gt;');
  });

  test('returns nothing for input with no suites, rather than throwing', () => {
    expect(parseJUnit('<testsuites/>')).toEqual([]);
  });
});

test('marks a skipped case as skipped rather than passed', () => {
  // vitest emits <skipped/> for a journey the runner declined to run. Read
  // as a pass, an uncovered journey inflates the passed count -- which is
  // the one number a reader uses to decide whether to ship.
  const xml = `<testsuites>
<testsuite name="tests/stack/journeys.stack.test.ts" time="1">
<testcase classname="x" name="J3 — Not run here" time="0"><skipped/></testcase>
<testcase classname="x" name="J2 — Ran" time="1"></testcase>
</testsuite>
</testsuites>`;

  const [suite] = parseJUnit(xml);

  expect(suite?.cases[0]?.skipped).toBe(true);
  expect(suite?.cases[1]?.skipped).toBeFalsy();
});
