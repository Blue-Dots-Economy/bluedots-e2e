import type { MailMessage, MailProbe, MailSummary } from './mail.js';

type Address = { Address: string };
type RawSummary = {
  ID: string;
  To?: Address[] | null;
  Cc?: Address[] | null;
  Subject?: string;
  Created?: string;
};
type RawMessage = RawSummary & {
  From?: Address | null;
  ReplyTo?: Address[] | null;
  HTML?: string;
  Text?: string;
};

const addresses = (list: Address[] | null | undefined) => (list ?? []).map((a) => a.Address);

const toSummary = (m: RawSummary): MailSummary => ({
  id: m.ID,
  to: addresses(m.To),
  cc: addresses(m.Cc),
  subject: m.Subject ?? '',
  created: m.Created ?? '',
});

/**
 * A probe backed by the stack's Mailpit HTTP API.
 *
 * notification-service delivers over plain SMTP to the mailpit service, so
 * what lands here is what a recipient's inbox would have received: the
 * rendered subject, body, recipients and reply-to.
 */
export function createMailProbe(cfg: { baseUrl: string; fetchImpl?: typeof fetch }): MailProbe {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const base = cfg.baseUrl.replace(/\/+$/, '');

  // null on any failure, never []: an empty list is what a quiet mailbox
  // reads, and the awaiter would take that as "nothing yet" until its
  // deadline and then blame the services.
  async function read<T>(path: string): Promise<T | null> {
    try {
      const res = await fetchImpl(`${base}${path}`);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  return {
    async list(opts) {
      // Mailpit keeps at most 500 messages by default, so 1000 is all of them.
      const path = opts?.to
        ? `/api/v1/search?limit=1000&query=${encodeURIComponent(`to:"${opts.to}"`)}`
        : '/api/v1/messages?limit=1000';
      const body = await read<{ messages?: RawSummary[] | null }>(path);
      return body === null ? null : (body.messages ?? []).map(toSummary);
    },

    async get(id): Promise<MailMessage | null> {
      const m = await read<RawMessage>(`/api/v1/message/${encodeURIComponent(id)}`);
      if (m === null) return null;
      return {
        ...toSummary(m),
        from: m.From?.Address ?? '',
        replyTo: addresses(m.ReplyTo),
        html: m.HTML ?? '',
        text: m.Text ?? '',
      };
    },
  };
}
