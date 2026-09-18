import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import { buildItemState } from '../../fixtures/item_state.js';
import { phoneFromSeed } from './contact_details.js';
import type { JourneyState } from '../../journey/state.js';

type Created = { upload_id?: string; upload_url?: string; content_type?: string };

/**
 * Build this run's row against the header the product gave us.
 *
 * The template supplies the COLUMNS -- generated from the network's own
 * participant schema, so a schema change moves them without touching this
 * -- and the values come from the same schema-driven generator every other
 * journey uses. Both halves matter.
 *
 * Hand-authoring two dozen columns is how the sample CSVs that used to ship
 * with the aggregator rotted into files its own parser rejected. But the
 * template's example ROW cannot be uploaded either: it illustrates format,
 * with values like "Example Location", and signals refuses it outright
 * (INVALID_ITEM_STATE). Only the header is worth taking.
 *
 * Columns the generator has no value for are left empty, which is what an
 * optional column is in a CSV.
 */
export function buildRow(
  header: string,
  itemState: Record<string, unknown>,
  arrayDelimiter = '|',
): string {
  const columns = header.trim().split(',').map((c) => c.trim());
  const cells = columns.map((column) => {
    const value = itemState[column];
    if (value === undefined || value === null) return '';
    // The network declares its own delimiter; an array sent as "a,b" would
    // be read as two columns and shift every field after it.
    if (Array.isArray(value)) return value.join(arrayDelimiter);
    return String(value);
  });
  return `${columns.join(',')}\n${cells.join(',')}\n`;
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
export const uploadParticipants = (spec: { as: string; withAnInvalidRow?: boolean }) =>
  step({
    label: spec.withAnInvalidRow
      ? `Uploaded a file of ${spec.as.replace(/_/g, ' ')} participants, one of them incomplete`
      : `Uploaded a file of ${spec.as.replace(/_/g, ' ')} participants`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const execInStack = requireContext(ctx.execInStack, 'the stack network');
      const target = requireContext(ctx.target, 'target');
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
      const [header] = (await template.text()).trim().split(/\r?\n/);
      if (!header) {
        throw new Error('STEP_FAILED: the template carried no header row to build against.');
      }

      // The same generator, and the same schema, the aggregator-free
      // journeys build their profiles from -- so a row that signals refuses
      // is signals disagreeing with its own schema, not this fixture
      // guessing.
      const { itemSchema } = target.schemaFor(spec.as);
      const phone = phoneFromSeed(seed, 'bulk');
      const itemState = {
        ...buildItemState(itemSchema as never, seed),
        // Overridden after generation: this is how the participant is found
        // afterwards, and the template carries no email column at all.
        phone,
      };
      let csv = buildRow(header, itemState);
      state.bulkPhone = phone;

      if (spec.withAnInvalidRow) {
        // A second row missing a REQUIRED field, and nothing else. The
        // point is a row the aggregator's own validation rejects on its
        // way in, not one signals refuses later: a rejection that reaches
        // signals at all is a different assertion, and a different bug.
        const required = (itemSchema.required ?? [])[0];
        if (!required) {
          throw new Error(
            `STEP_FAILED: ${target.network}'s "${spec.as}" schema requires no field, so no ` +
              `row can be made invalid by omission and this journey would assert nothing.`,
          );
        }
        const invalidPhone = phoneFromSeed(seed, 'bulk-invalid');
        const invalid = buildRow(header, {
          ...itemState,
          phone: invalidPhone,
          [required]: '',
        });
        // Header once, then both rows.
        csv = `${csv}${invalid.split('\n')[1]}\n`;
        state.bulkInvalidPhone = invalidPhone;
        state.bulkInvalidField = required;
      }

      const created = await ctx.http(`${ctx.endpoints.aggregatorApi}/v1/bulk-uploads`, {
        method: 'POST',
        headers: { ...authorized, 'content-type': 'application/json' },
        body: JSON.stringify({ participant_type: spec.as }),
      });
      if (!created.ok) {
        throw new Error(`STEP_FAILED: create upload ${created.status} ${await created.text()}`);
      }
      const {
        upload_id: uploadId,
        upload_url: uploadUrl,
        content_type: contentType,
      } = (await created.json()) as Created;
      if (!uploadId || !uploadUrl) {
        throw new Error('STEP_FAILED: the create returned no upload id or no presigned url.');
      }
      state.bulkUploadId = uploadId;

      // Written to a file first, and uploaded FROM it. Piping into
      // `--upload-file -` makes curl stream with chunked encoding and no
      // Content-Length, which S3 rejects outright (MissingContentLength) --
      // the object store needs the size up front.
      //
      // printf, not a heredoc: the body comes from the template and a seed,
      // so it carries no quotes or backslashes, and printf keeps the
      // newlines the parser needs without a second layer of escaping.
      const body = csv.replace(/'/g, '').replace(/\n/g, '\\n');
      const out = await execInStack('minio', [
        'sh',
        '-c',
        `printf '%b' '${body}' > /tmp/journey.csv && ` +
          `curl -sS -X PUT --upload-file /tmp/journey.csv ` +
          // The type the presign was issued for. Sending a different one
          // fails the signature when the presign covered it.
          `-H 'Content-Type: ${contentType ?? 'text/csv'}' ` +
          `-w '%{http_code}' '${uploadUrl}'`,
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
