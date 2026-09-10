import type { KeycloakAdmin } from '../env/keycloak_setup.js';

/**
 * Create a participant the journeys can authenticate as.
 *
 * The realm role is not optional: KEYCLOAK_REQUIRED_REALM_ROLES defaults to
 * `signals_participant,signals_admin`, and a token carrying neither is
 * rejected on every human-path call with a 403 that looks like an
 * authorization bug rather than a missing grant.
 *
 * Nothing here is test-only product code: the user is created through
 * Keycloak's own Admin API, and the service then performs its genuine
 * authorization check against the resulting token.
 */
export async function mintParticipant(
  admin: KeycloakAdmin,
  realm: string,
  spec: { username: string; password: string; role: string; email?: string },
): Promise<{ userId: string }> {
  const userId = await admin.createUser(realm, {
    username: spec.username,
    email: spec.email,
  });
  await admin.setPassword(realm, userId, spec.password);
  await admin.addRealmRole(realm, userId, spec.role);
  return { userId };
}
