import type { RunnableJourney } from '../src/journey/select.js';
import { J2 } from './search/j2.js';

/**
 * Every journey the suite knows about.
 *
 * Adding one is a line here plus its scenario file. It costs no new stack
 * boot and no new test code: the stack test iterates this list against the
 * single stack it already brought up, so the marginal cost of a journey is
 * its own assertions rather than a two-and-a-half-minute boot.
 */
export const ALL_JOURNEYS: readonly RunnableJourney[] = [J2];
