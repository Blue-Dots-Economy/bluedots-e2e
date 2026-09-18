import { checkCapabilitySlug, checkLabel, type Capability } from './guards.js';
import type { Endpoints } from '../env/compose/ports.js';

/** What a step is handed. State is the only thing that carries between steps. */
export type StepContext = {
  clients: Record<string, unknown>;
  /**
   * Every HTTP call a step makes goes through this, never global fetch.
   * A run wires the recorder in here so the report can show the request and
   * the response behind a failure; it is required rather than optional so a
   * new step cannot quietly opt out of being recorded.
   */
  http: typeof fetch;
  endpoints: Endpoints;
  seeded: Record<string, unknown>;
  state: Record<string, unknown>;
  /**
   * The (dot, instance) this run is testing, resolving its own schemas per
   * domain. A resolver rather than one domain's schema: a step declares
   * which domain it acts as, and the fixture has to come from that domain
   * -- otherwise anything but the hardcoded one sends the wrong fields.
   */
  target?: import('../targets/target_schemas.js').TargetSchemas;
  /** Present only where the environment offers redis + postgres. */
  probe?: import('../awaiters/ingest.js').IngestProbe;
  /**
   * Reads the queues notification-service writes to. Present only where the
   * environment runs it -- a journey asserting a notification reports NOT
   * COVERED elsewhere rather than asserting something weaker.
   */
  notifications?: import('../awaiters/notification.js').NotificationProbe;
  /**
   * Mints a credential that authenticates AS a participant. Present only
   * where the environment offers postgres -- a journey where a person acts
   * for themselves (creates their own profile, accepts a request, views the
   * contact details they were granted) cannot be faked with the aggregator's
   * service key, so it reports NOT COVERED elsewhere.
   */
  keys?: import('../env/participant_keys.js').ParticipantKeys;
  /**
   * The mailbox the stack sends to. Present only where the environment runs
   * a mail server -- an approval link exists nowhere but inside an email,
   * so a journey that approves anything is NOT COVERED without one.
   */
  mail?: import('../awaiters/mailbox.js').MailProbe;
  /**
   * Mints a client-credentials token for a realm client.
   *
   * A factory rather than a token: these are short-lived and a run outlives
   * one, so a value captured at boot expires mid-suite and every later
   * journey fails on a 401 that looks like a broken realm.
   */
  serviceToken?: (clientId: string) => Promise<string>;
  /**
   * Reads a person's realm record. The whole effect of approving an
   * organisation is in the realm -- the owner goes from disabled to
   * enabled, gains a role and joins a group -- and none of it is visible
   * over any HTTP API.
   */
  realmUser?: (
    email: string,
  ) => Promise<{ id: string; enabled: boolean; roles: string[]; groups: string[] } | null>;
  /** Reads the organisations the NETWORK holds, which is where a coordinator lands. */
  networkOrgs?: { findBySlug: (slug: string) => Promise<{ id: string; name: string } | null> };
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

export type StepOutcome = { label: string; ok: boolean; durationMs: number; error?: string };

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
  hooks: { onStep?: (label: string) => void } = {},
): Promise<JourneyResult> {
  const trace: StepOutcome[] = [];

  for (const s of journey.steps) {
    // Before the step runs: requests it makes belong to it, not to the
    // step that happened to run before.
    hooks.onStep?.(s.label);
    const started = Date.now();
    try {
      await s.run(ctx);
      trace.push({ label: s.label, ok: true, durationMs: Date.now() - started });
    } catch (err: unknown) {
      trace.push({
        label: s.label,
        ok: false,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, failedStep: s.label, trace, state: ctx.state };
    }
  }

  return { ok: true, trace, state: ctx.state };
}
