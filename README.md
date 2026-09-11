# bluedots-e2e

Cross-service functional verification for a Blue Dots release candidate.

One journey is a short business sentence — *"a new profile becomes findable
in search"* — executed against the exact images a release tag published.
The suite boots a real stack (signals-dpg, signals-search, Keycloak,
Postgres, Redis), performs the journey through the services' own APIs, and
writes a report naming what it verified and at which digest.

## What it verifies, and what it does not

**Does:** that an event crossed the ingest spine and *caused* the result.
The awaiter checks four conditions together — the stream advanced past a
baseline, the consumer group consumed that entry, nothing is left pending,
and the dead-letter stream is unchanged — because signals-search runs a
reconciliation sweep that indexes any missing row straight from Postgres
every 60s. A journey built on "wait until it appears" passes with the
ingest spine completely dead. `tests/stack/negative_controls.stack.test.ts`
boots a deliberately broken stack to prove this suite still fails there.

**Does not:** act as a branch-protection check. A release tag only exists
after merge, so "an RC is not promotable until green" is a procedural gate
in the promotion checklist, not a required status.

## Running it

The harness needs three sibling checkouts. It overlays signals-dpg's
`local-setup/docker-compose.yml`, bind-mounts aggregator-dpg's Keycloak
realm, render script, providers and themes, and reads the network schemas:

```
workspace/
  bluedots-e2e/        # this repo
  Signals-DPG/         # compose base
  aggregator-dpg/      # realm + themes
  bluedots-schemas/    # network.json per dot
```

Point elsewhere with `SIGNALS_DPG_PATH`, `AGGREGATOR_DPG_PATH` and
`BLUEDOTS_SCHEMAS_PATH`. Docker must be running.

```bash
pnpm install
pnpm test            # unit tests, no containers, seconds
pnpm test:stack      # boots a real stack, minutes
pnpm journey --list  # targets the schemas define
```

`pnpm test:stack` is the whole suite: it boots once, runs every journey in
`journeys/index.ts` against that stack, and writes `reports/`.

## Environment

| Variable | Meaning |
| --- | --- |
| `JOURNEY_TARGET` | Which `(dot, instance)` to verify, e.g. `purple_dot` or `blue_dot/ka-dhwd`. Required in CI: a run that quietly picks one verifies something nobody asked for. |
| `JOURNEY_RELEASE_TAG` | The release being verified. Every service's image defaults to this tag. |
| `JOURNEY_IMAGE_TAGS` | Per-service overrides as `service=tag` pairs. A release is not always one tag across four repos. An unknown service name is rejected rather than ignored. |
| `JOURNEY_SEED` | Reproduces a run's fixtures and its participant exactly. Printed by every run; pass it back to replay one. |
| `EMBEDDER` | `stub` swaps the real TEI embedder for a stub — a much smaller, faster boot. Defaults to real TEI, whose vectors are the ones production computes. |
| `SIGNALS_DPG_PATH`, `AGGREGATOR_DPG_PATH`, `BLUEDOTS_SCHEMAS_PATH` | Where the sibling checkouts live. |

Everything the containers themselves run with — realm, admin credentials,
client secrets, database and Redis passwords — is owned by
`src/env/compose/stack_env.ts` and is not configurable per run. They are
fixed test values for a stack that is booted fresh and never reachable
outside its own compose network.

## In CI

`.github/workflows/journey.yml`, on `workflow_dispatch`. Give it the
release tag, optionally a per-service image tag for any service that was
re-cut, and optionally a single target. The matrix comes from
`journey --matrix` — the targets the schemas define that a journey also
declares — so adding a dot or a journey changes what CI runs without
editing the workflow. Jobs are named for the dot (`verify blue_dot`), and
keep the instance only when two covered targets share one.

Each run uploads `reports/`:

| File | For |
| --- | --- |
| `report.html` | A person. Scenario tree: open a journey, open a step, see its request and response. |
| `summary.md` | The Actions summary page, with the same counts. |
| `summary.json` | The canonical record the other renderers read. |
| `junit.xml` | The checks UI. |
| `http.json`, `journeys.json`, `run_facts.json` | Raw records: every request, the step traces, the resolved image digests. |

## Adding a journey

A journey is a list of named steps, not a program:

```ts
export const profileBecomesFindable = {
  ...defineJourney({
    id: 'J2',
    title: 'A new profile becomes findable in search',
    capability: 'search-and-discovery',
    targets: ['purple_dot', 'blue_dot/ka-dhwd'],
    steps: [createProfile({ as: 'seeker' }), waitUntilThisItemIndexed(), expectFoundInSearch()],
  }),
  requires: ['http', 'redis', 'postgres'] as const,
};
```

Add it to `journeys/index.ts` and it runs — no new file, no second stack
boot. Boot and seed cost ~145s; a journey's own assertions cost seconds,
which is the point of the shared stack. Fixtures are generated from the
target's own `network.json`, so a journey that runs on one dot runs on
another without test-code changes.

`requires` is what the environment must offer for the journey to mean
anything. A journey that cannot be verified in an environment is reported
NOT COVERED there, never silently downgraded to a weaker assertion that
passes.

## Status

The CLI (`pnpm journey`, published as `bin: journey`) brings a stack up and
tears it down. **It cannot yet run a journey** — that is phase 3 onward.
Use `pnpm test:stack` to run journeys.

Of the five capabilities in the design, `search-and-discovery` is covered
by J2. The other four have no journey yet.
