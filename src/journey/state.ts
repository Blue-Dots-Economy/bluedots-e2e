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
  profiles?: Record<
    string,
    { key: ItemKey; itemState: Record<string, unknown>; email: string; userId: string }
  >;
  /**
   * Accounts created WITHOUT a profile, by the domain they were registered
   * for. The self-service create needs a person who exists and owns nothing
   * yet; `profiles` is for people who already have one.
   */
  accounts?: Record<string, { userId: string; email: string }>;
  /** The action a step performed, for the step that resolves it. */
  actionId?: string;
  /** Who signed themselves up, for the step that checks they are known. */
  signedUp?: {
    email: string;
    domain: string;
    /** Known once they have logged in: the local user row exists only from then. */
    userId?: string;
  };
  /** The guardian address a ward named, for the step that checks it was emailed. */
  guardianEmail?: string;
  /** The reference a support submission was answered with. */
  supportReference?: string;
  /**
   * Mailpit as it stood before the triggering step.
   *
   * Seeding and earlier steps send mail of their own, so "a message
   * arrived" proves nothing -- only one absent from this baseline was
   * caused by the step.
   */
  mailBaseline?: import('../awaiters/mail.js').MailBaseline;
  baseline?: Baseline;
  seed?: string;
};

/** Which step records each key, so a failure can name the one that is missing. */
const PROVIDED_BY: Record<keyof JourneyState, string> = {
  itemKey: 'createProfile',
  itemState: 'createProfile',
  baseline: 'createProfile',
  profiles: 'createProfile',
  accounts: 'registerAccount',
  actionId: 'applyTo',
  signedUp: 'signUp',
  guardianEmail: 'nameAGuardian',
  supportReference: 'submitSupportRequest',
  mailBaseline: 'the step that triggers the email',
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
