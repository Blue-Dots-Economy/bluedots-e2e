import { defineJourney } from '../../src/journey/define_journey.js';
import { createProfile, expectSecondDomainRefused } from '../../src/steps/index.js';

/**
 * `J9`. An account is deliberately single-domain, and the reason is
 * disclosure rather than modelling: `user.onboarded_by_org_id` grants
 * PII-decrypt rights per ACCOUNT, so a person holding both a seeker and a
 * provider profile would let one domain's default aggregator decrypt the
 * other domain's participant.
 *
 * Written the other way round first -- asserting the second profile joined
 * the same person -- and the run returned DOMAIN_LOCKED, which is the
 * system being right and the journey being wrong. It earns its place
 * inverted: the lock only opens across two requests, so nothing inside one
 * service can hold it.
 */
export const onePersonOneDomain = {
  ...defineJourney({
    id: 'J9',
    title: 'One person cannot hold profiles in two domains',
    capability: 'consent-and-data-disclosure',
    targets: ['blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker' }),
      expectSecondDomainRefused({ as: 'provider', forProfileAs: 'seeker' }),
    ],
  }),
  requires: ['http'] as const,
};
