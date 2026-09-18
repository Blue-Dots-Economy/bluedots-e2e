import { step, type StepContext } from '../../journey/define_journey.js';
import { requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

type Upload = {
  status?: string;
  rows_total?: number;
  rows_succeeded?: number;
  rows_failed?: number;
};

/** Terminal states; anything else is still moving. */
const DONE = new Set(['completed', 'completed_with_errors', 'failed']);

/**
 * Wait for the pipeline to finish, and say which stage it died at.
 *
 * Three queues run in sequence -- the file, then a job per row, then the
 * finalise that writes errors.csv -- and a stall in any of them leaves the
 * record `running` forever. Without a deadline that is a test that hangs
 * until CI kills the job, with nothing said about where.
 */
export const waitUntilBulkFinished = (opts: { timeoutMs?: number } = {}) =>
  step({
    label: 'The upload finished processing',
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const uploadId = requireState(state, 'bulkUploadId');
      const token = requireState(state, 'coordinatorToken');
      const deadline = Date.now() + (opts.timeoutMs ?? 60_000);

      let last: Upload = {};
      for (;;) {
        const res = await ctx.http(
          `${ctx.endpoints.aggregatorApi}/v1/bulk-uploads/${uploadId}`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          throw new Error(`STEP_FAILED: read upload ${res.status} ${await res.text()}`);
        }
        last = (await res.json()) as Upload;
        if (last.status && DONE.has(last.status)) break;

        if (Date.now() >= deadline) {
          throw new Error(
            `STEP_FAILED: the upload is still "${last.status}" after ` +
              `${Math.round((opts.timeoutMs ?? 60_000) / 1000)}s. Nothing moves it but the ` +
              `worker, so a record stuck at "uploaded" means no job was consumed at all ` +
              `(check the worker is running and on the same queue), while one stuck at ` +
              `"running" means a stage started and never finished.`,
          );
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      if (last.status === 'failed') {
        throw new Error(
          `STEP_FAILED: the upload failed outright (${last.rows_failed ?? '?'} of ` +
            `${last.rows_total ?? '?'} rows). This is a file-level rejection, not a bad row.`,
        );
      }
      if (!last.rows_succeeded) {
        // The record reads `completed` with every row rejected, which is a
        // finished upload that onboarded nobody.
        throw new Error(
          `STEP_FAILED: the upload completed with no successful rows ` +
            `(${last.rows_failed ?? 0} failed of ${last.rows_total ?? 0}). The file was ` +
            `accepted and every row in it was not.`,
        );
      }
    },
  });
