import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * Where the pinned `bluedots-schemas` checkout lives.
 *
 * Configuration, never a hardcoded path: the harness must be able to point at
 * a different checkout (a pinned SHA in CI, a sibling clone locally) without
 * a code change.
 */
export function schemasRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BLUEDOTS_SCHEMAS_PATH;
  if (configured) return resolve(configured);
  return fileURLToPath(new URL('../../../bluedots-schemas', import.meta.url));
}

/**
 * Where the signals-dpg checkout lives. Its `local-setup/docker-compose.yml`
 * is the base the harness overlays, so this is configuration rather than a
 * fixed relative path.
 */
export function signalsDpgRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SIGNALS_DPG_PATH;
  if (configured) return resolve(configured);
  return fileURLToPath(new URL('../../../Signals-DPG', import.meta.url));
}
