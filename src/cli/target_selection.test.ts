import { describe, expect, test } from 'vitest';
import { renderTargetList, resolveSelection } from './target_selection.js';
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
