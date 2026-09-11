import { describe, expect, test } from 'vitest';
import { BASE_SERVICES, assertCoversBaseServices, resetFor } from './base_services.js';

const BASE = `
services:
  postgres:
    container_name: signals-postgres
  redis:
    container_name: signals-redis
`;

describe('resetFor', () => {
  test('unnames every service, since container_name is daemon-global', () => {
    // A fixed name collides with a stale run, a second target, or the
    // developer's own stack.
    for (const service of Object.keys(BASE_SERVICES)) {
      if (BASE_SERVICES[service]?.profile) continue;
      expect(resetFor(service), service).toContain('container_name: !reset null');
    }
  });

  test('makes a published port ephemeral, replacing the list not appending', () => {
    // Compose merges sequences, so a plain `ports:` keeps the base's fixed
    // binding alongside the ephemeral one.
    expect(resetFor('postgres')).toContain('ports: !override');
    expect(resetFor('postgres')).toContain('"0:5432"');
  });

  test('refuses a service name the table does not know', () => {
    // A typo would otherwise emit nothing and the fixed name would survive.
    expect(() => resetFor('postgress')).toThrow(/postgress/);
  });
});

describe('assertCoversBaseServices', () => {
  test('accepts a base compose whose named services are all in the table', () => {
    expect(() => assertCoversBaseServices(BASE)).not.toThrow();
  });

  test('fails when the base compose names a service the table has never heard of', () => {
    // This is the check that makes the class of bug impossible: it is how
    // tei-embeddings and keycloak-init kept their fixed names, each found
    // only by a port collision at boot.
    const withNewcomer = `${BASE}  voice-dpg:\n    container_name: voice-dpg\n`;

    expect(() => assertCoversBaseServices(withNewcomer)).toThrow(/voice-dpg/);
  });

  test('fails on a service that binds a host port without a name', () => {
    // BASE_SERVICES tracks `publishes` as well as the name, and the guard
    // only scanned for container_name -- so a base service growing a fixed
    // `ports:` escaped it and collided on the host port, which the
    // docstring claims it prevents.
    const withPort = `${BASE}  metrics:\n    ports:\n      - "9090:9090"\n`;

    expect(() => assertCoversBaseServices(withPort)).toThrow(/metrics/);
  });

  test('ignores a service the base compose does not name', () => {
    // No container_name, no collision, nothing to reset.
    expect(() => assertCoversBaseServices(`${BASE}  anon:\n    image: x\n`)).not.toThrow();
  });
});
