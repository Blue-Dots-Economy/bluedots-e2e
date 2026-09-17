import { describe, expect, test } from 'vitest';
import { createRecorder } from './http_recorder.js';

describe('createRecorder', () => {
  test('records method, url, status and duration', async () => {
    const rec = createRecorder(async () => new Response('{"ok":true}', { status: 200 }));

    await rec.fetch('http://x/v1/search', { method: 'POST' });

    expect(rec.entries[0]).toMatchObject({
      method: 'POST',
      url: 'http://x/v1/search',
      status: 200,
    });
    expect(rec.entries[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('records the request and response bodies, which a failure needs', async () => {
    const rec = createRecorder(async () => new Response('{"error":"nope"}', { status: 400 }));

    await rec.fetch('http://x/y', { method: 'POST', body: '{"a":1}' });

    expect(rec.entries[0]!.requestBody).toBe('{"a":1}');
    expect(rec.entries[0]!.responseBody).toContain('nope');
  });

  test('returns a usable response, since the caller still reads it', async () => {
    // Consuming the body to record it would leave the caller with a used
    // stream and a confusing "body already read" error.
    const rec = createRecorder(async () => new Response('{"v":1}', { status: 200 }));

    const res = await rec.fetch('http://x/y');

    expect(await res.json()).toEqual({ v: 1 });
  });

  test('redacts credentials, which otherwise land in a public artifact', async () => {
    const rec = createRecorder(async () => new Response('{}', { status: 200 }));

    await rec.fetch('http://x/y', {
      headers: { 'x-api-key': 'sk_signals_secret', authorization: 'Bearer eyJhb.c.d' },
    });

    const recorded = JSON.stringify(rec.entries[0]!.requestHeaders);
    expect(recorded).not.toContain('sk_signals_secret');
    expect(recorded).not.toContain('eyJhb');
    expect(recorded).toContain('REDACTED');
  });

  test('attributes each call to the step that made it', async () => {
    const rec = createRecorder(async () => new Response('{}', { status: 200 }));

    rec.startStep('Created a seeker profile');
    await rec.fetch('http://x/a');
    rec.startStep('Found the profile in search');
    await rec.fetch('http://x/b');

    expect(rec.entries.map((e) => e.step)).toEqual([
      'Created a seeker profile',
      'Found the profile in search',
    ]);
  });

  test('records a network error as an entry rather than losing it', async () => {
    // A connection refused is exactly what a reader needs to see, and it
    // has no status to hang off.
    const rec = createRecorder(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    await expect(rec.fetch('http://x/y')).rejects.toThrow();
    expect(rec.entries[0]!.error).toContain('ECONNREFUSED');
  });

  test('truncates a large body rather than embedding it whole', async () => {
    const rec = createRecorder(async () => new Response('x'.repeat(50_000), { status: 200 }));

    await rec.fetch('http://x/y');

    expect(rec.entries[0]!.responseBody!.length).toBeLessThan(10_000);
    expect(rec.entries[0]!.responseBody).toMatch(/truncated/);
  });
});

test('accepts a URL object, so it is a drop-in for fetch', async () => {
  const recorder = createRecorder(async () => new Response('{}', { status: 200 }));

  await recorder.fetch(new URL('http://signals/api/v1/admin/participant'));

  expect(recorder.entries[0]?.url).toBe('http://signals/api/v1/admin/participant');
});
