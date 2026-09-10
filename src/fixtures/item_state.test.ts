import { describe, expect, test } from 'vitest';
import { buildItemState } from './item_state.js';

const SCHEMA = {
  required: ['name', 'mobile', 'age', 'gender', 'tags', 'note'],
  properties: {
    name: { type: 'string', minLength: 1 },
    mobile: { type: 'string', pattern: '^[0-9]{10}$' },
    age: { type: 'integer', minimum: 18, maximum: 60 },
    gender: { type: 'string', enum: ['Male', 'Female', 'Other'] },
    tags: { type: 'array', items: { type: 'string', enum: ['A', 'B'] }, minItems: 1 },
    note: { type: 'string', minLength: 1, vectorize: true },
    optional: { type: 'string' },
  },
};

describe('buildItemState', () => {
  test('fills every required field and no others', () => {
    // The route rejects unknown keys with
    // "Invalid item_state: must NOT have additional properties", so a
    // generator that adds a friendly extra field breaks every journey.
    const state = buildItemState(SCHEMA);

    expect(Object.keys(state).sort()).toEqual(
      ['age', 'gender', 'mobile', 'name', 'note', 'tags'],
    );
  });

  test('respects an enum rather than inventing a value', () => {
    const state = buildItemState(SCHEMA);

    expect(SCHEMA.properties.gender.enum).toContain(state.gender);
  });

  test('respects a string pattern', () => {
    const state = buildItemState(SCHEMA);

    expect(String(state.mobile)).toMatch(/^[0-9]{10}$/);
  });

  test('respects numeric bounds', () => {
    const state = buildItemState(SCHEMA);

    expect(state.age).toBeGreaterThanOrEqual(18);
    expect(state.age).toBeLessThanOrEqual(60);
  });

  test('produces a non-empty array honouring its item enum', () => {
    const state = buildItemState(SCHEMA);

    expect(Array.isArray(state.tags)).toBe(true);
    expect((state.tags as string[]).length).toBeGreaterThanOrEqual(1);
    expect(SCHEMA.properties.tags.items.enum).toContain((state.tags as string[])[0]);
  });

  test('is deterministic for a given seed, so a failure can be reproduced', () => {
    expect(buildItemState(SCHEMA, 'seed-1')).toEqual(buildItemState(SCHEMA, 'seed-1'));
  });

  test('gives vectorized fields distinct text per seed', () => {
    // Two profiles that embed identically would make a search assertion
    // ambiguous about which item it matched.
    const a = buildItemState(SCHEMA, 'seed-1');
    const b = buildItemState(SCHEMA, 'seed-2');

    expect(a.note).not.toBe(b.note);
  });

  test('makes every generated string seed-distinct', () => {
    // Search filters target `item_state.<field>`, never item_id, so a
    // journey isolates its own item by matching a generated text value.
    const a = buildItemState(SCHEMA, 'seed-1');
    const b = buildItemState(SCHEMA, 'seed-2');

    expect(a.name).not.toBe(b.name);
  });
});
