import { describe, expect, test } from 'vitest';
import { requireState } from './state.js';

describe('requireState', () => {
  test('returns the value a previous step recorded', () => {
    const state = { itemKey: { network: 'p', domain: 's', type: 't', id: 'i' } };

    expect(requireState(state, 'itemKey').id).toBe('i');
  });

  test('names the missing precondition and who provides it', () => {
    // Steps compose freely, so a scenario CAN be written in the wrong
    // order. When it is, the failure has to say which step was missing --
    // "cannot read property of undefined" three frames deep does not.
    expect(() => requireState({}, 'itemKey')).toThrow(
      /itemKey.*createProfile/s,
    );
  });

  test('treats an explicitly undefined value as missing', () => {
    expect(() => requireState({ itemKey: undefined }, 'itemKey')).toThrow(/itemKey/);
  });
});
