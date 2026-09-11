import type { Target } from '../targets/target_discovery.js';

export type Selection =
  | { kind: 'selected'; dot: string; instance: string | null }
  | { kind: 'prompt' };

export function renderTargetList(targets: readonly Target[]): string {
  return targets.map((t) => t.id).join('\n') + '\n';
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
