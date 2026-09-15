import { describe, expect, test } from 'vitest';
import { BOOTED_SERVICES, SERVICES, SERVICE_REGISTRY } from './registry.js';
import { SPEC_SOURCES, specsWithoutOpenapi } from '../clients/spec_source.js';

describe('SERVICE_REGISTRY', () => {
  test('is the only list of services', () => {
    // Five copies existed, already in different orders, and a narrowing
    // applied to one call site was missed in another because of it.
    expect(SERVICES).toEqual([
      'signals-dpg',
      'signals-search',
      'aggregator-dpg',
      'notification-service',
    ]);
  });

  test('names the ones a run boots, which is what must resolve to a digest', () => {
    // aggregator-dpg is the odd one out: its realm and themes are read from
    // the checkout, so it is resolved for provenance and never started.
    expect(BOOTED_SERVICES).toEqual(['signals-dpg', 'signals-search', 'notification-service']);
  });

  test('derives the spec sources from it, rather than keeping a second list', () => {
    const withSpecs = SERVICES.filter((s) => SERVICE_REGISTRY[s].openapi !== null);

    expect(Object.keys(SPEC_SOURCES).sort()).toEqual([...withSpecs].sort());
    expect([...specsWithoutOpenapi].sort()).toEqual(
      SERVICES.filter((s) => SERVICE_REGISTRY[s].openapi === null).sort(),
    );
  });
});
