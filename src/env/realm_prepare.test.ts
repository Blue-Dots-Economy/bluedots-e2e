import { describe, expect, test } from 'vitest';
import { prepareRealm, KEYCLOAK_DESCRIPTION_LIMIT } from './realm_prepare.js';

describe('prepareRealm', () => {
  test('leaves a conforming realm untouched', () => {
    const { realm, mutations } = prepareRealm({
      clients: [{ clientId: 'signals-ui', description: 'short' }],
    });

    expect(mutations).toEqual([]);
    expect((realm.clients as { description: string }[])[0]!.description).toBe('short');
  });

  test('truncates a description Keycloak cannot store', () => {
    // CLIENT.DESCRIPTION is VARCHAR(255). A longer value fails the import
    // outright with "Value too long for column", and the realm never lands.
    const long = 'x'.repeat(343);

    const { realm } = prepareRealm({
      clients: [{ clientId: 'campaign-manager', description: long }],
    });

    const out = (realm.clients as { description: string }[])[0]!.description;
    expect(out.length).toBeLessThanOrEqual(KEYCLOAK_DESCRIPTION_LIMIT);
  });

  test('records what it changed and why', () => {
    const { mutations } = prepareRealm({
      clients: [{ clientId: 'campaign-manager', description: 'x'.repeat(343) }],
    });

    // The harness is editing a checked-in artifact. That has to be visible in
    // the run report, not silently absorbed.
    expect(mutations[0]).toMatch(/campaign-manager/);
    expect(mutations[0]).toMatch(/343/);
  });

  test('does not mutate the input', () => {
    const input = { clients: [{ clientId: 'c', description: 'y'.repeat(300) }] };

    prepareRealm(input);

    expect(input.clients[0]!.description).toHaveLength(300);
  });
});
