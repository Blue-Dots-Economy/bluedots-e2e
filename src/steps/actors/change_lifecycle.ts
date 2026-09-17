import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';
import { captureBaseline } from '../../awaiters/ingest.js';
import { captureNotificationBaseline } from '../../awaiters/notification.js';

const ACTIONS = { paused: 'pause', live: 'unpause', retired: 'retire' } as const;

/**
 * Move a profile through its lifecycle.
 *
 * Every transition publishes an item event (#557), not just retire, because
 * item_search is maintained off those events and every read path there is
 * live-only -- an unpublished transition leaves a profile visible in search
 * while `items` says otherwise. So this captures an ingest baseline first,
 * exactly as createProfile does, and the journey that follows can assert
 * the transition actually traversed the spine rather than that the row
 * changed.
 */
export const changeLifecycle = (spec: { to: keyof typeof ACTIONS }) =>
  step({
    label: `Moved the profile to ${spec.to}`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const auth = requireContext(ctx.auth, 'authentication');
      const probe = requireContext(ctx.probe, 'ingest probe');
      const key = requireState(state, 'itemKey');

      state.baseline = await captureBaseline(probe);

      // Taken before the write, like the ingest baseline and for the same
      // reason: seeding sends mail of its own, so only a job absent from
      // this set was caused by the step under test. Skipped where the
      // environment runs no notification-service -- a journey that needs
      // one is NOT COVERED there.
      if (ctx.notifications) {
        state.notificationBaseline = await captureNotificationBaseline(ctx.notifications);
      }

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/item/lifecycle`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': auth.apiKey,
          'x-acting-org-id': auth.actingOrgId,
        },
        body: JSON.stringify({ item_id: key.id, action: ACTIONS[spec.to] }),
      });

      if (!res.ok) {
        throw new Error(
          `STEP_FAILED: lifecycle ${ACTIONS[spec.to]} returned ${res.status} ${await res.text()}`,
        );
      }

      const body = (await res.json()) as { lifecycle_status?: string };
      if (body.lifecycle_status !== spec.to) {
        throw new Error(
          `STEP_FAILED: asked for ${spec.to}, the item is ${body.lifecycle_status}. ` +
            `Pause only applies to a live profile and retire is terminal, so the ` +
            `order of steps in this scenario may not be reachable.`,
        );
      }
    },
  });
