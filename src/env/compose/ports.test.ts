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
      { signalsApi: 55020, searchApi: 55019, keycloak: 55018, postgres: 55017, redis: 55016 },
      { postgresUser: 'postgres', postgresPassword: 'pw', postgresDb: 'db', redisPassword: 'rpw' },
    );

    expect(e.signalsApi).toBe('http://localhost:55020');
    expect(e.searchApi).toBe('http://localhost:55019');
  });

  test('builds DSNs the awaiter can connect with from the host', () => {
    const e = buildEndpoints(
      { signalsApi: 1, searchApi: 2, keycloak: 3, postgres: 55017, redis: 55016 },
      { postgresUser: 'postgres', postgresPassword: 'pw', postgresDb: 'db', redisPassword: 'rpw' },
    );

    expect(e.postgresUrl).toBe('postgres://postgres:pw@localhost:55017/db');
    expect(e.redisUrl).toBe('redis://:rpw@localhost:55016');
  });
});
