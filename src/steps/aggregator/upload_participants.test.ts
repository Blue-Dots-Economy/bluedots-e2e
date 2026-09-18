import { describe, expect, test } from 'vitest';
import { personaliseRow } from './upload_participants.js';

const TEMPLATE = 'name,phone,email,location,age\nAsha Devi,9876543210,asha@example.com,Pune,28\n';

describe('personaliseRow', () => {
  test('makes the identifying columns this run s own, and leaves the rest alone', () => {
    // The row has to be findable afterwards. An unmodified example collides
    // with every other run against the same stack, and the journey would
    // then assert against somebody an earlier run onboarded.
    const [, row] = personaliseRow(TEMPLATE, 'seed1').trim().split('\n');
    const cells = row!.split(',');

    expect(cells[2]).toBe('journey-bulk-seed1@example.test');
    expect(cells[0]).toBe('Journey Bulk seed1');
    // Untouched: the example's own values are valid against the network's
    // schema, and inventing replacements is how a fixture starts failing
    // validation for reasons that have nothing to do with the journey.
    expect(cells[3]).toBe('Pune');
    expect(cells[4]).toBe('28');
  });

  test('keeps the phone digits-only and long enough for the contact schema', () => {
    // Rejected before anything reaches signals otherwise, and the failure
    // reads as a bad row rather than a bad fixture.
    const [, row] = personaliseRow(TEMPLATE, 'ka-dhwd-99').trim().split('\n');
    const phone = row!.split(',')[1]!;

    expect(phone).toMatch(/^\d{10,15}$/);
  });

  test('keeps the header exactly, because the parser matches on it', () => {
    expect(personaliseRow(TEMPLATE, 'x').split('\n')[0]).toBe('name,phone,email,location,age');
  });

  test('refuses a template that carries no example row', () => {
    // The product generates header-plus-example. A header alone means the
    // endpoint changed shape, and building a one-line file from it would
    // upload nothing and still report success.
    expect(() => personaliseRow('name,phone,email\n', 'x')).toThrow(/header plus an example/);
  });
});
