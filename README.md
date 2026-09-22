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

Two guards run before the stack boots, both for ways the overlay has
actually gone wrong. `assertCoversBaseServices` catches a service the base
compose names that the overlay forgets to reset. `REQUIRED_CONTAINER_ENV`
(`src/env/compose/container_env.ts`) catches the subtler one: a variable
written into the env file, where it feeds compose-file **interpolation**
and never reaches the container. `KEYCLOAK_REALM` and `SIGNALS_SEARCH_URL`
both did that — each service booted clean, answered health checks, and
said so in a single level-40 log line, and the `SIGNALS_SEARCH_URL` case
kept the browse-feed journeys green while they never crossed into
signals-search at all. Entries list what a service **reads**, not
everything it is handed: add one when a variable's absence degrades the
service silently, not for every variable the overlay sets.

## Secret scanning

This repository is public, and the harness authenticates against real
environments. `.gitignore` covers `.env` and `.env.*`, but that is a
convention rather than a control: a credential pasted into a fixture, a
captured response body, or a config file matching neither pattern is
committed with nothing objecting — and on a public remote, pushing it is
disclosure. Rewriting history afterwards does not undo that.

Two layers, deliberately unequal:

| | Runs | Scans |
| --- | --- | --- |
| `.github/workflows/secret-scanning.yml` | every pull request, and pushes to `main` | the full history |
| `.pre-commit-config.yaml` | locally, on `git commit` | the staged diff |

The workflow is the control — it runs whether or not you installed
anything. The hook is the courtesy: it catches the same thing before the
push, which is the only point at which the problem is still private. Both
run gitleaks v8.18.4 with `--redact`, so a finding never prints the
credential it just caught into a world-readable Actions log or a shared
terminal.

One-time setup:

```bash
pip install pre-commit && pre-commit install
```

The other three hooks are not gitleaks' job: `detect-private-key` for the
one credential shape that arrives as a file rather than a string,
`check-added-large-files` for a keystore or response dump that a public
history would keep forever, and `check-merge-conflict` because a committed
conflict marker means the file was not read before staging.

If gitleaks flags something that is genuinely a test fixture, add it to
`.gitleaksignore` with a comment saying why it is safe. If it flags a live
credential, **rotate it and raise an issue** — do not allowlist it. History
is clean as of this writing, which is why no `.gitleaksignore` exists yet.

## In CI

`.github/workflows/journey.yml`, on `workflow_dispatch`. Give it the
release tag, optionally a per-service image tag for any service that was
re-cut, and optionally a target. The matrix comes from `journey --matrix` —
the targets the schemas define that a journey also declares — so adding a
dot or a journey changes what CI runs without editing the workflow. **No
target is named anywhere in the workflow**: the target input is free text,
validated in seconds against that same list, and the `prepare` job prints
what is covered in the run summary.

| Target input | What runs |
| --- | --- |
| *(blank)* | the default dot — `DEFAULT_TARGET` in `journey.yml`, currently `blue_dot`. A release-candidate tag push sends no input, so this is what an automatic run verifies. |
| `all` | every covered dot, one parallel job each |
| `blue_dot` | every covered instance of that dot |
| `blue_dot/ka-dhwd` | exactly that instance |
| anything else | fails in `prepare`, in seconds, naming the targets that exist |

Jobs are named for the dot (`verify blue_dot`), keeping the instance only
when two covered targets share one.

**A dot that is covered but not the default is only verified when asked
for.** The evidence sheet says so under "what a pass here still does not
prove", so a green run cannot be read as covering more than it did.

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

The CLI (`pnpm journey`, published as `bin: journey`) brings a stack up,
lists targets and emits the CI matrix. **It cannot run a journey** — that
is phase 3 onward, and `--journey` is rejected rather than accepted and
ignored. Use `pnpm test:stack`.

`--env` accepts `local` only. `ExternalProvider` exists and is tested, but
nothing selects it yet and there is no cluster to point it at, so
`--env external` is an error rather than a silent fallback to compose.

Of the five capabilities in the design, `search-and-discovery` is covered
by J2. The other four have no journey yet.
