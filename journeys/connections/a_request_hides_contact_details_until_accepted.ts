import { defineJourney } from '../../src/journey/define_journey.js';
import {
  applyTo,
  createProfile,
  expectContactDetailsHidden,
} from '../../src/steps/index.js';

/**
 * `J18`. The gate, asserted before the thing it gates.
 *
 * Contact details are released only on a status the interaction declares in
 * `reveals_pii_on_status`. A request that has merely been MADE is not one of
 * them -- so if this ever answers 200 with the details, anyone could learn
 * any participant's phone number by asking for something and reading the
 * reply. That is a disclosure, not a test failure, which is why it is
 * pinned on its own rather than as a line inside the happy path.
 *
 * Asserted on a concrete 403, never on absence: an assertion that nothing
 * came back also passes when the whole action subsystem is broken.
 */
export const aRequestHidesContactDetailsUntilAccepted = {
  ...defineJourney({
    id: 'J18',
    title: 'Contact details stay hidden while a request is only pending',
    capability: 'consent-and-data-disclosure',
    targets: ['blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'provider' }),
      createProfile({ as: 'seeker' }),
      applyTo({ action: 'apply', from: 'seeker', to: 'provider' }),
      expectContactDetailsHidden({ as: 'seeker' }),
    ],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
