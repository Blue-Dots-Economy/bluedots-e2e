import type { ResolvedTarget } from '../../targets/targets.js';

/**
 * Fixed, non-secret values. The stack is booted fresh per run and is not
 * reachable outside the compose network, so these are deliberately constant:
 * a run must be reproducible, and rotating them would only make failures
 * harder to compare.
 */
const TEST_SECRETS = {
  POSTGRES_PASSWORD: 'journey-postgres-pw',
  REDIS_PASSWORD: 'journey-redis-pw',
  AUTH_SECRET: 'journey-auth-secret',
  // Base64-encoded 32 bytes, as SIGNALS_PII_KEY requires.
  SIGNALS_PII_KEY: Buffer.alloc(32, 7).toString('base64'),
  INSTANCE_SHARED_SECRET: 'journey-instance-shared-secret-32ch',
  KC_BOOTSTRAP_ADMIN_USERNAME: 'admin',
  KC_BOOTSTRAP_ADMIN_PASSWORD: 'admin',
} as const;

/**
 * Deadline-shaping. These exist so the stack cannot hide a broken ingest
 * spine behind a background repair, and so failures surface inside a run
 * rather than after it.
 */
const TIMING = {
  // The reconciliation sweep indexes any items row missing from item_search
  // straight from Postgres (default every 60s). Left on, a journey passes
  // whether or not the event ever crossed the stream. Pushed far past any
  // journey deadline so only the stream can satisfy an assertion.
  SWEEP_INTERVAL_MS: '3600000',
  // result_cache caches empty results too (default 45s), which would turn a
  // polling search awaiter into a 45s flake.
  CACHE_TTL_SECONDS: '0',
  // XAUTOCLAIM redelivery is gated on this (default 60s), putting DLQ
  // escalation four minutes out and beyond any sane deadline.
  PEL_MIN_IDLE_MS: '5000',
} as const;

export function buildStackEnv(target: ResolvedTarget): Record<string, string> {
  return {
    ...TEST_SECRETS,
    ...TIMING,

    INSTANCE_NAME: `journey-${target.dot}${target.instance ? `-${target.instance}` : ''}`,
    INSTANCE_ENV: 'development',

    // Derived from the resolved config, never hand-written: signals-dpg 4xxs
    // a create for an unserved domain, and an instance can declare domains
    // the dot-level config does not.
    SERVED_DOMAINS: target.servedDomains,

    // AUTH_PROVIDER defaults to 'betterauth', which keeps every Keycloak path
    // dormant and the KEYCLOAK_* values inert.
    AUTH_PROVIDER: 'keycloak',
    // iss derives from the PUBLIC url; the internal one is the compose
    // service name. Collapsing them fails every token.
    KEYCLOAK_BASE_URL: 'http://localhost:8080',
    KEYCLOAK_INTERNAL_BASE_URL: 'http://keycloak:8080',
    KEYCLOAK_REALM: 'bluedots',
    KEYCLOAK_UI_CLIENT_ID: 'signals-ui',
    PUBLIC_BASE_URL: 'http://localhost:5173',

    // aggregator-dpg's render-realm.sh substitutes 19 placeholders and fails
    // hard on five of them. The realm is booted fresh per run and is not
    // reachable outside the compose network, so these are fixed test values.
    AGGREGATOR_API_SECRET: 'journey-aggregator-api-secret',
    AGGREGATOR_PORTAL_SECRET: 'journey-aggregator-portal-secret',
    AGGREGATOR_BFF_SECRET: 'journey-aggregator-bff-secret',
    CAMPAIGN_MANAGER_SECRET: 'journey-campaign-manager-secret',
    SIGNALSTACK_CLIENT_SECRET: 'journey-signalstack-secret',
    VOICE_DPG_SIGNALS_SECRET: 'journey-voice-dpg-secret',
    // Rendered into the signals-api client AND read by signals-api itself as
    // KEYCLOAK_API_CLIENT_SECRET. They must be the same value or the service
    // gets 401 invalid_client, which reads like a broken realm rather than
    // two settings drifting apart.
    SIGNALS_API_SECRET: 'journey-signals-api-secret',
    KEYCLOAK_API_CLIENT_SECRET: 'journey-signals-api-secret',

    // signals-search: one image for api and worker, sharing signals-dpg's
    // database. EMBEDDING_DIM must equal item_search.embedding's vector(1024)
    // or the worker refuses to start.
    EMBEDDING_DIM: '1024',
    EMBEDDING_MODEL: 'BAAI/bge-m3',
    RERANK_DEFAULT: 'false',
    // item_search's DDL belongs to signals-dpg and is applied by the
    // bootstrap one-shot. envBool accepts only true|false|1|0.
    RUN_MIGRATIONS: 'false',
  };
}

export function renderEnvFile(env: Record<string, string>): string {
  return (
    Object.entries(env)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n'
  );
}
