import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import { awaitNotificationQueued } from '../../awaiters/notification.js';

/**
 * Assert the step before this one caused a notification.
 *
 * Asserted on the queue notification-service writes, not on an inbox: that
 * service supports SES and Gmail and nothing else, so a hermetic run has no
 * mailbox. The queue is the better assertion anyway -- a job only lands
 * there after /notify has validated the channel, the template against that
 * provider's allowlist and the variables against its schema, so a queued
 * job means both services agreed on the contract.
 *
 * signals-dpg sends these best-effort and swallows its own failures, which
 * is precisely why nothing downstream would notice a broken pipeline.
 */
export const expectNotificationQueued = (spec: {
  /** Which profile's owner should have been notified. */
  forProfileAs: string;
  /**
   * What the notification is about, in the words the report should print.
   * Never the template id: a label is the business-facing report line, and
   * `account.aggregator_init` is an identifier the label guard rejects
   * outright -- correctly, since it means nothing to a reader.
   */
  about?: string;
  /** Matched as a substring, so copy variants of one case still count. */
  templateIdIncludes?: string;
  deadlineMs?: number;
}) =>
  step({
    label: spec.about
      ? `Notified the ${spec.forProfileAs.replace(/_/g, ' ')} about ${spec.about}`
      : `Notified the ${spec.forProfileAs.replace(/_/g, ' ')}`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const probe = requireContext(ctx.notifications, 'a notification probe');
      const baseline = requireState(state, 'notificationBaseline');
      const profiles = requireState(state, 'profiles');

      const profile = profiles[spec.forProfileAs];
      if (!profile) {
        throw new Error(
          `STEP_FAILED: this step needs a "${spec.forProfileAs}" profile, and this ` +
            `journey created ${Object.keys(profiles).join(', ') || 'none'}.`,
        );
      }

      await awaitNotificationQueued(
        probe,
        {
          to: profile.email,
          ...(spec.templateIdIncludes ? { templateIdIncludes: spec.templateIdIncludes } : {}),
        },
        { baseline, deadlineMs: spec.deadlineMs ?? 20_000 },
      );
    },
  });
