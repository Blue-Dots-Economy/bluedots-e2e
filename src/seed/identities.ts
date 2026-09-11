import { parseSeedOutput } from './service_users.js';
import { mintParticipant } from './participant.js';
import type { KeycloakAdmin } from '../env/keycloak_setup.js';

export type SeedResult = {
  /** Authenticates signals-search and signals-dpg server-to-server calls. */
  apiKey: string;
  /** The org a profile must be owned by to leave `draft`. */
  aggregatorOrgId: string;
  participant: { userId: string; username: string; password: string; token: string };
};

export type SeedDeps = {
  runTool: (command: readonly string[]) => Promise<string>;
  admin: KeycloakAdmin;
  obtainToken: (user: { username: string; password: string }) => Promise<string>;
};

const PARTICIPANT = {
  username: 'journey-seeker',
  password: 'journey-seeker-pw',
  // KEYCLOAK_REQUIRED_REALM_ROLES defaults to
  // signals_participant,signals_admin; a token with neither is rejected.
  role: 'signals_participant',
};

/**
 * Phase 3. Deliberately takes only a context and a few callables, so it does
 * not know whether a stack was booted here or already existed.
 */
export async function seedIdentities(
  ctx: { realm: string },
  deps: SeedDeps,
): Promise<SeedResult> {
  // The product's own provisioning script, not a hand-rolled insert: it owns
  // the better-auth hash scheme, and duplicating that here would drift from
  // it silently.
  const stdout = await deps.runTool(['pnpm', '--filter', 'api', 'db:seed:services']);
  const services = parseSeedOutput(stdout);
  const aggregator = services['aggregator-dpg'];
  if (!aggregator) {
    throw new Error(`SEED_FAILED: no aggregator-dpg service user in:\n${stdout}`);
  }

  const { userId } = await mintParticipant(deps.admin, ctx.realm, PARTICIPANT);
  const token = await deps.obtainToken(PARTICIPANT);

  return {
    apiKey: aggregator.apiKey,
    aggregatorOrgId: aggregator.orgId,
    participant: { userId, username: PARTICIPANT.username, password: PARTICIPANT.password, token },
  };
}
