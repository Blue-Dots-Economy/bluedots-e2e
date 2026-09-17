import { describe, expect, test } from 'vitest';
import { duration, escapeHtml, isFailedRequest, seconds } from './format.js';
import type { HttpEntryView } from './render_html.js';

const entry = (over: Partial<HttpEntryView>): HttpEntryView => ({
  step: null, method: 'GET', url: 'http://x', status: 200, durationMs: 1, requestHeaders: {}, ...over,
});

describe('isFailedRequest', () => {
  test('counts a 4xx and a 5xx', () => {
    expect(isFailedRequest(entry({ status: 400 }))).toBe(true);
    expect(isFailedRequest(entry({ status: 503 }))).toBe(true);
  });

  test('counts a connection that never completed, which has no status', () => {
    expect(isFailedRequest(entry({ status: null, error: 'ECONNREFUSED' }))).toBe(true);
  });

  test('does not count a 2xx or a redirect', () => {
    expect(isFailedRequest(entry({ status: 200 }))).toBe(false);
    expect(isFailedRequest(entry({ status: 302 }))).toBe(false);
  });
});

describe('duration', () => {
  test('shows sub-second calls in milliseconds', () => {
    expect(duration(42)).toBe('42ms');
    expect(duration(1500)).toBe('1.5s');
    expect(seconds(1500)).toBe('1.5s');
  });
});

describe('escapeHtml', () => {
  test('neutralises a script tag in the least trusted text on the page', () => {
    expect(escapeHtml('<script>"x"</script>')).toBe('&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  });
});
