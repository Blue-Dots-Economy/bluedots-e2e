import { defineJourney } from '../../src/journey/define_journey.js';
import {
  approveRegistration,
  expectParticipantInNetwork,
  expectRowRejected,
  registerCoordinator,
  registerOrganisation,
  signInAsCoordinator,
  uploadParticipants,
  waitUntilBulkFinished,
} from '../../src/steps/index.js';

/**
 * `B2`. The half of bulk upload that stops B1 passing over an empty result.
 *
 * One good row and one missing a required field, in the same file. Three
 * things have to hold at once, and each covers for a different way the
 * other two can be satisfied by accident:
 *
 *  - the good row still lands, so a file is not all-or-nothing;
 *  - the bad row is REPORTED, by the number that was on it and the column
 *    that was blank -- a silently dropped row satisfies "nobody was
 *    onboarded" perfectly, and leaves the operator with a smaller number
 *    than they uploaded and no way to find out which line was wrong;
 *  - and nobody was created from it, because a row that is reported and
 *    written anyway is a participant nobody validated.
 *
 * The absence is asserted on a concrete 404 rather than on an empty
 * answer: a lookup that errored would otherwise read as proof the
 * participant is not there.
 */
export const aBadRowIsReportedAndCreatesNobody = {
  ...defineJourney({
    id: 'B2',
    title: 'An incomplete row is reported and creates nobody, and the rest of the file lands',
    capability: 'aggregator-onboarding',
    targets: ['blue_dot/ka-dhwd'],
    steps: [
      registerOrganisation(),
      approveRegistration({ tier: 'organisation' }),
      registerCoordinator({ as: 'seeker' }),
      approveRegistration({ tier: 'coordinator' }),
      signInAsCoordinator(),
      uploadParticipants({ as: 'seeker', withAnInvalidRow: true }),
      waitUntilBulkFinished(),
      expectParticipantInNetwork(),
      expectRowRejected(),
    ],
  }),
  requires: ['http', 'postgres'] as const,
};
