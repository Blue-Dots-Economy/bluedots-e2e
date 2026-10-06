import { describe, expect, test } from 'vitest';
import { CookieJar, logInWithEmailOtp, parseLoginForm, rewriteOrigin } from './browser_login.js';

const PUBLIC = {
  publicSignalsApi: 'http://localhost:2742',
  publicKeycloak: 'http://localhost:8080',
  publicUi: 'http://localhost:5173',
};
const REACHABLE = { signalsApi: 'http://localhost:55005', keycloak: 'http://localhost:55003' };

const form = (id: string, action: string, extra = '') =>
  `<html><head><title>Sign in</title></head><body><form id="${id}" class="x" action="${action}" method="post">${extra}</form></body></html>`;

describe('parseLoginForm', () => {
  test('reads the form id and decodes the action', () => {
    const html = form(
      'kc-otp-identifier-form',
      'http://localhost:8080/realms/bluedots/login-actions/authenticate?session_code=a&amp;execution=b&amp;tab_id=c',
    );

    expect(parseLoginForm(html)).toEqual({
      id: 'kc-otp-identifier-form',
      action:
        'http://localhost:8080/realms/bluedots/login-actions/authenticate?session_code=a&execution=b&tab_id=c',
    });
  });

  test('answers null for a page with no form', () => {
    expect(parseLoginForm('<html><body>We are sorry</body></html>')).toBeNull();
  });
});

describe('rewriteOrigin', () => {
  test('sends a public URL to the port the harness can reach', () => {
    const map = { [PUBLIC.publicKeycloak]: REACHABLE.keycloak };

    expect(rewriteOrigin('http://localhost:8080/realms/x?a=1', map)).toBe(
      'http://localhost:55003/realms/x?a=1',
    );
    expect(rewriteOrigin('http://localhost:80801/x', map)).toBe('http://localhost:80801/x');
  });
});

describe('CookieJar', () => {
  test('keeps the latest value per name and drops cookies set to expire', () => {
    const jar = new CookieJar();
    const res = (cookies: string[]) => {
      const h = new Headers();
      for (const c of cookies) h.append('set-cookie', c);
      return new Response(null, { status: 302, headers: h });
    };

    jar.absorb(res(['A=1; Path=/', 'B=2; HttpOnly']));
    jar.absorb(res(['A=3', 'B=; Max-Age=0']));

    expect(jar.header()).toBe('A=3');
    expect(jar.get('A')).toBe('3');
  });
});

/** A scripted browser-side view of the two servers. */
function scripted(
  opts: { otpRejected?: boolean; callbackError?: boolean; landOnApi?: boolean } = {},
) {
  const calls: { method: string; url: string; body: string; cookie: string }[] = [];
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? String(init.body) : '';
    const cookie = new Headers(init?.headers).get('cookie') ?? '';
    calls.push({ method, url, body, cookie });
    const redirect = (location: string, setCookie?: string) => {
      const h = new Headers({ location });
      if (setCookie) h.append('set-cookie', setCookie);
      return new Response(null, { status: 302, headers: h });
    };
    const page = (html: string, setCookie?: string) => {
      const h = new Headers({ 'content-type': 'text/html' });
      if (setCookie) h.append('set-cookie', setCookie);
      return new Response(html, { status: 200, headers: h });
    };

    if (url.startsWith(`${REACHABLE.signalsApi}/api/v1/auth/session/login`)) {
      return redirect(
        'http://localhost:8080/realms/bluedots/protocol/openid-connect/auth?client_id=signals-ui&state=s1',
        'oidc_flow=s1; Path=/api/v1/auth; HttpOnly',
      );
    }
    if (url.startsWith(`${REACHABLE.keycloak}/realms/bluedots/protocol/openid-connect/auth`)) {
      return page(
        form('kc-otp-identifier-form', 'http://localhost:8080/realms/bluedots/login-actions/authenticate?step=id'),
        'AUTH_SESSION_ID=kc1; Path=/realms/bluedots/',
      );
    }
    if (url.endsWith('step=id')) {
      return page(
        form(
          'kc-otp-channel-select-form',
          'http://localhost:8080/realms/bluedots/login-actions/authenticate?step=channel',
        ),
      );
    }
    if (url.endsWith('step=channel')) {
      return page(
        form('kc-email-otp-form', 'http://localhost:8080/realms/bluedots/login-actions/authenticate?step=otp'),
      );
    }
    if (url.endsWith('step=otp')) {
      if (opts.otpRejected) {
        return page(
          form('kc-email-otp-form', 'http://localhost:8080/realms/bluedots/login-actions/authenticate?step=otp'),
        );
      }
      return redirect('http://localhost:2742/api/v1/auth/session/callback?code=c1&state=s1');
    }
    if (url.startsWith(`${REACHABLE.signalsApi}/api/v1/auth/session/callback`)) {
      return opts.callbackError
        ? redirect('http://localhost:5173/auth/login?auth_error=1')
        : redirect(
            `${opts.landOnApi ? 'http://localhost:2742' : 'http://localhost:5173'}/auth/callback?returnTo=%2F`,
            'sid=session-1; Path=/; HttpOnly',
          );
    }
    return new Response('unexpected', { status: 500 });
  }) as typeof fetch;
  return { http, calls };
}

