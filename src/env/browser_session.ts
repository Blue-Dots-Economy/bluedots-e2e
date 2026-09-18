/**
 * Signing in the way a person does.
 *
 * signals refuses a human bearer token however valid it is (AUTH-VULN-03/04)
 * -- a browser session is the `sid` cookie and nothing else -- so a journey
 * where somebody acts for themselves has to complete the real
 * authorization-code flow: the API redirects to Keycloak, Keycloak
 * authenticates, the API exchanges the code server-side and sets an opaque
 * cookie. The browser never holds a token, and neither does this.
 *
 * That is also what PROVISIONS them: the local `user` row appears at first
 * login, keyed on the Keycloak `sub`. A self-signed-up person does not exist
 * in signals until they sign in once.
 */

/** Only what the flow needs: names to values, last write winning. */
export class CookieJar {
  private readonly values = new Map<string, string>();

  /** Takes raw `set-cookie` header values and keeps only the pairs. */
  absorb(setCookies: readonly string[]): void {
    for (const raw of setCookies) {
      // Everything after the first `;` is attributes -- Path, HttpOnly,
      // Max-Age. Sending those back as cookies confuses Keycloak's session
      // lookup rather than failing loudly.
      const [pair] = raw.split(';');
      const eq = pair?.indexOf('=') ?? -1;
      if (!pair || eq <= 0) continue;
      this.values.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  get(name: string): string | undefined {
    return this.values.get(name);
  }

  header(): string {
    return [...this.values].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

/**
 * Where Keycloak's login page posts to.
 *
 * Keycloak serves its error pages with a 200, so a missing form is the only
 * signal that the flow landed somewhere unexpected -- an expired page, a
 * required action, a realm that does not know this client.
 */
export function loginFormAction(html: string): string {
  const match = html.match(/<form[^>]*\saction="([^"]+)"/i);
  if (!match?.[1]) {
    throw new Error(
      `LOGIN_FAILED: no login form on the page Keycloak served, so there is nothing to ` +
        `submit credentials to. It answers 200 for its error pages too, and this one ` +
        `said: ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)}`,
    );
  }
  // The action is a URL inside an HTML attribute, so its query separators
  // arrive as &amp;. Posting it verbatim drops every parameter after the
  // first and Keycloak answers "page expired".
  return match[1].replace(/&amp;/g, '&');
}

export type BrowserSession = {
  /** The Cookie header every later request sends. */
  cookie: string;
  /** Sent back as `x-csrf-token`; the API requires it on writes. */
  csrfToken: string;
};

/** Follows one redirect at a time, so every Set-Cookie on the way is kept. */
async function hop(
  fetcher: typeof fetch,
  url: string,
  jar: CookieJar,
  init: RequestInit = {},
): Promise<{ status: number; location: string | null; body: string; url: string }> {
  const res = await fetcher(url, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers ?? {}), ...(jar.header() ? { cookie: jar.header() } : {}) },
  });
  // getSetCookie keeps them separate; a joined header cannot be split on
  // commas without breaking Expires dates.
  jar.absorb(res.headers.getSetCookie?.() ?? []);
  const location = res.headers.get('location');
  return {
    status: res.status,
    location: location ? new URL(location, url).toString() : null,
    body: location ? '' : await res.text(),
    url,
  };
}

/**
 * Complete a real sign-in and return the session it opened.
 *
 * Deliberately NOT a password grant. Keycloak would happily mint a token
 * for these credentials, and signals would refuse it -- the refusal is the
 * product's, and going around it would mean the journey proves something
 * the service does not allow.
 */
export async function signInThroughTheFrontDoor(opts: {
  signalsApi: string;
  username: string;
  password: string;
  fetcher?: typeof fetch;
}): Promise<BrowserSession> {
  const fetcher = opts.fetcher ?? fetch;
  const jar = new CookieJar();

  // 1. The API starts the flow and hands back a Keycloak authorize URL,
  //    setting the flow cookie that binds this browser to the exchange.
  const started = await hop(fetcher, `${opts.signalsApi}/api/v1/auth/session/login`, jar);
  if (!started.location) {
    throw new Error(
      `LOGIN_FAILED: the login route answered ${started.status} instead of redirecting to the ` +
        `identity provider. A 404 here means this instance is not running the Keycloak ` +
        `provider at all.`,
    );
  }

  // 2. Keycloak's login page. It may redirect once to attach its own
  //    session before serving HTML.
  let page = await hop(fetcher, started.location, jar);
  if (page.location) page = await hop(fetcher, page.location, jar);

  // 3. Credentials, to wherever that page posts.
  const submitted = await hop(fetcher, loginFormAction(page.body), jar, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: opts.username, password: opts.password }).toString(),
  });
  if (!submitted.location) {
    throw new Error(
      `LOGIN_FAILED: Keycloak did not redirect back after the credentials were submitted, ` +
        `which is what it does when it refuses them or wants something else first -- an ` +
        `unverified email, an OTP, a profile it considers incomplete. It said: ` +
        `${submitted.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)}`,
    );
  }

  // 4. Back at the API, which exchanges the code server-side and sets `sid`.
  let back = await hop(fetcher, submitted.location, jar);
  // It redirects on to the app afterwards; follow far enough to be sure the
  // cookie was set rather than stopping at the first hop.
  for (let i = 0; i < 3 && back.location && !jar.get('sid'); i++) {
    back = await hop(fetcher, back.location, jar);
  }
  if (!jar.get('sid')) {
    throw new Error(
      `LOGIN_FAILED: the flow finished without a session cookie, so the code exchange did not ` +
        `open one. The callback answers a redirect either way.`,
    );
  }

  // 5. The CSRF token the API expects back on every write.
  const session = await fetcher(`${opts.signalsApi}/api/v1/auth/session`, {
    headers: { cookie: jar.header() },
  });
  const body = (await session.json()) as { authenticated?: boolean; csrfToken?: string };
  if (!body.authenticated || !body.csrfToken) {
    throw new Error(
      `LOGIN_FAILED: the session cookie was set but the API does not consider it signed in ` +
        `(${JSON.stringify(body)}).`,
    );
  }

  return { cookie: jar.header(), csrfToken: body.csrfToken };
}
