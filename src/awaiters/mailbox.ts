/**
 * Reading the mailbox the stack sends to.
 *
 * An approval link exists ONLY inside an email -- the aggregator mints a
 * signed token, mails it, and exposes it nowhere else -- so a journey that
 * approves anything has to open the mail. That makes the mailbox part of the
 * environment, not a convenience, and it is why these journeys need the
 * stack's mail server rather than only its APIs.
 */

export type MailMessage = { id: string; to: string[]; subject: string; body: string };

/**
 * The mailbox as it stood before the triggering step.
 *
 * Seeding sends mail, and so does every earlier journey in the run. "A
 * message exists for this address" therefore proves nothing; only one absent
 * from this set was caused by the step under test. Same rule, and the same
 * reason, as the notification baseline.
 */
export type MailBaseline = { seen: Set<string> };

export type MailProbe = {
  list: () => Promise<{ id: string; to: string[]; subject: string }[]>;
  find: (
    spec: { to: string; subjectIncludes?: string; baseline: MailBaseline },
    opts?: { timeoutMs?: number; pollMs?: number },
  ) => Promise<MailMessage | null>;
};

type ListResponse = {
  messages?: { ID?: string; To?: { Address?: string }[]; Subject?: string }[];
};

export async function captureMailBaseline(probe: MailProbe): Promise<MailBaseline> {
  return { seen: new Set((await probe.list()).map((m) => m.id)) };
}

export function createMailProbe(cfg: { baseUrl: string; fetcher?: typeof fetch }): MailProbe {
  const http = cfg.fetcher ?? fetch;

  const list: MailProbe['list'] = async () => {
    // A generous limit rather than the default 50: a full run sends every
    // onboarding and lifecycle mail before these journeys, and the message
    // being waited for would fall off the first page.
    const res = await http(`${cfg.baseUrl}/api/v1/messages?limit=200`);
    if (!res.ok) {
      throw new Error(
        `MAILBOX_UNREADABLE: ${res.status} from the mail server. Without it an ` +
          `approval link cannot be read, so nothing can be approved.`,
      );
    }
    const body = (await res.json()) as ListResponse;
    return (body.messages ?? []).map((m) => ({
      id: String(m.ID),
      to: (m.To ?? []).map((t) => String(t.Address ?? '')),
      subject: String(m.Subject ?? ''),
    }));
  };

  return {
    list,

    async find(spec, opts = {}) {
      const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
      const pollMs = opts.pollMs ?? 200;
      // A mailbox matches an address without regard to case, and the
      // aggregator lowercases the owner address on the way in -- so a
      // journey comparing what it submitted would miss its own mail.
      const wanted = spec.to.toLowerCase();

      for (;;) {
        // Newest first, which is what the mail server returns: two runs of
        // the same journey against one stack would otherwise match the
        // older message and approve a record the run did not create.
        const match = (await list()).find(
          (m) =>
            !spec.baseline.seen.has(m.id) &&
            m.to.some((address) => address.toLowerCase() === wanted) &&
            (!spec.subjectIncludes || m.subject.includes(spec.subjectIncludes)),
        );

        if (match) {
          const res = await http(`${cfg.baseUrl}/api/v1/message/${match.id}`);
          const full = (await res.json()) as { Text?: string; HTML?: string };
          return { ...match, body: full.Text || full.HTML || '' };
        }

        if (Date.now() >= deadline) return null;
        await new Promise((r) => setTimeout(r, pollMs));
      }
    },
  };
}

/**
 * The approval link inside a review email, re-based onto this run.
 *
 * The host in the mail is PUBLIC_API_URL -- a deployment setting -- and this
 * run published the API on an ephemeral port instead, so the link as written
 * resolves to nothing. Asserting on that host would be asserting on a config
 * echo; the path, the record id and the signed token are the behaviour.
 */
export function approvalLinkIn(
  body: string,
  apiBaseUrl: string,
): { url: string; token: string; id: string } {
  const match = body.match(/https?:\/\/[^\s"'<>]*\/admin\/v1\/[^\s"'<>]*/);
  if (!match) {
    throw new Error(
      `APPROVAL_LINK_NOT_FOUND: the review email carries no /admin/v1/ link, so there is ` +
        `nothing to approve with. Body was:\n${body.slice(0, 500)}`,
    );
  }

  const found = new URL(match[0]);
  const token = found.searchParams.get('token');
  if (!token) {
    throw new Error(
      `APPROVAL_LINK_NOT_FOUND: the link carries no token, and the decision route rejects ` +
        `a request without one. Link was: ${found.pathname}${found.search}`,
    );
  }

  const base = new URL(apiBaseUrl);
  found.protocol = base.protocol;
  found.host = base.host;

  // `.../read/<id>` and `.../decision/<id>` both put the record last.
  const id = found.pathname.split('/').filter(Boolean).at(-1) ?? '';

  return { url: found.toString(), token, id };
}
