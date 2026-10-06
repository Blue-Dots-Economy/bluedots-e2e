import { describe, expect, test } from 'vitest';
import { createNotificationEvents } from './notification_events.js';

describe('createNotificationEvents', () => {
  test('reads the event types recorded for a recipient from its own database', async () => {
    const calls: { service: string; cmd: readonly string[] }[] = [];
    const events = createNotificationEvents({
      exec: async (service, cmd) => {
        calls.push({ service, cmd });
        return 'item.onboarded_by_aggregator\nitem.paused\n';
      },
    });

    expect(await events.eventTypesFor('seeker@example.test')).toEqual([
      'item.onboarded_by_aggregator',
      'item.paused',
    ]);
    expect(calls[0]!.service).toBe('notification-postgres');
    const sql = calls[0]!.cmd.at(-1)!;
    expect(sql).toContain("payload->'to'->>'email'");
    expect(sql).toContain("'seeker@example.test'");
    // The event type, never the template key: the catalogue chooses the
    // template, and the contract between the two services is the event.
    expect(sql).toContain('event_type');
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

    await events.eventTypesFor("o'brien@example.test");

    expect(sql).toContain("'o''brien@example.test'");
  });

  test('answers null, never an empty list, when the database cannot be read', async () => {
    const events = createNotificationEvents({
      exec: async () => {
        throw new Error('container gone');
      },
    });

    expect(await events.eventTypesFor('x@example.test')).toBeNull();
  });
});
