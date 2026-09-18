import { step, type StepContext } from '../../journey/define_journey.js';
import { requireState } from '../../journey/state.js';
import { describeRowErrors, readRowErrors } from './row_errors.js';
import type { JourneyState } from '../../journey/state.js';

type Upload = {
  status?: string;
  status_reason?: string | null;
  total_rows?: number | null;
  passed?: number;
  failed?: number;
  skipped?: number;
};

/**
 * Terminal states, from the store's own union. The others -- uploaded,
 * file_validating, row_processing, finalising -- are the four stages in
 * flight, and naming them here is what lets a stall say WHICH one stalled.
 */
const DONE = new Set(['completed', 'failed', 'file_failed']);

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
              `worker, so "uploaded" means no job was consumed at all -- check the worker is ` +
              `running and reading the same queue -- while "file_validating", ` +
              `"row_processing" or "finalising" each name the stage that started and did not ` +
              `finish.`,
          );
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      if (last.status !== 'completed') {
        // file_failed is the whole file rejected before any row ran --
        // usually a header the parser does not recognise -- and the service
        // says which in status_reason.
        throw new Error(
          `STEP_FAILED: the upload ended "${last.status}": ` +
            `${last.status_reason ?? 'no reason given'}. That is a file-level rejection, ` +
            `not a bad row.`,
        );
      }
      if (!last.passed) {
        // The record reads completed with every row rejected, which is a
        // finished upload that onboarded nobody. status_reason covers the
        // FILE and is null here, so the per-row reasons are read out of
        // errors.csv -- otherwise this says a row failed and not why.
        throw new Error(
          `STEP_FAILED: the upload completed and passed no rows (${last.failed ?? 0} failed, ` +
            `${last.skipped ?? 0} skipped, of ${last.total_rows ?? 0}). The file was accepted ` +
            `and every row in it was not:\n${describeRowErrors(await readRowErrors(ctx, uploadId, token))}`,
        );
      }
    },
  });
