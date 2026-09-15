/**
 * The step library.
 *
 * Steps belong to the library, never to a journey: the design's whole claim
 * is that scenario six costs no new TypeScript, which only holds if the
 * steps a scenario needs already exist here. Organised by the extension
 * points a step is allowed to reach -- actors, awaiters, projections --
 * with fixtures and generated clients underneath.
 */
export { createProfile } from './actors/create_profile.js';
export { changeLifecycle } from './actors/change_lifecycle.js';
export { editProfile } from './actors/edit_profile.js';
export { expectSecondDomainRefused } from './actors/refused_second_domain.js';
export { waitUntilThisItemIndexed } from './awaiters/wait_for_indexing.js';
export { waitUntilThisItemRemoved } from './awaiters/wait_for_removal.js';
export { expectFoundInSearch } from './projections/search_results.js';
export { expectNotFoundInSearch } from './projections/not_in_search.js';
export { expectNotificationQueued } from './projections/notification_queued.js';
export { expectLifecycleStatus } from './projections/item_status.js';
export { expectFoundInDiscover } from './projections/discover_feed.js';
export { expectSameParticipant } from './projections/participant_identity.js';
