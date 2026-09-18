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
  NOTIFICATION_SERVICE_KEY_ID: 'k',
  NOTIFICATION_SERVICE_SECRET: 's',
  NOTIFICATION_FROM_EMAIL: 'no-reply@journey.local',
  FRONTEND_BASE_URL: 'http://localhost:3000',
  KEYCLOAK_SERVICE_CLIENT_IDS: 'aggregator-dpg',
};

const workerEnv = {
  SIGNALSTACK_AUTH_MODE: 'bearer',
  SIGNALSTACK_BASE_URL: 'http://signals-api:2742',
  SIGNALSTACK_CLIENT_ID: 'aggregator-dpg',
  SIGNALSTACK_CLIENT_SECRET: 's',
  SIGNALSTACK_ACTING_ORG_ID: 'org_x',
  S3_ENDPOINT: 'http://minio:9000',
  S3_BUCKET: 'b',
  AGGREGATOR_NETWORK_SOURCE: 'http://schemas/network.json',
};

const aggregatorEnv = {
  KEYCLOAK_ALLOWED_AZP: 'aggregator-bff',
  ORG_HIERARCHY_ENABLED: 'true',
  ADMIN_EMAILS: 'admin@journey.test',
  APPROVAL_TOKEN_SECRET: 'x'.repeat(40),
  SIGNALSTACK_BASE_URL: 'http://signals-api:2742',
  SIGNALSTACK_AUTH_MODE: 'bearer',
  SIGNALSTACK_CLIENT_ID: 'aggregator-dpg',
  SIGNALSTACK_CLIENT_SECRET: 's',
  SIGNALSTACK_ACTING_ORG_ID: 'org_x',
  S3_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'http://minio:9000',
  S3_BUCKET: 'b',
  AGGREGATOR_NETWORK_SOURCE: 'http://schemas/network.json',
};

describe('assertContainerEnv', () => {
  test('passes when every declared variable reaches the container', () => {
    expect(() => assertContainerEnv(rendered({ 'signals-api': apiEnv, 'aggregator-api': aggregatorEnv, 'aggregator-worker': workerEnv }))).not.toThrow();
  });

  test('names the service and the variable a container will not receive', () => {
    // The bug this exists for, twice over: a variable in the env file feeds
    // compose-file INTERPOLATION and never reaches the container. Both times
    // the service started fine and said so in one level-40 log line nobody
    // was reading.
    const { SIGNALS_SEARCH_URL: _, ...missing } = apiEnv;

    expect(() => assertContainerEnv(rendered({ 'signals-api': missing, 'aggregator-api': aggregatorEnv, 'aggregator-worker': workerEnv }))).toThrow(
      /CONTAINER_ENV_MISSING.*signals-api.*SIGNALS_SEARCH_URL/s,
    );
  });

  test('treats a variable that interpolated to nothing as missing', () => {
    // `FOO: ${FOO}` with FOO unset in the env file renders to an empty
    // string: present in the rendered config, and read by the service as
    // absent. Exactly the same silent fallback, one layer further in.
    expect(() =>
      assertContainerEnv(rendered({ 'signals-api': { ...apiEnv, SIGNALS_SEARCH_API_KEY: '' }, 'aggregator-api': aggregatorEnv, 'aggregator-worker': workerEnv })),
    ).toThrow(/SIGNALS_SEARCH_API_KEY/);
  });

  test('treats a variable rendered as null the same way', () => {
    expect(() =>
      assertContainerEnv(rendered({ 'signals-api': { ...apiEnv, NOTIFICATION_SERVICE_SECRET: null }, 'aggregator-api': aggregatorEnv, 'aggregator-worker': workerEnv })),
    ).toThrow(/NOTIFICATION_SERVICE_SECRET/);
  });

  test('reports every missing variable at once, not the first', () => {
    const { SIGNALS_SEARCH_URL: _a, NOTIFICATION_FROM_EMAIL: _b, ...missing } = apiEnv;
    let message = '';
    try {
      assertContainerEnv(rendered({ 'signals-api': missing, 'aggregator-api': aggregatorEnv, 'aggregator-worker': workerEnv }));
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toMatch(/SIGNALS_SEARCH_URL/);
    expect(message).toMatch(/NOTIFICATION_FROM_EMAIL/);
  });

  test('fails when the service the table names is not in the stack at all', () => {
    // Otherwise a renamed service silently empties the guard: nothing to
    // check, nothing reported, and the table goes on claiming coverage.
    expect(() => assertContainerEnv(rendered({}))).toThrow(/signals-api/);
  });

  test('catches the aggregator approving coordinators and registering nobody', () => {
    // getSignalStackWriter() returns null and logs at WARN when the bearer
    // config is incomplete. The approvals then succeed and reach the network
    // with nothing -- a green run over an empty result, which is the one
    // outcome this suite exists to make impossible.
    const { SIGNALSTACK_CLIENT_SECRET: _, ...broken } = aggregatorEnv;

    expect(() =>
      assertContainerEnv(rendered({ 'signals-api': apiEnv, 'aggregator-api': broken, 'aggregator-worker': workerEnv })),
    ).toThrow(/aggregator-api.*SIGNALSTACK_CLIENT_SECRET/s);
  });
});
