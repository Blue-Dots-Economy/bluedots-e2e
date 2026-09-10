# Blue Dots E2E — Journey Layer Design

**Audience:** DPG service owners, the release engineer, and whoever picks up
T1–T12 cold.

**Status:** approved design, pending implementation plan.

**Parent design:** `signals-dpg/docs/superpowers/specs/2026-09-02-cross-service-functional-testing-design.technical.md`
(branch `spec/cross-service-functional-testing`). That document decides the
architecture for both layers. This one narrows to what `bluedots-e2e` builds
first, and records the places where reading the code changed the answer.

---

## Contents

1. [Scope](#1-scope)
2. [What the code changed](#2-what-the-code-changed)
3. [Entry point](#3-entry-point)
4. [Stack composition](#4-stack-composition)
5. [Seeding](#5-seeding)
6. [Step framework](#6-step-framework)
7. [J2 concretely](#7-j2-concretely)
8. [Output](#8-output)
9. [Self-verification](#9-self-verification)
10. [CI](#10-ci)
11. [Repository layout](#11-repository-layout)
12. [Work breakdown](#12-work-breakdown)
13. [Open questions](#13-open-questions)

---

## 1. Scope

### In

The **journey layer**, in this repository: the five-phase runner, a hermetic
Docker Compose stack, Keycloak-minted identities, the step framework, three
report tiers, the harness's own self-verification, and CI bound to a
release-candidate tag.

One journey ships with it — **J2, item → event → search hit**, on `purple_dot`.
The compose file defines the whole stack; profiles boot only what a journey
needs.

### Out

The **contract layer** (`oasdiff breaking` per repo, plus one shared
event-envelope schema asserted from both ends) is out of this spec. It lands as
separate pull requests in the four service repositories. The parent design
recommends building it first; the sequencing decision here is deliberate — the
repository exists, and the journey layer is what it is for.

Out permanently for v1, per the parent design: browser/UI coverage,
Helm/Kubernetes validation, Kong ingress, cross-namespace wiring, and
search ranking-quality evaluation.

### Why J2 and not J1

J1 (onboarding → dashboard) exercises the identity minting that made the runbook
manual. J2 exercises the asynchronous spine — `xadd`, consumer-group drain,
embedding, index upsert, retrievability — which is where flake actually lives.
A suite that is flaky is a suite that gets disabled, so the spine is the risk
worth retiring on journey one. J2 also needs no aggregator, no MinIO, and no
browser path, so its stack is roughly half of J1's.

---

## 2. What the code changed

Five findings from reading the services. Each contradicts or sharpens the parent
design, and each is load-bearing for the plan.

### 2.1 signals-search shares signals-dpg's database

`signals-search/src/worker/process_event.ts` reads the item row with raw SQL
against `items` — the stream entry carries only a key, never a payload. The two
services therefore share one Postgres, which the parent design's diagram does
not show. Compose wires signals-search's `sql` at the signals-dpg database.

### 2.2 Two images are not published

`build-images.yaml` and `ci.yaml` publish a matrix of `api` and `ui` only, to
`ghcr.io/blue-dots-economy/<repo>/<service>`. Neither the custom Keycloak image
nor `dpg-db-postgis-pgvector:17` exists in any registry. The harness builds
both. This is the largest single deviation from the parent design, which
assumed six pullable images.

The Keycloak image is built from **signals-dpg's** `infra/keycloak/Dockerfile`
— it carries the OTP provider jar and the themes — but imports
**aggregator-dpg's** realm export (§2.3). That pairing is unusual enough to
state plainly, because neither repository alone produces a working image for a
four-service stack.

### 2.3 The two realm exports are not interchangeable

`Signals-DPG/infra/keycloak/render-realm.sh` states that the signals-dpg and
aggregator-dpg realm exports stay interchangeable. They do not:

| | signals-dpg `bluedots-realm.json` | aggregator-dpg `realm.json` |
|---|---|---|
| realm name | `bluedots` (literal) | `__KEYCLOAK_REALM__` (placeholder) |
| clients | 4 | 8 — strict superset; identical mapper counts on the shared 4 |
| auth flows | 2 | 9 (portal SSO and OTP gates) |
| `browserFlow` | `bluedots-otp-browser` | `aggregator-otp-browser` |
| `directGrantFlow` | `direct grant` | `direct grant` |

The harness imports **aggregator-dpg's** export, pinned by commit SHA: it is the
only one carrying every client a four-service stack needs. The differing
`browserFlow` does not matter, because the harness authenticates by direct grant
and client credentials and never drives the browser OTP UI. `directGrantFlow` is
identical in both, which is exactly what the parent design's phase 3 relies on.

### 2.4 The voice bot never calls search

Parent design open question 2 asked whether the voice bot's search call targets
signals-dpg's BFF or signals-search directly. Neither. `org_type: 'voice'` is
admitted on exactly three paths in signals-dpg — `GET /api/v1/admin/participant`
(lookup by email or phone), `POST /api/v1/admin/participant` (tier-aware
upsert), and action perform via `_resolve_acting_actor`. No search route accepts
a voice acting org. When J5 is built it is lookup → upsert → action, with any
search hit asserted as a downstream projection rather than a call the voice bot
makes. **This resolves open question 2.**

### 2.5 The stack has two authentication systems, not one

signals-search does not accept Keycloak tokens. `signals-search/src/api/auth.ts`
authenticates by an `x-api-key` header, SHA-256 hashed and matched against the
`apikey` table — better-auth's scheme and table, which survived the Keycloak
migration in signals-dpg. signals-dpg itself accepts both: Keycloak sessions and
tokens for user-facing routes, `x-api-key` for server-to-server callers
(`create_item.ts` branches on the header to decide whether `created_by` may be
set).

So phase 3 mints identities in **both** systems. The parent design's phase 3
describes only the Keycloak half; a harness built to that description gets a 401
from `/v1/search` and no journey passes.

The API key is not hand-inserted. signals-dpg ships
`apps/api/scripts/seed_service_users.ts` — idempotent, creates the
`network_service` organization and its service user, mints one key, prints it
once. The production equivalent is `provision_service_users.sql`, applied by the
deploy-time migrate job from the `AGGREGATOR_DPG_API_KEY` secret. Running the
repository's own script keeps the harness on the real provisioning path and out
of the business of knowing the hash scheme.

### 2.6 Contracts, pinned

```
stream    signals:item-events              (MAXLEN ~ trimmed)
group     signals-search                   DLQ signals:item-events:dlq
envelope  producer omits occurred_at; xadd injects it
embedder  POST {EMBEDDING_BASE_URL}/embeddings
          request   { model, input: string[] }
          response  { data: [{ embedding: number[] }] }
search    POST /v1/search · /v1/search/flat · /v1/relevance
```

`EMBEDDING_DIM` is capped at 2000 by the pgvector HNSW index limit. The stub
embedder returns deterministic, dimension-correct vectors; ranking quality is an
offline evaluation, not a release gate.

`publishItemEvent` is best-effort — it swallows `xadd` failures and logs a
warning. `create_item.ts` awaits it before responding, so there is no race
between a 200 and the stream entry; but a dropped event leaves the stream
untouched, which the drain awaiter must not read as "drained". §7 handles this.

---

## 3. Entry point

One command. CI and a laptop differ only in flags; a suite whose only working
path is the CI path is a suite nobody reproduces.

```
pnpm journey                                   # all journeys, images :develop
pnpm journey --branch feat/x                   # all four services on that branch tag
pnpm journey --branch signals-dpg=feat/x       # one service moved, rest on develop
pnpm journey --images-from-tag 202608-s2-rc1   # what CI runs
pnpm journey --journey J2                      # one scenario, all its networks
pnpm journey --network purple_dot              # one network, all its scenarios
pnpm journey --list                            # print the matrix, boot nothing
pnpm journey --keep-stack                      # leave containers up to debug
```

Local runs default to `:develop`, which `ci.yaml` publishes only after its
checks pass, so the default is never a red build. `--branch` accepts a bare
branch (all four services) or `service=branch` pairs (one service moved, the
rest left on the default). Branch images for refs other than `develop` and
`main` exist only after a manual `build-images.yaml` dispatch; the resolve phase
fails with `IMAGE_NOT_FOUND` and names the missing service rather than falling
back silently.

Whatever the input, resolve lands on a **digest**. Branch tags are mutable, and
the report prints the digest that actually ran.

Five phases, each naming its own failure so a red run says *where* it broke:

```
1 resolve   branch|tag → 4 image digests          RESOLVE_TIMEOUT / IMAGE_NOT_FOUND
2 up        compose up; health + migrations       STACK_UNHEALTHY
3 seed      realm identities, orgs, service accts SEED_FAILED
4 run       scenarios × networks under vitest     <scenario> FAILED
5 report    three artifacts + triage bundle       (never fails)
```

Phase 5 runs on success and failure alike. That is structural, not a
convenience: a gate that explains nothing when red is a gate that gets disabled.

---

## 4. Stack composition

The full stack is defined in compose; each journey declares the profiles it
needs. J2 boots eight containers of roughly fourteen. Adding J1 or J3 later is
a profile declaration, not a compose change.

**Booted for J2:**

| Service | Image | Note |
|---|---|---|
| postgres-pgvector | built by harness | `dpg-db-postgis-pgvector:17`, unpublished |
| redis | `redis:7.2-alpine` | signals-dpg's stream and queues |
| keycloak | built by harness | aggregator-dpg realm, SHA-pinned |
| schema-server | built by harness | static server over pinned `bluedots-schemas` |
| signals-dpg api | `ghcr.io/.../signals-dpg/api` | |
| signals-search api | `ghcr.io/.../signals-search/<service>` | shares the Postgres above; image name unconfirmed (§13.2) |
| signals-search worker | same image, worker entrypoint | consumer group `signals-search` |
| stub-embedder | built by harness | deterministic, dimension-correct |

**Defined, not booted for J2:** aggregator-dpg api and worker, MinIO and its
init sidecar, notification-service and its worker, its separate Redis, Mailpit,
and the SMS provider stub.

Two decisions worth naming. Each service keeps its own Redis where it has one
today — sharing a single instance would make queue-drain assertions ambiguous
across services, and drain is the assertion J2 rests on. And the stack is
hermetic, booted per run from resolved digests rather than shared with anyone,
so a red run is reproducible locally and cannot be shared-state flake.

Network schemas come from a **schema-server container over a `bluedots-schemas`
checkout pinned by commit SHA**, mirroring the local `:8765` setup. Baking the
schemas into this repository would let them drift from the real ones silently;
pointing at the deployed schema URL would let a change outside the release turn
the gate red or green.

---

## 5. Seeding

Phase 3 is what removes the runbook's manual steps. All the routes the journeys
need already exist; authentication was the only blocker.

For J2:

- **Keycloak.** Import the pinned aggregator-dpg realm. Mint one participant
  user through the Admin API and obtain a token by direct grant. Take a
  client-credentials token for `signals-api`.
- **API key.** Run signals-dpg's `apps/api/scripts/seed_service_users.ts` to
  provision the `network_service` organization, its service user, and one
  `apikey` row; capture the key it prints. This is what authenticates
  `POST /v1/search` and signals-dpg's server-to-server routes (§2.5). It is the
  repository's own script on the real provisioning path, not a harness-authored
  insert.
- **Postgres.** signals-dpg migrations must have completed before phase 3
  begins — gated on a real signal, never slept on.
- **Schemas.** `purple_dot` served from the pinned checkout.

### Realm rendering

`render-realm.sh` substitutes placeholders at first import only, and four of its
inputs are fail-hard (`:?`): `PUBLIC_BASE_URL`, `AGGREGATOR_API_SECRET`,
`AGGREGATOR_PORTAL_SECRET`, `AGGREGATOR_BFF_SECRET`. The harness supplies all
four as fixed, non-secret test values — the realm is booted fresh per run and
never reachable from outside the compose network.

One is easy to get silently wrong. aggregator-dpg's export names the realm
`__KEYCLOAK_REALM__`, a placeholder, while signals-dpg's names it literally
`bluedots`. The harness must render it to the value signals-dpg's configuration
expects, or tokens are issued against a realm no service trusts and every
journey fails at its first authenticated call. T3 owns this and asserts it: the
seed verifies the rendered realm name matches what signals-dpg is configured
with, rather than discovering the mismatch as a 401 three steps later.

### Reusing what already exists

signals-dpg ships `scripts/e2e/` — `generate_fixtures.mts`,
`submit_qr_participants.mts`, `seed_actions.mts`, `purple_dot_providers.csv`,
`purple_dot_qr_payloads.json` and a README. These are the runbook steps the
parent design describes as "already scripted", and they carry the deterministic
purple_dot fixture generation this suite needs.

T7's fixtures port these rather than reinventing them. Where a script is usable
as-is, the harness invokes it; where only the fixture data is wanted, the data
moves and the generator stays in signals-dpg. What must not happen is a second,
subtly different purple_dot fixture set — two generators disagreeing is a
failure mode with no owner.

Because `aggregator_id` and `aggregator_type` are Keycloak user attributes
mapped to JWT claims by protocol mappers in the checked-in realm, a real user
created through the Admin API produces a genuine token, and the service performs
its real authorization check. No OTP scraping, and **no test-only code in the
product**.

`purple_dot` declares 9 vectorize-marked fields against `blue_dot`'s 31, which
is why the parent design tiers J2 across both networks. The proof run covers
purple only; adding blue is a matrix entry, not test code.

---

## 6. Step framework

Unchanged from the parent design, and restated here because the work breakdown
depends on it.

A scenario is a **list of named steps**, not a program — no `await`, no control
flow, no assertions in test syntax. The TypeScript lives in the step library,
with each step's plain-English label declared beside its implementation:

```ts
export const pauseProfile = step({
  label: 'Pause the profile',
  run: (ctx) => ctx.clients.signals.lifecycle({ item_id: ctx.state.item_id, to: 'paused' }),
});
```

Steps compose from five extension points, and a step is the only place they are
reachable: **actors** (who is calling), **clients** (typed, generated from each
service's `openapi.json`), **awaiters** (the only sanctioned way to wait),
**projections** (what you assert on), and **fixtures** (per-network seeded
generators).

Generating the clients is load-bearing rather than cosmetic. Three repositories
already fail CI when their spec is stale against the code, so those specs are a
trustworthy proxy for the implementations, generation is free, and a provider
that removes a response field breaks the harness **typecheck** before any
container starts.

The fourth is a gap, not an oversight: **notification-service publishes no
`openapi.json` at all**. Its client is hand-written when J3 is built, and it
gets no typecheck-level contract check until the service emits a spec. J2 does
not touch it, so this blocks nothing now — but it is the one edge the generated
-client argument does not cover, and the contract layer will hit the same wall.

Three lint guards, enforced by the harness's own tests so they fail in review
rather than in a report months later:

1. A scenario `title` and a step `label` must read as prose, and must not
   contain a route path, an identifier, or a service name.
2. A `capability` must be one of the five declared slugs, so the reported
   taxonomy is closed.
3. A scenario needing genuine logic must say so through `custom({ label, run })`
   — a named, labelled escape hatch, so dropping to raw code is visible in
   review and in the report.

The label declared beside each step **is the line the report prints**. Nothing
is translated at render time, so the business-facing report cannot drift from
what the tests assert.

---

## 7. J2 concretely

```ts
defineJourney({
  id:         'J2',
  title:      'A new profile becomes findable in search',
  capability: 'search-and-discovery',
  networks:   ['purple_dot'],

  steps: [
    createProfile({ as: 'seeker' }),
    waitUntilIngestDrained(),
    expectFoundInSearch(),
  ],
});
```

`waitUntilIngestDrained()` is the load-bearing piece, and the reason J2 is the
right first journey. It polls with a deadline and never sleeps.

Before `createProfile` runs, the awaiter records a baseline: the stream's
last-generated id and the DLQ's length. Then it waits for all four conditions:

1. The stream's last id has **advanced** past the baseline
2. `XINFO GROUPS signals:item-events` — lag for group `signals-search` is zero
   **and not null**
3. `XPENDING` — no un-acknowledged entries
4. `XLEN signals:item-events:dlq` — unchanged from the baseline

The assertion then reads the `searchHits` projection through `POST /v1/search`.

Three of those four exist because the obvious two-condition version passes
vacuously.

**Condition 1** catches the dropped publish. `publishItemEvent` swallows `xadd`
failures (§2.6), so a lost event leaves the stream untouched — lag is zero
because nothing was ever added, drain "succeeds" instantly, and the run fails
later at the search assertion with a misleading "not found". Requiring the
stream to have advanced turns a silent drop into a precise failure at the step
that caused it.

**Condition 2's null clause** catches a subtler one. `XINFO GROUPS` reports
`lag` as **null** when entries have been trimmed and the group's position can no
longer be computed — and this stream is `MAXLEN ~` trimmed by every publish. A
helper that treats a null lag as zero reports "drained" on every call, and every
journey built on it passes without asserting anything. Null is treated as *not
drained*; if it persists to the deadline the step fails naming the trim, because
a permanently uncomputable lag is a harness bug, not a slow worker.

**Condition 4** catches poison. A poisoned event is acknowledged on the main
group and parked in the DLQ, so lag reaches zero and pending empties exactly as
a successful ingest would. Without it, a poison event is indistinguishable from
a slow one until the deadline expires, and what gets reported is a timeout
rather than the parked entry. On DLQ growth the step fails immediately with the
entry attached.

Conditions 1 and 2 are each covered by a negative control in §9 — a stub that
never publishes, and a stream trimmed to force a null lag. Without those, the
conditions are assertions about Redis that no test would notice going wrong.

Waits are concentrated in one small module. That is what makes this reviewable:
a bare `sleep` in a diff can be rejected because the alternative already exists
and is named.

---

## 8. Output

Three artifacts, because three audiences need materially different things.

| Tier | Artifact | Audience |
|---|---|---|
| 1 | exit code + GitHub check — binary, no prose | CI, branch protection |
| 2 | journey × network grid, step trace, expected-vs-actual on failure | developer, release manager |
| 3 | one-page evidence sheet, business language, by capability | product, client, compliance |

Tier 2 renders the step trace from the declared labels:

```
 ✓ Created a seeker profile
 ✓ Waited until search ingestion had caught up
 ✗ Found it in search — no match after 30s
```

`summary.json` is the canonical record that both renderers read. JUnit XML is
derived from it purely to feed GitHub's check UI, since JUnit cannot carry a
capability, a skip reason, or digest provenance.

Tier 3's **NOT COVERED** block is generated, not written — derived from the
uncovered edges plus the declared non-goals. With one journey shipping, that
block is most of the page. That is correct: a report listing only passes invites
the reader to assume everything was checked.

On failure the run emits a **triage bundle** as one artifact: per-service
container logs, a `pg_dump` of the touched tables, the resolved digests, the
seeded identities, and the failing step trace — so "what state was it in?" is
answerable without a rerun.

---

## 9. Self-verification

A falsely-green gate is worse than no gate. If a wait helper silently resolves
on timeout, every scenario passes vacuously. Three defences ship **with** J2,
not after it:

1. **Harness unit tests** — fixture determinism, report rendering, the lint
   rules.
2. **Negative controls** — four, each pinning one way the suite could go
   vacuously green:
   - the drain awaiter against a worker that never converges — must time out;
   - the drain awaiter against a publisher that never publishes — must fail on
     the stream-advance condition, not report "drained";
   - the drain awaiter against a stream trimmed hard enough to force a null
     `lag` — must fail naming the trim, not read null as zero;
   - J2 against deliberately wrong expected values — must fail.
3. **A `harness-selftest` CI job** — two canary scenarios, one built to pass and
   one built to fail, asserting the runner reported exactly one of each and
   exited non-zero.

Mutation-testing the harness was considered and rejected as poor value against
those three.

Sequencing follows from this. The controls are built **before** the first real
journey (T9 before T10 in §12): written afterwards, they can only confirm what
their author already believes.

---

## 10. CI

A workflow triggered on `20*-s*-rc*` tag pushes. All four repositories already
publish on the same fleet-wide tag — `202608-s2-rc1` exists in all four — so
resolving one tag to four digests is well defined.

Phase 5 runs under `always()`, so a red run still produces its reports and
triage bundle.

A second workflow runs on every pull request **to this repository**:
`harness-selftest`, plus the unit tests and lint guards. It needs no service
images and finishes in seconds, because the canaries assert on the runner rather
than on the platform. Without it the harness has no CI signal of its own until
T12, which would mean building the thing that catches vacuous passes without
anything watching it for the same fault.

The journey layer **cannot** be a branch-protection check: it runs on a tag,
which exists only after merge. "An RC is not promotable until green" is a
procedural gate in the promotion checklist, not an enforced rule. Running the
suite on `develop → main` promotion pull requests behind an opt-in label stays
available if that proves too weak.

---

## 11. Repository layout

```text
bluedots-e2e/
│
├── journeys/
│   └── search/                 # J2
│
├── steps/
│   ├── actors/
│   ├── clients/                # generated from three openapi.json
│   ├── awaiters/
│   ├── projections/
│   └── fixtures/
│
├── compose/
│   └── docker-compose.yml      # full stack; profiles boot subsets
│
├── scripts/                    # resolve, seed, report
│
├── tests/
│   └── harness/                # unit tests, negative controls, canaries
│
├── reports/
│
├── docs/superpowers/specs/
├── package.json
├── vitest.config.ts
└── README.md
```

---

## 12. Work breakdown

Twelve tickets, spine before breadth. Each becomes a GitHub issue in this
repository once the implementation plan is approved, carrying enough context for
a fresh reader.

| # | Ticket | Proves | Depends on |
|---|---|---|---|
| T1 | Repo scaffold: pnpm, vitest, `pnpm journey` CLI, `--list` | Entry point works with zero containers | — |
| T2 | Resolve phase: branch/tag → digests, per-service override | Mutable tags are pinned | T1 |
| T3 | Compose: full stack + profiles; build keycloak and pgvector images | The stack boots | T1 |
| T4 | Health and migration gating | `STACK_UNHEALTHY` is a real signal | T3 |
| T5 | Seed: realm import, participant mint, client-credentials token | Real authorization, no test-only product code | T4 |
| T6 | Generated clients from the three published `openapi.json` | Typecheck as a second contract check | T1 |
| T7 | Step framework: `defineJourney`, labels, lint guards | Scenario six is cheap | T6 |
| T8 | Awaiters and drain detection (`XINFO`, `XPENDING`, DLQ) | No sleeps anywhere | T7 |
| T9 | Canary scenarios, negative controls, `harness-selftest` as a per-PR check | The gate cannot go vacuously green | T8 |
| T10 | J2 | One real journey passes | T5, T9 |
| T11 | Report renderers: `summary.json` → tiers 1/2/3 + triage bundle | Legible evidence | T10 |
| T12 | CI workflow on RC tag | Bound to the release | T11 |

The parent design's cost-of-change table is the acceptance criterion for T7 and
T8 together: a second journey from existing steps must cost **no TypeScript**,
and a second network must cost **no test code**.

---

## 13. Open questions

1. **Does a standard GitHub runner hold the stack?** J2's eight containers are
   comfortable; the full fourteen on 16GB is unproven. Settled empirically at
   T3, escape hatch is a larger runner. *(provisional)*
2. **Are aggregator-dpg, signals-search and notification-service images
   published on the same scheme as signals-dpg?** signals-dpg is confirmed
   (`api`, `ui`). The other three have Dockerfiles and share the RC tag, but
   their build matrices have not been read. Resolve at T2. *(provisional)*
3. **Should signals-dpg's integration suites leave the `sonar` job?** They run
   under `continue-on-error` today, making regressions advisory. Cheap and
   adjacent, but a separate decision with its own CI-time cost.
4. **When does the contract layer land?** It is a few days' work in the four
   service repositories and retires a recurring production failure class
   (signals-dpg #103, #104, #112, #115, #122; aggregator-dpg #399). Out of this
   spec, but it should not stay unscheduled.
