import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import { describeRowErrors, readRowErrors } from './row_errors.js';

/**
 * The bad row was REPORTED, and it onboarded nobody.
 *
 * Both halves, because either alone passes over the wrong thing. A row that
 * is silently dropped satisfies "nobody was onboarded" perfectly -- the
 * operator gets a completed upload, a smaller number than they uploaded,
 * and no way to find out which line was wrong. And a row that is reported
 * but still written creates a participant nobody validated.
 *
 * The reason is read from the service's own errors.csv rather than
 * inferred from the counts: "one row failed" is not a diagnosis, and this
 * file is the only place the operator is given one.
 */
export const expectRowRejected = () =>
  step({
    label: 'The incomplete row was reported and nobody was created from it',
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const auth = requireContext(ctx.auth, 'authentication');
      const uploadId = requireState(state, 'bulkUploadId');
      const token = requireState(state, 'coordinatorToken');
      const phone = requireState(state, 'bulkInvalidPhone');
      const field = requireState(state, 'bulkInvalidField');

      // The counts first. errors.csv is absent when NOTHING failed, so
      // reading it before checking that something did makes a row the
      // pipeline happily accepted look like a reporting bug -- which is
      // exactly how the first attempt at this journey misread itself.
      const record = await ctx.http(
        `${ctx.endpoints.aggregatorApi}/v1/bulk-uploads/${uploadId}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const counts = (await record.json()) as {
        passed?: number;
        failed?: number;
        total_rows?: number | null;
      };
      if (!counts.failed) {
        throw new Error(
          `STEP_FAILED: the upload rejected nothing (${counts.passed ?? 0} passed, ` +
            `${counts.failed ?? 0} failed, of ${counts.total_rows ?? 0}). The row built to be ` +
            `invalid was accepted, so this journey is asserting nothing -- fix the row, not ` +
            `the assertion.`,
        );
      }

      const errors = await readRowErrors(ctx, uploadId, token);
      if (!errors.ok) {
        throw new Error(
          `STEP_FAILED: the rejected row has no entry to read -- ${errors.why}. A row that ` +
            `fails without being written to errors.csv is one the operator cannot find.`,
        );
      }
      if (!errors.body.includes(phone)) {
        throw new Error(
          `STEP_FAILED: errors.csv does not mention ${phone}, so the row that was rejected ` +
            `was not reported as rejected. What it does say:\n${errors.body.slice(0, 800)}`,
        );
      }
      // The blank field should be named. A report that says only "invalid"
      // leaves the operator to diff two dozen columns by eye.
      if (!errors.body.includes(field)) {
        throw new Error(
          `STEP_FAILED: errors.csv reports ${phone} without naming "${field}", the field left ` +
            `blank, so the operator is told a row failed and not which column to fix.`,
        );
      }

      const res = await ctx.http(
        `${ctx.endpoints.signalsApi}/api/v1/admin/participant?phone_number=${encodeURIComponent(`+91${phone}`)}`,
        { headers: { 'x-api-key': auth.apiKey, 'x-acting-org-id': auth.actingOrgId } },
      );

      // A concrete 404, not merely "no user came back": the difference
      // matters because a lookup that errored would otherwise read as proof
      // the participant is absent.
      if (res.status === 404) return;
      if (!res.ok) {
        throw new Error(
          `STEP_FAILED: could not tell whether ${phone} exists -- the lookup answered ` +
            `${res.status} ${await res.text()}. An unreadable answer is not an absence.`,
        );
      }

      const body = (await res.json()) as { user_id?: string };
      if (body.user_id) {
        throw new Error(
          `STEP_FAILED: ${phone} was rejected in errors.csv and EXISTS in the network anyway. ` +
            `The row was reported and written, so the report is not what decided it.`,
        );
      }
    },
  });
