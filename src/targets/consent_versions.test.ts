import { describe, expect, test } from 'vitest';
import { readConsentVersions } from './consent_versions.js';

const DOC = JSON.stringify({
  documents: {
    terms: { current_version: 2, versions: [{ version: 1 }, { version: 2 }] },
    privacy: { current_version: 1 },
    profile_creation: { current_version: 1 },
  },
});

describe('readConsentVersions', () => {
  test('takes the CURRENT version, not the first one published', () => {
    // The ledger stores what it is given, so accepting version 1 of a
    // document now on version 2 records an acceptance of something nobody
    // is being shown.
    expect(readConsentVersions(DOC).versionFor('terms')).toBe(2);
    expect(readConsentVersions(DOC).versionFor('privacy')).toBe(1);
  });

  test('names what the target does declare when a category is missing', () => {
    expect(() => readConsentVersions(DOC).versionFor('marketing')).toThrow(
      /terms, privacy, profile_creation/,
    );
  });
});
