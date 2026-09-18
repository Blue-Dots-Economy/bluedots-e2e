import { describe, expect, test } from 'vitest';
import { parsePublishedPort, buildEndpoints } from './ports.js';

describe('parsePublishedPort', () => {
  test('reads the host port from a docker compose port line', () => {
    expect(parsePublishedPort('0.0.0.0:55017')).toBe(55017);
  });

  test('reads an IPv6 binding', () => {
    expect(parsePublishedPort('[::]:55017')).toBe(55017);
  });

  test('takes the first line when docker prints one per family', () => {
    expect(parsePublishedPort('0.0.0.0:55017\n[::]:55017\n')).toBe(55017);
  });

  test('refuses output with no port rather than returning NaN', () => {
    // An unpublished service yields empty output. Returning NaN here would
    // build a URL like http://localhost:NaN and fail much later.
    expect(() => parsePublishedPort('')).toThrow(/no published port/i);
  });
});

describe('buildEndpoints', () => {
  test('builds host URLs from the discovered ephemeral ports', () => {
    const e = buildEndpoints(
      { signalsApi: 55020, searchApi: 55019, keycloak: 55018, postgres: 55017, redis: 55016, aggregatorApi: 0, mailpit: 0 },
      { postgresUser: 'postgres', postgresPassword: 'pw', postgresDb: 'db', redisPassword: 'rpw' },
    );

    expect(e.signalsApi).toBe('http://localhost:55020');
    expect(e.searchApi).toBe('http://localhost:55019');
  });

  test('builds DSNs the awaiter can connect with from the host', () => {
    const e = buildEndpoints(
      { signalsApi: 1, searchApi: 2, keycloak: 3, postgres: 55017, redis: 55016, aggregatorApi: 0, mailpit: 0 },
      { postgresUser: 'postgres', postgresPassword: 'pw', postgresDb: 'db', redisPassword: 'rpw' },
    );

    expect(e.postgresUrl).toBe('postgres://postgres:pw@localhost:55017/db');
    expect(e.redisUrl).toBe('redis://:rpw@localhost:55016');
  });
});

test('carries the aggregator and the mail server, which two journeys read', () => {
  // Both are ephemeral like everything else. The aggregator's approval mails
  // carry links built from PUBLIC_API_URL -- a fixed host:port that is NOT
  // where this run published it -- so a step re-bases the link onto this
  // endpoint. Mailpit is where the link is read from in the first place.
  const endpoints = buildEndpoints(
    { signalsApi: 1, searchApi: 2, keycloak: 3, postgres: 4, redis: 5, aggregatorApi: 6, mailpit: 7 },
    { postgresUser: 'u', postgresPassword: 'p', postgresDb: 'd', redisPassword: 'r' },
  );

  expect(endpoints.aggregatorApi).toBe('http://localhost:6');
  expect(endpoints.mailpit).toBe('http://localhost:7');
});
