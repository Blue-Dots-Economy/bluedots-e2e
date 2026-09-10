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
13. [Relationship to epic #1](#13-relationship-to-epic-1)
14. [Open questions](#14-open-questions)

---

## 1. Scope

### In

The **journey layer**, in this repository: the five-phase runner, a hermetic
Docker Compose stack, Keycloak-minted identities, the step framework, three
report tiers, the harness's own self-verification, and CI bound to a
release-candidate tag.

One journey ships with it — **J2, item → event → search hit** — on two
targets: **`purple_dot`** and **`blue_dot/ka-dhwd`**. The compose file defines the whole stack;
profiles boot only what a journey needs.

Running two targets on the first journey is deliberate. The design's central
claim is that a target is a matrix parameter rather than a copy, and a
single-target run asserts that claim without testing it. `blue_dot/ka-dhwd` is
also the target worth having: it is a real deployed instance, it carries a
third domain and extra actions the dot-level config does not (§4), and blue
declares **31** vectorize-marked fields against purple's **9** — far more
exposed to ingestion regressions than the network the runbook happens to
cover.

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
worth retiring on journey one. J2 also needs no aggregator, no MinIO and no browser path, so its stack is
smaller than J1's — around eleven containers (§4).

---

## 2. What the code changed

Findings from reading the four services. Each contradicts or sharpens the
parent design, and each is load-bearing for the plan.

An earlier revision of this section got several of these wrong by reasoning
from the repositories' root `docker-compose.yaml` files. The authoritative
file is **`Signals-DPG/local-setup/docker-compose.yml`** (505 lines), which
already boots most of the stack this suite needs. Read it before §4.

### 2.1 signals-search shares signals-dpg's database

`signals-search/src/worker/process_event.ts:26-32` reads the item row with raw
SQL against `items` — the stream entry carries only a key, never a payload.
`local-setup/docker-compose.yml:441-443` states it outright: "The SAME database
signals-dpg uses: signals-search reads `apikey`, `items` and `item_search` from
it. A separate DB silently yields 401s and an empty index."

### 2.2 The item_search DDL belongs to signals-dpg, and only a tools image can create it

`signals-search/src/db/migrate.ts:21-52` hard-fails at boot unless `item_search`
exists and carries `source_updated_at`. It does not create it —
`local-setup/docker-compose.yml` sets `RUN_MIGRATIONS: "false"` for both search
services because the DDL is signals-dpg's.

What creates it is the `signals-bootstrap` one-shot: `drizzle-kit push --force`
then `pnpm --filter api db:init`. And it needs its own image, because the
published api image cannot run either command.
`local-setup/infra/signals-bootstrap.Dockerfile:3-6`:

> signals-dpg's production API image (apps/api/Dockerfile) is pruned to
> prod-only dependencies, so it does NOT contain drizzle-kit or tsx and
> therefore cannot run migrations or the init/seed scripts.

The runner stage is `dhi.io/node:24-alpine` — hardened, no shell, no package
manager. The `prod-deps` stage names `tsx` as one of the peers it deliberately
starves.

This has a consequence the design has to absorb: **`seed_service_users.ts` is
TypeScript and runs only in the tools image**, which is built from source and
therefore cannot be resolved to a registry digest. §4 states how the digest
rule accommodates it.

### 2.3 No custom Keycloak image is needed

Both reference composes run **stock** `quay.io/keycloak/keycloak:26.5.5` with
`render-realm.sh` as the entrypoint and providers, themes and realms
bind-mounted (`local-setup/docker-compose.yml:107, 165-172`). `start-dev`
indexes the mounted provider jar at boot, so no rebuild is needed to pick up a
new one. signals-dpg's `infra/keycloak/Dockerfile:12-16` says as much itself,
and deliberately does not copy `render-realm.sh` (lines 17-19) — under
Kubernetes an initContainer does the substitution — so an image built from it
could not render its own realm anyway.

A Keycloak **server** image is separately published and deployed
(`bluedots-automation/helm/aggregator/values.yaml:277`), but the harness needs
neither. It mounts, like the reference composes do.

### 2.4 Keycloak boot needs a post-import fixup, or identities fail silently

`infra/keycloak/init/apply-user-profile.sh:5-17`:

> Keycloak 26 **ignores `kc.user.profile.config` from a realm import**. Verified
> on 26.5.5 … The consequence is silent and severe: writes of the `phoneNumber`
> attribute are DROPPED rather than rejected … This must run after every
> Keycloak boot.

The same script creates the `signals_acting_orgs` protocol mappers (lines
143-232), because the realm JSON is consulted only on first import. The
reference compose runs it as the `keycloak-init` one-shot and calls it "NOT
optional when running Keycloak". Any harness that imports a realm and starts
minting users without it gets a realm that looks correct and drops attributes.

### 2.5 Two authentication systems, and the Keycloak half is switched off

signals-search accepts only an `x-api-key`, SHA-256 base64url-matched against
the `apikey` table (`signals-search/src/api/auth.ts:6-25`) — better-auth's
table, which survived the Keycloak migration. signals-dpg accepts both, and
branches on the header at `apps/api/src/routes/v1/item/create_item.ts:169-186`.

Three things block the Keycloak half as the parent design describes it:

1. **Direct grant is disabled on every usable client.**
   `directAccessGrantsEnabled` is `false` for `signals-ui`, `signals-api`,
   `aggregator-dpg` and `voice-dpg` in both realm exports. The only
   direct-grant client in either is `campaign-manager`, which is not in
   `KEYCLOAK_ACCEPTED_CLIENT_IDS` (default `signals-ui`,
   `packages/config/src/secrets.ts:109`), so its token is rejected on the human
   path regardless.
2. **The `signals-api` service token is rejected by design.**
   `apps/api/src/services/auth/service_account.ts:101` rejects any clientId
   absent from `KEYCLOAK_SERVICE_CLIENT_IDS`, which defaults to empty
   (`secrets.ts:134`). The docblock at `secrets.ts:100-109` is explicit that
   `signals-api` is deliberately excluded because it is not an integrating DPG.
3. **`AUTH_PROVIDER` defaults to `betterauth`**, which
   `local-setup/docker-compose.yml:295-297` says "keeps every Keycloak path
   dormant; the KEYCLOAK_* values below are inert".

§5 states what the harness does about each. None of it is free, and one item
requires mutating the realm after import — which the earlier "no test-only code
in the product" claim glossed over.

### 2.6 The reconciliation sweep is a second, silent ingestion path

`signals-search/src/worker/main.ts:42-52` runs `sweep()` at boot and every
`SWEEP_INTERVAL_MS`, default **60_000** (`src/config.ts:42`).
`src/ingest/sweep.ts:22-30` selects every `items` row with no `item_search` row
and indexes it directly from Postgres, through the same `indexItem` the stream
path uses. `Signals-DPG/apps/api/src/utils/publish_item_event.ts:22-23` names
it: "The signals-search reconciliation sweep is the backstop."

For production this is good design. For this suite it is the single largest
vacuous-pass risk, because it makes "the item is findable" true whether or not
the event ever crossed the stream. §7 handles it; §9 adds a control for it.

### 2.7 The voice bot, and what open question 2 actually asks

`org_type: 'voice'` is admitted as an acting-org type globally
(`apps/api/src/middleware/acting_org.ts:8`); three routes check it —
`GET`/`POST /api/v1/admin/participant` and action perform via
`_resolve_acting_actor`.

An earlier revision claimed this resolved the parent design's open question 2.
It does not. signals-dpg **does** have a search BFF —
`apps/api/src/routes/v1/network/item/discover.ts`, calling signals-search
`/v1/search` through `services/signals_search_client.ts:371`. It is
unauthenticated by design (`discover.ts:39-41`) and `acting_org_preHandler` is
wired only for `/api/v1/admin`, `/api/v1/aggregator` and `/api/v1/action`
(`apps/api/src/app.ts:98-99`). So no search route takes an acting org from
anyone, which makes the observation true and uninformative. The real answer is
that the BFF is the search path and it needs no acting org.

That BFF also **fails open**: when signals-search is unconfigured, times out or
returns non-2xx, `discover.ts:51-64` falls back to
`fetchItemsAcrossInstances` and returns 200 with `meta.source:
'native_fallback'`. Both `SIGNALS_SEARCH_URL` and `SIGNALS_SEARCH_API_KEY` are
optional (`secrets.ts:305-306`). A journey asserting through the BFF passes with
signals-search absent entirely. J2 asserts against `/v1/search` directly and so
avoids this, at the cost of testing a path no end user takes. §14 carries the
question of which a later journey should cover.

### 2.8 Contracts, pinned

```
stream    signals:item-events    MAXLEN ~ 100_000 (secrets.ts:395)
group     signals-search         DLQ signals:item-events:dlq
envelope  producer omits occurred_at; xadd injects it (publish_item_event.ts:39)
          the CONSUMER requires it (ingest/stream_consumer.ts:13)
embedder  POST {EMBEDDING_BASE_URL}/embeddings   base URL must end in /v1
          request   { model, input: string[] }
          response  { data: [{ embedding: number[] }] }
search    POST /v1/search · /v1/search/flat · /v1/relevance
```

`EMBEDDING_DIM` is **pinned to 1024**, not merely capped: `ITEM_SEARCH_VECTOR_DIM
= 1024` (`db/item_search_repo.ts:5`), the column is `vector(1024)`
(`db/migrations/0001_item_search.sql:10`), and `worker/main.ts:17-22` throws at
boot on any mismatch. The `.max(2000)` in `config.ts:19` never binds.

The `occurred_at` asymmetry matters in exactly one place: the harness plays
producer in the §9 negative controls. An `xadd` that omits `occurred_at` is
dead-lettered as poison rather than processed.

`publishItemEvent` is best-effort — it swallows `xadd` failures and logs a
warning. `create_item.ts` awaits it before responding, so there is no race
between a 200 and the stream entry; but a dropped event leaves the stream
untouched, which the drain awaiter must not read as "drained" (§7).

### 2.9 The two realm exports are not interchangeable

`Signals-DPG/infra/keycloak/render-realm.sh:11-13` states that the signals-dpg
and aggregator-dpg realm exports stay interchangeable. They do not:

| | signals-dpg `bluedots-realm.json` | aggregator-dpg `realm.json` |
|---|---|---|
| realm name | `bluedots` (literal) | `__KEYCLOAK_REALM__` (placeholder) |
| clients | 4 | 8 — strict superset; identical mapper counts on the shared 4 |
| auth flows | 2 | 9; **zero alias overlap** |
| placeholders substituted | 11 | 19 |
| `directAccessGrantsEnabled` | false on all 4 | false on 7 of 8 |

The harness imports **aggregator-dpg's** export: it is the only one carrying
every client a four-service stack needs. Two consequences the numbers hide:

- It must be rendered by **aggregator-dpg's** script. Signals' substitutes
  neither the realm name nor any client secret (§5.2).
- `signals-ui` in the aggregator export sets `"login_theme": "signals"`
  (`realm.json:544`), and that theme exists only under
  `aggregator-dpg/infra/keycloak/themes/`. The harness mounts both repositories'
  theme directories, which the reference composes' bind-mount approach makes
  trivial and an image build would not.

The `signals-api` client secret also differs between exports — signals hardcodes
`signals-api-dev-secret-change-me`, aggregator renders `__SIGNALS_API_SECRET__`
defaulting to `signals-api-local-dev-secret` (`render-realm.sh:38`). Carrying
the wrong literal yields `401 invalid_client`.

## 3. Entry point

One command. CI and a laptop differ only in flags; a suite whose only working
path is the CI path is a suite nobody reproduces.

```
pnpm journey --dot blue_dot --instance ka-dhwd   # a deployed instance
pnpm journey --dot purple_dot                    # a dot with no instances
pnpm journey --dot blue_dot/ka-dhwd,purple_dot   # two targets, two stacks
pnpm journey --images-from-tag 202608-s2-rc1     # what CI runs
pnpm journey --branch feat/x                     # all four services on that branch tag
pnpm journey --branch signals-dpg=feat/x         # one service moved, rest on develop
pnpm journey --journey J2                        # one scenario, all its targets
pnpm journey --list                              # print the matrix, boot nothing
pnpm journey --keep-stack                        # leave containers up to debug
```

### Choosing what to run against

Two things must be chosen before a run: **which images** and **which target**.
A target is a `(dot, instance)` pair — `blue_dot/ka-dhwd`, `purple_dot` — and
it decides which schema the stack is configured with.

When either is omitted on a terminal, the CLI prompts: the release tags or
branches to resolve, then the dot and instance to test, listing what the pinned
`bluedots-schemas` checkout actually offers. In CI both are flags and a missing
one is an error, never a prompt and never a guess.

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

**The harness extends `Signals-DPG/local-setup/docker-compose.yml`; it does not
rewrite it.** That file already carries postgres (pgvector + postgis), redis
with the password signals-dpg requires, stock Keycloak with its providers and
themes mounted, the `keycloak-init` fixup, mailpit, the `signals-bootstrap`
tools one-shot, signals-api, signals-ui, `tei-embeddings`, and signals-search
api + worker — all behind the `keycloak` and `search` profiles, with the env
wiring that makes them agree. Rebuilding that from the parent design's diagram
would reproduce a file that exists, minus the two dozen comments explaining why
each value is what it is.

The harness contributes an overlay: an `-f` layered compose file plus a
generated `.env`. What the overlay changes:

| Change | Why |
|---|---|
| Pin every image to a resolved digest | §3. Reference compose uses floating tags. |
| `SIGNALS_NETWORK` → a network **directory** | Two networks in one stack (below). |
| `AUTH_PROVIDER=keycloak`, `KEYCLOAK_*` split | Keycloak paths are dormant by default (§2.5). |
| `SERVED_DOMAINS` for purple and blue | Default is `blue_dot/seeker,blue_dot/provider`; an unserved domain 4xxs at create (`create_item.ts:204`). |
| `SWEEP_INTERVAL_MS` far past the deadline | Neutralise the backstop (§2.6, §7). |
| `CACHE_TTL_SECONDS=0` | `api/result_cache.ts:16-23` caches empty results for 45s by default. |
| `PEL_MIN_IDLE_MS` lowered | Default 60_000 puts DLQ escalation ~4 min out (§7). |
| `RERANK_DEFAULT=false`, TEI kept | Already the reference default; see the embedder note below. |

### One stack per target, because that is what deploys

An earlier revision put both networks in one stack, using signals-dpg's
`NETWORK_CONFIG_URLS` and a directory mount for signals-search. That code path
is real, but **nothing deploys it**.
`bluedots-automation/helm/signals/values.yaml:185-200`:

```yaml
SERVED_DOMAINS: "purple_dot/seeker,purple_dot/provider"
NETWORK_CONFIG_SOURCE: local
SCHEMA_REGISTRY_URL: ""
```

and `packages/config/src/network_config_loader.ts:29-32` makes `local` strictly
single-config:

```ts
const contents = await readFile(localFile, 'utf8');
baseConfigs = [parseNetworkConfigDocument(JSON.parse(contents))];
```

One network per instance, from one local file. A harness running
`source=remote` with two configs would be the only place in the fleet doing so,
which is testing a configuration that ships nowhere.

So: **one compose project per target**, each configured exactly as a deployed
instance is — `NETWORK_CONFIG_SOURCE=local`, one `network.json`,
`SERVED_DOMAINS` naming only that config's domains. Sequential by default,
parallel behind a flag, because §14.1 has not established that one runner holds
even a single stack with real TEI.

This also removes a rule the earlier revision needed: with a shared consumer
group, two networks ingesting concurrently would each see the other's backlog
and neither could tell drained from busy. Separate stacks, separate Redis,
separate group. The rule and its justification both go away.

### A target is a (dot, instance) pair

The unit is not a network. `bluedots-schemas` nests deployed instances under a
dot, and the instance config is not cosmetic:

| Config | Domains | Differs from dot-level in |
|---|---|---|
| `blue_dot/network.json` | seeker, provider | — |
| `blue_dot/ka-dhwd/network.json` | seeker, provider, **service_provider** | `actions`, `domains`, `instances` |
| `blue_dot/up-gzb/network.json` | seeker, provider, service_provider | identical to ka-dhwd |
| `purple_dot/network.json` | (no instance dirs) | — |

An instance adds a domain and extra actions, so it carries a different
interaction matrix. Running `blue_dot` at dot level would test a config no
deployment uses — the same error as the multi-network stack, one level down.

Resolution is mechanical, from the pinned checkout:

```
<dot>/<instance>/network.json   when an instance is given
<dot>/network.json              otherwise
<dot>/<instance>/consent.json   falling back to <dot>/consent.json
<dot>/<instance>/brand.json     falling back to <dot>/brand.json   (only upsdm has its own)
```

`SERVED_DOMAINS` is **derived** from the resolved config's `domains`, not
written by hand — for `ka-dhwd` that is three bindings, not two. Deriving it is
what keeps adding a target free of test code.

Note that `ka-dhwd` and `up-gzb` have equivalent `network.json`, so choosing
between them exercises brand and consent, not the network contract. Worth
knowing before someone adds both to the matrix expecting different coverage.

The proving run uses two targets: **`purple_dot`** and **`blue_dot/ka-dhwd`**.
Purple is what the runbook covers; ka-dhwd is a real deployed instance with the
larger domain set and 31 vectorize-marked fields against purple's 9.

### The embedder: real TEI, not a stub

The parent design specifies a stub embedder to keep memory down. That was
written before checking the registry:
`ghcr.io/blue-dots-economy/tei-bge-m3:cpu-1.7-bge-m3` **is published**, public,
and has bge-m3 baked in, so nothing downloads a 2.3 GB model at runtime. The
reference compose's own comment argues against substituting anything else:
`model_version` feeds the ingest content hash, so a different model yields local
relevance scores that correspond to nothing deployed.

The harness therefore runs real TEI, which removes a T3 deliverable and makes
the indexed vectors the same ones production computes. Cost: ~3-8 GB and a ~35s
first-load, which §14.1 must weigh against the runner budget. A stub stays the
fallback if the runner cannot hold TEI, and in that case §14.1's answer changes
the design rather than the other way round.

### Images and the digest rule

| Component | Image | Note |
|---|---|---|
| signals-dpg api | `ghcr.io/blue-dots-economy/signals-dpg/api` | published |
| signals-search api + worker | `ghcr.io/blue-dots-economy/signals-search` | **one** image, no `/<service>` suffix; different entrypoint per role |
| TEI embedder | `ghcr.io/blue-dots-economy/tei-bge-m3:cpu-1.7-bge-m3` | published |
| keycloak | `quay.io/keycloak/keycloak:26.5.5` | stock, mounts (§2.3) |
| mailpit, redis | upstream | |
| postgres | built from `local-setup/infra/postgres.Dockerfile` | pgvector + postgis, unpublished |
| **tools/bootstrap** | built from `local-setup/infra/signals-bootstrap.Dockerfile` | unpublished, and unpublishable at a service digest (§2.2) |

Two of these are built from source, so §3's "whatever the input, resolve lands
on a digest" cannot hold for all seven. The rule is narrowed rather than
quietly broken: **the four service images under test always resolve to a
digest**, and the built support images are pinned by the source SHA they were
built from, which the report prints alongside the digests. A support image is
not what a release ships, so this preserves the property that matters — knowing
exactly what was verified — without pretending to a purity the toolchain does
not allow.

### Platform

Both `tei-embeddings` and the signals-search images are **amd64-only**;
signals-search's CI does not set `platforms:`. On Apple Silicon the reference
compose runs them under emulation, which it documents as measured rather than
assumed. `SIGNALS_SEARCH_IMAGE` and `SEARCH_PLATFORM` are the escape hatches for
a native arm64 build. §3's "CI and a laptop differ only in flags" is therefore
not quite true, and §14.5 carries it: a suite that is slow on the machine of the
person debugging it gets run only in CI, and then ignored in CI.

### What J2 boots

Profiles `keycloak` and `search`, which is: postgres, redis, keycloak,
keycloak-init, mailpit, signals-bootstrap, signals-api, tei-embeddings,
signals-search-api, signals-search-worker, plus the harness's schema-server.
signals-ui is not needed — J2 asserts over HTTP. Around eleven containers.

Deferred and defined, for later journeys: aggregator-dpg api/web/worker, MinIO
and its init sidecar, notification-service and its worker, its separate Redis,
and the SMS provider stub.

## 5. Seeding

Phase 3 is what removes the runbook's manual steps. It is also the phase the
parent design underspecified most: it describes minting a Keycloak user and
taking a client-credentials token, and neither works as written (§2.5).

### 5.1 Boot configuration

signals-dpg fails fast on missing env, so the overlay supplies all of it.
Beyond the Keycloak block: `INSTANCE_NAME`, `INSTANCE_ENV`, `API_DOMAIN`,
`AUTH_SECRET` (min 8), `SERVED_DOMAINS` (min 1), `INSTANCE_SHARED_SECRET`
(min 32), `SCHEMA_REGISTRY_URL`, `POSTGRES_USER`/`PASSWORD` (min 8)/`DB`,
`REDIS_PASSWORD`, and `SIGNALS_PII_KEY` as a base64 32-byte key
(`packages/config/src/secrets.ts:5-399`). The reference compose is the working
set; the overlay changes values, not the shape.

Three that are easy to get wrong:

- **`AUTH_PROVIDER=keycloak`.** Default `betterauth` leaves every Keycloak path
  inert (§2.5).
- **`KEYCLOAK_BASE_URL` vs `KEYCLOAK_INTERNAL_BASE_URL`.** The `iss` claim
  derives from the public one (`secrets.ts:84-89`); a browser-vs-container
  mismatch fails every token with a signature that looks fine.
- **`SERVED_DOMAINS` must name purple's and blue's domains.**
  `create_item.ts:204` checks `isServedDomainBinding`, so J2's first step 4xxs
  otherwise. The reference default is blue-only.

Also `RUN_MIGRATIONS=false` for signals-search, and note `envBool` accepts only
`true|false|1|0` (`signals-search/src/config.ts:8-12`) — a `False` fails boot
with a Zod error.

### 5.2 Realm import, then two fixups

Import the aggregator-dpg export (§2.9), pinned by SHA, rendered through
**aggregator-dpg's** `render-realm.sh`, not signals-dpg's. The two are not
interchangeable in the direction the comment claims: signals' script
substitutes 11 placeholders and aggregator's 19, and **signals' script
substitutes neither `__KEYCLOAK_REALM__` nor any client secret**. Rendering the
aggregator export through it imports a realm literally named
`__KEYCLOAK_REALM__` whose eight clients have `__*_SECRET__` for secrets.

Five inputs are fail-hard (`:?`): `KEYCLOAK_REALM`, `PUBLIC_BASE_URL`,
`AGGREGATOR_API_SECRET`, `AGGREGATOR_PORTAL_SECRET`, `AGGREGATOR_BFF_SECRET`.
The harness supplies fixed non-secret test values; the realm is booted fresh per
run and unreachable outside the compose network. Because `KEYCLOAK_REALM` is
itself fail-hard, the realm-name mismatch that §2.9 warns about surfaces as a
boot failure rather than a silent 401 — the script already guards it.

Then, in order:

1. **`apply-user-profile.sh`** (§2.4). Without it `phoneNumber` writes are
   dropped silently and the `signals_acting_orgs` mappers do not exist.
2. **Enable direct grant.** `PUT /admin/realms/{realm}/clients/{id}` setting
   `directAccessGrantsEnabled: true` on the client the harness authenticates
   with, because it is `false` on every usable client in both exports (§2.5).

Step 2 is a realm mutation, and the design should own that plainly: the earlier
claim of "the checked-in realm, unmodified, no test-only code in the product"
is not achievable. What *is* preserved is the property that matters — the
service still runs its genuine authorization check against a real token, and no
test-only branch exists in product code. The mutation is confined to the
harness, logged in the run report, and asserted to be the only one.

### 5.3 Identities

- **Realm role.** `KEYCLOAK_REQUIRED_REALM_ROLES` defaults to
  `signals_participant,signals_admin` (`secrets.ts:121`). Both realms define
  them; the harness assigns one to the minted participant, or every human-path
  call 403s.
- **Service auth.** Rather than fighting `KEYCLOAK_SERVICE_CLIENT_IDS`, the
  harness uses `x-api-key` — which is what signals-search requires anyway
  (§2.5) and what the reference compose assumes for search. If a later journey
  needs client-credentials, it names an integrating DPG client and adds it to
  `KEYCLOAK_SERVICE_CLIENT_IDS`; `signals-api` cannot be that client by design.
- **The API key** comes from `apps/api/scripts/seed_service_users.ts`, run in
  the tools image (§2.2). Two constraints: the script currently randomizes org
  ids and keys, so the harness cannot predict what it provisioned — epic #1's
  P0 makes it accept pinned values, and **T5 depends on that landing first**
  (§13). And it prints the raw key only on first mint, returning `null` on a
  re-run (lines 115-117, 160-166), which is fine while every run is hermetic and
  breaks the day `--keep-stack` reuse or a named volume appears.

### 5.4 Schema and migration gating

`signals-bootstrap` runs `drizzle-kit push --force` then `db:init`, creating
`item_search` among the rest. signals-search's `assertSchemaReady` then passes.
Phase 2's gate is `service_completed_successfully` on that one-shot — a real
signal, not a healthcheck poll, which is what the reference compose already
uses for both search services.

### 5.5 Getting the item to `live`

Nothing in the parent design mentions this, and without it J2 can never pass.

`signals-search/src/db/search_query.ts:62` filters `lifecycle_status = 'live'`.
In `create_item.ts`, a self-create promotes past `draft` only when it carries
consent (`:249` `resolveSelfConsentPromotes`, `:297` `consent_accepted`), and
`tagUserWithDefaultAggregator` (`:278`) must find an owning aggregator org where
the domain declares `owner_required`. The docblock at `:265-280` spells out that
a brand-new signup's first profile is otherwise "classified unowned and lands in
`draft`".

So phase 3 seeds an aggregator organization and `createProfile` carries
consent — or the item sits in `draft`, the drain awaiter correctly reports
drained, and the search assertion fails forever for a reason that looks like an
ingestion bug.

This is worth stating as a general rule, because it is how a journey suite rots:
**a step's precondition is part of the step**. `createProfile({ as: 'seeker' })`
must produce a live, searchable profile or be named something that admits it
does not.

### 5.6 Reusing what already exists

signals-dpg ships `scripts/e2e/` — `generate_fixtures.mts`,
`submit_qr_participants.mts`, `seed_actions.mts`, `purple_dot_providers.csv`,
`purple_dot_qr_payloads.json`, and a README. These are the runbook steps the
parent design calls "already scripted", and they carry deterministic purple_dot
fixture generation.

T7 ports these rather than reinventing them. Note the trap: `seed_actions.mts`
already exists **twice** (`scripts/e2e/` and `apps/api/scripts/e2e/`). Adding a
third copy in this repository is the failure this section exists to prevent.
Where a script is usable as-is, invoke it; where only the data is wanted, move
the data and leave the generator in signals-dpg.

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
  targets:    ['purple_dot', 'blue_dot/ka-dhwd'],

  steps: [
    createProfile({ as: 'seeker' }),      // live, not draft — see §5.5
    waitUntilThisItemIndexed(),
    expectFoundInSearch(),
  ],
});
```

### The awaiter

The parent design's instruction is "poll with a deadline, never sleep". That is
necessary and nowhere near sufficient here, because signals-search has a second
ingestion path. `sweep()` indexes any `items` row missing from `item_search`
every 60s straight from Postgres (§2.6). So an awaiter that waits for *the
index to contain the item* proves the row reached Postgres and nothing more —
the stream could be dead and J2 still goes green.

Worse, the four stream-level conditions an earlier revision specified do not
close it either, because none of them ties **this item** to **that stream
entry**. `worker/process_event.ts:33` returns early — silently acking — when it
cannot find the item row. Stream advanced, lag zero, XPENDING empty, DLQ
unchanged, nothing indexed. The sweep then indexes it within 60s and the
journey passes having verified the opposite of what it claims.

So the awaiter correlates, and the stack is configured to remove the backstop:

1. **`SWEEP_INTERVAL_MS` is set far beyond the journey deadline** (§4), so the
   sweep cannot mask a broken stream inside a run.
2. Capture the **entry id** from `XRANGE` after `createProfile` returns —
   `create_item.ts` awaits the publish before responding, so the entry exists by
   then or never will.
3. Wait until the group's last-delivered id has passed **that** entry, and
   `XPENDING` shows it un-pending.
4. Assert `item_search` carries a row for **that item key** whose `indexed_at`
   moved — the index changed because of this event, not because of a sweep.
5. `XLEN signals:item-events:dlq` unchanged from the baseline.

Condition 2 also catches a dropped publish: `publishItemEvent` swallows `xadd`
failures (§2.8), so with no correlation a lost event is indistinguishable from a
fast one.

### What each condition really catches

The earlier revision credited the wrong condition for poison, which matters
because it is the knob someone will tune.

- **Schema-invalid** messages are parked and acked immediately
  (`worker/main.ts:82-87`), so the DLQ check catches them at once.
- **Processing failures** are left unacked and reach the DLQ only after
  `INGEST_MAX_DELIVERIES` redeliveries (default 5), and redelivery runs through
  `XAUTOCLAIM` gated on `PEL_MIN_IDLE_MS` (default 60_000) — **four minutes
  minimum**. Within any sane deadline it is **`XPENDING`**, not the DLQ, that
  catches these. §4 lowers `PEL_MIN_IDLE_MS` so the escalation path is
  observable at all.

A note on the null-lag guard, which an earlier revision justified wrongly:
`XINFO GROUPS` can report `lag` as null once trimming loses the group position,
but `INGEST_STREAM_MAXLEN` is 100_000 and a hermetic run publishes a handful of
events, so **the state is unreachable here**. The guard stays because it costs
nothing and the constant could change; the claim that this stream is "trimmed by
every publish" was false.

### Deadlines

No deadline is pinned by the parent design, and its sample output shows 30s —
which sits inside neither the 60s sweep regime nor the ~4 min DLQ regime.
Deadlines are derived from the constants they race and named in one place, so
changing `SWEEP_INTERVAL_MS` or `PEL_MIN_IDLE_MS` moves them together.

### Scheduling

Each target gets its own stack (§4), so each has its own Redis and its own
`signals-search` consumer group. Targets are therefore independent, and the
run order is a resource decision rather than a correctness one: sequential by
default so peak container count stays at one stack, parallel behind a flag.

Within a target, scenarios serialize. They share one consumer group, and the
awaiter's baseline is only meaningful if nothing else is publishing.

### Result-set assertions, not rank

`db/search_query.ts:98-101` orders by vector distance with `LIMIT`/`OFFSET`.
Real TEI (§4) gives meaningful ordering, but J2 asserts **set membership** with
`limit` above the fixture count, or filters to isolate the item. A journey that
depends on rank position starts failing as the corpus grows, for reasons
unrelated to the ingest spine it is meant to test.

Waits are concentrated in one module. That is what makes this reviewable: a bare
`sleep` in a diff can be rejected because the alternative already exists and is
named.

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
2. **Negative controls** — five, each pinning one way the suite could go
   vacuously green:
   - the awaiter against a worker whose consumer loop never converges — must
     time out;
   - **the awaiter against a worker with the consumer loop dead and the sweep
     alive** — must fail, not pass on the backstop. This is the control for
     §2.6, and the one the parent design had no reason to think of;
   - the awaiter against a publisher that never publishes — must fail on
     correlation, not report "drained";
   - a processing failure — must be caught by `XPENDING`, and must reach the
     DLQ once `PEL_MIN_IDLE_MS` elapses;
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
│   └── search/                 # J2 (purple_dot, blue_dot)
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

Fourteen tickets, spine before breadth. Each becomes a GitHub issue under epic
`Blue-Dots-Economy/bluedots-e2e#1` once the implementation plan is approved.

