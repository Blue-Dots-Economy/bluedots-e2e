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
  /**
   * The organisation a journey registered, and the coordinator under it.
   *
   * Two tiers, kept apart: the organisation is approved by the network
   * admin and never reaches signals, while the coordinator is approved by
   * that organisation's owner and IS what gets an organisation in the
   * network. Collapsing them would hide which approval a later step means.
   */
  organisation?: { id: string; ownerEmail: string; slug?: string };
  coordinator?: { id: string; email: string; slug?: string };
  /** A token for the approved coordinator, carrying the claims its approval set. */
  coordinatorToken?: string;
  /** The bulk upload a step created, for the steps that start and await it. */
  bulkUploadId?: string;
  /**
   * The number the uploaded row carries, which is how the participant is
   * found afterwards. A phone and not an address: the seeker template
   * declares no email column at all.
   */
  bulkPhone?: string;
  /** The number on the row that was meant to be rejected, and the field left blank. */
  bulkInvalidPhone?: string;
  bulkInvalidField?: string;
  /**
   * The mailbox as it stood before the triggering step.
   *
   * An approval token exists only inside an email, and the run has sent
   * plenty by this point -- so only a message absent from this set was
   * caused by the step.
   */
  mailBaseline?: import('../awaiters/mailbox.js').MailBaseline;
  /** The action a step performed, for the step that resolves it. */
  actionId?: string;
  /** Who signed themselves up, for the step that checks they are known. */
  signedUp?: { email: string; domain: string };
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
  accounts: 'registerAccount',
  organisation: 'registerOrganisation',
  coordinator: 'registerCoordinator',
  coordinatorToken: 'signInAsCoordinator',
  bulkUploadId: 'uploadParticipants',
  bulkPhone: 'uploadParticipants',
  bulkInvalidPhone: 'uploadParticipants with an invalid row',
  bulkInvalidField: 'uploadParticipants with an invalid row',
  mailBaseline: 'the step that triggers the email',
  actionId: 'applyTo',
  signedUp: 'signUp',
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
