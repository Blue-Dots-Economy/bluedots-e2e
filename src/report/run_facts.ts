/**
 * Facts only the running suite knows.
 *
 * The workflow writes provenance.txt before the stack boots, so it can name
 * git commits and image tags but not the digests those tags resolved to,
 * nor anything the harness changed while running. Both are what makes the
 * report evidence rather than a screenshot, so the suite writes them and
 * these readers prefer them over the guesses.
 */
export type RunFacts = {
  digests: Record<string, string>;
  realmMutations: string[];
};

export function imageDigests(
  resolved: Record<string, string> | null,
  provenance: Record<string, string>,
): Record<string, string> {
  if (resolved && Object.keys(resolved).length > 0) return resolved;
  return Object.fromEntries(Object.entries(provenance).filter(([k]) => k.endsWith('_sha')));
}

export function realmMutations(
  recorded: string[] | null,
  provenance: Record<string, string>,
): string[] {
  if (recorded) return recorded;
  const fromProvenance = (provenance.realm_mutations ?? '').split(';').filter(Boolean);
  // An empty list reads as "the harness changed nothing", which is a claim.
  // Nothing recorded it, so the report says that instead.
  return fromProvenance.length > 0 ? fromProvenance : ['(not recorded by this run)'];
}
