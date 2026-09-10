import type { KeycloakAdmin } from '../env/keycloak_setup.js';

/**
 * Create a participant the journeys can authenticate as.
 *
 * The realm role is not optional: KEYCLOAK_REQUIRED_REALM_ROLES defaults to
 * `signals_participant,signals_admin`, and a token carrying neither is
 * rejected on every human-path call with a 403 that looks like an
 * authorization bug rather than a missing grant.
 *
 * An email is always supplied, even though the caller may not care about
 * one: the realm's user profile marks email required for role `user`, so a
 * user without one counts as "not fully set up" and Keycloak refuses the
 * password grant with `invalid_grant`. apply-user-profile.sh relaxes that
 * requirement, which made the failure depend on whether the fixup had
 * settled -- a race rather than a coin flip.
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
    email: spec.email ?? `${spec.username}@journey.local`,
  });
  await admin.setPassword(realm, userId, spec.password);
  await admin.addRealmRole(realm, userId, spec.role);
  return { userId };
}
