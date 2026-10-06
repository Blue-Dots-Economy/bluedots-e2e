import { describe, expect, test } from 'vitest';
import { expectEmailDelivered } from './email_delivered.js';
import type { StepContext } from '../../journey/define_journey.js';
import type { MailMessage, MailProbe } from '../../awaiters/mail.js';
import { checkLabel } from '../../journey/guards.js';

const delivered = (to: string, over: Partial<MailMessage> = {}): MailMessage => ({
  id: 'm-new',
  to: [to],
  cc: [],
  subject: 'Your profile is paused',
  created: '2026-10-06T10:00:00Z',
  from: 'notifications@bluedots.test',
  replyTo: [],
  html: '<p>Your profile is now paused.</p>',
  text: '',
  ...over,
});

const mailOf = (messages: MailMessage[], asked: (string | undefined)[] = []): MailProbe => ({
  list: async (opts) => {
    asked.push(opts?.to);
    return messages
      .filter((m) => !opts?.to || m.to.includes(opts.to))
      .map(({ id, to, cc, subject, created }) => ({ id, to, cc, subject, created }));
  },
  get: async (id) => messages.find((m) => m.id === id) ?? null,
});

const baseState = () => ({
  seed: 'abc',
  mailBaseline: { ids: new Set<string>() },
  profiles: {
    seeker: {
      key: { network: 'blue_dot', domain: 'seeker', type: 'profile_1.0', id: 'itm_s' },
      itemState: {},
      email: 'seeker-abc@example.test',
      userId: 'usr_s',
    },
  },
  signedUp: { email: 'self-abc@example.test', domain: 'seeker' },
});

const ctx = (over: Partial<StepContext> = {}): StepContext => ({
  clients: {},
  state: baseState(),
  endpoints: { signalsApi: '', searchApi: '', keycloak: '', postgresUrl: '', redisUrl: '', mailpit: '' },
  seeded: {},
  http: fetch,
  ...over,
});

const FAST = { deadlineMs: 30 };

describe('expectEmailDelivered', () => {
  test('reads as prose in the report, never as a template key', () => {
    const s = expectEmailDelivered({ to: { profile: 'seeker' }, about: 'their profile being paused' });

    expect(s.label).toBe('Emailed the seeker about their profile being paused');
    expect(checkLabel(s.label).ok).toBe(true);
  });

  test('labels the other recipients in words too', () => {
    expect(expectEmailDelivered({ to: { signedUp: true }, about: 'a welcome' }).label).toBe(
      'Emailed the person who signed up about a welcome',
    );
    expect(
      expectEmailDelivered({ to: { address: 'support@bluedots.test' }, about: 'a support request' })
        .label,
    ).toBe('Emailed support@bluedots.test about a support request');
  });

  test('passes when the profile owner got the mail the step caused', async () => {
    const asked: (string | undefined)[] = [];
    await expectEmailDelivered({
      to: { profile: 'seeker' },
      about: 'their profile being paused',
      subjectIncludes: 'paused',
      ...FAST,
    }).run(ctx({ mail: mailOf([delivered('seeker-abc@example.test')], asked) }));

    expect(asked).toContain('seeker-abc@example.test');
  });

  test('resolves the signed-up address and a literal one', async () => {
    await expectEmailDelivered({ to: { signedUp: true }, about: 'a welcome', ...FAST }).run(
      ctx({ mail: mailOf([delivered('self-abc@example.test')]) }),
    );
    await expectEmailDelivered({
      to: { address: 'support@bluedots.test' },
      about: 'a support request',
      ...FAST,
    }).run(ctx({ mail: mailOf([delivered('support@bluedots.test')]) }));
  });

  test('fails when the mail went to someone else', async () => {
    await expect(
      expectEmailDelivered({ to: { profile: 'seeker' }, about: 'x', ...FAST }).run(
        ctx({ mail: mailOf([delivered('other@example.test')]) }),
      ),
    ).rejects.toThrow(/EMAIL_NOT_DELIVERED/);
  });

  test('needs the baseline the triggering step records', async () => {
    const state = baseState() as Record<string, unknown>;
    delete state.mailBaseline;

    await expect(
      expectEmailDelivered({ to: { profile: 'seeker' }, about: 'x', ...FAST }).run(
        ctx({ state, mail: mailOf([delivered('seeker-abc@example.test')]) }),
      ),
    ).rejects.toThrow(/mailBaseline/);
  });

  test('needs a mail probe, which an environment without mailpit cannot give', async () => {
    await expect(
      expectEmailDelivered({ to: { profile: 'seeker' }, about: 'x', ...FAST }).run(ctx()),
    ).rejects.toThrow(/mail probe/);
  });

  test('names a missing profile rather than reading undefined', async () => {
    await expect(
      expectEmailDelivered({ to: { profile: 'provider' }, about: 'x', ...FAST }).run(
        ctx({ mail: mailOf([]) }),
      ),
    ).rejects.toThrow(/"provider" profile/);
  });

  describe('the event notification-service recorded', () => {
    test('passes when an event of that type was recorded for the recipient', async () => {
      const asked: string[] = [];
      await expectEmailDelivered({
        to: { profile: 'seeker' },
        about: 'x',
        recordedAs: 'item.paused',
        ...FAST,
      }).run(
        ctx({
          mail: mailOf([delivered('seeker-abc@example.test')]),
          notificationEvents: {
            eventTypesFor: async (email) => {
              asked.push(email);
              return ['item.onboarded_by_aggregator', 'item.paused'];
            },
          },
        }),
      );

      expect(asked).toEqual(['seeker-abc@example.test']);
    });

    test('fails naming the event types it did find', async () => {
      await expect(
        expectEmailDelivered({
          to: { profile: 'seeker' },
          about: 'x',
          recordedAs: 'item.retired',
          ...FAST,
        }).run(
          ctx({
            mail: mailOf([delivered('seeker-abc@example.test')]),
            notificationEvents: { eventTypesFor: async () => ['item.paused'] },
          }),
        ),
      ).rejects.toThrow(/EVENT_NOT_RECORDED.*item\.retired.*item\.paused/s);
    });

    test('needs the event reader when an event type is asked for', async () => {
      await expect(
        expectEmailDelivered({
          to: { profile: 'seeker' },
          about: 'x',
          recordedAs: 'item.paused',
          ...FAST,
        }).run(ctx({ mail: mailOf([delivered('seeker-abc@example.test')]) })),
      ).rejects.toThrow(/notification events/);
    });
  });
});
