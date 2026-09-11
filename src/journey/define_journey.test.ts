import { describe, expect, test } from 'vitest';
import { defineJourney, step, custom, runJourney } from './define_journey.js';

const ctx = () => ({
  clients: {},
  // Unused by these scenarios; present because every step context carries
  // the recorded fetch.
  http: (async () => new Response('{}')) as unknown as typeof fetch,
  state: {} as Record<string, unknown>,
  endpoints: { signalsApi: '', searchApi: '', keycloak: '', postgresUrl: '', redisUrl: '' },
  seeded: {},
});

describe('defineJourney', () => {
  test('accepts a scenario that is a list of named steps', () => {
    const j = defineJourney({
      id: 'J2',
      title: 'A new profile becomes findable in search',
      capability: 'search-and-discovery',
      targets: ['purple_dot'],
      steps: [step({ label: 'Created a seeker profile', run: async () => {} })],
    });

    expect(j.id).toBe('J2');
    expect(j.steps).toHaveLength(1);
  });

  test('rejects a title that reads like an implementation detail', () => {
    // The title is what the evidence sheet prints. A route path there makes
    // the business-facing report unreadable to the people it is for.
    expect(() =>
      defineJourney({
        id: 'J9',
        title: 'POST /v1/search returns a hit',
        capability: 'search-and-discovery',
        targets: ['purple_dot'],
        steps: [],
      }),
    ).toThrow(/route path/i);
  });

  test('rejects a capability outside the declared five', () => {
    expect(() =>
      defineJourney({
        id: 'J9',
        title: 'Something happens',
        capability: 'misc' as never,
        targets: ['purple_dot'],
        steps: [],
      }),
    ).toThrow(/misc/);
  });

  test('rejects a step label naming a service', () => {
    expect(() =>
      defineJourney({
        id: 'J9',
        title: 'Something happens',
        capability: 'search-and-discovery',
        targets: ['purple_dot'],
        steps: [step({ label: 'Wait for signals-search', run: async () => {} })],
      }),
    ).toThrow(/service/);
  });

  test('rejects a journey with no targets, which would silently run nowhere', () => {
    expect(() =>
      defineJourney({
        id: 'J9',
        title: 'Something happens',
        capability: 'search-and-discovery',
        targets: [],
        steps: [],
      }),
    ).toThrow(/target/i);
  });
});

describe('runJourney', () => {
  test('runs steps in order', async () => {
    const order: string[] = [];
    const j = defineJourney({
      id: 'J1',
      title: 'Steps run in order',
      capability: 'search-and-discovery',
      targets: ['purple_dot'],
      steps: [
        step({ label: 'First thing', run: async () => { order.push('a'); } }),
        step({ label: 'Second thing', run: async () => { order.push('b'); } }),
      ],
    });

    await runJourney(j, ctx());

    expect(order).toEqual(['a', 'b']);
  });

  test('threads state from one step to the next', async () => {
    const j = defineJourney({
      id: 'J1',
      title: 'State carries forward',
      capability: 'search-and-discovery',
      targets: ['purple_dot'],
      steps: [
        step({ label: 'Recorded an item', run: async (c) => { c.state.itemId = 'i-1'; } }),
        step({ label: 'Read it back', run: async (c) => { c.state.seen = c.state.itemId; } }),
      ],
    });

    const result = await runJourney(j, ctx());

    expect(result.state.seen).toBe('i-1');
  });

  test('stops at the first failing step and names it', async () => {
    // The trace has to point at the step that broke, not the last one.
    const after: string[] = [];
    const j = defineJourney({
      id: 'J1',
      title: 'Failure stops the run',
      capability: 'search-and-discovery',
      targets: ['purple_dot'],
      steps: [
        step({ label: 'Worked fine', run: async () => {} }),
        step({ label: 'Broke here', run: async () => { throw new Error('boom'); } }),
        step({ label: 'Never reached', run: async () => { after.push('x'); } }),
      ],
    });

    const result = await runJourney(j, ctx());

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('Broke here');
    expect(after).toEqual([]);
  });

  test('records every step outcome for the trace', async () => {
    const j = defineJourney({
      id: 'J1',
      title: 'Trace is recorded',
      capability: 'search-and-discovery',
      targets: ['purple_dot'],
      steps: [
        step({ label: 'Did a thing', run: async () => {} }),
        step({ label: 'Failed a thing', run: async () => { throw new Error('nope'); } }),
      ],
    });

    const result = await runJourney(j, ctx());

    expect(result.trace).toEqual([
      { label: 'Did a thing', ok: true },
      { label: 'Failed a thing', ok: false, error: 'nope' },
    ]);
  });
});

describe('custom', () => {
  test('is a labelled escape hatch, marked so review can see it', () => {
    // Dropping to raw logic is allowed but must be visible in the diff and
    // in the report, rather than hidden inside a step body.
    const s = custom({ label: 'Compared two rollups by hand', run: async () => {} });

    expect(s.isCustom).toBe(true);
    expect(s.label).toBe('Compared two rollups by hand');
  });
});

describe('runJourney step attribution', () => {
  test('announces each step label before running it', async () => {
    const seen: string[] = [];
    const order: string[] = [];
    const j = defineJourney({
      id: 'J2',
      title: 'A new profile becomes findable in search',
      capability: 'search-and-discovery',
      targets: ['purple_dot'],
      steps: [
        step({ label: 'Created a seeker profile', run: async () => { order.push('ran:one'); } }),
        step({ label: 'Found the profile in search', run: async () => { order.push('ran:two'); } }),
      ],
    });

    await runJourney(j, ctx(), {
      onStep: (label) => {
        seen.push(label);
        order.push(`announced:${label}`);
      },
    });

    expect(seen).toEqual(['Created a seeker profile', 'Found the profile in search']);
    // Announced BEFORE the step runs, or the recorder attributes the step's
    // own requests to whatever ran previously.
    expect(order[0]).toBe('announced:Created a seeker profile');
    expect(order[1]).toBe('ran:one');
  });
});
