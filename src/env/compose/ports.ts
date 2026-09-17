/**
 * Host ports are ephemeral (published as `0:<container>`), so the only way to
 * reach a service from the harness is to ask compose what it assigned.
 */
export type DiscoveredPorts = {
  signalsApi: number;
  searchApi: number;
  keycloak: number;
  postgres: number;
  redis: number;
};

export type Endpoints = {
  signalsApi: string;
  searchApi: string;
  keycloak: string;
  postgresUrl: string;
  redisUrl: string;
};

/**
 * `docker compose port <svc> <port>` prints `0.0.0.0:55017`, and on a
 * dual-stack host one line per address family.
 */
export function parsePublishedPort(output: string): number {
  const line = output.split('\n').map((l) => l.trim()).find(Boolean);
  const match = line?.match(/:(\d+)$/);
  if (!match) {
    // Returning NaN here would build `http://localhost:NaN` and fail far from
    // the cause, which is usually a service that published nothing.
    throw new Error(`No published port in docker output: ${JSON.stringify(output)}`);
  }
  return Number(match[1]);
}

export function buildEndpoints(
  ports: DiscoveredPorts,
  creds: {
    postgresUser: string;
    postgresPassword: string;
    postgresDb: string;
    redisPassword: string;
  },
): Endpoints {
  return {
    signalsApi: `http://localhost:${ports.signalsApi}`,
    searchApi: `http://localhost:${ports.searchApi}`,
    keycloak: `http://localhost:${ports.keycloak}`,
    postgresUrl: `postgres://${creds.postgresUser}:${creds.postgresPassword}@localhost:${ports.postgres}/${creds.postgresDb}`,
    redisUrl: `redis://:${creds.redisPassword}@localhost:${ports.redis}`,
  };
}
