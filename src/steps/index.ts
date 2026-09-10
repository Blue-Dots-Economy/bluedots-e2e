/**
 * The step library.
 *
 * Steps belong to the library, never to a journey: the design's whole claim
 * is that scenario six costs no new TypeScript, which only holds if the
 * steps a scenario needs already exist here. Organised by the extension
 * points a step is allowed to reach -- actors, awaiters, projections --
 * with fixtures and generated clients underneath.
 */
export { createProfile } from './actors/profile.js';
export { waitUntilThisItemIndexed } from './awaiters/indexed.js';
export { expectFoundInSearch } from './projections/search.js';
