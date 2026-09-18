import { describe, expect, test } from 'vitest';
import { obtainServiceToken } from './service_token.js';

const realm = { baseUrl: 'http://kc', realm: 'bluedots' };

describe('obtainServiceToken', () => {
  test('asks for a client-credentials grant, not a password one', async () => {
    let sent = '';
    const fetcher = (async (_url: string, init?: RequestInit) => {
      sent = String(init?.body);
      return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    }) as unknown as typeof fetch;

    const token = await obtainServiceToken(
      { ...realm, clientId: 'aggregator-bff', clientSecret: 'shh' },
      fetcher,
    );

    expect(token).toBe('tok');
    const form = new URLSearchParams(sent);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe('aggregator-bff');
    expect(form.get('client_secret')).toBe('shh');
    // A human grant carries these; a service one must not, or the token
    // comes back with a `sub` for a person and the callee reads it as one.
    expect(form.get('username')).toBeNull();
  });

  test('reports the body, because 401 alone does not say which of four causes', async () => {
    const fetcher = (async () =>
      new Response('{"error":"unauthorized_client"}', { status: 401 })) as unknown as typeof fetch;

    await expect(
      obtainServiceToken({ ...realm, clientId: 'aggregator-bff', clientSecret: 'wrong' }, fetcher),
    ).rejects.toThrow(/unauthorized_client/);
  });
});
