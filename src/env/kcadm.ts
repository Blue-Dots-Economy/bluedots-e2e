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

    async updateClient(realm, id, changes) {
      // -s sets fields directly. kcadm can read a JSON body from stdin, but
      // wiring stdin through `docker compose exec -T` is needless complexity
      // for flipping a boolean.
      const sets = Object.entries(changes).flatMap(([k, v]) => ['-s', `${k}=${v}`]);
      await exec('keycloak', [KCADM, 'update', `clients/${id}`, '-r', realm, ...sets]);
    },
  };
}
