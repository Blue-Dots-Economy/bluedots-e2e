import { describe, expect, test } from 'vitest';
import { parseArgs } from './args.js';

describe('parseArgs', () => {
  test('takes a dot and instance as separate flags', () => {
    const a = parseArgs(['--dot', 'blue_dot', '--instance', 'ka-dhwd']);

    expect(a.dot).toBe('blue_dot');
    expect(a.instance).toBe('ka-dhwd');
  });

  test('accepts dot/instance shorthand in --dot', () => {
    const a = parseArgs(['--dot', 'blue_dot/ka-dhwd']);

    expect(a.dot).toBe('blue_dot');
    expect(a.instance).toBe('ka-dhwd');
  });

  test('reads a bare branch as applying to every service', () => {
    const a = parseArgs(['--branch', 'feat/x']);

    expect(a.branch).toEqual({ __all__: 'feat/x' });
  });

  test('reads service=branch pairs, leaving other services alone', () => {
    const a = parseArgs(['--branch', 'signals-dpg=feat/x,signals-search=feat/y']);

    expect(a.branch).toEqual({ 'signals-dpg': 'feat/x', 'signals-search': 'feat/y' });
  });

  test('rejects --branch and --images-from-tag together', () => {
    expect(() => parseArgs(['--branch', 'feat/x', '--images-from-tag', '202608-s2-rc1']))
      .toThrow(/--branch/);
  });

  test('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parseArgs(['--dott', 'blue_dot'])).toThrow(/--dott/);
  });

  test('defaults env to local and list to false', () => {
    const a = parseArgs([]);

    expect(a.env).toBe('local');
    expect(a.list).toBe(false);
  });
});

test('refuses to swallow a flag as another flag\'s value', () => {
  // `journey --dot --list` set dot to "--list" and dropped the flag: the
  // run then looked for a target called "--list" and never listed anything.
  expect(() => parseArgs(['--dot', '--list'])).toThrow(/needs a value/i);
});
