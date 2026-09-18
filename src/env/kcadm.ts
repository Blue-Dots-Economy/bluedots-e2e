import type { ClientRep, KeycloakAdmin } from './keycloak_setup.js';

const KCADM = '/opt/keycloak/bin/kcadm.sh';

/** Runs a command inside a compose service and returns stdout. */
export type Exec = (service: string, command: readonly string[]) => Promise<string>;

/**
 * Keycloak admin access via kcadm inside the container.
 *
 * Not an HTTP client on purpose. Keycloak refuses admin calls from a
 * non-local address with `403 HTTPS required`, and the harness runs on the
 * host while Keycloak sees the docker gateway address. kcadm talks to
 * localhost from inside the container, so the request is local and allowed --
 * the same reason the base compose's keycloak-init sidecar works.
 *
 * The login writes a session into the container, so later calls reuse it.
 */
export async function createKcadmAdmin(
  exec: Exec,
  creds: { username: string; password: string },
): Promise<KeycloakAdmin> {
  await exec('keycloak', [
    KCADM, 'config', 'credentials',
    '--server', 'http://localhost:8080',
    '--realm', 'master',
    '--user', creds.username,
    '--password', creds.password,
  ]);

  return {
    async getClients(realm, clientId) {
      const out = await exec('keycloak', [
        KCADM, 'get', 'clients', '-r', realm, '-q', `clientId=${clientId}`,
      ]);
      return JSON.parse(out || '[]') as ClientRep[];
    },

    async findUsersByEmail(realm, email) {
      // `exact=true`, or Keycloak treats the query as a prefix search and a
      // second run's address matches the first run's user.
      const out = await exec('keycloak', [
        KCADM, 'get', 'users', '-r', realm, '-q', `email=${email}`, '-q', 'exact=true',
      ]);
      return JSON.parse(out || '[]') as { id: string; email?: string; enabled?: boolean }[];
    },

    async realmRolesOf(realm, userId) {
      const out = await exec('keycloak', [
        KCADM, 'get', `users/${userId}/role-mappings/realm`, '-r', realm,
      ]);
      return (JSON.parse(out || '[]') as { name?: string }[])
        .map((r) => String(r.name ?? ''))
        .filter(Boolean);
    },

    async groupsOf(realm, userId) {
      const out = await exec('keycloak', [KCADM, 'get', `users/${userId}/groups`, '-r', realm]);
      return (JSON.parse(out || '[]') as { path?: string; name?: string }[])
        .map((g) => String(g.path ?? g.name ?? ''))
        .filter(Boolean);
    },

    async markReadyToSignIn(realm, userId) {
      await exec('keycloak', [
        KCADM, 'update', `users/${userId}`, '-r', realm,
        '-s', 'enabled=true',
        '-s', 'emailVerified=true',
        // A pending action is evaluated at AUTHENTICATION time, so one left
        // over from signup interrupts the login rather than the account.
        '-s', 'requiredActions=[]',
      ]);
    },

    async createUser(realm, user) {
      // kcadm prints "Created new user with id 'uuid'" on stderr-ish output;
      // `-i` makes it print just the id, which is what we need.
      const out = await exec('keycloak', [
        KCADM, 'create', 'users', '-r', realm,
        '-s', `username=${user.username}`,
        '-s', 'enabled=true',
        // Explicitly nothing pending. A user can pick up required actions
        // from realm defaults or a user profile that has not settled, and
        // Keycloak then refuses the password grant with
        // `invalid_grant: Account is not fully set up` -- intermittently,
        // which is worse than never.
        '-s', 'requiredActions=[]',
        '-s', 'emailVerified=true',
        // firstName/lastName are not decoration. Keycloak evaluates
        // VERIFY_PROFILE at AUTHENTICATION time rather than storing it on
        // the user, so a profile missing them fails the password grant with
        // `invalid_grant: Account is not fully set up` while the user record
        // still reads requiredActions: [] and looks perfectly healthy.
        // Verified directly: adding these two fields turns that exact
        // failure into a token.
        '-s', `firstName=${user.firstName ?? 'Journey'}`,
        '-s', `lastName=${user.lastName ?? 'Participant'}`,
        ...(user.email ? ['-s', `email=${user.email}`] : []),
        '-i',
      ]);
      return out.trim();
    },

    async setPassword(realm, userId, password) {
      // No --temporary. kcadm's -t is a boolean SWITCH, not a flag taking
      // a value -- `-t false` fails with "Unmatched argument ... 'false'".
      // Omitting it gives a permanent password, which is what is wanted: a
      // temporary one is itself a required action (UPDATE_PASSWORD) and
      // would reintroduce `Account is not fully set up` by another route.
      await exec('keycloak', [
        KCADM, 'set-password', '-r', realm,
        '--userid', userId, '--new-password', password,
      ]);
    },

    async addRealmRole(realm, userId, role) {
      // --uid takes the user id; --uusername takes a username, and passing
      // an id to it fails with "User not found for username: <uuid>".
      await exec('keycloak', [
        KCADM, 'add-roles', '-r', realm,
        '--uid', userId, '--rolename', role,
      ]);
    },

    async updateClient(realm, id, changes) {
      // -s sets fields directly. kcadm can read a JSON body from stdin, but
      // wiring stdin through `docker compose exec -T` is needless complexity
      // for flipping a boolean.
      const sets = Object.entries(changes).flatMap(([k, v]) => ['-s', `${k}=${v}`]);
      await exec('keycloak', [KCADM, 'update', `clients/${id}`, '-r', realm, ...sets]);
    },
  };
}
