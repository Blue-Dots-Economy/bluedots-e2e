import type { ItemKey } from '../awaiters/ingest.js';

export type UpsertBody = {
  channel: 'bulk' | 'link' | 'voice' | 'self';
  name: string;
  network: string;
  domain: string;
  item_type: string;
  item_state: Record<string, unknown>;
  privacy_accepted: boolean;
  terms_accepted: boolean;
  /** Required: the route rejects a body carrying neither identifier. */
  email: string;
  /** What actually promotes the item past draft. */
  compliance: { key: string; value: boolean }[];
  /** Required alongside consent on guardian-gated domains. */
  age: number;
};

/**
 * Body for `POST /api/v1/admin/participant`, the tier-aware upsert.
 *
 * Three fields are load-bearing and easy to leave out:
 *
 * - `network` defaults to blue_dot server-side, so a purple_dot run that
 *   omits it creates the item on the wrong network and then fails to find
 *   it, looking like an ingestion problem.
 * - consent, and specifically the `compliance` array. `privacy_accepted`
 *   and `terms_accepted` alone leave the item in `draft`:
 *   recordParticipantConsent promotes to `live` only when a
 *   `profile_creation` entry is accepted, and `user_terms`/`user_privacy`
 *   are a both-or-none pair enforced with `USER_LEVEL_INCOMPLETE`. Since
 *   search filters `lifecycle_status = 'live'`, getting this wrong makes
 *   the journey fail at the search assertion, pointing at the wrong
 *   subsystem entirely.
 * - `age`, because on a guardian-gated domain the route answers
 *   `400 AGE_REQUIRED` when consent arrives without one, and an age under
 *   18 leaves the profile held in draft by the guardian gate however
 *   complete the consent is.
 * - a non-empty `item_state`: absent or `{}` with no item_id puts the route
 *   into account-only mode, creating a user and no item at all.
 *
 * An identifier is also mandatory -- the route answers
 * `400 either email or phone_number is required` -- so it is a required
 * argument here rather than an optional field someone can forget.
 */
/**
 * Old enough that the guardian gate cannot hold the profile in draft.
 *
 * Not incidental: purple_dot's own age field allows a minimum of 1, so a
 * schema-driven fixture can legitimately generate a minor -- and a minor's
 * profile stays draft under guardianGateBlocksGoLive no matter how complete
 * the consent is. A journey testing search must not depend on that lottery.
 */
export const ADULT_AGE = 30;

export function buildUpsertBody(spec: {
  network: string;
  domain: string;
  name: string;
  email: string;
  itemType?: string;
  itemState?: Record<string, unknown>;
  /** Defaults to an adult; see ADULT_AGE. */
  age?: number;
}): UpsertBody {
  return {
    channel: 'bulk',
    name: spec.name,
    network: spec.network,
    domain: spec.domain,
    item_type: spec.itemType ?? 'profile_1.0',
    item_state: spec.itemState ?? { name: spec.name },
    privacy_accepted: true,
    terms_accepted: true,
    email: spec.email,
    // Accept-only: `false` on any entry rejects the whole request with
    // CONSENT_DECLINED, so entries are either present-and-true or omitted.
    compliance: [
      { key: 'user_terms', value: true },
      { key: 'user_privacy', value: true },
      { key: 'profile_creation', value: true },
    ],
    age: spec.age ?? ADULT_AGE,
  };
}

type UpsertResponse = {
  items: {
    item_network: string;
    item_domain: string;
    item_type: string;
    item_id: string;
    lifecycle_status?: string;
  }[];
};

/**
 * Pull the key the awaiter correlates on, refusing anything unusable.
 *
 * A draft item is rejected here rather than at the search assertion: draft
 * is invisible to search however well ingestion works, so failing later
 * would point at the wrong subsystem.
 */
export function extractItemKey(res: UpsertResponse): ItemKey {
  const item = res.items[0];
  if (!item) throw new Error('STEP_FAILED: the upsert wrote no item');

  if (item.lifecycle_status && item.lifecycle_status !== 'live') {
    throw new Error(
      `STEP_FAILED: item is ${item.lifecycle_status}, not live — search only ` +
        `returns live items. Check consent and that an owning aggregator org exists.`,
    );
  }

  return {
    network: item.item_network,
    domain: item.item_domain,
    type: item.item_type,
    id: item.item_id,
  };
}

/**
 * Body for `POST /v1/search`, scoped to one item.
 *
 * Filters target `item_state.<field>` and nothing else -- the route answers
 * `400 target must be item_state.<field>` for anything else, item_id
 * included. So a journey isolates its own item by matching a generated,
 * seed-distinct field value.
 *
 * Still a set-membership assertion, not a rank one: ordering is cosine
 * distance with LIMIT/OFFSET, so depending on position would start failing
 * as the fixture corpus grows, for reasons unrelated to the ingest spine.
 */
export function buildSearchBody(key: ItemKey, filter: { field: string; value: unknown }) {
  return {
    context: {
      domain: key.domain,
      itemType: key.type,
      networkId: key.network,
      messageId: `journey-${key.id}`,
      version: '1.0.0',
    },
    message: {
      intent: {
        filters: [
          { op: 'eq' as const, target: `item_state.${filter.field}`, value: filter.value },
        ],
      },
    },
  };
}
