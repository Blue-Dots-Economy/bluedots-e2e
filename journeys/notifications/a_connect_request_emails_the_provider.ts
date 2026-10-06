import { defineJourney } from '../../src/journey/define_journey.js';
import { applyTo, createProfile, expectEmailDelivered } from '../../src/steps/index.js';

/**
 * A seeker's connect request emails the provider it was sent to.
 *
 * `connect` is the one action every target declares, so this is the action
 * email that runs everywhere; J21 covers `apply`, which only ka-dhwd has.
 * The receiving domain differs by target, because each network.json
 * declares a different seeker-side connect:
 *
 *  - purple_dot/alimco: seeker -> provider.
 *  - blue_dot/ka-dhwd: seeker -> service_provider. Its seeker -> provider
 *    contact is `apply`; `connect` reaches a provider only from a
 *    service_provider.
 *
 * Both catalogues send the receiving side `action.connect.provider.inbound_request`
 * ("A seeker is interested in your service"). The body assertion is the
 * sentence both copies share; ka-dhwd says "A job seeker", alimco "A seeker".
 * The template has no name variable, so the seeker's name is not asserted.
 */
const connectRequestJourney = (spec: { id: string; target: string; receiver: string }) => ({
  ...defineJourney({
    id: spec.id,
    title: `A connect request emails the ${spec.receiver.replace(/_/g, ' ')} it was sent to`,
    capability: 'notifications',
    targets: [spec.target],
    steps: [
      createProfile({ as: spec.receiver }),
      createProfile({ as: 'seeker' }),
      applyTo({ action: 'connect', from: 'seeker', to: spec.receiver }),
      expectEmailDelivered({
        to: { profile: spec.receiver },
        about: 'the connect request they received',
        subjectIncludes: 'is interested in',
        bodyIncludes: [
          'is interested in the service you are offering and wants to connect with you',
          'View their details and respond',
          'http://localhost:5173/',
        ],
        recordedAs: 'action.connect.inbound_request',
        recordedDomain: spec.receiver,
      }),
    ],
  }),
  // As J21: redis + postgres for the actors' ingest baseline and instance
  // url, mail for the assertion.
  requires: ['http', 'redis', 'postgres', 'mail'] as const,
});

/** `J25`. alimco, where a seeker connects to a provider. */
export const aConnectRequestEmailsTheProvider = connectRequestJourney({
  id: 'J25',
  target: 'purple_dot/alimco',
  receiver: 'provider',
});

/** `J26`. ka-dhwd, where a seeker connects to a service provider. */
export const aConnectRequestEmailsTheServiceProvider = connectRequestJourney({
  id: 'J26',
  target: 'blue_dot/ka-dhwd',
  receiver: 'service_provider',
});
