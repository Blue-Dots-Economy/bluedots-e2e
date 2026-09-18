/**
 * A client-credentials token, for the calls a SERVICE makes.
 *
 * Distinct from obtainUserToken, which runs a password grant for a person.
 * The two are not interchangeable at either end of the fleet: signals
 * refuses a human bearer token outright (AUTH-VULN-03/04) and resolves a
 * service one to an organisation by its client id, while the aggregator
 * checks `azp` against an allow-list and treats a token with no
 * `aggregator_id` claim as a service principal rather than a user.
 *
 * Registration is reached this way for a real reason: the applicant is
 * anonymous, so aggregator-dpg's own BFF attaches an `aggregator-bff`
 * service token on their behalf. This mirrors that, rather than inventing
 * a credential the product does not use.
 */
export async function obtainServiceToken(
  client: { baseUrl: string; realm: string; clientId: string; clientSecret: string },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });

  const res = await fetcher(
    `${client.baseUrl}/realms/${client.realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );

  if (!res.ok) {
    // A 401 here has four causes -- wrong secret, service accounts not
    // enabled on the client, the client absent from the realm, the realm
    // name wrong -- and only the body tells them apart.
    throw new Error(
      `SEED_FAILED: client-credentials token for "${client.clientId}" ${res.status} ` +
        `${await res.text()}`,
    );
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error(
      `SEED_FAILED: the token response for "${client.clientId}" carried no access_token.`,
    );
  }
  return json.access_token;
}
