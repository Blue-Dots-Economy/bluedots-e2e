/**
 * Log a person in the way a browser does: signals-dpg's BFF login, Keycloak's
 * OTP forms, the emailed code, and back to the BFF callback.
 *
 * There is no shorter path that means the same thing. The bearer path refuses
 * a human token outright, and a participant api key skips the one thing a
 * first login does that nothing else does: signals-dpg creates its local user
 * mirror there, and sends the welcome mail from it.
 *
 * Both servers answer with their PUBLIC origins (Keycloak's pinned hostname,
 * the API's configured base URL), which are fixed ports nothing publishes in
 * a harness stack. Every URL is therefore rewritten to the ephemeral port the
 * harness discovered before it is requested.
 */

export type LoginForm = { id: string; action: string };

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/&quot;/g, '"');

/** The first form on a Keycloak page: its id says which step this is. */
export function parseLoginForm(html: string): LoginForm | null {
  const tag = /<form\b[^>]*>/i.exec(html)?.[0];
  if (!tag) return null;
  const id = /\bid="([^"]*)"/i.exec(tag)?.[1] ?? '';
  const action = /\baction="([^"]*)"/i.exec(tag)?.[1];
  if (!action) return null;
  return { id, action: decodeEntities(action) };
}

/** Replace a public origin with the reachable one, matching whole origins only. */
export function rewriteOrigin(url: string, map: Record<string, string>): string {
  for (const [from, to] of Object.entries(map)) {
    if (url === from || url.startsWith(`${from}/`) || url.startsWith(`${from}?`)) {
      return to + url.slice(from.length);
    }
  }
  return url;
}

/**
 * Cookies by name only. Both servers are on localhost, where a browser
 * would also share cookies across ports, and their names do not collide.
 */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(res: Response): void {
    for (const raw of res.headers.getSetCookie()) {
      const [pair = '', ...attrs] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a));
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

export type LoginDeps = {
  http: typeof fetch;
  /** Reachable origins. */
  signalsApi: string;
  keycloak: string;
  /** The origins the servers put in their redirects and form actions. */
  publicSignalsApi: string;
  publicKeycloak: string;
  publicUi: string;
  /** The emailed code. Called once, when the code form is showing; never logged. */
  readCode: () => Promise<string>;
};

const SESSION_COOKIE = 'sid';
const MAX_HOPS = 25;

const fail = (why: string) => new Error(`LOGIN_FAILED: ${why}`);

const titleOf = (html: string) =>
  /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || 'untitled page';

export async function logInWithEmailOtp(
  email: string,
  deps: LoginDeps,
): Promise<{ sessionCookie: string }> {
  const jar = new CookieJar();
  const origins = {
    [deps.publicKeycloak]: deps.keycloak,
    [deps.publicSignalsApi]: deps.signalsApi,
  };

  let url = `${deps.signalsApi}/api/v1/auth/session/login`;
  let method: 'GET' | 'POST' = 'GET';
  let body: string | undefined;
  let codeSubmitted = false;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const target = rewriteOrigin(url, origins);
    const cookie = jar.header();
    const res = await deps.http(target, {
      method,
      redirect: 'manual',
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(body !== undefined ? { body } : {}),
    });
    jar.absorb(res);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw fail(`${res.status} from ${new URL(target).pathname} with no location`);
      const next = new URL(location, target).toString();

      // The BFF callback is the last server step: it either made a session
      // or sends the browser to its login error page. Where it lands (the UI,
      // or the API's own origin when no UI origin was given) is a page this
      // harness has no use for.
      const fromCallback = new URL(target).pathname === '/api/v1/auth/session/callback';
      if (fromCallback || next.startsWith(deps.publicUi)) {
        if (next.includes('auth_error')) {
          throw fail(`the callback sent the browser to ${new URL(next).pathname}?auth_error`);
        }
        const sid = jar.get(SESSION_COOKIE);
        if (!sid) throw fail('the callback set no session cookie');
        return { sessionCookie: `${SESSION_COOKIE}=${sid}` };
      }

      url = next;
      method = 'GET';
      body = undefined;
      continue;
    }

    if (!res.ok) throw fail(`${res.status} from ${new URL(target).pathname}`);

    const html = await res.text();
    const form = parseLoginForm(html);
    if (!form) throw fail(`Keycloak answered "${titleOf(html)}", which has no form to continue`);

    url = form.action;
    method = 'POST';
    switch (form.id) {
      case 'kc-otp-identifier-form':
        body = new URLSearchParams({ identifier: email }).toString();
        break;
      case 'kc-otp-channel-select-form':
        body = new URLSearchParams({ channel: 'email' }).toString();
        break;
      case 'kc-email-otp-form':
        if (codeSubmitted) throw fail('the emailed code was refused');
        codeSubmitted = true;
        body = new URLSearchParams({ otp: await deps.readCode() }).toString();
        break;
      default:
        throw fail(`unexpected form "${form.id}" on "${titleOf(html)}"`);
    }
  }

  throw fail(`no session after ${MAX_HOPS} requests`);
}
