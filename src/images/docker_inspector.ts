import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Inspector } from './images.js';

const run = promisify(execFile);

/** Runs `docker manifest inspect -v <ref>` and returns stdout. */
export type ManifestReader = (ref: string) => Promise<string>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const isAuthFailure = (detail: string) =>
  /unauthorized|denied|authentication required/i.test(detail);

/** Only these mean the tag genuinely is not there. */
const isMissing = (detail: string) =>
  /manifest unknown|no such manifest|not found|manifest_unknown/i.test(detail);

/**
 * Resolve a tag to a digest, distinguishing three outcomes that a bare
 * try/catch collapses into one.
 *
 * A transient registry error reported as IMAGE_NOT_FOUND sends the reader
 * hunting for an image that exists -- which happened here, on an image that
 * had booted successfully minutes earlier in the same run. So a blip is
 * retried and then reported as REGISTRY_UNAVAILABLE, an auth failure is
 * reported as REGISTRY_UNAUTHORIZED and not retried because it will not fix
 * itself, and only an explicit "manifest unknown" counts as missing.
 */
export function makeInspector(
  read: ManifestReader,
  opts: { retries?: number; backoffMs?: number } = {},
): Inspector {
  const retries = opts.retries ?? 3;
  const backoffMs = opts.backoffMs ?? 500;

  return async (ref) => {
    let lastDetail = '';
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const parsed: unknown = JSON.parse(await read(ref));
        // A multi-arch tag yields an array of per-platform descriptors; a
        // single-arch tag yields one object. Both carry Descriptor.digest.
        const first = Array.isArray(parsed) ? parsed[0] : parsed;
        return (first as { Descriptor?: { digest?: string } })?.Descriptor?.digest ?? null;
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        lastDetail = String(e.stderr ?? e.message ?? err);

        if (isAuthFailure(lastDetail)) {
          throw new Error(
            `REGISTRY_UNAUTHORIZED: ${ref} — the registry refused the credentials. ` +
              `In CI this usually means the job lacks \`packages: read\`.`,
          );
        }
        if (isMissing(lastDetail)) return null;
        if (attempt < retries) await sleep(backoffMs * attempt);
      }
    }

    throw new Error(
      `REGISTRY_UNAVAILABLE: ${ref} — ${retries} attempts failed. Last error: ${lastDetail}`,
    );
  };
}

export const dockerInspector: Inspector = makeInspector(async (ref) => {
  const { stdout } = await run('docker', ['manifest', 'inspect', '-v', ref], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
});
