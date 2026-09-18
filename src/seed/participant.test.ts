import { describe, expect, test } from 'vitest';
import { mintParticipant } from './participant.js';
import type { KeycloakAdmin } from '../env/keycloak_setup.js';

function fakeAdmin() {
  const calls: { op: string; args: unknown[] }[] = [];
  const admin: KeycloakAdmin = {
    getClients: async () => [],
    updateClient: async () => {},
    createUser: async (...args) => {
      calls.push({ op: 'createUser', args });
      return 'user-uuid';
    },
    setPassword: async (...args) => {
      calls.push({ op: 'setPassword', args });
    },
    addRealmRole: async (...args) => {
      calls.push({ op: 'addRealmRole', args });
    },
    findUsersByEmail: async () => [],
    realmRolesOf: async () => [],
    groupsOf: async () => [],
  };
  return { calls, admin };
}

describe('mintParticipant', () => {
  test('creates the user, sets a password, and assigns a realm role', async () => {
    const { calls, admin } = fakeAdmin();

    await mintParticipant(admin, 'bluedots', {
      username: 'j2-seeker',
      password: 'pw',
      role: 'signals_participant',
    });

    expect(calls.map((c) => c.op)).toEqual([
      'createUser', 'setPassword', 'addRealmRole',
    ]);
  });

  test('assigns the role the API requires, or every call 403s', async () => {
    // KEYCLOAK_REQUIRED_REALM_ROLES defaults to
    // signals_participant,signals_admin. A token without one is rejected on
    // the human path.
    const { calls, admin } = fakeAdmin();

    await mintParticipant(admin, 'bluedots', {
      username: 'j2-seeker',
      password: 'pw',
      role: 'signals_participant',
    });

    const role = calls.find((c) => c.op === 'addRealmRole')!;
    expect(role.args).toContain('signals_participant');
  });

  test('always gives the participant an email', async () => {
    // The realm's user profile marks email required for role `user`, so a
    // user without one is "not fully set up" and Keycloak refuses the
    // password grant. apply-user-profile.sh relaxes that, which made the
    // failure depend on whether the fixup had taken effect yet -- a race
    // rather than a coin flip. Supplying an email holds in both states.
    const { calls, admin } = fakeAdmin();

    await mintParticipant(admin, 'bluedots', {
      username: 'j2-seeker',
      password: 'pw',
      role: 'signals_participant',
    });

    const created = calls.find((c) => c.op === 'createUser')!;
    expect(JSON.stringify(created.args)).toMatch(/@/);
  });

  test('returns the user id so later steps can address the user', async () => {
    const { admin } = fakeAdmin();

    const out = await mintParticipant(admin, 'bluedots', {
      username: 'j2-seeker',
      password: 'pw',
      role: 'signals_participant',
    });

    expect(out.userId).toBe('user-uuid');
  });
});