The sequence changed after review. T3 shrank — the stack is an overlay on
`local-setup/docker-compose.yml`, not a new compose file — and three tickets
split out of it, because "compose topology" was hiding a tools image, a set of
auth prerequisites, and an empirical runner question.

| # | Ticket | Proves | Depends on |
|---|---|---|---|
| T1 | Repo scaffold: pnpm, vitest, `pnpm journey` CLI, `--list`, `(dot, instance)` resolution and prompting | Entry point works with zero containers; `--list` shows real targets from the pinned checkout | — |
| T2 | Resolve phase: branch/tag → digests, per-service override, source-SHA pinning for built images | Mutable tags are pinned (§4) | T1 |
| T3 | Compose overlay on `local-setup/docker-compose.yml`; one project per target; deadline-shaping env | A stack boots for a given `(dot, instance)` | T2 |
| T4 | Tools image + `signals-bootstrap` gating | `item_search` exists; a real completion signal | T3 |
| T5 | Realm import via aggregator's render script, `apply-user-profile.sh`, direct-grant enablement | Keycloak works at all (§2.5) | T4 |
| T6 | Identities: realm role, aggregator org, API key via `seed_service_users.ts` | J2's caller can authenticate | T5, **epic P0** |
| T7 | Generated clients from the three published `openapi.json`, fetched at the resolved digest | Typecheck as a second contract check | T2 |
| T8 | Step framework: `defineJourney`, labels, lint guards | Scenario six is cheap | T7 |
| T9 | Correlating awaiter (`XRANGE` id → group position → `item_search.indexed_at`) | Ingestion is actually verified (§7) | T8, T4 |
| T10 | Canary scenarios + `harness-selftest` as a per-PR check | The runner reports honestly | T8 |
| T11 | Negative controls, including sweep-alive/consumer-dead | The gate cannot go vacuously green | T9, T4 |
| T12 | J2 on `purple_dot` and `blue_dot/ka-dhwd` | One real journey passes on two targets | T6, T11 |
| T13 | Report renderers: `summary.json` → tiers 1/2/3 + triage bundle | Legible evidence | T9 |
| T14 | CI workflow on RC tag | Bound to the release | T12, T13 |

