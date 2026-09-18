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
    // All four now. aggregator-dpg used to be the odd one out -- read from
    // the checkout for its realm and themes, never started -- until the
    // aggregator-onboarding journeys needed its API running. A service that
    // boots must resolve to a digest or the run fails at compose with a
    // reference to nothing.
    expect(BOOTED_SERVICES).toEqual([
      'signals-dpg',
      'signals-search',
      'aggregator-dpg',
      'notification-service',
    ]);
  });

  test('derives the spec sources from it, rather than keeping a second list', () => {
    const withSpecs = SERVICES.filter((s) => SERVICE_REGISTRY[s].openapi !== null);

    expect(Object.keys(SPEC_SOURCES).sort()).toEqual([...withSpecs].sort());
    expect([...specsWithoutOpenapi].sort()).toEqual(
      SERVICES.filter((s) => SERVICE_REGISTRY[s].openapi === null).sort(),
    );
  });
});
