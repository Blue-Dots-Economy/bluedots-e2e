export type HttpEntry = {
  step: string | null;
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  error?: string;
};

const MAX_BODY = 4000;

/** Anything whose value is a credential, not just anything that looks odd. */
const SECRET_HEADERS = ['x-api-key', 'authorization', 'cookie', 'set-cookie'];

function redact(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    // Reports are uploaded as CI artifacts, which are far more widely
    // readable than the stack they came from.
    out[k] = SECRET_HEADERS.includes(k.toLowerCase()) ? 'REDACTED' : v;
  }
  return out;
}

function truncate(body: string): string {
  if (body.length <= MAX_BODY) return body;
  return `${body.slice(0, MAX_BODY)}\n… truncated, ${body.length - MAX_BODY} more characters`;
}

function headersOf(init?: RequestInit): Record<string, string> {
  const h = init?.headers;
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

/**
 * Wraps fetch so a run can show the request and response behind a failure.
 *
 * Without this a failed step carries only the message it chose to throw --
 * the request body, the headers and the response are gone by the time
 * anything renders, so the report can say what failed but not why.
 */
export function createRecorder(impl: typeof fetch = fetch) {
  const entries: HttpEntry[] = [];
  let step: string | null = null;

  return {
    entries,
    startStep(label: string) {
      step = label;
    },

    // Signature matches global fetch so it can be dropped in wherever a
    // step would otherwise have called fetch directly.
    async fetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
      const started = Date.now();
      const entry: HttpEntry = {
        step,
        method: init?.method ?? (url instanceof Request ? url.method : 'GET'),
        url: url instanceof Request ? url.url : String(url),
        status: null,
        durationMs: 0,
        requestHeaders: redact(headersOf(init)),
        ...(init?.body ? { requestBody: truncate(String(init.body)) } : {}),
      };

      try {
        const res = await impl(url, init);
        // Clone before reading: consuming the body here would leave the
        // caller with a used stream and a "body already read" error.
        const text = await res.clone().text();
        entry.status = res.status;
        entry.responseBody = truncate(text);
        entry.durationMs = Date.now() - started;
        entries.push(entry);
        return res;
      } catch (err: unknown) {
        // A connection refused has no status, and is precisely what a
        // reader needs to see.
        entry.error = err instanceof Error ? err.message : String(err);
        entry.durationMs = Date.now() - started;
        entries.push(entry);
        throw err;
      }
    },
  };
}

export type HttpRecorder = ReturnType<typeof createRecorder>;
