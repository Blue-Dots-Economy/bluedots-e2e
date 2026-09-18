import { describe, expect, test } from 'vitest';
import { phoneFromSeed } from './contact_details.js';

describe('phoneFromSeed', () => {
  test('gives two journeys in one run different numbers', () => {
    // The failure this exists for: A2 and B1 both register a coordinator,
    // both sent the same hardcoded number, and the second got
    // PHONE_EXISTS -- which reads as a product refusal rather than two
    // fixtures colliding. The addresses were already seed-derived; the
    // phone was not.
    expect(phoneFromSeed('run-a2', 'coordinator')).not.toBe(
      phoneFromSeed('run-b1', 'coordinator'),
    );
  });

  test('gives two roles in one journey different numbers', () => {
    // An organisation and its coordinator are registered by the same
    // journey, moments apart, and the uniqueness check does not care that
    // they are different kinds of record.
    expect(phoneFromSeed('run-1', 'organisation')).not.toBe(
      phoneFromSeed('run-1', 'coordinator'),
    );
  });

  test('is reproducible, so a replay still replays', () => {
    expect(phoneFromSeed('run-1', 'coordinator')).toBe(phoneFromSeed('run-1', 'coordinator'));
  });

  test('is ten digits starting with a mobile prefix the contact schema accepts', () => {
    // Rejected before the route is reached otherwise, and the failure reads
    // as a malformed request rather than a bad fixture.
    for (const seed of ['a', 'run-1', 'main-blue-dot-ka-dhwd-35323433615-b1']) {
      expect(phoneFromSeed(seed, 'coordinator')).toMatch(/^9\d{9}$/);
    }
  });
});
