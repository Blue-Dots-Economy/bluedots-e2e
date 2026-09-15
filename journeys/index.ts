import type { RunnableJourney } from '../src/journey/select.js';
import { profileBecomesFindable } from './search/profile_becomes_findable.js';
import { editedProfileIsReindexed } from './search/edited_profile_is_reindexed.js';
import { profileReachesBrowseFeed } from './search/profile_reaches_browse_feed.js';
import { browseFeedHonoursAFilter } from './search/browse_feed_honours_a_filter.js';
import { pausedProfileLeavesSearch } from './lifecycle/paused_profile_leaves_search.js';
import { retiredProfileLeavesSearch } from './lifecycle/retired_profile_leaves_search.js';
import { participantIsNotDuplicated } from './onboarding/participant_is_not_duplicated.js';
import { onePersonOneDomain } from './onboarding/one_person_one_domain.js';
import { profileWithoutConsentStaysHidden } from './consent/profile_without_consent_stays_hidden.js';
import { onboardingNotifiesTheParticipant } from './notifications/onboarding_notifies_the_participant.js';
import { pausingNotifiesTheOwner } from './notifications/pausing_notifies_the_owner.js';

/**
 * Every journey the suite knows about.
 *
 * Adding one is a line here plus its scenario file. It costs no new stack
 * boot and no new test code: the stack test iterates this list against the
 * single stack it already brought up, so the marginal cost of a journey is
 * its own assertions rather than a two-and-a-half-minute boot.
 *
 * Grouped by the directory the scenario lives in, which is the capability
 * it covers. Four of the five capabilities are represented; voice-assistant
 * has no journey because no stack this harness boots runs voice-dpg, and
 * the evidence sheet says so rather than leaving a green run to imply it.
 */
export const ALL_JOURNEYS: readonly RunnableJourney[] = [
  // search-and-discovery
  profileBecomesFindable,
  editedProfileIsReindexed,
  profileReachesBrowseFeed,
  browseFeedHonoursAFilter,
  pausedProfileLeavesSearch,
  retiredProfileLeavesSearch,
  // participant-onboarding
  participantIsNotDuplicated,
  // consent-and-data-disclosure
  profileWithoutConsentStaysHidden,
  onePersonOneDomain,
  // notifications
  onboardingNotifiesTheParticipant,
  pausingNotifiesTheOwner,
];
