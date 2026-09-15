import { createHash } from 'node:crypto';

/**
 * The key signals-api presents when it calls signals-search.
 *
 * Fixed, because it has to be in the container's environment at boot while
 * the apikey row can only exist after seeding -- and signals-api does not
 * use it until the first discover request, which is long after both. A
 * random key would mean restarting signals-api mid-run to hand it one.
 */
export const SEARCH_CALLER_API_KEY = 'sk_signals_journey_search_caller';

/**
 * better-auth stores SHA-256(key) base64url-encoded without padding and
 * compares the hash at verify time, and signals-search reads that same
 * column. Node's base64url digest is unpadded by default, which matches.
 */
export const hashApiKey = (raw: string) => createHash('sha256').update(raw).digest('base64url');

/**
 * Grant signals-api a key signals-search will accept.
 *
 * Without one the API logs "signals-search is not configured" at level 40
 * and the discover BFF silently falls back to a native distance/recency
 * query -- so the browse-feed journeys passed while never crossing into
 * signals-search at all. Green, and proving less than they claimed.
 */
export async function grantSearchCallerKey(deps: {
  exec: (service: string, command: readonly string[]) => Promise<string>;
  /** The service user the key belongs to; any valid user works. */
  userId: string;
}): Promise<void> {
  const hashed = hashApiKey(SEARCH_CALLER_API_KEY);
  const sql = `
    INSERT INTO "apikey" (id, name, key, user_id, reference_id, config_id,
                          start, prefix, enabled, rate_limit_enabled,
                          created_at, updated_at)
    VALUES ('key_journey_search_caller', 'journey search caller', '${hashed}',
            '${deps.userId}', '${deps.userId}', 'default',
            '${SEARCH_CALLER_API_KEY.slice(0, 6)}', 'sk_signals_', true, false,
            now(), now())
    ON CONFLICT (id) DO NOTHING;`;

  const out = await deps.exec('postgres', [
    'psql', '-U', 'postgres', '-d', 'postgresdb', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ]);

  if (!/INSERT|^$/m.test(out)) {
    throw new Error(
      `SEED_FAILED: could not grant the search caller key. psql said: ${out.trim()}`,
    );
  }
}
