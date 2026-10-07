/**
 * What notification-service recorded about the events it accepted.
 *
 * Delivered mail proves a message reached an inbox; it does not say which
 * event signals-dpg sent. The event type is the contract between the two
 * services -- the catalogue chooses the template -- so a journey can assert
 * that signals-dpg described the change correctly, independently of copy.
 */
export type RecordedEvent = {
  eventType: string;
  /** The recipient domain the event named; null for a network-wide event. */
  domain: string | null;
};

export type NotificationEvents = {
  /** Every event addressed to `email`, oldest first, or null when unreadable. */
  eventsFor: (email: string) => Promise<RecordedEvent[] | null>;
};

/** SQL string literal. The addresses are generated, but a value is never SQL. */
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Read through the compose stack's own notification-postgres, by service
 * name. That database publishes no port, and nothing else in the harness
 * needs one.
 */
export function createNotificationEvents(deps: {
  exec: (service: string, cmd: readonly string[]) => Promise<string>;
}): NotificationEvents {
  return {
    async eventsFor(email) {
      // One row per line, "event_type|domain"; psql -A prints NULL as empty.
      const sql =
        `select event_type || '|' || coalesce(domain, '') from notification_event ` +
        `where payload->'to'->>'email' = ${literal(email)} and event_type is not null ` +
        `order by created_at`;
      try {
        const out = await deps.exec('notification-postgres', [
          'psql', '-U', 'notification', '-d', 'notification', '-tAc', sql,
        ]);
        return out
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((line) => {
            const [eventType = '', domain = ''] = line.split('|');
            return { eventType, domain: domain || null };
          });
      } catch {
        return null;
      }
    },
  };
}
