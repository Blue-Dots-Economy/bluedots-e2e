import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import { awaitEmailDelivered } from '../../awaiters/mail.js';

type Recipient = { profile: string } | { signedUp: true } | { address: string };

const describeRecipient = (to: Recipient) =>
  'profile' in to
    ? `the ${to.profile.replace(/_/g, ' ')}`
    : 'signedUp' in to
      ? 'the person who signed up'
      : to.address;

function resolveAddress(to: Recipient, state: JourneyState): string {
  if ('address' in to) return to.address;
  if ('signedUp' in to) return requireState(state, 'signedUp').email;

  const profiles = requireState(state, 'profiles');
  const profile = profiles[to.profile];
  if (!profile) {
    throw new Error(
      `STEP_FAILED: this step needs a "${to.profile}" profile, and this journey ` +
        `created ${Object.keys(profiles).join(', ') || 'none'}.`,
    );
  }
  return profile.email;
}

/**
 * Assert the step before this one caused an email that was DELIVERED.
 *
 * Read from the stack's Mailpit, where notification-service sends over
 * SMTP. A delivered message means signals-dpg sent the event,
 * notification-service accepted it, resolved a template from the target's
 * catalogue, rendered it and handed it to a transport -- the whole path,
 * not just the hop into a queue.
 *
 * signals-dpg sends these best-effort and swallows its own failures, which
 * is precisely why nothing downstream would notice a broken pipeline.
 */
export const expectEmailDelivered = (spec: {
  /** Who it is for: a profile this journey created, whoever signed up, or a literal address. */
  to: Recipient;
  /**
   * What it is about, in the words the report should print. Never a
   * template key: the label is the business-facing report line.
   */
  about: string;
  /** A stable fragment of the catalogue subject for every target the journey runs on. */
  subjectIncludes?: string;
  /** Stable fragments of the rendered body: a rendered variable, the link host. */
  bodyIncludes?: string[];
  cc?: string[];
  replyTo?: string;
  /**
   * The event type notification-service recorded for this recipient. The
   * event, never the template key: the event is what signals-dpg says
   * happened, and the catalogue is free to choose any template for it.
   */
  recordedAs?: string;
  /**
   * The recipient domain recorded with that event, when the journey knows
   * it. null asserts a network-wide event (support, guardian codes).
   */
  recordedDomain?: string | null;
  deadlineMs?: number;
}) =>
  step({
    label: `Emailed ${describeRecipient(spec.to)} about ${spec.about}`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const probe = requireContext(ctx.mail, 'a mail probe');
      const baseline = requireState(state, 'mailBaseline');
      const to = resolveAddress(spec.to, state);

      await awaitEmailDelivered(
        probe,
        {
          to,
          ...(spec.subjectIncludes ? { subjectIncludes: spec.subjectIncludes } : {}),
          ...(spec.bodyIncludes ? { bodyIncludes: spec.bodyIncludes } : {}),
          ...(spec.cc ? { cc: spec.cc } : {}),
          ...(spec.replyTo ? { replyTo: spec.replyTo } : {}),
        },
        // 30s: the event crosses signals-dpg, the NS route, the NS worker
        // and SMTP to Mailpit, which is slower than a Redis read.
        { baseline, deadlineMs: spec.deadlineMs ?? 30_000, pollMs: 250 },
      );

      if (spec.recordedAs) {
        const events = requireContext(ctx.notificationEvents, 'the notification events reader');
        const recorded = await events.eventsFor(to);
        if (recorded === null) {
          throw new Error(
            'NOTIFICATION_EVENTS_UNREADABLE: could not read the events notification-service ' +
              'recorded, so the event type was not checked.',
          );
        }
        const checkDomain = spec.recordedDomain !== undefined;
        const found = recorded.some(
          (e) =>
            e.eventType === spec.recordedAs &&
            (!checkDomain || e.domain === spec.recordedDomain),
        );
        if (!found) {
          const describe = (eventType: string, domain: string | null) =>
            `${eventType} for ${domain ?? 'no domain'}`;
          const wanted = checkDomain
            ? describe(spec.recordedAs, spec.recordedDomain ?? null)
            : spec.recordedAs;
          throw new Error(
            `EVENT_NOT_RECORDED: the mail arrived, but no ${wanted} event was recorded for ` +
              `its recipient (recorded: ${
                recorded.map((e) => describe(e.eventType, e.domain)).join(', ') || 'none'
              }).`,
          );
        }
      }
    },
  });
