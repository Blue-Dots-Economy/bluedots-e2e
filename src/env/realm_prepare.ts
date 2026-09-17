/** Keycloak's CLIENT.DESCRIPTION column is VARCHAR(255). */
export const KEYCLOAK_DESCRIPTION_LIMIT = 255;

type Realm = Record<string, unknown>;

/**
 * Make a realm export importable, reporting anything it had to change.
 *
 * aggregator-dpg's export currently carries a 343-character description on
 * the campaign-manager client (added in aggregator-dpg#692/#696), which
 * exceeds Keycloak's column and fails the whole import with:
 *
 *   Value too long for column "DESCRIPTION CHARACTER VARYING(255)"
 *
 * That is a defect in the export rather than something to work around
 * quietly, so the fix is applied here and surfaced as a realm mutation.
 * When the export is corrected upstream this becomes a no-op and stops
 * appearing in the report.
 */
export function prepareRealm(input: Realm): { realm: Realm; mutations: string[] } {
  const realm = structuredClone(input);
  const mutations: string[] = [];

  const clients = realm.clients;
  if (Array.isArray(clients)) {
    for (const client of clients as { clientId?: string; description?: string }[]) {
      const description = client.description;
      if (typeof description === 'string' && description.length > KEYCLOAK_DESCRIPTION_LIMIT) {
        mutations.push(
          `truncated ${client.clientId} description from ${description.length} to ` +
            `${KEYCLOAK_DESCRIPTION_LIMIT} chars (Keycloak column limit)`,
        );
        client.description = description.slice(0, KEYCLOAK_DESCRIPTION_LIMIT);
      }
    }
  }

  return { realm, mutations };
}
