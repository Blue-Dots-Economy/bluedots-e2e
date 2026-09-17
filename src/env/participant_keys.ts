import { createHash, randomBytes } from 'node:crypto';
import { Client } from 'pg';

/**
 * Authenticate as a participant, not as the aggregator that onboarded them.
 *
 * Three routes read `request.user.id` and act only for the person it names:
 * a self-service `POST /item/create` owns the item it writes,
 * `POST /action/update-status` is self-acted (only the target item's OWNER
 * may accept), and `/action/:id/contact-details` reveals PII only to a
 * participant in that action. A service key + acting org cannot stand in for
 * any of them, so a suite holding only the aggregator's key can exercise the
 * aggregator half of the product and nothing a person does for themselves.
 *
 * The credential is an api-key row bound to the participant's own `user` row,
 * which is what signals-dpg's own integration tests mint for exactly this
 * reason (see apps/api/.../action/__tests__/consent_flow.integration.test.ts).
 * The alternative channel -- the `sid` cookie -- means driving Keycloak's
 * redirect + OTP login from the harness, and the bearer path deliberately
 * REFUSES a human token (AUTH-VULN-03/04), so there is no third door.
 *
 * Nothing about the routes under test changes: `request.user.id` is the
 * participant either way, and every gate (consent, ownership, liveness,
 * reveal status) runs its real check against it.
 */
export type ParticipantKeys = {
  /**
   * An `x-api-key` that authenticates as `userId`.
   *
   * Stable per USER, never per label. Every journey seeds its own
   * participants -- the fixture addresses carry the journey id -- so two
   * scenarios asking for "the seeker" mean two different people, and a
   * credential cached under the role handed the second journey the first
   * journey's identity. The route then answered
   * SOURCE_ITEM_NOT_OWNED_BY_ACTOR, which reads as a product bug.
   */
  issueFor: (userId: string, label: string) => Promise<string>;
};

/** better-auth compares SHA-256(key) base64url, unpadded. See search_api_key. */
const hash = (raw: string) => createHash('sha256').update(raw).digest('base64url');

const PREFIX = 'sk_signals_';

/** Only what this needs from a pg client, so the rules above are testable. */
export type Query = <R>(sql: string, params: unknown[]) => Promise<{ rowCount: number; rows: R[] }>;

export function participantKeys(query: Query): ParticipantKeys {
  // Issued keys, by USER id. The raw key is never readable back out of the
  // table (only its hash is stored), so a second issueFor for the same
  // participant has to return the SAME string rather than mint a second one
  // whose row the ON CONFLICT would then discard -- which would hand back a
  // key the service has never heard of.
  const issued = new Map<string, string>();

  return {
    async issueFor(userId, label) {
      const cached = issued.get(userId);
      if (cached) return cached;

      // The row id is the user's, not the label's. The label only names the
      // row for anyone reading the table.
      const id = `key_journey_${userId}`;

      const raw = `${PREFIX}${label}_${randomBytes(12).toString('hex')}`;

      // Selected FROM "user" rather than naming the id in VALUES: a user row
      // that does not exist would otherwise fail on apikey_user_id_user_id_fk
      // with a constraint name, and the real problem -- this participant has
      // never logged in / was never created locally -- deserves a sentence.
      const res = await query(
        `INSERT INTO "apikey" (id, name, key, user_id, reference_id, config_id,
                               start, prefix, enabled, rate_limit_enabled,
                               created_at, updated_at)
         SELECT $1, $2, $3, u.id, u.id, 'default', $4, $5, true, false, now(), now()
           FROM "user" u
          WHERE u.id = $6
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [id, `journey ${label}`, hash(raw), raw.slice(0, 6), PREFIX, userId],
      );

      if (res.rowCount === 0) {
        const found = await query<{ count: string }>(
          'SELECT count(*) FROM "user" WHERE id = $1',
          [userId],
        );
        if (found.rows[0]?.count === '0') {
          throw new Error(
            `STEP_FAILED: no local user row for "${userId}", so no credential can be ` +
              `issued for them. A self-signed-up person only gets one at first login; ` +
              `an aggregator-onboarded one gets it at onboarding.`,
          );
        }
        throw new Error(
          `STEP_FAILED: an api-key row for "${userId}" already exists from an earlier run ` +
            `and its raw key cannot be read back. Take the stack down and re-run.`,
        );
      }

      issued.set(userId, raw);
      return raw;
    },
  };
}

export function createParticipantKeys(cfg: { postgresUrl: string }): ParticipantKeys & {
  close: () => Promise<void>;
} {
  const pg = new Client({ connectionString: cfg.postgresUrl });
  let connected = false;

  const query: Query = async (sql, params) => {
    if (!connected) {
      await pg.connect();
      connected = true;
    }
    const res = await pg.query(sql, params);
    return { rowCount: res.rowCount ?? 0, rows: res.rows };
  };

  return {
    ...participantKeys(query),
    async close() {
      if (connected) await pg.end();
    },
  };
}
