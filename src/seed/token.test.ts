import { describe, expect, test } from 'vitest';
import { obtainUserToken } from './token.js';

describe('obtainUserToken', () => {
  test('uses the password grant against the realm token endpoint', async () => {
    let seen: { url: string; body: string } | null = null;
    const fetcher = async (url: string, init: { body: string }) => {
      seen = { url, body: init.body };
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
    };

    await obtainUserToken(
      { baseUrl: 'http://localhost:55018', realm: 'bluedots', clientId: 'signals-ui' },
      { username: 'j2', password: 'pw' },
      fetcher as never,
    );

    expect(seen!.url).toContain('/realms/bluedots/protocol/openid-connect/token');
    expect(seen!.body).toContain('grant_type=password');
  });

  test('returns the access token', async () => {
    const fetcher = async () => ({
      ok: true, status: 200, json: async () => ({ access_token: 'tok-123' }),
    });

    const token = await obtainUserToken(
      { baseUrl: 'http://x', realm: 'bluedots', clientId: 'signals-ui' },
      { username: 'j2', password: 'pw' },
      fetcher as never,
    );

    expect(token).toBe('tok-123');
  });

  test('fails with the response body, since 401 here has several causes', async () => {
    // Could be direct grant still disabled, a wrong client secret, or a
    // missing realm role. The body distinguishes them; a bare status does not.
    const fetcher = async () => ({
      ok: false, status: 401, text: async () => 'invalid_client',
    });

    await expect(
      obtainUserToken(
        { baseUrl: 'http://x', realm: 'bluedots', clientId: 'signals-ui' },
        { username: 'j2', password: 'pw' },
        fetcher as never,
      ),
    ).rejects.toThrow(/invalid_client/);
  });
});
