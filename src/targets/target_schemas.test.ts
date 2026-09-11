import { describe, expect, test } from 'vitest';
import { buildTargetSchemas } from './target_schemas.js';

const CONFIG = {
  id: 'purple_dot',
  domains: [
    { id: 'seeker', item_schemas: { 'profile_1.0': { properties: { beneficiary_name: {} } } } },
    { id: 'provider', item_schemas: { 'offer_1.0': { properties: { org_name: {} } } } },
  ],
};

describe('buildTargetSchemas', () => {
  test('resolves the schema for whichever domain a step acts as', () => {
    // A step says `as: 'provider'`; the fixture it builds has to come from
    // the provider schema. Carrying one domain's schema on the context sent
    // seeker fields to the provider domain, which signals-dpg rejects with
    // "must NOT have additional properties" -- an error pointing at the
    // generator rather than at the mismatch.
    const target = buildTargetSchemas(CONFIG);

    expect(target.schemaFor('provider').itemType).toBe('offer_1.0');
    expect(Object.keys(target.schemaFor('provider').itemSchema.properties ?? {})).toEqual([
      'org_name',
    ]);
  });

  test('names the domains it does serve when asked for one it does not', () => {
    const target = buildTargetSchemas(CONFIG);

    expect(() => target.schemaFor('student')).toThrow(/student.*seeker, provider/s);
  });

  test('lists the domains, so a journey can be selected against them', () => {
    expect(buildTargetSchemas(CONFIG).domains).toEqual(['seeker', 'provider']);
  });

  test('refuses a domain that declares no item schema', () => {
    // Object.keys(...)[0] on an empty map yielded undefined and the failure
    // surfaced much later, as a create with item_type undefined.
    const target = buildTargetSchemas({
      id: 'x',
      domains: [{ id: 'seeker', item_schemas: {} }],
    });

    expect(() => target.schemaFor('seeker')).toThrow(/no item schema/i);
  });
});
