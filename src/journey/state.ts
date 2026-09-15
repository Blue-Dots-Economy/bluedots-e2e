import type { Baseline, ItemKey } from '../awaiters/ingest.js';

/**
 * What steps hand each other.
 *
 * Typed rather than a bag of unknowns: steps compose freely, so a scenario
 * can legitimately be written in an order where a precondition is missing,
 * and that has to fail with a sentence rather than "cannot read property of
 * undefined" three frames inside an awaiter.
 */
export type JourneyState = {
  itemKey?: ItemKey;
  itemState?: Record<string, unknown>;
  /**
   * Every profile this journey created, by the domain it was created as.
   *
   * An action needs two: blue_dot's `apply` runs seeker -> provider, so a
   * scenario creates both and each step has to be able to name which one it
   * means. itemKey stays the most recent, so every single-profile journey
   * is unaffected.
   */
  profiles?: Record<string, { key: ItemKey; itemState: Record<string, unknown>; email: string }>;
  /** The action a step performed, for the step that resolves it. */
  actionId?: string;
  /**
   * The notification queue as it stood before the triggering step.
   *
   * Seeding sends mail of its own, so "a job is queued" proves nothing --
   * only a job absent from this baseline was caused by the step.
   */
  notificationBaseline?: import('../awaiters/notification.js').NotificationBaseline;
  baseline?: Baseline;
  seed?: string;
};

/** Which step records each key, so a failure can name the one that is missing. */
const PROVIDED_BY: Record<keyof JourneyState, string> = {
  itemKey: 'createProfile',
  itemState: 'createProfile',
  baseline: 'createProfile',
  profiles: 'createProfile',
  actionId: 'performApply',
  notificationBaseline: 'the step that triggers the notification',
  seed: 'the run',
};

export function requireState<K extends keyof JourneyState>(
  state: JourneyState,
  key: K,
): NonNullable<JourneyState[K]> {
  const value = state[key];
  if (value === undefined) {
    throw new Error(
      `STEP_FAILED: this step needs "${key}", which ${PROVIDED_BY[key]} records. ` +
        `Check the step order in the scenario.`,
    );
  }
  return value as NonNullable<JourneyState[K]>;
}

/**
 * Read something the ENVIRONMENT provides, as opposed to a previous step.
 *
 * A missing probe means the environment lacks the redis/postgres
 * capabilities, not that the scenario is mis-ordered, so it gets its own
 * message.
 */
export function requireContext<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(
      `STEP_FAILED: this step needs ${what}, which this environment does not provide.`,
    );
  }
  return value;
}
