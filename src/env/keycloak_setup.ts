export type ClientRep = {
  id: string;
  clientId: string;
  directAccessGrantsEnabled?: boolean;
};

/**
 * The slice of Keycloak's admin surface the harness needs.
 *
 * Deliberately narrow, and deliberately not an HTTP client: Keycloak rejects
 * admin calls from a non-local address with `403 HTTPS required`, and the
 * harness runs on the host while Keycloak sees the docker gateway. Calls go
 * through kcadm inside the container instead, where they are local.
 */
export type KeycloakAdmin = {
  getClients: (realm: string, clientId: string) => Promise<ClientRep[]>;
  updateClient: (
    realm: string,
    id: string,
    changes: Record<string, string | boolean>,
  ) => Promise<void>;
  /** Create an enabled user and return its id. */
  createUser: (
    realm: string,
    user: { username: string; email?: string },
  ) => Promise<string>;
  setPassword: (realm: string, userId: string, password: string) => Promise<void>;
  addRealmRole: (realm: string, userId: string, role: string) => Promise<void>;
};

/**
 * Enable the direct access grant on one client.
 *
 * `directAccessGrantsEnabled` is false for signals-ui, signals-api,
 * aggregator-dpg and voice-dpg in BOTH realm exports -- the only
 * direct-grant client anywhere is campaign-manager, which is excluded from
 * KEYCLOAK_ACCEPTED_CLIENT_IDS and so is rejected on the human path anyway.
 * Without this the harness cannot obtain a user token at all.
 *
 * This mutates the imported realm, and the design owns that rather than
 * pretending otherwise: "the checked-in realm, unmodified" is not
 * achievable. What is preserved is the property that matters -- the service
 * still runs its genuine authorization check against a real token, and no
 * test-only branch exists in product code. The return value lets the run
 * report say what changed.
 */
export async function enableDirectGrant(
  admin: KeycloakAdmin,
  realm: string,
  clientId: string,
): Promise<boolean> {
  const clients = await admin.getClients(realm, clientId);
  const client = clients.find((c) => c.clientId === clientId);

  if (!client) {
    throw new Error(`Client "${clientId}" is not in realm "${realm}".`);
  }
  if (client.directAccessGrantsEnabled === true) return false;

  await admin.updateClient(realm, client.id, { directAccessGrantsEnabled: true });
  return true;
}
