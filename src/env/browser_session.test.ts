import { describe, expect, test } from 'vitest';
import { CookieJar, loginFormAction } from './browser_session.js';

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
