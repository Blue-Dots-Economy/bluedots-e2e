import { describe, expect, test } from 'vitest';
import { captureMailBaseline, createMailProbe, approvalLinkIn } from './mailbox.js';

const LIST = {
  messages: [
    { ID: 'm3', To: [{ Address: 'owner@journey.test' }], Subject: 'A coordinator wants to join', Created: '2026-09-18T10:00:03Z' },
    { ID: 'm2', To: [{ Address: 'network-admin@journey.test' }], Subject: 'New organisation', Created: '2026-09-18T10:00:02Z' },
    { ID: 'm1', To: [{ Address: 'someone@else.test' }], Subject: 'Older mail', Created: '2026-09-18T10:00:01Z' },
  ],
};

const fakeFetch = (bodies: Record<string, unknown>): typeof fetch =>
  (async (url: string) => {
    const key = Object.keys(bodies).find((k) => String(url).includes(k));
    if (!key) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(bodies[key]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

describe('mail probe', () => {
  test('finds the message an action sent, not one that was already there', async () => {
    // Same rule as the notification baseline. Seeding and earlier journeys
    // both send mail, so "a message exists for this address" proves nothing
    // -- only one absent from the baseline was caused by the step.
    const probe = createMailProbe({
      baseUrl: 'http://mail',
      fetcher: fakeFetch({ '/api/v1/messages': LIST, '/api/v1/message/m3': { Text: 'hello' } }),
    });

    const baseline = await captureMailBaseline(probe);
    expect(baseline.seen.has('m3')).toBe(true);

    const found = await probe.find(
      { to: 'owner@journey.test', baseline },
      { timeoutMs: 10, pollMs: 1 },
    );
    expect(found).toBeNull();
  });

  test('returns the newest matching message once one arrives', async () => {
    const probe = createMailProbe({
      baseUrl: 'http://mail',
      fetcher: fakeFetch({ '/api/v1/messages': LIST, '/api/v1/message/m2': { Text: 'body of m2' } }),
    });

    const found = await probe.find(
      { to: 'network-admin@journey.test', baseline: { seen: new Set<string>() } },
      { timeoutMs: 50, pollMs: 1 },
    );

    expect(found?.id).toBe('m2');
    expect(found?.body).toBe('body of m2');
  });

  test('matches the address case-insensitively, as a mailbox does', async () => {
    const probe = createMailProbe({
      baseUrl: 'http://mail',
      fetcher: fakeFetch({ '/api/v1/messages': LIST, '/api/v1/message/m2': { Text: 'b' } }),
    });

    const found = await probe.find(
      { to: 'NETWORK-ADMIN@Journey.test', baseline: { seen: new Set<string>() } },
      { timeoutMs: 50, pollMs: 1 },
    );

    expect(found?.id).toBe('m2');
  });
});

describe('approvalLinkIn', () => {
  const body = `Hello,

Please review: http://localhost:4000/admin/v1/orgs/read/org-123?token=abc.def.ghi&intent=approve

Thanks`;

  test('pulls the path and the token out, and re-bases onto the running instance', () => {
    // The host in the mail is PUBLIC_API_URL, a deployment setting, and the
    // run published the API on an ephemeral port instead. Asserting the host
    // would test the config echo; the path and the token are the behaviour.
    const link = approvalLinkIn(body, 'http://localhost:55123');

    expect(link.url).toBe(
      'http://localhost:55123/admin/v1/orgs/read/org-123?token=abc.def.ghi&intent=approve',
    );
    expect(link.token).toBe('abc.def.ghi');
    expect(link.id).toBe('org-123');
  });

  test('refuses a body with no link rather than returning an empty one', () => {
    expect(() => approvalLinkIn('no link here', 'http://x')).toThrow(/APPROVAL_LINK_NOT_FOUND/);
  });

  test('refuses a link carrying no token, which cannot approve anything', () => {
    expect(() =>
      approvalLinkIn('http://localhost:4000/admin/v1/orgs/read/org-1', 'http://x'),
    ).toThrow(/no token/);
  });
});
