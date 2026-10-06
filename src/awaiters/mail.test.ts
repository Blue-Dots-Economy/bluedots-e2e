import { describe, expect, test } from 'vitest';
import {
  awaitEmailDelivered,
  captureMailBaseline,
  type MailMessage,
  type MailProbe,
  type MailSummary,
} from './mail.js';

const summary = (over: Partial<MailSummary> = {}): MailSummary => ({
  id: 'm-1',
  to: ['seeker@example.test'],
  cc: [],
  subject: 'Your profile is paused',
  created: '2026-10-06T10:00:00Z',
  ...over,
});

const message = (over: Partial<MailMessage> = {}): MailMessage => ({
  ...summary(),
  from: 'notifications@bluedots.test',
  replyTo: [],
  html: '<p>Hi! Your profile is now paused. <a href="http://localhost:5173/auth/login">Reactivate</a></p>',
  text: 'Hi! Your profile is now paused.',
  ...over,
});

/** A probe over a fixed mailbox, recording which recipients were asked for. */
function probeOf(
  messages: () => MailMessage[] | null,
  asked: (string | undefined)[] = [],
): MailProbe {
  return {
    list: async (opts) => {
      asked.push(opts?.to);
      const all = messages();
      if (all === null) return null;
      const to = opts?.to?.toLowerCase();
      return all
        .filter((m) => !to || m.to.some((a) => a.toLowerCase() === to))
        .map(({ id, to: t, cc, subject, created }) => ({ id, to: t, cc, subject, created }));
    },
    get: async (id) => messages()?.find((m) => m.id === id) ?? null,
  };
}

const clock = () => {
  let t = 0;
  return () => (t += 5);
};
const NOOP_SLEEP = async () => {};
const FAST = { deadlineMs: 50, now: clock(), sleep: NOOP_SLEEP };
const fast = () => ({ ...FAST, now: clock() });

describe('captureMailBaseline', () => {
  test('records every message Mailpit already holds', async () => {
    const base = await captureMailBaseline(probeOf(() => [message({ id: 'old' })]));

    expect([...base.ids]).toEqual(['old']);
  });

  test('refuses an unreadable mailbox rather than baselining nothing', async () => {
    // An empty baseline would make every message already there count as new.
    await expect(captureMailBaseline(probeOf(() => null))).rejects.toThrow(
      /^MAIL_PROBE_UNREADABLE:/,
    );
  });
});

