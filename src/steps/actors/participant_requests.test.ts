import { describe, expect, test } from 'vitest';
import { signUp } from './sign_up.js';
import { logIn } from './log_in.js';
import { recordAge } from './record_age.js';
import { nameAGuardian } from './name_a_guardian.js';
import { submitSupportRequest } from './submit_support_request.js';
import type { StepContext } from '../../journey/define_journey.js';
import type { MailMessage, MailProbe } from '../../awaiters/mail.js';
import { buildTargetSchemas } from '../../targets/target_schemas.js';
import { checkLabel } from '../../journey/guards.js';

const target = buildTargetSchemas({
  id: 'blue_dot',
  domains: [
    {
      id: 'seeker',
      item_schemas: {
        'profile_1.0': { required: ['name'], properties: { name: { type: 'string' } } },
      },
    },
  ],
});

type Sent = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** An http stub answering by path, recording every request. */
function server(routes: Record<string, (body: unknown) => Response>) {
  const sent: Sent[] = [];
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const raw = init?.body ? String(init.body) : '';
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      // a form body stays a string
    }
    sent.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body,
    });
    const path = new URL(url).pathname;
    const handler = routes[path];
    return handler ? handler(body) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { http, sent };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const noMail: MailProbe = { list: async () => [], get: async () => null };

const ctx = (
  http: typeof fetch,
  state: Record<string, unknown> = {},
  extra: Partial<StepContext> = {},
): StepContext => ({
  clients: {},
  state: Object.assign(state, { seed: state.seed ?? 'abc123' }),
  endpoints: {
    signalsApi: 'http://signals',
    searchApi: '',
    keycloak: 'http://kc',
    postgresUrl: '',
    redisUrl: '',
    mailpit: 'http://mail',
  },
  seeded: {},
  http,
  keys: { issueFor: async (userId) => `key-for-${userId}` },
  target,
  mail: noMail,
  ...extra,
});

const signedUp = () => ({
  signedUp: { email: 'journey-self-seeker-abc123@example.test', domain: 'seeker', userId: 'usr_self' },
});

describe('labels', () => {
  test('every new step reads as prose', () => {
    for (const s of [
      logIn(),
      recordAge({ age: 15 }),
      nameAGuardian(),
      submitSupportRequest({ type: 'support_request', details: 'Cannot see my profile' }),
    ]) {
      expect(checkLabel(s.label), s.label).toEqual({ ok: true });
    }
  });
});

describe('signUp', () => {
  test('can leave the age out, so it can be recorded later', async () => {
    const { http, sent } = server({ '/api/v1/auth/signup': () => json({ ok: true }) });

    await signUp({ as: 'seeker', age: null }).run(ctx(http));

    expect(sent[0]!.body).not.toHaveProperty('age');
  });

  test('still signs up an adult by default', async () => {
    const { http, sent } = server({ '/api/v1/auth/signup': () => json({ ok: true }) });

    await signUp({ as: 'seeker' }).run(ctx(http));

    expect((sent[0]!.body as { age: number }).age).toBe(30);
  });
});

