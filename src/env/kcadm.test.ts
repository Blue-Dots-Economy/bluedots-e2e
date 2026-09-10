import { describe, expect, test } from 'vitest';
import { createKcadmAdmin } from './kcadm.js';

describe('createKcadmAdmin', () => {
  test('logs in against localhost inside the container', async () => {
    // From the host Keycloak sees the docker gateway and answers
    // `403 HTTPS required`. Inside the container the call is local and allowed.
    const calls: string[][] = [];
    const exec = async (_s: string, cmd: readonly string[]) => {
      calls.push([...cmd]);
      return '[]';
    };

    await createKcadmAdmin(exec, { username: 'admin', password: 'admin' });

    const login = calls[0]!;
    expect(login).toContain('--server');
    expect(login).toContain('http://localhost:8080');
  });

  test('queries a client by clientId', async () => {
    const calls: string[][] = [];
    const exec = async (_s: string, cmd: readonly string[]) => {
      calls.push([...cmd]);
      return JSON.stringify([{ id: 'u1', clientId: 'signals-ui' }]);
    };
    const admin = await createKcadmAdmin(exec, { username: 'a', password: 'b' });

    const out = await admin.getClients('bluedots', 'signals-ui');

    expect(out[0]!.id).toBe('u1');
    expect(calls.at(-1)).toContain('clientId=signals-ui');
  });

  test('updates a client with -s, avoiding stdin', async () => {
    // kcadm can read a JSON body from stdin, but `docker compose exec -T`
    // makes that awkward to wire; -s sets fields directly.
    const calls: string[][] = [];
    const exec = async (_s: string, cmd: readonly string[]) => {
      calls.push([...cmd]);
      return '';
    };
    const admin = await createKcadmAdmin(exec, { username: 'a', password: 'b' });

    await admin.updateClient('bluedots', 'u1', { directAccessGrantsEnabled: true });

    const update = calls.at(-1)!;
    expect(update).toContain('clients/u1');
    expect(update).toContain('directAccessGrantsEnabled=true');
  });
});

describe('createKcadmAdmin user operations', () => {
  test('creates a user and returns the id kcadm prints', async () => {
    const exec = async (_s: string, cmd: readonly string[]) =>
      cmd.includes('users') ? 'user-uuid-123\n' : '';
    const admin = await createKcadmAdmin(exec, { username: 'a', password: 'b' });

    expect(await admin.createUser('bluedots', { username: 'j2' })).toBe('user-uuid-123');
  });

  test('asks kcadm for just the id, not a success sentence', async () => {
    const calls: string[][] = [];
    const exec = async (_s: string, cmd: readonly string[]) => {
      calls.push([...cmd]);
      return 'id\n';
    };
    const admin = await createKcadmAdmin(exec, { username: 'a', password: 'b' });

    await admin.createUser('bluedots', { username: 'j2' });

    expect(calls.at(-1)).toContain('-i');
  });

  test('assigns a realm role by name', async () => {
    const calls: string[][] = [];
    const exec = async (_s: string, cmd: readonly string[]) => {
      calls.push([...cmd]);
      return '';
    };
    const admin = await createKcadmAdmin(exec, { username: 'a', password: 'b' });

    await admin.addRealmRole('bluedots', 'user-uuid', 'signals_participant');

    expect(calls.at(-1)).toContain('--rolename');
    expect(calls.at(-1)).toContain('signals_participant');
    // --uid takes an id; --uusername takes a username and fails with
    // "User not found for username: <uuid>" when given one.
    expect(calls.at(-1)).toContain('--uid');
    expect(calls.at(-1)).not.toContain('--uusername');
  });
});
