import { describe, expect, test } from 'vitest';
import { CAPABILITIES, checkLabel, checkCapabilitySlug } from './guards.js';

describe('checkLabel', () => {
  test('accepts a label that reads as prose', () => {
    expect(checkLabel('Created a seeker profile').ok).toBe(true);
  });

  test('rejects a label containing a route path', () => {
    // The label IS the line the report prints. A route path in it makes the
    // business-facing report unreadable to the people it is for.
    const r = checkLabel('POST /api/v1/admin/participant');

    expect(r.ok).toBe(false);
  });

  test('rejects a label naming a service', () => {
    expect(checkLabel('Wait for signals-search to index').ok).toBe(false);
  });

  test('rejects a label containing an identifier', () => {
    expect(checkLabel('Set item_state to live').ok).toBe(false);
  });

  test('explains why, so the failure is actionable in review', () => {
    const r = checkLabel('POST /v1/search');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/route path/i);
  });
});

describe('checkCapabilitySlug', () => {
  test('accepts one of the five declared capabilities', () => {
    expect(checkCapabilitySlug('search-and-discovery').ok).toBe(true);
    expect(CAPABILITIES).toHaveLength(5);
  });

  test('rejects an undeclared capability so the taxonomy stays closed', () => {
    // The evidence sheet groups by capability. An open set means the report
    // grows categories nobody agreed to.
    const r = checkCapabilitySlug('misc');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/search-and-discovery/);
  });
});
