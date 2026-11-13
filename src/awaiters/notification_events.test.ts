import { describe, expect, test } from 'vitest';
import { createNotificationEvents } from './notification_events.js';

describe('createNotificationEvents', () => {
  test('reads the event types recorded for a recipient from its own database', async () => {
    const calls: { service: string; cmd: readonly string[] }[] = [];
    const events = createNotificationEvents({
      exec: async (service, cmd) => {
        calls.push({ service, cmd });
        return 'item.onboarded_by_aggregator|seeker\nsupport.request|\n';
      },
    });

    // An empty domain column is null: a network-wide event, not a missing read.
    expect(await events.eventsFor('seeker@example.test')).toEqual([
      { eventType: 'item.onboarded_by_aggregator', domain: 'seeker' },
      { eventType: 'support.request', domain: null },
    ]);
    expect(calls[0]!.service).toBe('notification-postgres');
    const sql = calls[0]!.cmd.at(-1)!;
    expect(sql).toContain("payload->'to'->>'email'");
    expect(sql).toContain("'seeker@example.test'");
    // The event type, never the template key: the catalogue chooses the
    // template, and the contract between the two services is the event.
    expect(sql).toContain('event_type');
    expect(sql).toContain('domain');
    expect(sql).not.toContain('template_key');
  });

  test('quotes the address, so it is a value and never SQL', async () => {
    let sql = '';
    const events = createNotificationEvents({
      exec: async (_s, cmd) => {
        sql = cmd.at(-1)!;
        return '';
      },
    });

    await events.eventsFor("o'brien@example.test");

    expect(sql).toContain("'o''brien@example.test'");
  });

  test('answers null, never an empty list, when the database cannot be read', async () => {
    const events = createNotificationEvents({
      exec: async () => {
        throw new Error('container gone');
      },
    });

    expect(await events.eventsFor('x@example.test')).toBeNull();
  });
});
