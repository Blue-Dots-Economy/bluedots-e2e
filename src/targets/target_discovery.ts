import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * A target is a (dot, instance) pair — the unit a run tests.
 *
 * It is NOT a network. `bluedots-schemas` nests deployed instances under a
 * dot, and the instance config is not cosmetic: blue_dot/ka-dhwd declares a
 * third domain (`service_provider`) and different actions from the dot-level
 * config. Nothing deploys the dot-level config for a dot that has instances,
 * so offering it as a target would invite verifying a configuration that
 * ships nowhere.
 */
export type Target = {
  /** `purple_dot` or `blue_dot/ka-dhwd`. */
  id: string;
  dot: string;
  instance: string | null;
};

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function hasNetworkConfig(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, 'network.json'))).isFile();
  } catch {
    return false;
  }
}

/**
 * Discover every target the given `bluedots-schemas` checkout offers.
 *
 * A dot directory holding `network.json` is a target only when it has no
 * instance subdirectories of its own.
 */
export async function listTargets(schemasRoot: string): Promise<Target[]> {
  const entries = await readdir(schemasRoot, { withFileTypes: true });
  const targets: Target[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dot = entry.name;
    const dotDir = join(schemasRoot, dot);
    if (!(await hasNetworkConfig(dotDir))) continue;

    const instances: string[] = [];
    for (const child of await readdir(dotDir, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      const childDir = join(dotDir, child.name);
      if (!(await isDirectory(childDir))) continue;
      if (await hasNetworkConfig(childDir)) instances.push(child.name);
    }

    if (instances.length === 0) {
      targets.push({ id: dot, dot, instance: null });
      continue;
    }
    for (const instance of instances.sort()) {
      targets.push({ id: `${dot}/${instance}`, dot, instance });
    }
  }

  return targets.sort((a, b) => a.id.localeCompare(b.id));
}

/** A target resolved against a schemas checkout: every path the stack needs. */
export type ResolvedTarget = Target & {
  networkConfigPath: string;
  consentPath: string | null;
  brandPath: string | null;
  /**
   * `SERVED_DOMAINS` is DERIVED from the resolved config's domains, never
   * hand-written. signals-dpg 4xxs a create for an unserved domain
   * (`create_item.ts`, `isServedDomainBinding`), and ka-dhwd needs three
   * bindings where the dot-level config needs two. Deriving it is what keeps
   * adding a target free of test code.
   */
  servedDomains: string;
};

async function firstExisting(...paths: string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      if ((await stat(path)).isFile()) return path;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export async function resolveTarget(
  rawSchemasRoot: string,
  dot: string,
  instance: string | null,
): Promise<ResolvedTarget> {
  // Always absolute. These paths become compose bind sources, and compose
  // resolves a relative source against the PROJECT directory -- signals-dpg's
  // local-setup, not this repo. Worse, Docker creates a missing bind source
  // as an empty directory instead of erroring, so a relative path here
  // surfaces much later as EISDIR inside a container.
  const schemasRoot = isAbsolute(rawSchemasRoot) ? rawSchemasRoot : resolve(rawSchemasRoot);
  const available = await listTargets(schemasRoot);
  const id = instance ? `${dot}/${instance}` : dot;
  const match = available.find((t) => t.id === id);

  if (!match) {
    const names = available.map((t) => t.id).join(', ');
    throw new Error(`Unknown target "${id}". Available: ${names}`);
  }

  const dotDir = join(schemasRoot, dot);
  const dir = instance ? join(dotDir, instance) : dotDir;
  const networkConfigPath = join(dir, 'network.json');

  const raw = await readFile(networkConfigPath, 'utf8');
  const config = JSON.parse(raw) as { id: string; domains?: { id: string }[] };
  const servedDomains = (config.domains ?? [])
    .map((d) => `${config.id}/${d.id}`)
    .join(',');

  return {
    ...match,
    networkConfigPath,
    consentPath: await firstExisting(
      join(dir, 'consent.json'),
      join(dotDir, 'consent.json'),
    ),
    brandPath: await firstExisting(join(dir, 'brand.json'), join(dotDir, 'brand.json')),
    servedDomains,
  };
}
