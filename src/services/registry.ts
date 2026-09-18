/**
 * Every per-service fact, in one table.
 *
 * The four names were written out in five places -- the CLI's flag parser,
 * the image resolver's two maps, the spec sources, and a booted-services
 * list in a test fixture -- already in different orders, and a narrowing
 * applied to one call site was missed in another because of it. A service
 * is added here and nowhere else.
 */
export const SERVICE_REGISTRY = {
  'signals-dpg': {
    repo: 'Blue-Dots-Economy/signals-dpg',
    /** Images are published per component: the matrix is api, ui. */
    perComponent: true,
    /** Published only after CI passes, so never a red build. */
    defaultTag: 'develop',
    /** A journey run starts containers for it. */
    boots: true,
    openapi: 'openapi.json',
  },
  'signals-search': {
    repo: 'Blue-Dots-Economy/signals-search',
    /** ONE image serves both the api and the worker. */
    perComponent: false,
    defaultTag: 'develop',
    boots: true,
    openapi: 'openapi.json',
  },
  'aggregator-dpg': {
    repo: 'Blue-Dots-Economy/aggregator-dpg',
    /** Per component, but the matrix is api, web, worker -- no "ui". */
    perComponent: true,
    defaultTag: 'develop',
    /**
     * Booted since the aggregator-onboarding journeys. Before those it was
     * resolved for provenance only, and the checkout supplied the realm
     * export and themes without needing an image -- it still does, but the
     * API now runs as well, so a missing image is a failed run rather than
     * a missing provenance line.
     */
    boots: true,
    openapi: 'openapi.json',
  },
  'notification-service': {
    repo: 'Blue-Dots-Economy/notification-service',
    perComponent: false,
    /**
     * Its build workflow triggers on `main` and `feature` only, so it
     * publishes no `:develop` at all.
     */
    defaultTag: 'main',
    /**
     * Booted since the notification journeys: signals-dpg's client is
     * undefined without an endpoint, so with the service absent the whole
     * pipeline was unassertable rather than merely untested.
     */
    boots: true,
    /**
     * Publishes no openapi.json. Recorded as null rather than omitted, so
     * nobody "fixes" the gap by vendoring a hand-written spec that would
     * then drift from the service with nothing to catch it.
     */
    openapi: null,
  },
} as const;

export type Service = keyof typeof SERVICE_REGISTRY;

export const SERVICES = Object.keys(SERVICE_REGISTRY) as readonly Service[];

/**
 * The services a run actually starts containers for.
 *
 * Only these are required to resolve to a digest. A release is not always
 * cut across all four repos, and failing a run because a service it never
 * starts has no image for that tag stops the verification that could have
 * happened and reports nothing.
 */
export const BOOTED_SERVICES: readonly Service[] = SERVICES.filter(
  (s) => SERVICE_REGISTRY[s].boots,
);
