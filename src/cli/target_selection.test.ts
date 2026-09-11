import { describe, expect, test } from 'vitest';
import { coveredTargets, renderTargetList, resolveSelection } from './target_selection.js';
import type { Target } from '../targets/target_discovery.js';

const TARGETS: Target[] = [
  { id: 'blue_dot/ka-dhwd', dot: 'blue_dot', instance: 'ka-dhwd' },
  { id: 'blue_dot/up-gzb', dot: 'blue_dot', instance: 'up-gzb' },
  { id: 'purple_dot', dot: 'purple_dot', instance: null },
];

describe('resolveSelection', () => {
  test('uses the flags when both are supplied', () => {
    const s = resolveSelection({ dot: 'blue_dot', instance: 'ka-dhwd' }, TARGETS, {
      isCI: true,
    });

    expect(s).toEqual({ kind: 'selected', dot: 'blue_dot', instance: 'ka-dhwd' });
  });

  test('fails in CI when no target is given, rather than defaulting', () => {
    expect(() => resolveSelection({ dot: null, instance: null }, TARGETS, { isCI: true }))
      .toThrow(/--dot/);
  });

  test('asks to prompt when interactive and no target is given', () => {
    const s = resolveSelection({ dot: null, instance: null }, TARGETS, { isCI: false });

    expect(s.kind).toBe('prompt');
  });

  test('fails in CI when a dot with instances is given without one', () => {
    expect(() => resolveSelection({ dot: 'blue_dot', instance: null }, TARGETS, { isCI: true }))
      .toThrow(/blue_dot\/ka-dhwd/);
  });
});

describe('renderTargetList', () => {
  test('lists every target one per line', () => {
    const out = renderTargetList(TARGETS);

    expect(out).toContain('blue_dot/ka-dhwd');
    expect(out).toContain('purple_dot');
    expect(out.trim().split('\n')).toHaveLength(3);
  });
});

describe('renderTargetList as json', () => {
  test('emits an array a workflow matrix can consume', () => {
    // The targets were enumerated by hand in journey.yml as well as
    // discovered here, so a new dot meant editing both and the workflow
    // silently kept testing the old set.
    const json = renderTargetList(
      [
        { id: 'purple_dot', dot: 'purple_dot', instance: null },
        { id: 'blue_dot/ka-dhwd', dot: 'blue_dot', instance: 'ka-dhwd' },
      ] as never,
      { json: true },
    );

    expect(JSON.parse(json)).toEqual(['purple_dot', 'blue_dot/ka-dhwd']);
  });

  test('still prints one per line by default, for a person', () => {
    const text = renderTargetList([{ id: 'purple_dot' }] as never);

    expect(text).toBe('purple_dot\n');
  });
});

describe('coveredTargets', () => {
  test('keeps only targets a journey actually declares', () => {
    // The schemas define five targets; two have journeys. A matrix built
    // from discovery alone boots three stacks that assert nothing, at
    // roughly eight minutes each.
    const covered = coveredTargets(
      [
        { id: 'purple_dot' },
        { id: 'blue_dot/ka-dhwd' },
        { id: 'orange_dot' },
        { id: 'yellow_dot' },
      ] as never,
      [{ targets: ['purple_dot'] }, { targets: ['purple_dot', 'blue_dot/ka-dhwd'] }] as never,
    );

    expect(covered).toEqual(['purple_dot', 'blue_dot/ka-dhwd']);
  });

  test('drops a declared target the schemas do not define', () => {
    // Otherwise a typo in a journey's targets list becomes a matrix job
    // that fails at target resolution, minutes in.
    expect(
      coveredTargets([{ id: 'purple_dot' }] as never, [{ targets: ['purple_dott'] }] as never),
    ).toEqual([]);
  });
});
