import { defineJourney } from '../../src/journey/define_journey.js';
import { createProfile, expectListedForTheAssistant } from '../../src/steps/index.js';

/**
 * `J20`. What a provider posts is what an assistant can read back.
 *
 * The voice assistant does not use the browse feed the other journeys
 * assert on. `/network/item/discover` is the BFF the web app calls; the
 * assistant reads `/network/item/fetch_local`, a separate route behind the
 * peer guard, and nothing in this suite touched it. A regression there
 * would have been invisible here and visible to every caller on a phone.
 *
 * Sent unsigned, because that is how the assistant sends it -- the guard
 * admits an unsigned request while PEER_AUTH_MODE is `permissive`, its
 * default. Adding a credential would test a path the real caller does not
 * take, and would hide the day that default changes.
 *
 * Asserted on the item's own id rather than on a non-empty page: a listing
 * that returned somebody else's postings would satisfy "results came back"
 * exactly as well.
 */
export const aListingReachesTheAssistant = {
  ...defineJourney({
    id: 'J20',
    title: 'A new listing is returned to an assistant reading the network',
    capability: 'search-and-discovery',
    targets: ['blue_dot/ka-dhwd', 'purple_dot/alimco'],
    steps: [
      createProfile({ as: 'provider' }),
      expectListedForTheAssistant({ as: 'provider' }),
    ],
  }),
  // The write model only: this route reads it directly, without waiting on
  // the index the search journeys depend on.
  requires: ['http', 'redis', 'postgres'] as const,
};
