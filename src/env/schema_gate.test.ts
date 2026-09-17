import { describe, expect, test } from 'vitest';
import { REQUIRED_RELATIONS, assertSchemaReady } from './schema_gate.js';

describe('assertSchemaReady', () => {
  test('passes when every relation the journeys read exists', async () => {
    const present = new Set<string>(REQUIRED_RELATIONS);
    const lookup = async (rel: string) => present.has(rel);

    await expect(assertSchemaReady(lookup)).resolves.toBeUndefined();
  });

  test('fails naming what is missing, not just that something is', async () => {
    // "migrations failed" sends the reader to the bootstrap logs. Naming the
    // relation says whether drizzle-kit push ran, or db:init did not.
    const lookup = async (rel: string) => rel !== 'item_search';

    await expect(assertSchemaReady(lookup)).rejects.toThrow(/item_search/);
  });

  test('uses its own error code, distinct from a stack that would not boot', async () => {
    const lookup = async () => false;

    // A stack that came up but has no schema is a different failure from a
    // stack that never came up, and the run should say which.
    await expect(assertSchemaReady(lookup)).rejects.toThrow(/MIGRATIONS_INCOMPLETE/);
  });

  test('requires item_search, which signals-dpg owns and signals-search asserts', async () => {
    // signals-search fails at boot without it, but RUN_MIGRATIONS is false
    // there because the DDL belongs to signals-dpg's db:init.
    expect(REQUIRED_RELATIONS).toContain('item_search');
  });

  test('requires apikey, which is how search authenticates at all', async () => {
    expect(REQUIRED_RELATIONS).toContain('apikey');
  });
});
