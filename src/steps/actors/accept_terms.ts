import { step, type StepContext } from '../../journey/define_journey.js';
import { requireContext, requireState } from '../../journey/state.js';
import type { JourneyState } from '../../journey/state.js';

/**
 * The person accepts the terms, as themselves.
 *
 * The account-level pair, not the profile's. They are a both-or-none set --
 * the ledger rejects one without the other -- and they are separate from
 * the `profile_creation` acceptance a profile carries, which is recorded
 * against the item rather than the account.
 *
 * Recorded against the signed-in caller, so it needs the session rather
 * than a service credential: an acceptance attributed to the aggregator
 * would be a consent nobody gave.
 */
export const acceptTerms = (spec: { as: string }) =>
  step({
    label: `The ${spec.as.replace(/_/g, ' ')} accepted the terms and the privacy notice`,
    run: async (ctx: StepContext) => {
      const state = ctx.state as JourneyState;
      const target = requireContext(ctx.target, 'target');
      const consent = requireContext(ctx.consent, "this target's consent document");
      const session = requireState(state, 'sessions')[spec.as];
      if (!session) {
        throw new Error(`STEP_FAILED: the "${spec.as}" is not signed in, so nobody can accept.`);
      }

      const res = await ctx.http(`${ctx.endpoints.signalsApi}/api/v1/consent/accept`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: session.cookie,
          // Every write wants it back; the API answers 403 without it.
          'x-csrf-token': session.csrfToken,
        },
        body: JSON.stringify({
          network: target.network,
          source: 'signup',
          // `terms` and `privacy`, not the `user_terms` / `user_privacy`
          // the admin route's compliance array uses: two vocabularies for
          // the same two documents, and this one is the ledger's.
          //
          // Versions from the target's own consent document rather than a
          // literal. The ledger stores what it is given, so a hardcoded one
          // records an acceptance of a revision nobody was shown the moment
          // the network publishes a new one.
          items: [
            { category: 'terms', version: consent.versionFor('terms') },
            { category: 'privacy', version: consent.versionFor('privacy') },
          ],
        }),
      });

      if (!res.ok) {
        throw new Error(`STEP_FAILED: accept terms ${res.status} ${await res.text()}`);
      }

      const { recorded } = (await res.json()) as { recorded?: number };
      if (!recorded) {
        // The route answers 200 with `recorded: 0` when it matched nothing
        // to record -- an unknown category, or a version already accepted --
        // so the status code alone would read that as consent given.
        throw new Error(
          `STEP_FAILED: the acceptance recorded nothing (recorded: ${recorded ?? 'absent'}). ` +
            `A 200 here does not mean a ledger entry exists.`,
        );
      }
    },
  });
