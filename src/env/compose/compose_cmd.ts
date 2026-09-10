import { dirname } from 'node:path';

/**
 * One compose project per target, so two targets can never share containers,
 * volumes or a Redis stream. A run tests one target; the project name is what
 * keeps successive runs from colliding.
 */
export function projectName(target: { dot: string; instance: string | null }): string {
  const parts = [target.dot, target.instance].filter(Boolean).join('-');
  return `journey-${parts.replace(/_/g, '-')}`;
}

export function composeArgs(opts: {
  project: string;
  baseFile: string;
  overlayFile: string;
  envFile: string;
  command: readonly string[];
}): string[] {
  return [
    'compose',
    '-p', opts.project,
    // Relative paths inside the base compose (../infra/keycloak/providers and
    // friends) resolve against the project directory, so it must stay
    // local-setup's own directory or every bind mount breaks.
    '--project-directory', dirname(opts.baseFile),
    '--env-file', opts.envFile,
    '-f', opts.baseFile,
    '-f', opts.overlayFile,
    // Both are opt-in in the base compose: search carries signals-search and
    // TEI, keycloak carries Keycloak, mailpit and the user-profile fixup.
    '--profile', 'keycloak',
    '--profile', 'search',
    ...opts.command,
  ];
}
