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
}): Promise<void> {
  const hashed = hashApiKey(SEARCH_CALLER_API_KEY);
  // The owner is SELECTed from the service key that already exists rather
  // than named. The participant's id is a Keycloak subject and has no row
  // in signals-dpg's `user` table, so naming it violated
  // apikey_user_id_user_id_fk and took the whole boot down -- correctly
  // reported as a harness failure, but a boot nonetheless.
  const sql = `
    INSERT INTO "apikey" (id, name, key, user_id, reference_id, config_id,
                          start, prefix, enabled, rate_limit_enabled,
                          created_at, updated_at)
    SELECT 'key_journey_search_caller', 'journey search caller', '${hashed}',
           a.user_id, a.user_id, 'default',
           '${SEARCH_CALLER_API_KEY.slice(0, 6)}', 'sk_signals_', true, false,
           now(), now()
      FROM "apikey" a
     WHERE a.prefix = 'sk_signals_' AND a.user_id IS NOT NULL
     LIMIT 1
    ON CONFLICT (id) DO NOTHING;`;

  const out = await deps.exec('postgres', [
    'psql', '-U', 'postgres', '-d', 'postgresdb', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ]);

  // INSERT 0 0 means the SELECT matched nothing: no service key exists, so
  // signals-api would call signals-search with a key nobody knows and the
  // BFF would fall back silently -- the exact failure this grant prevents.
  if (/INSERT 0 0/.test(out)) {
    throw new Error(
      'SEED_FAILED: no existing service apikey to hang the search caller key on, so ' +
        'signals-api cannot authenticate to signals-search and the discover BFF will ' +
        'fall back to its native query without saying so.',
    );
  }
  if (!/INSERT/.test(out)) {
    throw new Error(
      `SEED_FAILED: could not grant the search caller key. psql said: ${out.trim()}`,
    );
  }
}
