import { describe, expect, test } from 'vitest';
import { describeSource, isReleaseTag } from './source_label.js';

describe('describeSource', () => {
  test('calls a release candidate a release', () => {
    expect(describeSource('202609-s1-rc1')).toBe('release 202609-s1-rc1');
    expect(isReleaseTag('202609-s1-rc1')).toBe(true);
  });

  test('calls a branch a branch, so a run cannot claim to have verified a release', () => {
    // The whole point. A branch run boots that branch's images; a report
    // saying "release X" over them would promote a candidate on the result
    // of code that is not in it.
    expect(describeSource('main')).toBe('branch main');
    expect(describeSource('feat/something')).toBe('branch feat/something');
    expect(isReleaseTag('main')).toBe(false);
  });

  test('names a commit for what it is', () => {
    expect(describeSource('sha-76ed014')).toBe('commit sha-76ed014');
  });

  test('says so rather than rendering an empty headline', () => {
    expect(describeSource('')).toBe('an unnamed source');
  });
});
