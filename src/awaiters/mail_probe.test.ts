import { describe, expect, test } from 'vitest';
import { createMailProbe } from './mail_probe.js';

const LIST = {
  messages: [
    {
      ID: 'abc',
      To: [{ Name: '', Address: 'seeker@example.test' }],
      Cc: [{ Name: '', Address: 'cc@bluedots.test' }],
      Subject: 'Your profile is paused',
      Created: '2026-10-06T10:00:00Z',
    },
  ],
};
const MESSAGE = {
  ID: 'abc',
  From: { Name: 'Blue Dots', Address: 'notifications@bluedots.test' },
  To: [{ Name: '', Address: 'seeker@example.test' }],
  Cc: null,
  ReplyTo: [{ Name: '', Address: 'person@example.test' }],
  Subject: 'Your profile is paused',
  Created: '2026-10-06T10:00:00Z',
  HTML: '<p>paused</p>',
  Text: 'paused',
};

function stubFetch(routes: Record<string, unknown>, seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const path = url.replace('http://mail', '');
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    if (!key) return new Response('nope', { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as typeof fetch;
}

describe('createMailProbe', () => {
  test('maps the Mailpit list and message shapes', async () => {
    const seen: string[] = [];
    const probe = createMailProbe({
      baseUrl: 'http://mail',
      fetchImpl: stubFetch(
        { '/api/v1/messages': LIST, '/api/v1/search': LIST, '/api/v1/message/abc': MESSAGE },
        seen,
      ),
    });

    expect(await probe.list()).toEqual([
      {
        id: 'abc',
        to: ['seeker@example.test'],
        cc: ['cc@bluedots.test'],
        subject: 'Your profile is paused',
        created: '2026-10-06T10:00:00Z',
      },
    ]);
    expect(await probe.get('abc')).toEqual({
      id: 'abc',
      to: ['seeker@example.test'],
      cc: [],
      subject: 'Your profile is paused',
      created: '2026-10-06T10:00:00Z',
      from: 'notifications@bluedots.test',
      replyTo: ['person@example.test'],
      html: '<p>paused</p>',
      text: 'paused',
    });

    await probe.list({ to: 'seeker@example.test' });
    const search = seen.find((u) => u.includes('/api/v1/search'))!;
    expect(new URL(search).searchParams.get('query')).toBe('to:"seeker@example.test"');
  });

  test('answers null, never an empty list, when Mailpit cannot be read', async () => {
    const down = createMailProbe({
      baseUrl: 'http://mail',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch,
    });
    const erroring = createMailProbe({ baseUrl: 'http://mail', fetchImpl: stubFetch({}) });

    expect(await down.list()).toBeNull();
    expect(await erroring.list({ to: 'x@example.test' })).toBeNull();
    expect(await erroring.get('abc')).toBeNull();
  });
});
