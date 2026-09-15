import Redis from 'ioredis';
import type { NotificationProbe, QueuedNotification } from './notification.js';

/**
 * A probe backed by the queues notification-service actually writes to.
 *
 * `/notify` validates the channel, the template against that provider's
 * allowlist and the variables against its schema, and only then LPUSHes the
 * job. So a job on one of these lists means signals-dpg and
 * notification-service agreed on the contract -- which is more than an
 * inbox would tell us, and is reachable without SES or Gmail credentials.
 */
export function createNotificationProbe(cfg: {
  redisUrl: string;
  /** Defaults are notification-service's own queue keys. */
  queues?: readonly string[];
}): NotificationProbe & { close: () => Promise<void> } {
  const queues = cfg.queues ?? ['queue:realtime', 'queue:other'];
  const redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: 3 });

  return {
    async queued() {
      try {
        const lists = await Promise.all(queues.map((q) => redis.lrange(q, 0, -1)));
        return lists.flat().flatMap((raw) => {
          try {
            return [JSON.parse(raw) as QueuedNotification];
          } catch {
            // A job the service wrote that we cannot read is not a job we
            // can assert on, but it is also not a reason to fail the whole
            // reading -- the one we are waiting for may be beside it.
            return [];
          }
        });
      } catch {
        // null, never []: an empty list is what a quiet queue reads, and
        // the awaiter would take that as "nothing yet" until its deadline.
        return null;
      }
    },

    async close() {
      redis.disconnect();
    },
  };
}
