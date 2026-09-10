import { describe, expect, test } from 'vitest';
import { selectJourneys, type RunnableJourney } from './select.js';
import { defineJourney, step } from './journey.js';

const j = (id: string, targets: string[], needs: ('http' | 'redis' | 'postgres')[] = ['http']) =>
  ({
    ...defineJourney({
      id,
      title: `Journey ${id.toLowerCase()} does a thing`,
      capability: 'search-and-discovery',
      targets,
      steps: [step({ label: 'Did a thing', run: async () => {} })],
    }),
    requires: needs,
  });

const ALL: RunnableJourney[] = [
  j('J2', ['purple_dot', 'blue_dot/ka-dhwd'], ['http', 'redis', 'postgres']),
  j('J3', ['purple_dot']),
  j('J9', ['orange_dot']),
];

describe('selectJourneys', () => {
  test('runs the journeys that declare this target', () => {
    const { run } = selectJourneys(ALL, 'purple_dot', ['http', 'redis', 'postgres']);

    expect(run.map((r) => r.id)).toEqual(['J2', 'J3']);
  });

  test('skips a journey that does not declare this target, and says why', () => {
    const { skipped } = selectJourneys(ALL, 'purple_dot', ['http', 'redis', 'postgres']);

    expect(skipped).toEqual([
      { id: 'J9', reason: 'does not declare target purple_dot' },
    ]);
  });

  test('skips a journey the environment cannot verify, naming the capability', () => {
    // An http-only environment cannot run the correlation check, and the
    // report must say NOT COVERED rather than quietly asserting less.
    const { run, skipped } = selectJourneys(ALL, 'purple_dot', ['http']);

    expect(run.map((r) => r.id)).toEqual(['J3']);
    expect(skipped).toContainEqual({
      id: 'J2',
      reason: 'environment lacks redis, postgres',
    });
  });

  test('never silently drops a journey', () => {
    // Every journey is accounted for as run or skipped-with-a-reason.
    const { run, skipped } = selectJourneys(ALL, 'purple_dot', ['http']);

    expect(run.length + skipped.length).toBe(ALL.length);
  });
});
