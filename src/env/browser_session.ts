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
        `said: ${describePage(html)}`,
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

/**
 * Put a URL back on a host this process can reach.
 *
 * Every service in the stack addresses its peers by compose name --
 * `keycloak:8080` is what signals redirects to, because that is the issuer
 * it validates and the only host every container can resolve. Nothing
 * outside the network can, and a browser on a developer's machine has the
 * same problem: the local setup instructions have you add `127.0.0.1
 * keycloak` to /etc/hosts for exactly this reason.
 *
 * Rewriting only the origin is safe. Keycloak does not sign the authorize
 * URL, and it validates `redirect_uri` against the client's allow-list
 * rather than against the host the request arrived on -- and the `iss` in
 * the resulting token stays pinned by KC_HOSTNAME whichever way we came in,
 * which is the value signals actually checks.
 *
 * Routed by path rather than by host: the API and Keycloak each own an
 * unmistakable prefix, and matching on hosts would need a table of every
 * name a service might use for itself.
 */
function rebase(url: string, endpoints: { signalsApi: string; keycloak: string }): string {
  const target = new URL(url);
  const base = new URL(
    target.pathname.startsWith('/realms/') || target.pathname.startsWith('/resources/')
      ? endpoints.keycloak
      : endpoints.signalsApi,
  );
  target.protocol = base.protocol;
  target.host = base.host;
  return target.toString();
}

/**
 * What a Keycloak page is actually telling us.
 *
 * Its pages carry a themed `<style>` block big enough to fill any excerpt,
 * so stripping tags alone yields CSS -- which is how a refused login came
 * back as "--bd-primary: #0074ff". Style and script go first, then the
 * fields the form wants are listed: a page asking for something this flow
 * does not send is the likeliest reason it re-served itself.
 */
export function describePage(html: string): string {
  const text = html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const fields = [...html.matchAll(/<input[^>]*\sname="([^"]+)"/gi)]
    .map((m) => m[1])
    .filter((name) => name && !/^_/.test(name));

  return [
    text.slice(0, 400),
    fields.length ? `[form fields: ${[...new Set(fields)].join(', ')}]` : '[form has no inputs]',
  ].join(' ');
}

/**
 * What the code page calls its input.
 *
 * Read off the page rather than assumed: the theme owns these names, and a
 * wrong one posts an empty value that comes back as "incorrect code" --
 * which sends you looking at the mailbox instead of at the form.
 */
export function codeFieldOf(html: string): string {
  const names = [...html.matchAll(/<input[^>]*\sname="([^"]+)"/gi)]
    .map((m) => m[1]!)
    .filter((name) => !name.startsWith('_'));
  const found = names.find((name) => /code|otp|token/i.test(name));
  if (!found) {
    throw new Error(
      `LOGIN_FAILED: the page after the identifier asks for no code field, so the flow has ` +
        `gone somewhere unexpected. It offers: ${names.join(', ') || 'nothing'}`,
    );
  }
  return found;
}

/** Exported for its own tests; the flow uses it through `go`. */
export const rebaseForTest = rebase;

/** Follows one redirect at a time, so every Set-Cookie on the way is kept. */
async function hop(
  fetcher: typeof fetch,
  url: string,
  jar: CookieJar,
  init: RequestInit = {},
): Promise<{ status: number; location: string | null; body: string; url: string }> {
  let res: Response;
  try {
    res = await fetcher(url, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers ?? {}), ...(jar.header() ? { cookie: jar.header() } : {}) },
    });
  } catch (err) {
    // Node's fetch throws a bare "fetch failed" for everything from an
    // unresolvable host to a refused connection, so the URL is the only
    // part of the diagnosis anybody can act on.
    throw new Error(
      `LOGIN_FAILED: could not reach ${url} -- ${err instanceof Error ? err.message : String(err)}`,
    );
  }
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
export async function signInThroughTheFrontDoor<Baseline>(opts: {
  signalsApi: string;
  /** Where THIS process reaches Keycloak; the redirects name its compose host. */
  keycloak: string;
  /** Email or mobile. The login page asks for one field and calls it that. */
  identifier: string;
  /**
   * How the one-time code is obtained.
   *
   * There is no password anywhere in this realm: the login page takes an
   * identifier and emails a code. So signing in means reading the mailbox,
   * exactly as approving a registration does -- `capture` runs before the
   * code is requested, so that only a message caused by THIS sign-in can
   * satisfy it.
   */
  code: { capture: () => Promise<Baseline>; read: (baseline: Baseline) => Promise<string> };
  fetcher?: typeof fetch;
}): Promise<BrowserSession> {
  const fetcher = opts.fetcher ?? fetch;
  const jar = new CookieJar();
  const endpoints = { signalsApi: opts.signalsApi, keycloak: opts.keycloak };
  const go = (url: string, init?: RequestInit) => hop(fetcher, rebase(url, endpoints), jar, init);

  // 1. The API starts the flow and hands back a Keycloak authorize URL,
  //    setting the flow cookie that binds this browser to the exchange.
  const started = await go(`${opts.signalsApi}/api/v1/auth/session/login`);
  if (!started.location) {
    throw new Error(
      `LOGIN_FAILED: the login route answered ${started.status} instead of redirecting to the ` +
        `identity provider. A 404 here means this instance is not running the Keycloak ` +
        `provider at all.`,
    );
  }

  // 2. Keycloak's login page. It may redirect once to attach its own
  //    session before serving HTML.
  let page = await go(started.location);
  if (page.location) page = await go(page.location);

  // 3. The identifier, which asks Keycloak to send a code. The mailbox is
  //    read from BEFORE that, so an older message cannot satisfy it.
  const baseline = await opts.code.capture();
  const asked = await go(loginFormAction(page.body), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ identifier: opts.identifier }).toString(),
  });
  if (asked.location) {
    throw new Error(
      `LOGIN_FAILED: the identifier was accepted and the flow completed without ever asking ` +
        `for a code, which is not how this realm authenticates anybody.`,
    );
  }

  // 4. The code, into whatever the next page calls its field. Named rather
  //    than assumed: the page is themed, and a wrong field name posts an
  //    empty code and reads as a wrong code.
  const codeField = codeFieldOf(asked.body);
  const submitted = await go(loginFormAction(asked.body), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ [codeField]: await opts.code.read(baseline) }).toString(),
  });
  if (!submitted.location) {
    throw new Error(
      `LOGIN_FAILED: Keycloak did not redirect back after the credentials were submitted, ` +
        `which is what it does when it refuses them or wants something else first -- an ` +
        `refuses the code or wants something else first. It said: ` +
        `${describePage(submitted.body)}`,
    );
  }

  // 4. Back at the API, which exchanges the code server-side and sets `sid`.
  let back = await go(submitted.location);
  // It redirects on to the app afterwards; follow far enough to be sure the
  // cookie was set rather than stopping at the first hop.
  for (let i = 0; i < 3 && back.location && !jar.get('sid'); i++) {
    back = await go(back.location);
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
