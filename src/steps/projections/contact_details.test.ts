import { describe, expect, test } from 'vitest';
import {
  expectContactDetailsHidden,
  expectContactDetailsRevealed,
} from './contact_details.js';
import type { StepContext } from '../../journey/define_journey.js';
import { buildTargetSchemas } from '../../targets/target_schemas.js';

const target = buildTargetSchemas({
  id: 'blue_dot',
  domains: [
    {
      id: 'provider',
      item_schemas: {
        'job_posting_1.0': {
          required: ['role'],
          properties: {
            role: { type: 'string' },
            hiringManagerPhoneNumber: { type: 'string', private: true },
          },
        },
      },
    },
  ],
});

const state = () => ({
  seed: 'abc123',
  actionId: 'act_1',
  profiles: {
    seeker: {
      key: { network: 'blue_dot', domain: 'seeker', type: 'profile_1.0', id: 'itm_s' },
      itemState: {},
      email: 's@b.test',
      userId: 'usr_s',
    },
    provider: {
      key: { network: 'blue_dot', domain: 'provider', type: 'job_posting_1.0', id: 'itm_p' },
      itemState: { role: 'Fitter', hiringManagerPhoneNumber: '9000012345' },
      email: 'p@b.test',
      userId: 'usr_p',
    },
  },
});

const ctx = (http: typeof fetch): StepContext => ({
  clients: {},
  state: state(),
  endpoints: { signalsApi: 'http://signals', searchApi: '', keycloak: '', postgresUrl: '', redisUrl: '', aggregatorApi: '', mailpit: '' },
  seeded: {},
  http,
  keys: { issueFor: async (userId) => `key-for-${userId}` },
  target,
  auth: { apiKey: 'k', actingOrgId: 'org', participantToken: 't' },
});

const reply = (body: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

describe('expectContactDetailsRevealed', () => {
  test('passes when the private field carries the value the counterparty stored', async () => {
    await expectContactDetailsRevealed({ as: 'seeker', of: 'provider' }).run(
      ctx(
        reply({
          revealed: true,
          action_status: 'accepted',
          other_actor: {
            item: { item_state: { role: 'Fitter', hiringManagerPhoneNumber: '9000012345' } },
          },
        }),
      ),
    );
  });

  test('fails on a masked value even though the route says it revealed', async () => {
    // The regression this exists for: authorisation still works, the
    // decrypt does not, and `revealed: true` would pass a flag-only check
    // while the person sees "9***".
    await expect(
      expectContactDetailsRevealed({ as: 'seeker', of: 'provider' }).run(
        ctx(
          reply({
            revealed: true,
            action_status: 'accepted',
            other_actor: { item: { item_state: { hiringManagerPhoneNumber: '9***' } } },
          }),
        ),
      ),
    ).rejects.toThrow(/never decrypted/);
  });

  test('names which party blocked the reveal', async () => {
    await expect(
      expectContactDetailsRevealed({ as: 'seeker', of: 'provider' }).run(
        ctx(reply({ revealed: false, reveal_blocked_reason: 'other', action_status: 'accepted' })),
      ),
    ).rejects.toThrow(/reason: other/);
  });
});

describe('expectContactDetailsHidden', () => {
  test('passes on the 403 the gate answers', async () => {
    await expectContactDetailsHidden({ as: 'seeker' }).run(
      ctx(reply({ error: 'PII_NOT_REVEALED' }, 403)),
    );
  });

  test('calls a reveal on a pending request a disclosure', async () => {
    await expect(
      expectContactDetailsHidden({ as: 'seeker' }).run(
        ctx(reply({ revealed: true, action_status: 'created', other_actor: { item: {} } })),
      ),
    ).rejects.toThrow(/disclosure/);
  });

  test('fails on a 500, rather than counting any non-200 as hidden', async () => {
    // "Not revealed" must mean the gate refused, not that the route fell
    // over -- otherwise an outage reads as a passing privacy assertion.
    await expect(
      expectContactDetailsHidden({ as: 'seeker' }).run(ctx(reply({ error: 'BOOM' }, 500))),
    ).rejects.toThrow(/expected 403/);
  });
});