describe('awaitEmailDelivered', () => {
  test('returns the delivered message the step under test caused', async () => {
    const base = await captureMailBaseline(probeOf(() => []));

    const found = await awaitEmailDelivered(
      probeOf(() => [message()]),
      { to: 'seeker@example.test', subjectIncludes: 'paused' },
      { baseline: base, ...fast() },
    );

    expect(found.subject).toBe('Your profile is paused');
  });

  test('asks Mailpit for the recipient, not for the whole mailbox', async () => {
    const asked: (string | undefined)[] = [];
    const base = await captureMailBaseline(probeOf(() => []));

    await awaitEmailDelivered(
      probeOf(() => [message()], asked),
      { to: 'seeker@example.test' },
      { baseline: base, ...fast() },
    );

    expect(asked).toContain('seeker@example.test');
  });

  test('compares addresses case-insensitively', async () => {
    const base = await captureMailBaseline(probeOf(() => []));

    await expect(
      awaitEmailDelivered(
        probeOf(() => [message({ to: ['Seeker@Example.TEST'] })]),
        { to: 'seeker@example.test' },
        { baseline: base, ...fast() },
      ),
    ).resolves.toMatchObject({ id: 'm-1' });
  });

  test('never matches a message that was already there before the step', async () => {
    // Seeding and earlier steps send mail of their own; only a message
    // absent from the baseline was caused by the step under test.
    const existing = message({ id: 'seeded' });
    const base = await captureMailBaseline(probeOf(() => [existing]));

    await expect(
      awaitEmailDelivered(
        probeOf(() => [existing]),
        { to: 'seeker@example.test' },
        { baseline: base, ...fast() },
      ),
    ).rejects.toThrow(/^EMAIL_NOT_DELIVERED after 50ms/);
  });

  test('a fresh message to someone else does not match, and the error names what was seen', async () => {
    const base = await captureMailBaseline(probeOf(() => []));
    const other = message({ to: ['someone@example.test'], subject: 'Welcome aboard' });
    // A probe that ignores the recipient filter, as a reading of the whole
    // mailbox would: the awaiter must still filter by address itself.
    const unfiltered: MailProbe = {
      list: async () => [other],
      get: async () => other,
    };

    const err = await awaitEmailDelivered(
      unfiltered,
      { to: 'seeker@example.test' },
      { baseline: base, ...fast() },
    ).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Welcome aboard -> someone@example\.test/);
    expect((err as Error).message).toMatch(/check the signals-api log for ns_rejected\/ns_unreachable/);
  });

  test('every condition must hold: subject, body, cc and reply-to', async () => {
    const base = await captureMailBaseline(probeOf(() => []));
    const full = message({
      cc: ['ops@bluedots.test', 'cc@bluedots.test'],
      replyTo: ['person@example.test'],
    });
    const probe = probeOf(() => [full]);
    const ok = {
      to: 'seeker@example.test',
      subjectIncludes: 'paused',
      bodyIncludes: ['now paused', 'localhost:5173'],
      cc: ['OPS@bluedots.test', 'cc@bluedots.test'],
      replyTo: 'person@example.test',
    };

    await expect(awaitEmailDelivered(probe, ok, { baseline: base, ...fast() })).resolves.toBeTruthy();

    for (const broken of [
      { ...ok, subjectIncludes: 'retired' },
      { ...ok, bodyIncludes: ['now paused', 'not in the body'] },
      { ...ok, cc: ['missing@bluedots.test'] },
      { ...ok, replyTo: 'someone-else@example.test' },
    ]) {
      await expect(
        awaitEmailDelivered(probe, broken, { baseline: base, ...fast() }),
      ).rejects.toThrow(/EMAIL_NOT_DELIVERED/);
    }
  });

  test('a body fragment may appear in the text part instead of the html', async () => {
    const base = await captureMailBaseline(probeOf(() => []));

    await expect(
      awaitEmailDelivered(
        probeOf(() => [message({ html: '', text: 'plain only' })]),
        { to: 'seeker@example.test', bodyIncludes: ['plain only'] },
        { baseline: base, ...fast() },
      ),
    ).resolves.toBeTruthy();
  });

  test('never prints the body it checked, so a code in it stays out of the report', async () => {
    const base = await captureMailBaseline(probeOf(() => []));
    const otp = message({ html: 'Your code is 482913', text: 'Your code is 482913' });

    const err = await awaitEmailDelivered(
      probeOf(() => [otp]),
      { to: 'seeker@example.test', bodyIncludes: ['not there'] },
      { baseline: base, ...fast() },
    ).catch((e: Error) => e);

    expect((err as Error).message).not.toContain('482913');
  });

  test('a body pattern must match, and a miss never prints the body or the pattern match', async () => {
    const base = await captureMailBaseline(probeOf(() => []));
    const withCode = message({ html: 'Your code is 482913.', text: '' });
    const without = message({ id: 'm-2', html: 'No code here', text: '' });

    await expect(
      awaitEmailDelivered(
        probeOf(() => [withCode]),
        { to: 'seeker@example.test', bodyMatches: /\b\d{6}\b/ },
        { baseline: base, ...fast() },
      ),
    ).resolves.toMatchObject({ id: 'm-1' });

    const err = await awaitEmailDelivered(
      probeOf(() => [without]),
      { to: 'seeker@example.test', bodyMatches: /\b\d{6}\b/ },
      { baseline: base, ...fast() },
    ).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/body does not match the expected pattern/);
    expect((err as Error).message).not.toContain('No code here');
  });

  test('keeps retrying an unreadable mailbox, then says it could not be read', async () => {
    // null is not "nothing yet": reading it that way would wait out the
    // deadline and blame the services for a harness that could not see.
    const base = await captureMailBaseline(probeOf(() => []));
    let reads = 0;
    const flaky: MailProbe = {
      list: async () => {
        reads += 1;
        return null;
      },
      get: async () => null,
    };

    await expect(
      awaitEmailDelivered(flaky, { to: 'seeker@example.test' }, { baseline: base, ...fast() }),
    ).rejects.toThrow(/Mailpit could not be read/);
    expect(reads).toBeGreaterThan(1);
  });

  test('picks up a message that arrives on a later poll', async () => {
    const base = await captureMailBaseline(probeOf(() => []));
    let polls = 0;
    const late = probeOf(() => (++polls >= 3 ? [message()] : []));

    await expect(
      awaitEmailDelivered(late, { to: 'seeker@example.test' }, { baseline: base, ...fast() }),
    ).resolves.toMatchObject({ id: 'm-1' });
  });
});
