import { describe, expect, test } from 'vitest';
import { CookieJar, loginFormAction, rebaseForTest as rebase } from './browser_session.js';

describe('CookieJar', () => {
  test('sends back what a server set, which is the whole binding', () => {
    // The login flow binds the browser to the exchange with a flow cookie
    // and ends by setting `sid`. Dropping either makes the callback refuse
    // a code that is otherwise valid.
    const jar = new CookieJar();
    jar.absorb(['AUTH_SESSION_ID=abc; Path=/; HttpOnly', 'KC_RESTART=xyz; Path=/']);

    expect(jar.header()).toBe('AUTH_SESSION_ID=abc; KC_RESTART=xyz');
  });

  test('a later value replaces an earlier one, as a browser does', () => {
    const jar = new CookieJar();
    jar.absorb(['sid=first; Path=/']);
    jar.absorb(['sid=second; Path=/']);

    expect(jar.header()).toBe('sid=second');
  });

  test('ignores an expiring cookie s attributes, not just its value', () => {
    // Attributes are not cookies. Sending `Path` back as one confuses
    // Keycloak's session lookup rather than failing loudly.
    const jar = new CookieJar();
    jar.absorb(['sid=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=600']);

    expect(jar.header()).toBe('sid=v');
  });

  test('reads one cookie by name, for the session the flow is after', () => {
    const jar = new CookieJar();
    jar.absorb(['FLOW=1; Path=/', 'sid=wanted; Path=/']);

    expect(jar.get('sid')).toBe('wanted');
    expect(jar.get('absent')).toBeUndefined();
  });
});

describe('loginFormAction', () => {
  test('finds where the login page posts to', () => {
    const html = `<html><body><form id="kc-form-login" action="http://kc/realms/r/login-actions/authenticate?session_code=s" method="post">`;

    expect(loginFormAction(html)).toBe(
      'http://kc/realms/r/login-actions/authenticate?session_code=s',
    );
  });

  test('unescapes the ampersands an HTML attribute carries', () => {
    // The action is a URL inside an attribute, so its query separators are
    // written &amp;. Posting to it verbatim drops every parameter after the
    // first and Keycloak answers with an expired-page error.
    const html = `<form action="http://kc/auth?session_code=s&amp;execution=e&amp;tab_id=t" method="post">`;

    expect(loginFormAction(html)).toBe('http://kc/auth?session_code=s&execution=e&tab_id=t');
  });

  test('refuses a page that is not a login form, naming what it got', () => {
    // Keycloak serves an error page with a 200, so a missing form is the
    // only signal that the flow went somewhere unexpected.
    expect(() => loginFormAction('<html><body>We are sorry ... page expired</body></html>')).toThrow(
      /no login form/i,
    );
  });
});

describe('rebase', () => {
  const endpoints = { signalsApi: 'http://localhost:55001', keycloak: 'http://localhost:55002' };

  test('sends a realm URL to where this process reaches Keycloak', () => {
    // signals redirects to the COMPOSE host, because that is the issuer it
    // validates and the only name every container resolves. Nothing outside
    // the network can reach it -- a browser on a developer's machine hits
    // the same wall, which is why the local setup has you add a hosts entry.
    expect(rebase('http://keycloak:8080/realms/bluedots/protocol/openid-connect/auth?x=1', endpoints))
      .toBe('http://localhost:55002/realms/bluedots/protocol/openid-connect/auth?x=1');
  });

  test('sends an API URL back to the API, not to Keycloak', () => {
    expect(rebase('http://localhost:2742/api/v1/auth/session/callback?code=c', endpoints))
      .toBe('http://localhost:55001/api/v1/auth/session/callback?code=c');
  });

  test('keeps the path and the query untouched', () => {
    // The query carries the authorization code and the PKCE state. Losing
    // any of it fails the exchange with an error about the code rather than
    // about the rewrite.
    const out = new URL(rebase('http://keycloak:8080/realms/r/x?code=abc&state=s', endpoints));

    expect(out.pathname).toBe('/realms/r/x');
    expect(out.searchParams.get('code')).toBe('abc');
    expect(out.searchParams.get('state')).toBe('s');
  });
});
