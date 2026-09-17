export type SeededService = {
  orgId: string;
  userId: string;
  memberId: string;
  apiKey: string;
};

/**
 * Parse `apps/api/scripts/seed_service_users.ts` output.
 *
 * The harness does not need the script to accept pinned ids: it already
 * prints everything, and its own comment says the raw key is shown once and
 * should be captured then. Reading stdout keeps the harness on the real
 * provisioning path rather than inserting an apikey row itself, which would
 * mean duplicating better-auth's hash scheme here.
 *
 *   aggregator-dpg:
 *     org_id:    org_...
 *     user_id:   usr_...
 *     member_id: mbr_...
 *     apikey:    sk_signals_...
 */
export function parseSeedOutput(stdout: string): Record<string, SeededService> {
  const out: Record<string, SeededService> = {};

  for (const block of stdout.split(/\n(?=\S+:\s*$)/m)) {
    const slug = block.match(/^(\S+):\s*$/m)?.[1];
    if (!slug) continue;

    const field = (name: string) =>
      block.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'm'))?.[1]?.trim();

    const orgId = field('org_id');
    const userId = field('user_id');
    const memberId = field('member_id');
    const apiKey = field('apikey');
    if (!orgId || !userId || !memberId || !apiKey) continue;

    if (!apiKey.startsWith('sk_')) {
      // "(existing — capture from first-run logs…)": the row was already
      // there, so the raw key is unrecoverable. Every search call would 401
      // with nothing pointing at the cause, so stop here instead.
      throw new Error(
        `SEED_FAILED: ${slug} apikey already existed, so no raw key was printed ` +
          `(${apiKey}). The stack must start from a clean volume.`,
      );
    }

    out[slug] = { orgId, userId, memberId, apiKey };
  }

  if (Object.keys(out).length === 0) {
    throw new Error(`SEED_FAILED: no service users in seed output:\n${stdout}`);
  }
  return out;
}
