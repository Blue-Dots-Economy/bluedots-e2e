import type { HttpEntryView } from './render_html.js';

/**
 * Shared by every renderer, so they cannot disagree about the same run.
 *
 * escape() was byte-identical in two of them, the duration helpers existed
 * in three variants, and the "did this request fail" test was written out
 * four times -- while the console renderer had none at all, so its totals
 * could differ from the HTML's for the same report.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Requests are mostly sub-second, where "0.0s" says nothing. */
export const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : seconds(ms));

/**
 * A recorded call that did not succeed.
 *
 * A null status with an error is a connection that never completed, which
 * is a failure with no status to show -- not a success.
 */
export const isFailedRequest = (h: HttpEntryView): boolean =>
  Boolean(h.error) || (h.status !== null && h.status >= 400);

export const failedRequests = (http: readonly HttpEntryView[]): HttpEntryView[] =>
  http.filter(isFailedRequest);
