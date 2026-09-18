/**
 * A phone number no other fixture in the run will claim.
 *
 * The aggregator enforces uniqueness on phone AND email across every
 * registration, and it does not care that an organisation and a coordinator
 * are different kinds of record. Two journeys that both register one, or one
 * journey registering both, collide on a fixed number and the second gets
 * `PHONE_EXISTS` -- which reads as the product refusing a duplicate person
 * rather than as two fixtures sharing a literal.
 *
 * Derived rather than random for the same reason the addresses are: a seed
 * has to reproduce the whole run, participants included.
 */
export function phoneFromSeed(seed: string, role: string): string {
  // Small, stable, and not trying to be a hash function -- it only has to
  // spread distinct inputs across nine digits.
  let h = 0;
  for (const ch of `${role}:${seed}`) {
    h = (h * 31 + ch.charCodeAt(0)) % 1_000_000_000;
  }
  // Indian mobile numbers start 6-9 and the network's schema expects ten
  // digits; 9 keeps it unambiguous.
  return `9${String(h).padStart(9, '0')}`;
}
