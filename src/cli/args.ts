/** Every service whose image a run resolves. */
// Re-exported, not redeclared: see src/services/registry.ts.
import { SERVICES, type Service } from '../services/registry.js';

export { SERVICES, type Service };

/** `{ __all__: branch }` moves every service; named keys move one each. */
export const ALL_SERVICES = '__all__';

export type Args = {
  dot: string | null;
  instance: string | null;
  env: string;
  journey: string | null;
  list: boolean;
  /** With --list: emit JSON, for a workflow matrix rather than a person. */
  json: boolean;
  /** With --list: only targets a journey declares. */
  covered: boolean;
  /** Emit the CI matrix: {target, label} per covered target, as JSON. */
  matrix: boolean;
  keepStack: boolean;
  branch: Record<string, string> | null;
  imagesFromTag: string | null;
};

const VALUE_FLAGS = new Set([
  '--dot',
  '--instance',
  '--env',
  '--journey',
  '--branch',
  '--images-from-tag',
]);
const BOOL_FLAGS = new Set(['--list', '--json', '--covered', '--matrix', '--keep-stack']);

function parseBranch(raw: string): Record<string, string> {
  // A bare branch applies to every service; `service=branch` pairs move one
  // each and leave the rest on the default. A cross-service change usually
  // lives on a branch in ONE repo, which is why the per-service form exists.
  if (!raw.includes('=')) {
    // An empty bare branch used to move every service to the tag "", which
    // docker rejects as an invalid reference -- reported three retries
    // later as REGISTRY_UNAVAILABLE. The per-service form is trimmed and
    // emptiness-checked below for exactly this reason.
    if (raw.trim() === '') {
      throw new Error('--branch needs a branch name. Pass one, or omit the flag.');
    }
    return { [ALL_SERVICES]: raw.trim() };
  }

  const out: Record<string, string> = {};
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [service, branch] = entry.split('=').map((s) => s.trim());
    if (!service || !branch) {
      throw new Error(`Invalid --branch entry "${entry}". Expected "service=branch".`);
    }
    if (!(SERVICES as readonly string[]).includes(service)) {
      throw new Error(`Unknown service "${service}" in --branch. Known: ${SERVICES.join(', ')}`);
    }
    out[service] = branch;
  }
  return out;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    dot: null,
    instance: null,
    env: 'local',
    journey: null,
    list: false,
    json: false,
    covered: false,
    matrix: false,
    keepStack: false,
    branch: null,
    imagesFromTag: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;

    if (BOOL_FLAGS.has(flag)) {
      if (flag === '--list') args.list = true;
      if (flag === '--json') args.json = true;
      if (flag === '--covered') args.covered = true;
      if (flag === '--matrix') args.matrix = true;
      if (flag === '--keep-stack') args.keepStack = true;
      continue;
    }

    if (!VALUE_FLAGS.has(flag)) {
      // Silently ignoring a typo'd flag is how a run quietly tests the wrong
      // thing — `--dott purple` would fall back to prompting or a default.
      throw new Error(`Unknown flag "${flag}".`);
    }

    const value = argv[++i];
    // A flag is never a value: `--dot --list` set dot to "--list" and
    // swallowed the flag, so the run looked for a target called "--list"
    // and silently did not list anything.
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Flag "${flag}" needs a value.`);
    }

    switch (flag) {
      case '--dot': {
        const [dot, instance] = value.split('/');
        args.dot = dot ?? null;
        if (instance) args.instance = instance;
        break;
      }
      case '--instance':
        args.instance = value;
        break;
      case '--env':
        // Parsed and then read by nothing: `--env external` booted a local
        // compose stack anyway. Silently running the wrong environment is
        // the same failure this parser rejects a typo'd flag to prevent,
        // so an environment the CLI cannot build is an error until
        // ExternalProvider is wired to it.
        if (value !== 'local') {
          throw new Error(
            `--env ${value} is not implemented. The CLI builds the local compose ` +
              `environment only; the external provider exists but nothing selects it yet.`,
          );
        }
        args.env = value;
        break;
      case '--journey':
        // Same: the CLI brings a stack up and takes it down, and cannot run
        // a journey at all. Accepting a selector for one promises something
        // it does not do -- use `pnpm test:stack`.
        throw new Error(
          `--journey is not implemented. The CLI brings a stack up and tears it ` +
            `down; run journeys with \`pnpm test:stack\`.`,
        );
      case '--branch':
        args.branch = parseBranch(value);
        break;
      case '--images-from-tag':
        args.imagesFromTag = value;
        break;
    }
  }

  if (args.branch && args.imagesFromTag) {
    throw new Error('Use --branch or --images-from-tag, not both.');
  }

  return args;
}
