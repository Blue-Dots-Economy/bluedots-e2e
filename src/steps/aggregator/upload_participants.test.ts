import { describe, expect, test } from 'vitest';
import { buildRow } from './upload_participants.js';

const HEADER = 'name,location,age,phone,languageSpoken,gender';

describe('buildRow', () => {
  test('keeps the header exactly, because the parser matches on it', () => {
    // The columns come from the product's own template, generated from the
    // network's participant schema. Rewriting them is how the sample CSVs
    // that used to ship with the aggregator rotted into files its own
    // parser rejected.
    expect(buildRow(HEADER, { name: 'A' }).split('\n')[0]).toBe(HEADER);
  });

  test('places each value under its own column', () => {
    const [, row] = buildRow(HEADER, { name: 'Asha', age: 30, phone: '9000000001' }).split('\n');

    expect(row!.split(',')).toEqual(['Asha', '', '30', '9000000001', '', '']);
  });

  test('joins an array with the network s delimiter, not a comma', () => {
    // A comma would be read as two columns and shift every field after it,
    // so the row would fail validation on something unrelated.
    const [, row] = buildRow(HEADER, { languageSpoken: ['Assamese', 'Bengali'] }).split('\n');

    expect(row!.split(',')[4]).toBe('Assamese|Bengali');
  });

  test('leaves a column the generator has no value for empty', () => {
    // Which is what an optional column is in a CSV. Inventing a placeholder
    // is how the template s own example row gets refused by signals.
    const [, row] = buildRow(HEADER, {}).split('\n');

    expect(row).toBe(',,,,,');
  });
});
