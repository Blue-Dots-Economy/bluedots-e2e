import { describe, expect, test } from 'vitest';
import { participantKeys, type Query } from './participant_keys.js';

const inserts = () => {
  const rows: unknown[][] = [];
  const query: Query = async (sql, params) => {
    if (sql.includes('INSERT')) {
      rows.push(params);
      return { rowCount: 1, rows: [{ id: params[0] }] as never[] };
    }
    return { rowCount: 1, rows: [{ count: '1' }] as never[] };
  };
  return { rows, query };
};

describe('participantKeys', () => {
  test('gives two people two credentials, even under the same role', async () => {
    // The regression: every journey seeds its own participants, so "the
    // seeker" in one scenario is a different person from "the seeker" in
    // the next. Caching under the role handed the second journey the first
    // one's identity, and the route answered SOURCE_ITEM_NOT_OWNED_BY_ACTOR
    // -- which reads as a product bug.
    const { rows, query } = inserts();
    const keys = participantKeys(query);

    const a = await keys.issueFor('usr_a', 'actor-seeker');
    const b = await keys.issueFor('usr_b', 'actor-seeker');

    expect(a).not.toBe(b);
    expect(rows.map((r) => r[0])).toEqual(['key_journey_usr_a', 'key_journey_usr_b']);
  });

  test('reuses one credential per person, because the raw key cannot be read back', async () => {
    const { rows, query } = inserts();
    const keys = participantKeys(query);

    const first = await keys.issueFor('usr_a', 'self-seeker');
    const second = await keys.issueFor('usr_a', 'actor-seeker');

    expect(second).toBe(first);
    expect(rows).toHaveLength(1);
  });

  test('says the user has no local row, rather than reporting a constraint', async () => {
    const query: Query = async (sql) =>
      sql.includes('INSERT')
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [{ count: '0' }] as never[] };

    await expect(participantKeys(query).issueFor('usr_ghost', 'actor-seeker')).rejects.toThrow(
      /no local user row/,
    );
  });

  test('distinguishes a leftover row from a missing user', async () => {
    const query: Query = async (sql) =>
      sql.includes('INSERT')
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [{ count: '1' }] as never[] };

    await expect(participantKeys(query).issueFor('usr_a', 'actor-seeker')).rejects.toThrow(
      /already exists from an earlier run/,
    );
  });
});
