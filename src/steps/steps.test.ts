import { describe, expect, test } from 'vitest';
import { buildUpsertBody, buildSearchBody, extractItemKey } from './steps.js';

describe('buildUpsertBody', () => {
  test('targets the dot the run is testing, not the API default', () => {
    // network defaults to blue_dot server-side. A purple_dot run that omits
    // it would silently create the item on the wrong network.
    const body = buildUpsertBody({ network: 'purple_dot', domain: 'seeker', name: 'J2', email: 'j2@example.test' });

    expect(body.network).toBe('purple_dot');
    expect(body.domain).toBe('seeker');
  });

  test('carries consent, without which the item never leaves draft', () => {
    // search filters lifecycle_status = 'live', and a profile only promotes
    // past draft when it carries consent and has an owning aggregator.
    const body = buildUpsertBody({ network: 'purple_dot', domain: 'seeker', name: 'J2', email: 'j2@example.test' });

    expect(body.privacy_accepted).toBe(true);
    expect(body.terms_accepted).toBe(true);
  });

  test('writes an item rather than entering account-only mode', () => {
    // An absent or empty item_state with no item_id creates the user only,
    // and no item means nothing to index or find.
    const body = buildUpsertBody({ network: 'purple_dot', domain: 'seeker', name: 'J2', email: 'j2@example.test' });

    expect(Object.keys(body.item_state ?? {}).length).toBeGreaterThan(0);
  });
});

describe('buildUpsertBody identifiers', () => {
  test('always carries an identifier, which the route requires', () => {
    // Without one the route answers
    // `400 either email or phone_number is required`.
    const body = buildUpsertBody({
      network: 'purple_dot', domain: 'seeker', name: 'J2', email: 'j2@example.test',
    });

    expect(body.email).toBe('j2@example.test');
  });
});

describe('buildUpsertBody consent', () => {
  test('sends profile_creation, which is what promotes the item to live', () => {
    // privacy_accepted/terms_accepted alone leave the item in draft:
    // recordParticipantConsent promotes only on a profile_creation entry.
    const body = buildUpsertBody({
      network: 'purple_dot', domain: 'seeker', name: 'J2', email: 'j2@example.test',
    });

    expect(body.compliance.find((c) => c.key === 'profile_creation')?.value).toBe(true);
  });

  test('sends user_terms and user_privacy together, as the route demands', () => {
    // They are a both-or-none pair; sending one alone is
    // 400 USER_LEVEL_INCOMPLETE.
    const keys = buildUpsertBody({
      network: 'purple_dot', domain: 'seeker', name: 'J2', email: 'j2@example.test',
    }).compliance.map((c) => c.key);

    expect(keys).toContain('user_terms');
    expect(keys).toContain('user_privacy');
  });

  test('never sends a false entry, which would reject the whole request', () => {
    // Accept-only: any value:false is 400 CONSENT_DECLINED.
    const body = buildUpsertBody({
      network: 'purple_dot', domain: 'seeker', name: 'J2', email: 'j2@example.test',
    });

    expect(body.compliance.every((c) => c.value === true)).toBe(true);
  });
});

describe('buildUpsertBody age', () => {
  test('always sends an adult age, which consent requires here', () => {
    // Guardian-gated domains answer 400 AGE_REQUIRED when consent arrives
    // without an age.
    const body = buildUpsertBody({
      network: 'purple_dot', domain: 'seeker', name: 'J2', email: 'j2@example.test',
    });

    expect(body.age).toBeGreaterThanOrEqual(18);
  });
});

describe('extractItemKey', () => {
  test('reads the key the awaiter correlates on', () => {
    const key = extractItemKey({
      items: [{
        item_network: 'purple_dot', item_domain: 'seeker',
        item_type: 'profile_1.0', item_id: 'abc', lifecycle_status: 'live',
      }],
    });

    expect(key).toEqual({
      network: 'purple_dot', domain: 'seeker', type: 'profile_1.0', id: 'abc',
    });
  });

  test('fails when the upsert wrote no item', () => {
    expect(() => extractItemKey({ items: [] })).toThrow(/no item/i);
  });

  test('fails when the item is still draft, naming the status', () => {
    // Failing here rather than at the search assertion points at the cause:
    // a draft item is invisible to search no matter how well ingestion works.
    expect(() =>
      extractItemKey({
        items: [{
          item_network: 'p', item_domain: 's', item_type: 't', item_id: 'i',
          lifecycle_status: 'draft',
        }],
      }),
    ).toThrow(/draft/);
  });
});

describe('buildSearchBody', () => {
  test('scopes the query to the item under test', () => {
    const body = buildSearchBody(
      { network: 'purple_dot', domain: 'seeker', type: 'profile_1.0', id: 'abc' },
      { field: 'beneficiary_name', value: 'x' },
    );

    expect(body.context.networkId).toBe('purple_dot');
    expect(body.context.domain).toBe('seeker');
    expect(body.context.itemType).toBe('profile_1.0');
  });

  test('filters on an item_state field, the only target the route accepts', () => {
    // Anything else, item_id included, is
    // `400 target must be item_state.<field>`.
    const body = buildSearchBody(
      { network: 'purple_dot', domain: 'seeker', type: 'profile_1.0', id: 'abc' },
      { field: 'beneficiary_name', value: 'journey-beneficiary_name-seed-1' },
    );

    expect(body.message.intent.filters[0]!.target).toBe('item_state.beneficiary_name');
    expect(body.message.intent.filters[0]!.value).toBe('journey-beneficiary_name-seed-1');
  });
});
