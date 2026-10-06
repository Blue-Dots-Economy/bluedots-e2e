/** One message as Mailpit lists it. Addresses only, never display names. */
export type MailSummary = { id: string; to: string[]; cc: string[]; subject: string; created: string };

/** One message in full. */
export type MailMessage = MailSummary & { html: string; text: string; replyTo: string[]; from: string };

/**
 * Everything the mail awaiter reads.
 *
 * Injected for the same reason as the ingest probe: the logic is testable
 * without a live Mailpit, and an environment that cannot offer one simply
 * cannot construct it.
 */
export type MailProbe = {
  /**
   * Messages Mailpit holds, newest first -- only those addressed to `to`
   * when it is given. Null when Mailpit cannot be read.
   */
  list: (opts?: { to?: string }) => Promise<MailSummary[] | null>;
  get: (id: string) => Promise<MailMessage | null>;
};

export type MailBaseline = { ids: Set<string> };

/**
 * Read before the action, so "a NEW message" has a meaning.
 *
 * Mailpit is shared by every journey in a run, and seeding and earlier
 * steps send mail of their own. Only a message absent from this baseline
 * was caused by the step under test.
 */
export async function captureMailBaseline(probe: MailProbe): Promise<MailBaseline> {
  const messages = await probe.list();
  if (messages === null) {
    throw new Error(
      'MAIL_PROBE_UNREADABLE: could not read Mailpit for the baseline. Every later ' +
        'comparison would be against a set nobody read.',
    );
  }
  return { ids: new Set(messages.map((m) => m.id)) };
}

export type MailMatch = {
  to: string;
  subjectIncludes?: string;
  /** Every fragment must appear in the HTML or the text part. */
  bodyIncludes?: string[];
  /**
   * A shape the HTML or text must contain, e.g. a one-time code. Matched,
   * never reported: a miss says only that the pattern was not found.
   */
  bodyMatches?: RegExp;
  /** Every address must be among the message's cc. */
  cc?: string[];
  replyTo?: string;
};

const lower = (s: string) => s.toLowerCase();
const hasAddress = (list: string[], address: string) =>
  list.some((a) => lower(a) === lower(address));

/**
 * Why a message is not the one asked for, or null when it is.
 *
 * Says which condition failed and never quotes the body: a body can carry
 * a one-time code, and this text ends up in the report.
 */
function mismatch(m: MailMessage, match: MailMatch): string | null {
  if (match.subjectIncludes && !m.subject.includes(match.subjectIncludes)) {
    return `subject lacks "${match.subjectIncludes}"`;
  }
  const missing = (match.bodyIncludes ?? []).filter(
    (f) => !m.html.includes(f) && !m.text.includes(f),
  );
  if (missing.length) return `body lacks ${missing.map((f) => `"${f}"`).join(', ')}`;
  if (match.bodyMatches && !match.bodyMatches.test(m.html) && !match.bodyMatches.test(m.text)) {
    return 'body does not match the expected pattern';
  }
  const missingCc = (match.cc ?? []).filter((a) => !hasAddress(m.cc, a));
  if (missingCc.length) return `cc lacks ${missingCc.join(', ')}`;
  if (match.replyTo && !hasAddress(m.replyTo, match.replyTo)) {
    return `reply-to is ${m.replyTo.join(', ') || 'unset'}, not ${match.replyTo}`;
  }
  return null;
}

/**
 * Wait for an email the step under test caused, and check it is the right one.
 *
 * Asserts DELIVERY: the message reached the stack's SMTP server, so
 * signals-dpg sent the event, notification-service accepted it, resolved a
 * template from the catalogue, rendered it and handed it to a transport.
 * Mailpit is asked by recipient, and each journey's recipients carry its
 * own seed, so one journey cannot satisfy another's assertion.
 */
export async function awaitEmailDelivered(
  probe: MailProbe,
  match: MailMatch,
  opts: {
    baseline: MailBaseline;
    deadlineMs: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<MailMessage> {
  const now = opts.now ?? Date.now;
  const pollMs = opts.pollMs ?? 250;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = now();
  let last = 'no reading taken';

  while (now() - started < opts.deadlineMs) {
    const listed = await probe.list({ to: match.to });
    if (listed === null) {
      // null, never an empty list: empty is what a quiet mailbox reads, and
      // this gate would pass it as "nothing yet" forever.
      last = 'Mailpit could not be read';
      await sleep(pollMs);
      continue;
    }

    const fresh = listed.filter((m) => !opts.baseline.ids.has(m.id));
    const addressed = fresh.filter((m) => hasAddress(m.to, match.to));
    const reasons: string[] = [];
    for (const summary of addressed) {
      const full = await probe.get(summary.id);
      if (!full) {
        reasons.push(`"${summary.subject}" could not be read`);
        continue;
      }
      const why = mismatch(full, match);
      if (why === null) return full;
      reasons.push(`"${summary.subject}": ${why}`);
    }

    last = addressed.length
      ? `${addressed.length} new message(s) to ${match.to}, none matching (${reasons.join('; ')})`
      : fresh.length
        ? `${fresh.length} new message(s), none to ${match.to} ` +
          `(saw ${fresh.map((m) => `${m.subject} -> ${m.to.join(',')}`).join('; ')})`
        : `no new message to ${match.to}`;
    await sleep(pollMs);
  }

  throw new Error(
    `EMAIL_NOT_DELIVERED after ${opts.deadlineMs}ms: ${last}. signals-dpg sends ` +
      `best-effort; check the signals-api log for ns_rejected/ns_unreachable, then the ` +
      `notification-service log.`,
  );
}
