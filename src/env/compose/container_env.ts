/**
 * Which variables each container must actually RECEIVE.
 *
 * A second table, for the second way this overlay has gone wrong. The first
 * -- a service the base compose names that the overlay forgets to reset --
 * is caught by assertCoversBaseServices. This one is subtler and has now
 * happened twice: a variable written into the env file, where it feeds
 * compose-file INTERPOLATION and never reaches the container.
 *
 * Both times the service booted clean, answered health checks, and said so
 * in exactly one log line at level 40:
 *
 *   KEYCLOAK_REALM     -> the realm import ran against a realm named
 *                         __KEYCLOAK_REALM__
 *   SIGNALS_SEARCH_URL -> "signals-search is not configured", and the
 *                         discover BFF fell back to a native distance query,
 *                         so the browse-feed journeys were green while never
 *                         crossing into signals-search at all
 *
 * A suite that passes without exercising the thing it names is the failure
 * the negative control exists to prevent for J2. This is that failure, in
 * the environment rather than in a journey -- so it gets a guard rather than
 * a third comment.
 *
 * Entries are what the SERVICE reads, not everything it is handed. Adding a
 * variable to the overlay does not require a line here; a variable whose
 * absence degrades the service silently does.
 */
export const REQUIRED_CONTAINER_ENV: Record<string, readonly string[]> = {
  'signals-api': [
    // Without it the realm import runs against a literal __KEYCLOAK_REALM__.
    'KEYCLOAK_REALM',
    // Without these the discover BFF answers from its own distance/recency
    // query and never calls signals-search.
    'SIGNALS_SEARCH_URL',
    'SIGNALS_SEARCH_API_KEY',
    // Without all three getNotificationClient() returns undefined, and the
    // API sends nothing and logs nothing.
    'NOTIFICATION_SERVICE_ENDPOINT',
    'NOTIFICATION_SERVICE_KEY_ID',
    'NOTIFICATION_SERVICE_SECRET',
    // Both required by resolveNotifierConfig, which returns null WITHOUT
    // logging when either is missing.
    'NOTIFICATION_FROM_EMAIL',
    'FRONTEND_BASE_URL',
    // Empty refuses EVERY client-credentials token with
    // SERVICE_CLIENT_NOT_ALLOWED, which reads as a broken realm rather than
    // an unset allow-list -- and it is what the aggregator's push arrives on.
    'KEYCLOAK_SERVICE_CLIENT_IDS',
  ],
  'aggregator-api': [
    // Unset disables the azp allow-list entirely. On a SHARED realm that
    // admits any valid bluedots token as a service principal, signals' own
    // clients included.
    'KEYCLOAK_ALLOWED_AZP',
    // Off, and the org routes are never REGISTERED -- so tier one answers
    // 404, which reads as a missing route rather than a disabled feature.
    'ORG_HIERARCHY_ENABLED',
    // Without it no review email is sent, and an approval that is never
    // requested cannot be granted.
    'ADMIN_EMAILS',
    'APPROVAL_TOKEN_SECRET',
    // getSignalStackWriter() returns null and logs at WARN when any of these
    // is missing: the aggregator then approves coordinators and registers
    // nobody with the network, which is a green run over an empty result.
    'SIGNALSTACK_BASE_URL',
    'SIGNALSTACK_AUTH_MODE',
    'SIGNALSTACK_CLIENT_ID',
    'SIGNALSTACK_CLIENT_SECRET',
  ],
};

type RenderedConfig = {
  services?: Record<string, { environment?: Record<string, string | null> }>;
};

/**
 * Fail before boot when a container will not receive what it needs.
 *
 * Reads `docker compose config`, which is the MERGED view of base plus
 * overlay plus env file -- the same thing the daemon will act on. Checking
 * the overlay text instead would miss a variable the base already supplies
 * and would not see interpolation at all.
 */
export function assertContainerEnv(renderedJson: string): void {
  let config: RenderedConfig;
  try {
    config = JSON.parse(renderedJson) as RenderedConfig;
  } catch {
    throw new Error(
      'CONTAINER_ENV_UNREADABLE: could not parse the rendered compose config, so nothing ' +
        'was checked. A guard that cannot read its input must not report success.',
    );
  }

  const problems: string[] = [];

  for (const [service, required] of Object.entries(REQUIRED_CONTAINER_ENV)) {
    const rendered = config.services?.[service];
    if (!rendered) {
      // Not skipped. A renamed or removed service would otherwise empty this
      // guard silently while the table goes on claiming to cover it.
      problems.push(`${service}: not in the stack at all, so nothing was checked for it`);
      continue;
    }

    const env = rendered.environment ?? {};
    // Empty counts as missing: `FOO: ${FOO}` with FOO unset in the env file
    // renders to "", which is present in the config and absent to the
    // service -- the same silent fallback, one layer further in.
    const absent = required.filter((key) => {
      const value = env[key];
      return value === undefined || value === null || value === '';
    });

    if (absent.length > 0) {
      problems.push(`${service}: ${absent.join(', ')}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `CONTAINER_ENV_MISSING: these variables never reach the container that reads them:\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        `\n\nDeclare them under the service's own \`environment:\` in the overlay. An ` +
        `env_file feeds compose-file interpolation; it does not reach the container. ` +
        `Each of these degrades its service SILENTLY, which is how the same mistake ` +
        `reached a green suite twice.`,
    );
  }
}
