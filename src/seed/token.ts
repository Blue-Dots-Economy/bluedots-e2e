/**
 * Obtain a user token by password grant.
 *
 * Unlike the admin calls, this can go over plain HTTP from the host: the
 * bluedots realm sets `sslRequired: none`, where the master realm defaults to
 * `external` and rejects non-local HTTP with `403 HTTPS required`.
 */
export async function obtainUserToken(
  realm: { baseUrl: string; realm: string; clientId: string; clientSecret?: string },
  user: { username: string; password: string },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: realm.clientId,
    username: user.username,
    password: user.password,
    ...(realm.clientSecret ? { client_secret: realm.clientSecret } : {}),
  });

  const res = await fetcher(
    `${realm.baseUrl}/realms/${realm.realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );

  if (!res.ok) {
    // A 401 here has several causes -- direct grant still disabled, a wrong
    // client secret, a missing realm role -- and only the body distinguishes
    // them.
    throw new Error(`SEED_FAILED: token ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}
