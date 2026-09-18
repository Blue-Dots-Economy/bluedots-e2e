import type { StepContext } from '../../journey/define_journey.js';

/**
 * The per-row rejections, in the service's own words.
 *
 * Not on the upload record -- `status_reason` covers the FILE -- these are
 * written to an errors.csv in object storage and handed out as a presigned
 * url. Reading it carries the same constraint as writing the upload did:
 * the signature covers the host, so the fetch is issued from inside the
 * network.
 */
export type RowErrors =
  | { ok: true; body: string }
  | { ok: false; why: string };

export async function readRowErrors(
  ctx: StepContext,
  uploadId: string,
  token: string,
): Promise<RowErrors> {
  try {
    const res = await ctx.http(
      `${ctx.endpoints.aggregatorApi}/v1/bulk-uploads/${uploadId}/errors.csv`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return { ok: false, why: `errors.csv unavailable: ${res.status}` };

    const { url } = (await res.json()) as { url?: string };
    if (!url) return { ok: false, why: 'errors.csv carried no url' };
    if (!ctx.execInStack) return { ok: false, why: 'no way to reach object storage from here' };

    const body = await ctx.execInStack('minio', ['sh', '-c', `curl -sS '${url}'`]);
    return body.trim()
      ? { ok: true, body: body.trim() }
      : { ok: false, why: 'errors.csv was empty' };
  } catch (err) {
    return { ok: false, why: err instanceof Error ? err.message : String(err) };
  }
}

/** Flattened for a message, where the full CSV would bury the reason. */
export function describeRowErrors(errors: RowErrors): string {
  return errors.ok ? errors.body : `(${errors.why})`;
}
