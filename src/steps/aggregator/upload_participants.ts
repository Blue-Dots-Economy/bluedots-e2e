import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

type Created = { upload_id?: string; upload_url?: string };

/**
 * Make the template's example row this run's own.
 *
 * The template is the product's own: header plus one worked example,
 * generated from the network's participant schema. Taking it rather than
 * hand-authoring two dozen columns means a schema change moves both sides
 * together -- a hand-written fixture would rot into something the parser
 * rejects, which is exactly what happened to the sample CSVs that used to
 * ship with the aggregator.
 *
 * Only the identifying columns are rewritten, and only when present: the
 * journey has to be able to find ITS participant afterwards, and an
 * unmodified example would collide with every other run's.
 */
export function personaliseRow(csv: string, seed: string): string {
  const lines = csv.trim().split(/\r?\n/);
  const [header, example] = lines;
  if (!header || !example) {
    throw new Error(
      `STEP_FAILED: the template is not a header plus an example row; it has ` +
        `${lines.length} line(s). Nothing can be built from it.`,
    );
  }

  const columns = header.split(',').map((c) => c.trim());
  const cells = example.split(',');
  // Digits only and 10-15 long, or the contact schema rejects the row
  // before anything reaches signals.
  const digits = `9${seed.replace(/\D/g, '').padEnd(9, '0').slice(0, 9)}`;

  const personalised = columns.map((column, i) => {
    const cell = cells[i] ?? '';
    const name = column.toLowerCase();
    if (name.includes('email')) return `journey-bulk-${seed}@example.test`;
    if (name.includes('phone') || name.includes('mobile')) return digits;
    if (name === 'name' || name.includes('beneficiary')) return `Journey Bulk ${seed}`;
    return cell;
  });

  return `${header}\n${personalised.join(',')}\n`;
}

/**
 * The aggregator uploads a file of participants.
 *
 * Three hops, and the middle one is the reason this step exists rather than
 * being two: the API hands back a PRESIGNED url, the bytes go to object
 * storage directly, and only then does `start` enqueue anything. Skipping
 * the middle hop makes `start` answer "CSV upload not found in object
 * storage", which reads as a storage fault rather than a test that never
 * uploaded.
 *
 * The PUT is issued from inside the network. A presigned URL is signed over
 * its Host header, so it cannot be re-based onto a published port the way
 * an emailed approval link can -- the signature would not survive. The
 * object-storage image ships curl (its own healthcheck uses it), so the URL
 * goes out exactly as it was minted.
 */
export const uploadParticipants = (spec: { as: string }) =>
  step({
    label: `Uploaded a file of ${spec.as.replace(/_/g, ' ')} participants`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const execInStack = requireContext(ctx.execInStack, 'the stack network');
      const token = requireState(state, 'coordinatorToken');
      const seed = requireState(state, 'seed');
      const authorized = { authorization: `Bearer ${token}` };

      const template = await ctx.http(
        `${ctx.endpoints.aggregatorApi}/v1/bulk-uploads/template?participant_type=${spec.as}&format=csv`,
        { headers: authorized },
      );
      if (!template.ok) {
        throw new Error(
          `STEP_FAILED: template ${template.status} ${await template.text()}`,
        );
      }
      const csv = personaliseRow(await template.text(), seed);
      state.bulkEmail = `journey-bulk-${seed}@example.test`;

      const created = await ctx.http(`${ctx.endpoints.aggregatorApi}/v1/bulk-uploads`, {
        method: 'POST',
        headers: { ...authorized, 'content-type': 'application/json' },
        body: JSON.stringify({ participant_type: spec.as }),
      });
      if (!created.ok) {
        throw new Error(`STEP_FAILED: create upload ${created.status} ${await created.text()}`);
      }
      const { upload_id: uploadId, upload_url: uploadUrl } =
        (await created.json()) as Created;
      if (!uploadId || !uploadUrl) {
        throw new Error('STEP_FAILED: the create returned no upload id or no presigned url.');
      }
      state.bulkUploadId = uploadId;

      // printf, not a heredoc: the body is built from the template and a
      // seed, so it carries no quotes or backslashes, and printf keeps the
      // newlines the parser needs without a second layer of escaping.
      const body = csv.replace(/'/g, '').replace(/\n/g, '\\n');
      const out = await execInStack('minio', [
        'sh',
        '-c',
        `printf '%b' '${body}' | curl -sS -X PUT --upload-file - -w '%{http_code}' '${uploadUrl}'`,
      ]);
      if (!/(^|\D)20\d(\s|$)/.test(out.trim())) {
        throw new Error(
          `STEP_FAILED: the presigned upload answered "${out.trim()}". A signature error here ` +
            `means the url was minted for a host this PUT did not use.`,
        );
      }

      const started = await ctx.http(
        `${ctx.endpoints.aggregatorApi}/v1/bulk-uploads/${uploadId}/start`,
        {
          method: 'POST',
          headers: { ...authorized, 'content-type': 'application/json' },
          // The operator's attestation of authority. Without it the route
          // refuses before any storage work, which is the point of it.
          body: JSON.stringify({ attestation: true }),
        },
      );
      if (!started.ok) {
        throw new Error(`STEP_FAILED: start ${started.status} ${await started.text()}`);
      }
    },
  });
