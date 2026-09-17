import { defineJourney } from '../../src/journey/define_journey.js';
import {
  createProfile,
  expectLifecycleStatus,
  expectNotFoundInSearch,
} from '../../src/steps/index.js';

/**
 * `J10`. The consent gate is the nastiest shape in this codebase: a
 * profile created without consent returns 200, reports no error anywhere,
 * and commits `draft` -- so the person is simply never discoverable and
 * nothing says why. The harness itself was bitten by exactly this while
 * being built.
 *
 * Asserted on both models, because they are different claims: `draft` in
 * the write model, absent from the index. A journey checking only search
 * would pass against an item that never committed at all.
 */
export const profileWithoutConsentStaysHidden = {
  ...defineJourney({
    id: 'J10',
    title: 'A profile created without consent is not discoverable',
    capability: 'consent-and-data-disclosure',
    targets: ['purple_dot/alimco', 'blue_dot/ka-dhwd'],
    steps: [
      createProfile({ as: 'seeker', withoutConsent: true }),
      expectLifecycleStatus({ is: 'draft', because: 'consent was never given' }),
      expectNotFoundInSearch({ because: 'consent was never given' }),
    ],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
