/**
 * Every service the base compose gives a fixed name, and what the overlay
 * has to do about it.
 *
 * A table rather than a stanza pasted per service. The reset was written
 * out by hand nine times with no list to check against, which is exactly
 * how tei-embeddings kept its fixed name on the path CI takes and
 * keycloak-init kept its on every path -- each found by a collision at
 * boot rather than by anything in the harness.
 *
 * `publishes` is the container port the base binds to a fixed host port.
 * `profile` means the overlay parks the service behind a profile no run
 * enables, so it never starts and cannot collide.
 */
export const BASE_SERVICES: Record<string, { publishes?: number; profile?: string }> = {
  postgres: { publishes: 5432 },
  redis: { publishes: 6379 },
  keycloak: { publishes: 8080 },
  mailpit: { publishes: 8025 },
  'keycloak-init': {},
  'signals-bootstrap': {},
  'signals-api': { publishes: 2742 },
  'signals-ui': { profile: 'ui' },
  'tei-embeddings': {},
  'signals-search-api': { publishes: 3100 },
  'signals-search-worker': {},
};

/**
 * The override lines for one service: its name reset, and its published
 * port made ephemeral where it has one.
 *
 * container_name is global to the docker daemon, not scoped to the compose
 * project. The port list is `!override` because compose MERGES sequences,
 * so a plain `ports:` appends to the base list and keeps the fixed binding.
 */
export function resetFor(service: string): string {
  const spec = BASE_SERVICES[service];
  if (!spec) {
    throw new Error(
      `OVERLAY_UNKNOWN_SERVICE: "${service}" is not in BASE_SERVICES. ` +
        `Add it there rather than writing the override out by hand, or the ` +
        `next service to arrive gets missed the same way.`,
    );
  }

  const lines = ['    container_name: !reset null'];
  if (spec.publishes) {
    lines.push('    ports: !override', `      - "0:${spec.publishes}"`);
  }
  return lines.join('\n');
}

/**
 * Fail when the base compose has grown a named service the table does not
 * cover.
 *
 * Runs against the real file at boot, so a service added upstream is caught
 * by a sentence here rather than by a port or name collision minutes into a
 * run -- or, worse, by a second run mysteriously reusing the first one's
 * containers.
 */
export function assertCoversBaseServices(baseCompose: string): void {
  // A fixed name OR a fixed host port: the table tracks both, so a guard
  // reading only container_name let a service that binds a port escape and
  // collide on it -- the other half of what this claims to prevent.
  const claimed = new Set<string>();
  let current: string | null = null;
  let inPorts = false;

  for (const line of baseCompose.split('\n')) {
    const service = /^ {2}([a-z][a-z0-9_-]*):\s*$/.exec(line);
    if (service) {
      current = service[1] ?? null;
      inPorts = false;
      continue;
    }
    if (!current) continue;

    if (/^\s+container_name:/.test(line)) claimed.add(current);
    if (/^\s+ports:/.test(line)) {
      inPorts = true;
      continue;
    }
    // A published port is "host:container"; "container" alone is picked by
    // docker and cannot collide.
    if (inPorts && /^\s+-\s*['"]?\d+:\d+/.test(line)) claimed.add(current);
    else if (inPorts && !/^\s+-/.test(line)) inPorts = false;
  }

  const missing = [...claimed].filter((s) => !BASE_SERVICES[s]);
  if (missing.length > 0) {
    throw new Error(
      `OVERLAY_INCOMPLETE: the base compose gives ${missing.join(', ')} a fixed ` +
        `container_name or host port, and BASE_SERVICES does not cover them. Both ` +
        `are global to the docker daemon, so leaving either collides with a second ` +
        `run or with the developer's own stack.`,
    );
  }
}
