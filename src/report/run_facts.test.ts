import { describe, expect, test } from 'vitest';
import { imageDigests, realmMutations } from './run_facts.js';

describe('imageDigests', () => {
  test('prefers the digests the run resolved over git SHAs', () => {
    // "Images verified" listed *_sha keys from provenance.txt, which are
    // git commits. Pinning to a digest and then reporting a commit means
    // the evidence sheet names something other than what ran.
    const digests = imageDigests(
      { 'signals-dpg': 'sha256:aaa', 'signals-search': 'sha256:bbb' },
      { signals_dpg_sha: '7958281', target: 'purple_dot' },
    );

    expect(digests).toEqual({ 'signals-dpg': 'sha256:aaa', 'signals-search': 'sha256:bbb' });
  });

  test('falls back to the git SHAs when no run wrote its digests', () => {
    // A report rendered outside a run has nothing better; saying so beats
    // an empty "Images verified" section.
    expect(imageDigests(null, { signals_dpg_sha: '7958281', target: 'x' })).toEqual({
      signals_dpg_sha: '7958281',
    });
  });
});

describe('realmMutations', () => {
  test('reads what the run recorded', () => {
    expect(realmMutations(['enabled direct grants on signals-ui'], {})).toEqual([
      'enabled direct grants on signals-ui',
    ]);
  });

  test('does not claim an untouched realm when nothing was recorded', () => {
    // provenance.realm_mutations was never written by any step, so every
    // report said the realm was untouched while enableDirectGrant always
    // mutates it.
    expect(realmMutations(null, {})).toEqual(['(not recorded by this run)']);
  });

  test('still reads the provenance key when a run supplied one', () => {
    expect(realmMutations(null, { realm_mutations: 'a;b' })).toEqual(['a', 'b']);
  });
});