Four sequencing corrections worth naming, since each was wrong in the previous
revision:

- **T7 depends on T2, not T1.** The three specs live in the service repos at
  some revision. Vendoring them lets them drift — the same argument §4 makes
  against baking schemas — so they are fetched at the resolved digest, which
  means the resolver must exist first.
- **T10 and T11 are separate tickets.** §10 claims `harness-selftest` needs no
  service images and runs in seconds. True of the canaries, false of the drain
  controls, which need Redis and a real worker. Splitting them keeps the
  per-PR check fast and honest.
- **T13 before T12, not after.** The triage bundle exists so "what state was
  it in?" is answerable without a rerun. The first real journey is exactly
  when that matters, so it ships with diagnostics rather than acquiring them
  afterwards.
- **T6 is its own ticket and blocks on epic P0.** The previous T5 bundled realm
  mechanics with identity minting and named neither the API key nor its
  upstream dependency, so J2 was not buildable from its stated dependencies.

The parent design's cost-of-change table is the acceptance criterion for T8 and
T9 together: a second journey from existing steps must cost **no TypeScript**,
and `blue_dot/ka-dhwd` must cost **no test code** — which T12 tests directly by
running two targets. `SERVED_DOMAINS` being derived from the resolved config
rather than hand-written (§4) is the part of that claim most likely to break
first.

