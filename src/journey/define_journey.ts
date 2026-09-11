import { checkCapabilitySlug, checkLabel, type Capability } from './guards.js';
import type { Endpoints } from '../env/compose/ports.js';

/** What a step is handed. State is the only thing that carries between steps. */
export type StepContext = {
  clients: Record<string, unknown>;
  endpoints: Endpoints;
  seeded: Record<string, unknown>;
  state: Record<string, unknown>;
  /**
   * The (dot, instance) this run is testing, with that target's own item
   * schema. The schema travels with the target because item_state differs
   * per network, and hardcoding one would mean test code per target.
   */
  target?: {
    network: string;
    domain: string;
    itemType: string;
    itemSchema: { required?: string[]; properties?: Record<string, unknown> };
  };
  /** Present only where the environment offers redis + postgres. */
  probe?: import('../awaiters/ingest.js').IngestProbe;
  auth?: { apiKey: string; actingOrgId: string; participantToken: string };
};

export type Step = {
  label: string;
  run: (ctx: StepContext) => Promise<void>;
  /** True only for `custom`, so review and the report can see raw logic. */
  isCustom: boolean;
};

/**
 * A named step. The label declared here IS the line the report prints --
 * nothing is translated at render time, which is what keeps the
 * business-facing report from drifting from what the tests assert.
 */
export function step(spec: {
  label: string;
  run: (ctx: StepContext) => Promise<void>;
}): Step {
  return { ...spec, isCustom: false };
}

/**
 * The escape hatch for a scenario that needs genuine logic.
 *
 * Named and labelled on purpose: dropping to raw code stays visible in the
 * diff and in the report, rather than hidden inside an ordinary step body.
 */
export function custom(spec: {
  label: string;
  run: (ctx: StepContext) => Promise<void>;
}): Step {
  return { ...spec, isCustom: true };
}

export type Journey = {
  id: string;
  title: string;
  capability: Capability;
  /** `(dot, instance)` ids, e.g. `purple_dot` or `blue_dot/ka-dhwd`. */
  targets: string[];
  steps: Step[];
};

/**
 * A scenario is a list of named steps, not a program.
 *
 * The guards run at definition time so a bad label fails in review rather
 * than surfacing months later in an unreadable report.
 */
export function defineJourney(spec: Journey): Journey {
  const title = checkLabel(spec.title);
  if (!title.ok) throw new Error(`${spec.id} title: ${title.reason}`);

  const capability = checkCapabilitySlug(spec.capability);
  if (!capability.ok) throw new Error(`${spec.id} capability: ${capability.reason}`);

  if (spec.targets.length === 0) {
    // A journey with no targets is collected, reported as present, and runs
    // nowhere -- indistinguishable from coverage.
    throw new Error(`${spec.id} declares no target to run against.`);
  }

  for (const s of spec.steps) {
    const label = checkLabel(s.label);
    if (!label.ok) throw new Error(`${spec.id} step: ${label.reason}`);
  }

  return spec;
}

export type StepOutcome = { label: string; ok: boolean; error?: string };

export type JourneyResult = {
  ok: boolean;
  failedStep?: string;
  trace: StepOutcome[];
  state: Record<string, unknown>;
};

/**
 * Run a journey's steps in order, stopping at the first failure.
 *
 * Continuing past a failure would produce a trace where the interesting line
 * is buried among cascading errors from steps whose preconditions never held.
 */
export async function runJourney(
  journey: Journey,
  ctx: StepContext,
): Promise<JourneyResult> {
  const trace: StepOutcome[] = [];

  for (const s of journey.steps) {
    try {
      await s.run(ctx);
      trace.push({ label: s.label, ok: true });
    } catch (err: unknown) {
      trace.push({
        label: s.label,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, failedStep: s.label, trace, state: ctx.state };
    }
  }

  return { ok: true, trace, state: ctx.state };
}
