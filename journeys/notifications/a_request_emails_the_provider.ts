import { defineJourney } from '../../src/journey/define_journey.js';
import { applyTo, createProfile, expectEmailDelivered } from '../../src/steps/index.js';

/**
 * `J21`. A request is only useful if the person asked hears about it. The
 * provider is emailed when a seeker applies, and signals-dpg names that an
 * inbound request for the PROVIDER's domain -- the domain decides which
 * copy and which portal link they get.
 *
 * ka-dhwd only: apply is the interaction this target declares, and the
 * other target declares none that a seeker sends a provider.
 */
export const aRequestEmailsTheProvider = {
  ...defineJourney({
    id: 'J21',
    title: 'A request emails the provider it was sent to',
    capability: 'notifications',
    targets: ['blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'provider' }),
      createProfile({ as: 'seeker' }),
      applyTo({ action: 'apply', from: 'seeker', to: 'provider' }),
      expectEmailDelivered({
        to: { profile: 'provider' },
        about: 'the request they received',
        subjectIncludes: 'has applied',
        bodyIncludes: ['View the application', 'http://localhost:5173/'],
        recordedAs: 'action.apply.inbound_request',
        recordedDomain: 'provider',
      }),
    ],
  }),
  // redis + postgres: the actors record an ingest baseline and read the
  // target's instance url; mail: the assertion reads Mailpit.
  requires: ['http', 'redis', 'postgres', 'mail'] as const,
};
