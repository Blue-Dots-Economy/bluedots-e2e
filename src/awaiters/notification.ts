/** One job as notification-service enqueues it (`{ job_id, ...body, priority }`). */
export type QueuedNotification = {
  job_id: string;
  channel: string;
  to: string;
  template_id: string;
  priority: 'realtime' | 'other';
  variables: Record<string, unknown>;
};

/**
 * Everything the notification awaiter reads.
 *
 * Injected for the same reason as the ingest probe: the logic is testable
 * without a live Redis, and an environment that cannot offer one simply
 * cannot construct it.
 */
export type NotificationProbe = {
  /** Every job currently on queue:realtime and queue:other, newest first. */
  queued: () => Promise<QueuedNotification[] | null>;
};

export type NotificationBaseline = { jobIds: Set<string> };

/**
 * Read before the action, so "a NEW notification" has a meaning.
 *
 * A stack is seeded before a journey runs and seeding sends mail of its
 * own, so "the queue is non-empty" says nothing. Only a job absent from
 * this baseline was caused by the step under test.
 */
export async function captureNotificationBaseline(
  probe: NotificationProbe,
): Promise<NotificationBaseline> {
  const jobs = await probe.queued();
  if (jobs === null) {
    throw new Error(
      'NOTIFICATION_PROBE_UNREADABLE: could not read the notification queues for the ' +
        'baseline. Every later comparison would be against a set nobody read.',
    );
  }
  return { jobIds: new Set(jobs.map((j) => j.job_id)) };
}

export type NotificationMatch = { to: string; templateIdIncludes?: string };

/**
 * Wait for a notification the step under test caused.
 *
 * Asserts on the QUEUE rather than on an inbox: notification-service
 * supports SES and Gmail and nothing else, so a hermetic run has no
 * mailbox to read. What it does have is the job the service accepted --
 * validated against its template allowlist and its per-provider variables
 * schema before being enqueued, so a queued job means signals-dpg and
 * notification-service agreed on the contract, which is the seam this
 * suite exists to check.
 */
export async function awaitNotificationQueued(
  probe: NotificationProbe,
  match: NotificationMatch,
  opts: {
    baseline: NotificationBaseline;
    deadlineMs: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<QueuedNotification> {
  const now = opts.now ?? Date.now;
  const pollMs = opts.pollMs ?? 250;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = now();
  let last = 'no reading taken';

  while (now() - started < opts.deadlineMs) {
    const jobs = await probe.queued();
    if (jobs === null) {
      // null, never an empty list: empty is what a quiet queue reads, and
      // this gate would pass it as "nothing yet" forever.
      last = 'the notification queues could not be read';
      await sleep(pollMs);
      continue;
    }

    const fresh = jobs.filter((j) => !opts.baseline.jobIds.has(j.job_id));
    const found = fresh.find(
      (j) =>
        j.to === match.to &&
        (match.templateIdIncludes === undefined ||
          j.template_id.includes(match.templateIdIncludes)),
    );
    if (found) return found;

    last = fresh.length
      ? `${fresh.length} new notification(s), none to ${match.to}` +
        `${match.templateIdIncludes ? ` for ${match.templateIdIncludes}` : ''}` +
        ` (saw ${fresh.map((j) => `${j.template_id}->${j.to}`).join(', ')})`
      : `no notification queued since the baseline`;
    await sleep(pollMs);
  }

  throw new Error(
    `NOTIFICATION_NOT_QUEUED after ${opts.deadlineMs}ms: ${last}. ` +
      `signals-dpg sends best-effort, so a send that failed is logged there and ` +
      `never reaches the queue -- check the API log before the service.`,
  );
}
