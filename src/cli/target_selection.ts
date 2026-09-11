import type { Target } from '../targets/target_discovery.js';

export type Selection =
  | { kind: 'selected'; dot: string; instance: string | null }
  | { kind: 'prompt' };

export function renderTargetList(
  targets: readonly Target[],
  opts: { json?: boolean } = {},
): string {
  // JSON so the workflow builds its matrix from the discovered targets
  // rather than a second, hand-maintained list that silently keeps testing
  // the old set when a dot is added.
  if (opts.json) return `${JSON.stringify(targets.map((t) => t.id))}\n`;
  return targets.map((t) => t.id).join('\n') + '\n';
}

/**
 * The targets worth booting: defined by the schemas AND declared by a
 * journey.
 *
 * Discovery alone finds every dot in the schemas repo, three of which no
 * journey mentions -- a matrix built from it boots stacks that assert
 * nothing. A journey's declared target that the schemas do not define is
 * dropped rather than scheduled, since it can only fail at resolution
 * minutes into a run.
 */
export function coveredTargets(
  targets: readonly Target[],
  journeys: readonly { targets: readonly string[] }[],
): string[] {
  const declared = new Set(journeys.flatMap((j) => j.targets));
  return targets.map((t) => t.id).filter((id) => declared.has(id));
}

/**
 * The CI matrix: the exact target to verify, and what to call the job.
 *
 * A job list reading "verify blue_dot/ka-dhwd" spends its width on the
 * instance, which is the part a reader scanning for a red dot does not
 * need. The label drops it -- unless two covered targets share a dot, when
 * two jobs both reading "verify blue_dot" would be worse than the noise:
 * a red one could not be told from a green one.
 *
 * `target` is always the precise id. Everything that resolves a target,
 * names an artifact or seeds a fixture uses that, never the label.
 */
export function matrixEntries(
  targets: readonly Target[],
  journeys: readonly { targets: readonly string[] }[],
): { target: string; label: string }[] {
  const covered = coveredTargets(targets, journeys);
  const dots = covered.map((id) => id.split('/')[0] ?? id);

  return covered.map((target, i) => {
    const dot = dots[i] ?? target;
    const shared = dots.filter((d) => d === dot).length > 1;
    return { target, label: shared ? target : dot };
  });
}

/**
 * Decide which target a run tests.
 *
 * In CI a missing or ambiguous target is an ERROR, never a prompt and never a
 * default. A run that quietly picks a target verifies something nobody asked
 * for and reports it as though they had.
 */
export function resolveSelection(
  args: { dot: string | null; instance: string | null },
  targets: readonly Target[],
  ctx: { isCI: boolean },
): Selection {
  const names = targets.map((t) => t.id).join(', ');

  if (!args.dot) {
    if (ctx.isCI) {
      throw new Error(`--dot is required in CI. Available targets: ${names}`);
    }
    return { kind: 'prompt' };
  }

  const id = args.instance ? `${args.dot}/${args.instance}` : args.dot;
  if (targets.some((t) => t.id === id)) {
    return { kind: 'selected', dot: args.dot, instance: args.instance };
  }

  // A dot that has instances is not itself a target (see listTargets).
  const instancesOfDot = targets.filter((t) => t.dot === args.dot && t.instance);
  if (!args.instance && instancesOfDot.length > 0) {
    const options = instancesOfDot.map((t) => t.id).join(', ');
    if (ctx.isCI) {
      throw new Error(
        `"${args.dot}" has instances and is not itself a target. Choose one: ${options}`,
      );
    }
    return { kind: 'prompt' };
  }

  throw new Error(`Unknown target "${id}". Available: ${names}`);
}
