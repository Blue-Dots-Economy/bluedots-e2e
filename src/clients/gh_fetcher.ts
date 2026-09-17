import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SpecFetcher } from './spec_source.js';

const run = promisify(execFile);

async function gh(args: string[]): Promise<string> {
  const { stdout } = await run('gh', args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/**
 * Reads specs through `gh`, which already carries the developer's auth. The
 * repos are private, so an unauthenticated raw fetch would 404 in a way that
 * looks identical to a missing file.
 */
export const ghFetcher: SpecFetcher = {
  async resolveSha(repo, ref) {
    const out = await gh(['api', `repos/${repo}/commits/${ref}`, '--jq', '.sha']);
    return out.trim();
  },

  async readFile(repo, path, sha) {
    try {
      const out = await gh([
        'api',
        `repos/${repo}/contents/${path}?ref=${sha}`,
        '--jq',
        '.content',
      ]);
      return Buffer.from(out.trim(), 'base64').toString('utf8');
    } catch {
      return null;
    }
  },
};
