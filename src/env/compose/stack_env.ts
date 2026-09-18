import type { ResolvedTarget } from '../../targets/target_discovery.js';
import { SEARCH_CALLER_API_KEY } from '../../seed/search_api_key.js';

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

/**
 * The issuer keycloak mints, and therefore the one every service validates.
 * Exported so the overlay pins KC_HOSTNAME to the same value: the published
 * host port is ephemeral, and with KC_HOSTNAME_STRICT false keycloak would
 * derive `iss` from the request URL -- so a token taken through that port
 * carries a port number nothing is configured to expect, and 401s at first
 * use.
 *
 * The COMPOSE hostname, not localhost. signals splits the two concerns
 * (KEYCLOAK_BASE_URL validates `iss`, KEYCLOAK_INTERNAL_BASE_URL fetches the
 * JWKS) and could take either; aggregator-dpg derives BOTH from a single
 * KEYCLOAK_URL, so a localhost issuer would make it look for the JWKS on its
 * own loopback. One value has to satisfy both jobs, and only the compose
 * name is reachable from inside a container.
 *
 * The harness still reaches keycloak over the published host port. That
 * affects nothing here: KC_HOSTNAME governs what keycloak EMITS, not what
 * it accepts.
 */
export const KEYCLOAK_ISSUER = 'http://keycloak:8080';

/**
 * The HMAC identity signals-dpg signs notification requests with.
 *
 * notification-service reads its half from a mounted internal-secrets.json;
 * both halves are generated from these so the two cannot drift. A run boots
 * the service fresh and it is unreachable outside its compose network, so
 * these are fixed test values like the rest.
 */
export const NOTIFICATION_KEY_ID = 'signals-dpg';
export const NOTIFICATION_SECRET = 'journey-notification-secret';
/** Internal to the compose network; nothing publishes it. */
export const NOTIFICATION_PORT = 3001;

/**
 * aggregator-dpg's own database, on the shared postgres.
 *
 * Its API migrates itself on boot (RUN_MIGRATIONS_ON_BOOT), but it will not
 * CREATE the database -- so a one-shot makes it first. signals-dpg's base
 * compose ships `postgresdb` and no init directory, where aggregator's own
 * compose makes this the DEFAULT database; the two stacks disagree, and this
 * harness boots signals'.
 */
export const AGGREGATOR_DB = 'aggregator';
/** Internal to the compose network; the host port is ephemeral. */
export const AGGREGATOR_API_PORT = 4000;
/** Where the aggregator sends a registration for review. */
export const NETWORK_ADMIN_EMAIL = 'network-admin@journey.test';

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
    // Defaults to 'gated', which answers SELF_SIGNUP_DISABLED and makes the
    // self-service path untestable. An instance that serves the public runs
    // it allowed, so that is what the suite verifies; a journey for the
    // gated refusal would need its own stack, like the negative control.
    SELF_SIGNUP_MODE: 'allowed',
    // Both the compose hostname now, and deliberately the same value: the
    // issuer has to be somewhere every container can also FETCH from, and
    // aggregator-dpg has one variable for both jobs.
    KEYCLOAK_BASE_URL: KEYCLOAK_ISSUER,
    KEYCLOAK_INTERNAL_BASE_URL: KEYCLOAK_ISSUER,
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

    // Which clients may use client-credentials service auth against signals.
    // Empty by default, and an empty allow-list refuses EVERY service token
    // with SERVICE_CLIENT_NOT_ALLOWED -- so the aggregator's Keycloak push
    // fails in a way that reads like a realm problem. `aggregator-dpg` is
    // both the client id here and the signals organisation slug; the two
    // being the same string is how resolveServiceAccount finds the org.
    KEYCLOAK_SERVICE_CLIENT_IDS: 'aggregator-dpg,voice-dpg',

    // ── aggregator-dpg ──────────────────────────────────────────────────
    AGGREGATOR_DB,
    AGGREGATOR_NETWORK: target.dot,
    // Its token check is an allow-list of `azp`. Unset disables the check --
    // and on a SHARED realm that admits any valid bluedots token as a
    // service principal, signals' own clients included.
    KEYCLOAK_ALLOWED_AZP: 'aggregator-portal,aggregator-api,aggregator-bff',
    // Registration and approval are both one-tier-per-flag: with this off
    // the org routes are never REGISTERED, so they answer 404 -- which reads
    // as a missing route rather than a disabled feature.
    ORG_HIERARCHY_ENABLED: 'true',
    // Rejected below 32 characters, with the container refusing to boot.
    APPROVAL_TOKEN_SECRET: 'journey-approval-token-secret-0123456789',
    ADMIN_EMAILS: NETWORK_ADMIN_EMAIL,
    // Keycloak, not the legacy key: the aggregator mints a client-credentials
    // token as `aggregator-dpg` and signals resolves the org from its client
    // id. Leaving this `apikey` (the default) would take the better-auth path
    // the fleet is retiring.
    SIGNALSTACK_AUTH_MODE: 'bearer',
    SIGNALSTACK_CLIENT_ID: 'aggregator-dpg',
    SIGNALSTACK_BASE_URL: 'http://signals-api:2742',

    // Without all three, getNotificationClient() returns undefined and the
    // API silently sends nothing -- which is what made the notification
    // pipeline unassertable rather than merely untested.
    // Without these the API logs "signals-search is not configured" at
    // level 40 and the discover BFF falls back to a native query, so a
    // browse-feed journey passes without ever crossing into signals-search.
    SIGNALS_SEARCH_URL: 'http://signals-search-api:3100',
    SIGNALS_SEARCH_API_KEY: SEARCH_CALLER_API_KEY,

    NOTIFICATION_SERVICE_ENDPOINT: `http://notification-service:${NOTIFICATION_PORT}`,
    NOTIFICATION_SERVICE_KEY_ID: NOTIFICATION_KEY_ID,
    NOTIFICATION_SERVICE_SECRET: NOTIFICATION_SECRET,
    // resolveNotifierConfig() needs a client AND a from-address AND some
    // URL source, and returns null WITHOUT LOGGING when any is missing --
    // so the whole pipeline disables itself in silence. Supplying the
    // client alone bought nothing: no /notify request, no warning, no
    // trace. All five, or none of it runs.
    NOTIFICATION_FROM_EMAIL: 'journeys@bluedots.test',
    FRONTEND_BASE_URL: 'http://localhost:5173',

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
