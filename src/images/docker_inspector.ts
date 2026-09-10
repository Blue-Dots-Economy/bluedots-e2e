import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Inspector } from './images.js';

const run = promisify(execFile);

/**
 * Resolve a tag to a digest via the registry API, using docker's manifest
 * endpoint.
 *
 * Deliberately NOT the GitHub Packages API: that needs a `read:packages`
 * token scope which the default `gh` login does not carry, whereas this works
 * with the docker credentials a developer already has.
 */
export const dockerInspector: Inspector = async (ref) => {
  try {
    const { stdout } = await run('docker', ['manifest', 'inspect', '-v', ref], {
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed: unknown = JSON.parse(stdout);
    // A multi-arch tag yields an array of per-platform descriptors; a
    // single-arch tag yields one object. Both carry Descriptor.digest.
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const digest = (first as { Descriptor?: { digest?: string } })?.Descriptor?.digest;
    return digest ?? null;
  } catch {
    return null;
  }
};
