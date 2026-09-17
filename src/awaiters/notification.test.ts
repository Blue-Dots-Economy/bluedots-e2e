import { describe, expect, test } from 'vitest';
import {
  awaitNotificationQueued,
  captureNotificationBaseline,
  type NotificationProbe,
  type QueuedNotification,
} from './notification.js';

const job = (over: Partial<QueuedNotification> = {}): QueuedNotification => ({
  job_id: 'j-1',
  channel: 'email',
  to: 'provider@example.test',
  template_id: 'action.connect.provider',
  priority: 'other',
  variables: {},
  ...over,
});

const probeOf = (
  queued: NotificationProbe['queued'],
  dedupeKeys: NotificationProbe['dedupeKeys'] = async () => [],
): NotificationProbe => ({ queued, dedupeKeys });
const clock = () => {
  let t = 0;
  return () => (t += 5);
};
const NOOP_SLEEP = async () => {};

describe('awaitNotificationQueued', () => {
  test('returns the job the step under test caused', async () => {
    const base = await captureNotificationBaseline(probeOf(async () => []));
    const probe = probeOf(async () => [job()]);

    const found = await awaitNotificationQueued(
      probe,
      { to: 'provider@example.test' },
      { baseline: base, deadlineMs: 50, now: clock(), sleep: NOOP_SLEEP },
    );

    expect(found.template_id).toBe('action.connect.provider');
  });

  test('ignores a job that was already queued before the step ran', async () => {
    // A stack is seeded before a journey runs and seeding sends mail of its
    // own, so "the queue is non-empty" proves nothing about this step.
    const existing = job({ job_id: 'seeded' });
    const base = await captureNotificationBaseline(probeOf(async () => [existing]));
    const probe = probeOf(async () => [existing]);

    await expect(
      awaitNotificationQueued(
        probe,
        { to: 'provider@example.test' },
        { baseline: base, deadlineMs: 20, now: clock(), sleep: NOOP_SLEEP },
      ),
    ).rejects.toThrow(/NOTIFICATION_NOT_QUEUED/);
  });

  test('will not accept a notification addressed to someone else', async () => {
    const base = await captureNotificationBaseline(probeOf(async () => []));
    const probe = probeOf(async () => [job({ to: 'seeker@example.test' })]);

    await expect(
      awaitNotificationQueued(
        probe,
        { to: 'provider@example.test' },
        { baseline: base, deadlineMs: 20, now: clock(), sleep: NOOP_SLEEP },
      ),
    ).rejects.toThrow(/none to provider@example.test/);
  });

  test('can require a particular template, not merely any mail', async () => {
    const base = await captureNotificationBaseline(probeOf(async () => []));
    const probe = probeOf(async () => [job({ template_id: 'action.apply.provider' })]);

    await expect(
      awaitNotificationQueued(
        probe,
        { to: 'provider@example.test', templateIdIncludes: 'connect' },
        { baseline: base, deadlineMs: 20, now: clock(), sleep: NOOP_SLEEP },
      ),
    ).rejects.toThrow(/NOTIFICATION_NOT_QUEUED/);
  });

  test('keeps waiting rather than passing when the queue cannot be read', async () => {
    // An empty list is what a quiet queue reads, so degrading to one would
    // make an unreadable probe indistinguishable from "nothing yet".
    const base = await captureNotificationBaseline(probeOf(async () => []));

    await expect(
      awaitNotificationQueued(
        probeOf(async () => null),
        { to: 'provider@example.test' },
        { baseline: base, deadlineMs: 20, now: clock(), sleep: NOOP_SLEEP },
      ),
    ).rejects.toThrow(/could not be read/);
  });

  test('refuses a baseline it could not read', async () => {
    await expect(captureNotificationBaseline(probeOf(async () => null))).rejects.toThrow(
      /NOTIFICATION_PROBE_UNREADABLE/,
    );
  });

  test('finds a notification the worker already ate', async () => {
    // The worker BRPOPs a job and then dies -- an unconfigured mail
    // transport throws out of processJob rather than returning a failure,
    // so the job is neither retried nor dead-lettered. Run 34960703710
    // accepted 14 notifications and left nothing on any list. The dedupe
    // key is set by the route before the worker can touch it.
    const base = await captureNotificationBaseline(probeOf(async () => [], async () => []));
    const probe = probeOf(
      async () => [],
      async () => ['dedupe:item_lifecycle:account.aggregator_init.seeker:usr_42'],
    );

    const found = await awaitNotificationQueued(
      probe,
      { to: 'x@example.test', ownerId: 'usr_42', templateIdIncludes: 'aggregator_init' },
      { baseline: base, deadlineMs: 50, now: clock(), sleep: NOOP_SLEEP },
    );

    expect(found.template_id).toContain('aggregator_init');
  });

  test('will not accept a notification keyed to a different owner', async () => {
    const base = await captureNotificationBaseline(probeOf(async () => [], async () => []));
    const probe = probeOf(
      async () => [],
      async () => ['dedupe:item_lifecycle:account.aggregator_init.seeker:somebody_else'],
    );

    await expect(
      awaitNotificationQueued(
        probe,
        { to: 'x@example.test', ownerId: 'usr_42', templateIdIncludes: 'aggregator_init' },
        { baseline: base, deadlineMs: 20, now: clock(), sleep: NOOP_SLEEP },
      ),
    ).rejects.toThrow(/none matching/);
  });
});
