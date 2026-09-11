/** Every service whose image a run resolves. */
export const SERVICES = [
  'signals-dpg',
  'signals-search',
  'aggregator-dpg',
  'notification-service',
] as const;

export type Service = (typeof SERVICES)[number];

/** `{ __all__: branch }` moves every service; named keys move one each. */
export const ALL_SERVICES = '__all__';

export type Args = {
  dot: string | null;
  instance: string | null;
  env: string;
  journey: string | null;
  list: boolean;
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
const BOOL_FLAGS = new Set(['--list', '--keep-stack']);

function parseBranch(raw: string): Record<string, string> {
  // A bare branch applies to every service; `service=branch` pairs move one
  // each and leave the rest on the default. A cross-service change usually
  // lives on a branch in ONE repo, which is why the per-service form exists.
  if (!raw.includes('=')) return { [ALL_SERVICES]: raw };

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
    keepStack: false,
    branch: null,
    imagesFromTag: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;

    if (BOOL_FLAGS.has(flag)) {
      if (flag === '--list') args.list = true;
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
        args.env = value;
        break;
      case '--journey':
        args.journey = value;
        break;
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
