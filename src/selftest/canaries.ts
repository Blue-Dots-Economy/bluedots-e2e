import { defineJourney, runJourney, step, type Journey, type StepContext } from '../journey/define_journey.js';

/**
 * Two scenarios whose outcomes are known in advance.
 *
 * Without them, a runner that swallowed every failure and a runner that
 * worked would produce identical output on a green suite. These make the
 * runner itself falsifiable, and they need no containers, so they can gate
 * every pull request to this repository.
 */
export const CANARIES: Journey[] = [
  defineJourney({
    id: 'CANARY-PASS',
    title: 'A canary that is built to pass',
    capability: 'search-and-discovery',
    targets: ['purple_dot'],
    steps: [step({ label: 'Did nothing at all', run: async () => {} })],
  }),
  defineJourney({
    id: 'CANARY-FAIL',
    title: 'A canary that is built to fail',
    capability: 'search-and-discovery',
    targets: ['purple_dot'],
    steps: [
      step({ label: 'Did nothing at all', run: async () => {} }),
      step({
        label: 'Failed on purpose',
        run: async () => {
          throw new Error('canary failure');
        },
      }),
    ],
  }),
];

export type SelftestResult = {
  passed: number;
  failed: number;
  exitCode: number;
  /** False when a canary did not behave as designed. */
  selftestOk: boolean;
  reason?: string;
  results: { id: string; ok: boolean; failedStep?: string }[];
};

export async function runSelftest(
  journeys: Journey[],
  makeCtx: () => StepContext,
): Promise<SelftestResult> {
  const results = [];
  for (const journey of journeys) {
    const r = await runJourney(journey, makeCtx());
    results.push({ id: journey.id, ok: r.ok, failedStep: r.failedStep });
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  // Assert the canaries behaved as their names promise. A CANARY-FAIL that
  // passes means the runner is reporting green regardless of what happened,
  // which is the exact fault this job exists to catch.
  const wrong = results.filter(
    (r) => (r.id === 'CANARY-PASS' && !r.ok) || (r.id === 'CANARY-FAIL' && r.ok),
  );

  return {
    passed,
    failed,
    // Non-zero whenever any journey failed, canary or not: CI must see it.
    exitCode: failed > 0 ? 1 : 0,
    selftestOk: wrong.length === 0,
    reason: wrong.length ? `canaries did not behave as designed: ${wrong.map((w) => w.id).join(', ')}` : undefined,
    results,
  };
}