describe('logInWithEmailOtp', () => {
  const deps = (http: typeof fetch, readCode = async () => '482913') => ({
    http,
    ...REACHABLE,
    ...PUBLIC,
    readCode,
  });

  test('walks the identifier, channel and code forms and returns the session cookie', async () => {
    const { http, calls } = scripted();

    const session = await logInWithEmailOtp('person@example.test', deps(http));

    expect(session).toEqual({ sessionCookie: 'sid=session-1' });
    const posts = calls.filter((c) => c.method === 'POST').map((c) => c.body);
    expect(posts).toEqual([
      'identifier=person%40example.test',
      'channel=email',
      'otp=482913',
    ]);
    // Every request went to a port the harness can reach.
    for (const c of calls) expect(c.url).not.toMatch(/localhost:(8080|2742)\//);
    // The flow cookie the login set is presented back at the callback.
    expect(calls.find((c) => c.url.includes('/session/callback'))!.cookie).toContain('oidc_flow=s1');
  });

  test('reads the code only once the code form is showing', async () => {
    const { http, calls } = scripted();
    let readAt = -1;

    await logInWithEmailOtp(
      'person@example.test',
      deps(http, async () => {
        readAt = calls.length;
        return '111111';
      }),
    );

    expect(calls[readAt - 1]!.url).toMatch(/step=channel$/);
  });

  test('fails when the code is refused, without printing it', async () => {
    const { http } = scripted({ otpRejected: true });

    const err = await logInWithEmailOtp('person@example.test', deps(http, async () => '987654')).catch(
      (e: Error) => e,
    );

    expect((err as Error).message).toMatch(/^LOGIN_FAILED: .*code was refused/);
    expect((err as Error).message).not.toContain('987654');
  });

  test('stops at the callback even when it lands on the API origin, not the UI', async () => {
    // No appOrigin on the login request: the BFF falls back to its own base
    // URL, which serves no /auth/callback page.
    const { http, calls } = scripted({ landOnApi: true });

    await expect(logInWithEmailOtp('person@example.test', deps(http))).resolves.toEqual({
      sessionCookie: 'sid=session-1',
    });
    expect(calls.some((c) => c.url.includes('/auth/callback?'))).toBe(false);
  });

  test('fails when the callback lands on the login error page', async () => {
    const { http } = scripted({ callbackError: true });

    await expect(logInWithEmailOtp('person@example.test', deps(http))).rejects.toThrow(
      /^LOGIN_FAILED: .*auth_error/,
    );
  });
});
