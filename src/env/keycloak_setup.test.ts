import { describe, expect, test } from 'vitest';
import { enableDirectGrant, type KeycloakAdmin, type ClientRep } from './keycloak_setup.js';

function fakeAdmin(clients: ClientRep[]) {
  const updates: { id: string; changes: Record<string, unknown> }[] = [];
  const admin: KeycloakAdmin = {
    getClients: async (_realm, clientId) =>
      clients.filter((c) => c.clientId === clientId),
    updateClient: async (_realm, id, changes) => {
      updates.push({ id, changes });
    },
    createUser: async () => 'user-uuid',
    setPassword: async () => {},
    addRealmRole: async () => {},
  findUsersByEmail: async () => [],
  realmRolesOf: async () => [],
  groupsOf: async () => [],
  };
  return { updates, admin };
}

describe('enableDirectGrant', () => {
  test('turns it on for a client that has it disabled', async () => {
    // directAccessGrantsEnabled is false on signals-ui, signals-api,
    // aggregator-dpg and voice-dpg in BOTH realm exports, so the harness
    // cannot obtain a user token without this.
    const { updates, admin } = fakeAdmin([
      { id: 'uuid-1', clientId: 'signals-ui', directAccessGrantsEnabled: false },
    ]);

    await enableDirectGrant(admin, 'bluedots', 'signals-ui');

    expect(updates).toEqual([
      { id: 'uuid-1', changes: { directAccessGrantsEnabled: true } },
    ]);
  });

  test('does nothing when it is already enabled', async () => {
    const { updates, admin } = fakeAdmin([
      { id: 'uuid-1', clientId: 'signals-ui', directAccessGrantsEnabled: true },
    ]);

    expect(await enableDirectGrant(admin, 'bluedots', 'signals-ui')).toBe(false);
    expect(updates).toEqual([]);
  });

  test('fails naming the client when the realm does not have it', async () => {
    const { admin } = fakeAdmin([]);

    await expect(enableDirectGrant(admin, 'bluedots', 'signals-ui')).rejects.toThrow(
      /signals-ui/,
    );
  });

  test('reports that it changed the realm, so the run can record it', async () => {
    const { admin } = fakeAdmin([
      { id: 'uuid-1', clientId: 'signals-ui', directAccessGrantsEnabled: false },
    ]);

    // "The checked-in realm, unmodified" is not achievable. What is
    // achievable is that the mutation is visible rather than silent.
    expect(await enableDirectGrant(admin, 'bluedots', 'signals-ui')).toBe(true);
  });
});
