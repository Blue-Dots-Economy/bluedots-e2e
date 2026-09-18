import { describe, expect, test } from 'vitest';
import { buildStackEnv } from './stack_env.js';

const TARGET = {
  id: 'blue_dot/ka-dhwd',
  dot: 'blue_dot',
  instance: 'ka-dhwd',
  networkConfigPath: '/schemas/blue_dot/ka-dhwd/network.json',
  consentPath: null,
  brandPath: null,
  servedDomains: 'blue_dot/seeker,blue_dot/provider,blue_dot/service_provider',
};

describe('buildStackEnv', () => {
  test('turns on the Keycloak paths, which are dormant by default', () => {
    const env = buildStackEnv(TARGET);

    // AUTH_PROVIDER defaults to betterauth, which leaves every KEYCLOAK_*
    // value inert. Every identity step in phase 3 depends on this.
    expect(env.AUTH_PROVIDER).toBe('keycloak');
  });

  test('serves exactly the resolved target domains', () => {
    const env = buildStackEnv(TARGET);

    expect(env.SERVED_DOMAINS).toBe(TARGET.servedDomains);
  });

  test('neutralises the reconciliation sweep', () => {
    const env = buildStackEnv(TARGET);

    // The sweep indexes any items row missing from item_search every 60s
    // straight from Postgres, which would let a journey pass with the stream
    // dead. It must not fire inside a run.
    expect(Number(env.SWEEP_INTERVAL_MS)).toBeGreaterThan(600_000);
  });

  test('disables the search result cache', () => {
    // result_cache caches empty results for 45s by default, which turns a
    // polling search awaiter into a 45s flake.
    expect(buildStackEnv(TARGET).CACHE_TTL_SECONDS).toBe('0');
  });

  test('pins the embedding dimension to what the column requires', () => {
    // item_search.embedding is vector(1024) and the worker throws at boot on
    // any mismatch.
    expect(buildStackEnv(TARGET).EMBEDDING_DIM).toBe('1024');
  });

  test('issues tokens from somewhere every container can also fetch from', () => {
    const env = buildStackEnv(TARGET);

    // These used to differ -- a public issuer and an internal fetch URL --
    // which signals supports and aggregator-dpg does not: it derives BOTH
    // the expected `iss` and the JWKS location from one KEYCLOAK_URL, so a
    // localhost issuer sent it looking for the JWKS on its own loopback and
    // every token came back "unexpected iss claim value".
    //
    // localhost is also the wrong half to keep: the published port is
    // ephemeral, so nothing can be configured to expect it.
    expect(env.KEYCLOAK_BASE_URL).toBe(env.KEYCLOAK_INTERNAL_BASE_URL);
    expect(env.KEYCLOAK_BASE_URL).toBe('http://keycloak:8080');
  });

  test('supplies every fail-hard secret the stack refuses to boot without', () => {
    const env = buildStackEnv(TARGET);

    for (const key of [
      'POSTGRES_PASSWORD',
      'REDIS_PASSWORD',
      'AUTH_SECRET',
      'SIGNALS_PII_KEY',
      'INSTANCE_SHARED_SECRET',
    ]) {
      expect(env[key], `${key} must be set`).toBeTruthy();
    }
    // Zod minimums that fail fast at boot.
    expect(env.AUTH_SECRET!.length).toBeGreaterThanOrEqual(8);
    expect(env.INSTANCE_SHARED_SECRET!.length).toBeGreaterThanOrEqual(32);
    expect(env.POSTGRES_PASSWORD!.length).toBeGreaterThanOrEqual(8);
    // A base64-encoded 32-byte key.
    expect(Buffer.from(env.SIGNALS_PII_KEY!, 'base64')).toHaveLength(32);
  });
});

describe('aggregator realm rendering', () => {
  test('supplies every fail-hard input the render script requires', () => {
    const env = buildStackEnv(TARGET);

    // All five are `:?` in aggregator's render-realm.sh, so a missing one
    // fails the container at boot rather than producing a broken realm.
    for (const key of [
      'KEYCLOAK_REALM',
      'PUBLIC_BASE_URL',
      'AGGREGATOR_API_SECRET',
      'AGGREGATOR_PORTAL_SECRET',
      'AGGREGATOR_BFF_SECRET',
    ]) {
      expect(env[key], `${key} must be set`).toBeTruthy();
    }
  });

  test('the signals-api secret matches on both sides of the token exchange', () => {
    const env = buildStackEnv(TARGET);

    // The realm renders __SIGNALS_API_SECRET__ into the signals-api client,
    // and signals-api authenticates with KEYCLOAK_API_CLIENT_SECRET. If they
    // differ the service gets 401 invalid_client, which reads like a
    // misconfigured realm rather than two values drifting apart.
    expect(env.SIGNALS_API_SECRET).toBe(env.KEYCLOAK_API_CLIENT_SECRET);
  });
});