## 13. Relationship to epic #1

`Blue-Dots-Economy/bluedots-e2e#1` carries the approved phasing (P0–P5) and says
**start at P1**, the contract lane. This spec deliberately starts elsewhere, and
the deviation is recorded here rather than left for someone to trip over.

| | Epic #1 | This spec | Why |
|---|---|---|---|
| First lane | P1, contract | Journey layer | The repository exists and the journey layer is what it is for. The contract lane is not cancelled — it is unscheduled, and §14.8 keeps that visible. |
| First scenario | P2, onboarding → dashboard | J2, item → event → search hit | J2 exercises the asynchronous spine, which is where flake lives. A flaky suite gets disabled, so that risk is worth retiring first. |
| Networks | purple + blue | purple + blue | Unchanged from the epic. |

Two of the epic's P0 items are prerequisites this spec depends on, and neither
is optional:

1. **notification-service has no `openapi.json`.** Epic P0 adds `spec:dump`, a
   committed spec and a freshness gate. Until then its client is hand-written
   and gets no typecheck-level contract check (§6). J2 does not touch the
   service, so this blocks T10 but not T6.
2. **`seed_service_users.ts` randomizes org ids and keys.** The harness cannot
   predict what it provisioned, so phase 3 cannot use the key it mints (§5).
   Epic P0 makes the script accept pinned values. **T5 depends on that change
   landing in signals-dpg first.** Per the epic, this touches production
   provisioning rather than test scaffolding — the randomized org id is the same
   defect behind the orange_dot approval 503 — so it is not purely additive and
   wants its own review.