describe('logIn', () => {
  test('needs someone who signed up', async () => {
    const { http } = server({});

    await expect(logIn().run(ctx(http))).rejects.toThrow(/signedUp/);
  });

  test('records who the session belongs to, from the first authenticated request', async () => {
    // The whole flow is covered in browser_login.test.ts; here only what the
    // step does with the session it gets.
    const otpMail: MailMessage = {
      id: 'otp-1',
      to: ['journey-self-seeker-abc123@example.test'],
      cc: [],
      subject: 'OTP to verify access',
      created: '',
      from: 'no-reply@bluedots.local',
      replyTo: [],
      html: 'Your code is 123456',
      text: '',
    };
    let listed = 0;
    const mail: MailProbe = {
      // Empty for the baseline, then the code arrives.
      list: async () => (listed++ === 0 ? [] : [otpMail]),
      get: async () => otpMail,
    };
    const form = (id: string, step: string) =>
      new Response(`<form id="${id}" action="http://localhost:8080/realms/bluedots/login-actions/authenticate?s=${step}">`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    const redirect = (location: string, cookie?: string) => {
      const h = new Headers({ location });
      if (cookie) h.append('set-cookie', cookie);
      return new Response(null, { status: 302, headers: h });
    };
    const { http, sent } = server({
      '/api/v1/auth/session/login': () =>
        redirect('http://localhost:8080/realms/bluedots/protocol/openid-connect/auth?x=1'),
      '/realms/bluedots/protocol/openid-connect/auth': () => form('kc-otp-identifier-form', 'id'),
      '/realms/bluedots/login-actions/authenticate': (body) =>
        String(body).startsWith('otp=')
          ? redirect('http://localhost:2742/api/v1/auth/session/callback?code=c&state=s')
          : form('kc-email-otp-form', 'otp'),
      '/api/v1/auth/session/callback': () => redirect('http://localhost:5173/auth/callback', 'sid=s1'),
      '/api/v1/auth/me': () => json({ id: 'usr_new', email: 'x' }),
    });
    const state: Record<string, unknown> = {
      signedUp: { email: 'journey-self-seeker-abc123@example.test', domain: 'seeker' },
    };

    await logIn().run(ctx(http, state, { mail, endpoints: { ...ctx(http).endpoints, keycloak: 'http://kc' } }));

    expect((state.signedUp as { userId: string }).userId).toBe('usr_new');
    expect(state.mailBaseline).toBeDefined();
    const me = sent.find((s) => s.url.endsWith('/api/v1/auth/me'))!;
    expect(me.headers.cookie).toBe('sid=s1');
    expect(sent.find((s) => s.method === 'POST' && String(s.body).startsWith('otp='))!.body).toBe(
      'otp=123456',
    );
  });
});

describe('recordAge', () => {
  test('records the age as the signed-up person', async () => {
    const { http, sent } = server({ '/api/v1/consent/u18/dob': () => json({ isMinor: true }) });

    await recordAge({ age: 15 }).run(ctx(http, signedUp()));

    expect(sent[0]!.headers['x-api-key']).toBe('key-for-usr_self');
    expect(sent[0]!.body).toEqual({ network: 'blue_dot', age: 15 });
  });

  test('fails when a minor age is not read as a minor', async () => {
    const { http } = server({ '/api/v1/consent/u18/dob': () => json({ isMinor: false }) });

    await expect(recordAge({ age: 15 }).run(ctx(http, signedUp()))).rejects.toThrow(/minor/);
  });

  test('needs the person to have logged in once', async () => {
    const { http } = server({});
    const state = { signedUp: { email: 'a@b.test', domain: 'seeker' } };

    await expect(recordAge({ age: 15 }).run(ctx(http, state))).rejects.toThrow(/logged in/);
  });
});

describe('nameAGuardian', () => {
  test('names an email-only guardian, so no text message can be chosen', async () => {
    const { http, sent } = server({ '/api/v1/consent/u18/guardian': () => json({ otpSent: true }) });
    const state: Record<string, unknown> = signedUp();

    await nameAGuardian().run(ctx(http, state));

    const body = sent[0]!.body as Record<string, unknown>;
    expect(sent[0]!.headers['x-api-key']).toBe('key-for-usr_self');
    expect(body).toEqual({
      network: 'blue_dot',
      guardianName: 'Journey Guardian',
      guardianEmail: 'journey-guardian-abc123@example.test',
      guardianDeclarationAccepted: true,
    });
    expect(body).not.toHaveProperty('guardianPhone');
    expect(state.guardianEmail).toBe('journey-guardian-abc123@example.test');
    expect(state.mailBaseline).toBeDefined();
  });

  test('fails when no code was sent', async () => {
    const { http } = server({ '/api/v1/consent/u18/guardian': () => json({ otpSent: false }) });

    await expect(nameAGuardian().run(ctx(http, signedUp()))).rejects.toThrow(/no code/);
  });
});

describe('submitSupportRequest', () => {
  test('submits with the person as the contact and one attachment, and keeps the reference', async () => {
    const { http, sent } = server({
      '/api/v1/support': () => json({ ok: true, reference: 'SUP-20261006-ABC123' }, 201),
    });
    const state: Record<string, unknown> = signedUp();

    await submitSupportRequest({ type: 'support_request', details: 'Cannot see my profile' }).run(
      ctx(http, state),
    );

    const body = sent[0]!.body as Record<string, unknown> & {
      attachments: { filename: string; contentType: string; data: string }[];
    };
    expect(sent[0]!.url).toBe('http://signals/api/v1/support');
    expect(sent[0]!.headers['x-api-key']).toBe('key-for-usr_self');
    expect(body).toMatchObject({
      email: 'journey-self-seeker-abc123@example.test',
      type: 'support_request',
      details: 'Cannot see my profile',
      consent: true,
    });
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]!.contentType).toBe('image/png');
    expect(state.supportReference).toBe('SUP-20261006-ABC123');
    expect(state.mailBaseline).toBeDefined();
  });

  test('fails on a refusal, naming the status', async () => {
    const { http } = server({
      '/api/v1/support': () => json({ error: 'SUPPORT_NOT_CONFIGURED' }, 503),
    });

    await expect(
      submitSupportRequest({ type: 'complaint', details: 'x' }).run(ctx(http, signedUp())),
    ).rejects.toThrow(/503/);
  });
});
