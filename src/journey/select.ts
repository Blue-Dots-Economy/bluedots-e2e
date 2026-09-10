import type { Capability } from '../env/capabilities.js';
import type { Journey } from './journey.js';

/** A journey plus what the environment must offer for it to mean anything. */
export type RunnableJourney = Journey & { requires: readonly Capability[] };

export type Selection = {
  run: RunnableJourney[];
  skipped: { id: string; reason: string }[];
};

/**
 * Decide which journeys this run executes.
 *
 * Everything is accounted for: a journey is either run, or skipped with a
 * reason the report can print. Silently dropping one would show up as a
 * green run that covered less than it appeared to -- the failure mode the
 * NOT COVERED block exists to prevent.
 */
export function selectJourneys(
  journeys: readonly RunnableJourney[],
  target: string,
  capabilities: readonly Capability[],
): Selection {
  const run: RunnableJourney[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const journey of journeys) {
    if (!journey.targets.includes(target)) {
      skipped.push({ id: journey.id, reason: `does not declare target ${target}` });
      continue;
    }
    const missing = journey.requires.filter((c) => !capabilities.includes(c));
    if (missing.length > 0) {
      skipped.push({ id: journey.id, reason: `environment lacks ${missing.join(', ')}` });
      continue;
    }
    run.push(journey);
  }

  return { run, skipped };
}
