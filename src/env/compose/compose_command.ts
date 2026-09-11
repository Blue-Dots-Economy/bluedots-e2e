import { dirname } from 'node:path';

/**
 * One compose project per stack, so two can never share containers, volumes
 * or a Redis stream.
 *
 * The suffix matters as much as the target. The negative control boots its
 * own stack for the SAME target, alongside the real one -- with the project
 * derived from (dot, instance) alone both were `journey-purple-dot`, so the
 * control's `up` reconfigured the real stack's containers onto the decoy
 * consumer group and its `down -v` destroyed the other's volumes. That it
 * never happened was down to `fileParallelism: false`, a config flag in
 * another file, rather than to anything here.
 */
export function projectName(
  target: { dot: string; instance: string | null },
  suffix?: string,
): string {
  const parts = [target.dot, target.instance, suffix].filter(Boolean).join('-');
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
