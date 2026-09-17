import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Runs `docker <args>`, surfacing stderr on failure so a red boot says why. */
export async function dockerRun(args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('docker', args, { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const detail = (e.stderr || e.stdout || e.message || '').trim();
    throw new Error(`STACK_UNHEALTHY: docker ${args.join(' ')}\n${detail}`);
  }
}
