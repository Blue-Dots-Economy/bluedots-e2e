/** `202609-s1-rc1` — <YYYYMM>-s<sprint>-rc<candidate>. */
const RELEASE_TAG = /^20\d{4}-s\d+-rc\d+$/;
/** What CI publishes for a commit build. */
const COMMIT_TAG = /^sha-[0-9a-f]{7,40}$/i;

export const isReleaseTag = (source: string): boolean => RELEASE_TAG.test(source);

/**
 * What this run was actually verifying, in the words the report prints.
 *
 * A run against a branch is legitimate -- it is how a change is checked
 * before it is cut -- but the report must not describe it as a release.
 * Saying "release 202609-s1-rc1" over images built from `main` would let a
 * candidate be promoted on the result of code that is not in it, which is
 * the same failure as a suite passing without exercising what it names.
 */
export function describeSource(source: string): string {
  if (!source) return 'an unnamed source';
  if (RELEASE_TAG.test(source)) return `release ${source}`;
  if (COMMIT_TAG.test(source)) return `commit ${source}`;
  return `branch ${source}`;
}
