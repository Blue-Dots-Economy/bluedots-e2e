import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runJourney, type StepContext } from '../../src/journey/define_journey.js';
import { profileBecomesFindable } from '../../journeys/search/profile_becomes_findable.js';
import { bootStack, teardownStack, type BootedStack } from './boot_stack.js';

/**
 * The control that decides whether J2's green means anything.
 *
 * The worker is pointed at a DECOY consumer group and the reconciliation
 * sweep is left running fast. The item therefore still reaches item_search
 * -- straight from Postgres, exactly as the sweep is designed to do -- while
 * nothing ever crosses the group the awaiter watches.
 *
 * A naive awaiter ("wait until the item is findable") passes here. This one
 * must fail. If it ever passes, the suite is reporting that ingestion works
 * when it demonstrably does not, and every J2 green is worthless.
 */
describe('Negative control: the sweep must not be able to fake a pass', () => {
  let stack: BootedStack;
  let ctx: StepContext;

  beforeAll(async () => {
    stack = await bootStack({
      // Its own project directory: this stack runs alongside the real one.
      runDirPrefix: 'journey-control-',
      searchOverrides: {
        // Consume a group nobody is watching: the stream path is dead as
        // far as the awaiter is concerned.
        INGEST_CONSUMER_GROUP: 'decoy-control-group',
        // ...but leave the backstop running fast, so the item DOES get
        // indexed. This is precisely the situation a naive awaiter cannot
        // distinguish from success.
        SWEEP_INTERVAL_MS: '2000',
      },
      // Unrecorded on purpose: this stack is deliberately broken and its
      // failures are the expected result, not evidence anyone reads in the
      // release report.
      http: fetch,
    });

    ctx = { ...stack.baseCtx, state: { seed: stack.seed } };
  }, 600_000);

  afterAll(async () => {
    await teardownStack(stack);
  });

  test('J2 fails when only the sweep indexed the item', async () => {
    const result = await runJourney(profileBecomesFindable, ctx);

    expect(
      result.ok,
      `control PASSED, which means the suite cannot detect a dead ingest spine:\n${JSON.stringify(result.trace, null, 2)}`,
    ).toBe(false);
    expect(result.failedStep).toBe('Waited until the new profile was picked up for search');
  });

  test('and the item really was indexed, so the failure is about the path not the data', async () => {
    // Without this, a failure here could just mean nothing was written at
    // all -- which would make the control pass for the wrong reason.
    const indexed = await stack.probe.indexedAt(ctx.state.itemKey as never);

    expect(indexed).not.toBeNull();
  });
});