## 14. Open questions

1. **Does a standard GitHub runner hold one stack?** A target boots ~11
   containers and real TEI alone wants 3-8 GB (§4). The parent design assumed
   a stub precisely to avoid this. Per-target stacks make this a question about
   one stack rather than the whole matrix, which helps; running targets in
   parallel makes it worse and stays opt-in until this is answered. Settled
   empirically at T3; if the runner cannot hold TEI, the fallback is a stub
   embedder and §4's argument for production-identical vectors loses.
   *(provisional)*
2. **`bluedots-schemas` versus `examples/schemas`.** The two purple_dot configs
   have already drifted (§4). The harness pins `bluedots-schemas`, so the local
   stack no longer matches what signals-dpg's own compose serves. Which is
   authoritative is a question for the service owners, not this suite.
3. **Which search path should a later journey assert?** J2 uses `/v1/search`
   directly, which no end user reaches. The path users take — signals-dpg's
   `discover` BFF — **fails open** to `native_fallback` with signals-search
   absent (§2.7). A journey that asserts `meta.source !== 'native_fallback'`
   would cover the most vacuous-pass-shaped route in the fleet, and nothing
   currently does.
4. **notification-service has no `openapi.json` and publishes no `:develop`
   tag.** Its build workflow triggers on `main` and `feature` only, so §3's
   "local runs default to `:develop`" becomes undeliverable the moment J3
   lands. Epic #1's P0 covers the spec; the tag is unaddressed.
5. **Apple Silicon.** signals-search and TEI are amd64-only, so local runs use
   emulation (§4). `SIGNALS_SEARCH_IMAGE` + `SEARCH_PLATFORM` allow a native
   build, but nothing produces one in CI. A suite that is slow for whoever is
   debugging it gets run only in CI, then ignored there.
6. **What do `consent.json` and `brand.json` do to a journey?** The harness
   resolves both per target (§4), but J2 asserts on neither. Consent is
   load-bearing — §5.5 needs it for the item to reach `live` — so the consent
   document a target ships is already in the blast radius even though no
   assertion reads it. `ka-dhwd` and `up-gzb` differ *only* in brand and
   consent, so a journey that covers them is the one that would justify running
   both.
7. **Should signals-dpg's integration suites leave the `sonar` job?** They run
   under `continue-on-error` today, so regressions are advisory. Cheap and
   adjacent, but a separate decision with its own CI-time cost.
8. **When does the contract layer land?** A few days' work across the four
   service repositories, retiring a recurring production failure class
   (signals-dpg #103, #104, #112, #115, #122, tracked in #124; aggregator-dpg
   #399). Epic #1 recommends it first and this spec starts elsewhere (§13), so
   it is now unscheduled rather than merely later.
