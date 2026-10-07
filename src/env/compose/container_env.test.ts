import { describe, expect, test } from 'vitest';
import { assertContainerEnv } from './container_env.js';

const rendered = (services: Record<string, Record<string, string | null>>) =>
  JSON.stringify({
    services: Object.fromEntries(
      Object.entries(services).map(([name, environment]) => [name, { environment }]),
    ),
  });

const apiEnv = {
  KEYCLOAK_REALM: 'bluedots',
  SIGNALS_SEARCH_URL: 'http://signals-search-api:3100',
  SIGNALS_SEARCH_API_KEY: 'sk_x',
  NOTIFICATION_SERVICE_ENDPOINT: 'http://notification-service:4000',
  KEYCLOAK_API_CLIENT_SECRET: 'journey-signals-api-secret',
  FRONTEND_BASE_URL: 'http://localhost:3000',
};

describe('assertContainerEnv', () => {
  test('passes when every declared variable reaches the container', () => {
    expect(() => assertContainerEnv(rendered({ 'signals-api': apiEnv }))).not.toThrow();
  });

  test('names the service and the variable a container will not receive', () => {
    // The bug this exists for, twice over: a variable in the env file feeds
    // compose-file INTERPOLATION and never reaches the container. Both times
    // the service started fine and said so in one level-40 log line nobody
    // was reading.
    const { SIGNALS_SEARCH_URL: _, ...missing } = apiEnv;

    expect(() => assertContainerEnv(rendered({ 'signals-api': missing }))).toThrow(
      /CONTAINER_ENV_MISSING.*signals-api.*SIGNALS_SEARCH_URL/s,
    );
  });

  test('treats a variable that interpolated to nothing as missing', () => {
    // `FOO: ${FOO}` with FOO unset in the env file renders to an empty
    // string: present in the rendered config, and read by the service as
    // absent. Exactly the same silent fallback, one layer further in.
    expect(() =>
      assertContainerEnv(rendered({ 'signals-api': { ...apiEnv, SIGNALS_SEARCH_API_KEY: '' } })),
    ).toThrow(/SIGNALS_SEARCH_API_KEY/);
  });

  test('treats a variable rendered as null the same way', () => {
    expect(() =>
      assertContainerEnv(rendered({ 'signals-api': { ...apiEnv, KEYCLOAK_API_CLIENT_SECRET: null } })),
    ).toThrow(/KEYCLOAK_API_CLIENT_SECRET/);
  });

  test('reports every missing variable at once, not the first', () => {
    const { SIGNALS_SEARCH_URL: _a, KEYCLOAK_API_CLIENT_SECRET: _b, ...missing } = apiEnv;
    let message = '';
    try {
      assertContainerEnv(rendered({ 'signals-api': missing }));
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toMatch(/SIGNALS_SEARCH_URL/);
    expect(message).toMatch(/KEYCLOAK_API_CLIENT_SECRET/);
  });

  test('requires the keycloak client secret signals-api mints its NS token with', () => {
    // Without it getNotificationClient() returns undefined and the API sends
    // nothing and logs nothing.
    const { KEYCLOAK_API_CLIENT_SECRET: _, ...missing } = apiEnv;

    expect(() => assertContainerEnv(rendered({ 'signals-api': missing }))).toThrow(
      /KEYCLOAK_API_CLIENT_SECRET/,
    );
  });

  test('fails when the service the table names is not in the stack at all', () => {
    // Otherwise a renamed service silently empties the guard: nothing to
    // check, nothing reported, and the table goes on claiming coverage.
    expect(() => assertContainerEnv(rendered({}))).toThrow(/signals-api/);
  });
});
