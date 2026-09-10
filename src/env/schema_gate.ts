/**
 * Relations a journey run depends on, all created by signals-dpg's bootstrap
 * (`drizzle-kit push --force` then `db:init`).
 *
 * `item_search` is the one worth calling out: signals-search refuses to boot
 * without it (`assertSchemaReady` in its own migrate step), yet the DDL
 * belongs to signals-dpg, which is why signals-search runs with
 * RUN_MIGRATIONS=false.
 */
export const REQUIRED_RELATIONS = [
  'items',
  'item_search',
  'apikey',
  'user',
] as const;

export type RelationLookup = (relation: string) => Promise<boolean>;

/**
 * Gate phase 2 on the schema actually being present.
 *
 * The bootstrap container exiting 0 is only a proxy: a changed command could
 * exit 0 having created nothing, and every later failure would then look like
 * an application bug. This asserts the thing itself.
 */
export async function assertSchemaReady(lookup: RelationLookup): Promise<void> {
  const missing: string[] = [];
  for (const relation of REQUIRED_RELATIONS) {
    if (!(await lookup(relation))) missing.push(relation);
  }

  if (missing.length > 0) {
    // Distinct from STACK_UNHEALTHY: the stack came up, the schema did not.
    // Naming the relations says whether drizzle-kit push ran but db:init did
    // not, or neither did.
    throw new Error(`MIGRATIONS_INCOMPLETE: missing ${missing.join(', ')}`);
  }
}
