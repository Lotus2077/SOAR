# PR6B0 Hybrid Simulation Vertical Slice v1

Status: **Proposed; not Approved; no runtime work is authorized by this
document**

- Plan ID: `pr6b0-hybrid-simulation-v1-plan-1`
- Parent plan: `hybrid-lease-router-v0-plan-2`
- Predecessor: `pr6a-cloud-setup-dispatch-lock-v1-plan-1`
- Baseline revision: `90531899bc16b3862616a709ac8396257ebdd46c`
- Proposed: 2026-08-31
- Approval: not granted
- Project log: [BUILD_LOG.md](../BUILD_LOG.md)

## Decision

The former PR6B combined too many independently risky changes: credential
resolution, provider validation, production-shaped hybrid review, repository
egress, paid inference, fallback, accounting, and a live canary. Implementing
and proving those in one change would repeat the integration and attribution
problems that made PR5 difficult to close.

The revised delivery sequence is:

1. **PR6B0 — Hybrid Simulation Vertical Slice**: connect the strict
   change-review pipeline to the existing checkpoint router, egress policy,
   budget ledger, cloud attempt, Local fallback, replay, cancellation, and app
   UX using only explicitly branded fake providers. Normal production remains
   Local-only and Hybrid-locked. Cost and provider exposure are `$0`.
2. **PR6B1 — Signed Native Credential Lease**: separately plan Developer ID
   signing, hardened runtime and library validation, a native main-process-only
   credential lease, synthetic read/zeroization limits, hostile-client denial,
   upgrade identity continuity, and optional user re-entry. It makes no
   provider request.
3. **PR6B2 — Provider Validation**: after the signed identity gate, separately
   authorize bounded real credential resolution and provider/key/model/pricing/
   limit validation. It performs no inference and sends no repository content.
4. **PR6B3 — One Paid Public-fixture Canary**: after another exact-authority
   approval, run one tool-free cloud synthesis attempt against a frozen public
   fixture with a maximum provider reservation of `$0.25`, no retry or model
   substitution, and at most one predefined Local fallback.

This sequence advances the original routing goal without placing a real
credential under the current ad-hoc package identity. It also separates
provider-fact failures from paid-attempt failures.

## Rejected next-step alternative

The first planning draft proposed native credential re-entry before the fake
Hybrid slice. Independent security, runtime, and UX review rejected real
re-entry under the current package because:

- ad-hoc signing cannot prove an upgrade-stable designated requirement, so a
  later build could lose update/delete/read authority over the newly stored
  item;
- synchronous Security.framework item calls have no cancellation API, so a
  caller-side timeout cannot truthfully prove that a mutation did not complete
  later; and
- creating another stored credential provides no immediate product capability
  while Hybrid remains locked.

That negative result is retained here. PR6B0 does not compile a native addon,
touch either Keychain item, or invite credential re-entry. PR6B1 must solve the
signing identity, async/late-completion model, test-only namespace, exact
packaged-app proof, and inaccessible-item recovery before real re-entry is
considered.

## User and contributor promise

In an explicitly enabled fake development/test configuration, the app offers
**Hybrid simulation** beside Local. Local remains selected by default. The
simulation disclosure states that:

- no content leaves the machine and no external provider is contacted;
- one fake cloud synthesis attempt may be simulated;
- task instructions, bounded repository excerpts, and relative paths are the
  classes that a future real Hybrid request would send;
- tools and tool definitions are excluded; the bounded guard denies the
  canonical workspace/user-home roots, explicitly supplied sensitive values,
  recognized token/private-key forms, denied paths/artifacts, and semantic
  provenance gaps that it knows how to detect;
- that guard is bounded policy defense, not general data-loss prevention and
  not a promise to recognize every credential or absolute-path representation;
- `$0.25` is a simulated maximum reservation, not an actual charge; and
- denial or one eligible fake-cloud failure continues with one Local synthesis
  fallback, while cancellation creates no fallback.

The user must select Hybrid simulation and check an initially unchecked consent
box before starting. The checkbox acknowledges only
`simulation_cloud_synthesis_v1`; real egress consent remains `none`. The
simulation identity can never satisfy `hybrid_v0`, a production provider
factory, or an external-request admission gate.

Main issues a bounded, single-use `HybridSimulationConsentChallengeV1` that
binds the canonical workspace identity, exact disclosure version and text hash,
route, `$0.25` cap, simulation authority, fake provider identities, and expiry.
The renderer displays the challenge-bound disclosure and returns only its
opaque challenge ID plus acknowledgement. Session creation atomically consumes
and verifies the challenge; stale, reused, expired, mismatched, or unknown
challenges create no session or budget work. Changing workspace, route,
disclosure, cap, or simulation authority invalidates the challenge and clears
the checkbox.

Simulation availability is independent of Cloud Settings and never reads the
stored credential. In simulation mode the existing **Set up cloud** action is
not presented as a prerequisite; the route states: **Simulation is independent
of Cloud Settings and never reads your stored credential.**

During and after the run, the app shows a truthful sequence:

`Local inspection -> Routing check -> Fake cloud synthesis -> optional Local fallback`

Each visible phase distinguishes provider/model, admission or failure reason,
status, latency, simulated reservation, simulated settled amount, and actual
external spend (`$0`). Restart/replay reconstructs the sequence without
dispatching again.

The active/completed review header, every result and finding projection,
session-history row, run details, notification, copied Markdown, and replayed
result retain the exact marker **Simulation only — fake models; no external
provider contacted; not a real review.** Both provider labels include **Fake**,
and every synthetic amount is labeled **Simulated**. A projection that loses
this attribution fails closed. Copied content is stamped; no surface may say
only “Cloud completed” or render `$0.25` as ordinary provider cost.

Normal vLLM mode continues to show Hybrid as unavailable. No production user
can enable the simulation with renderer input, a stored credential, or a route
toggle.

## Approval boundary

Approval must use the exact plan ID and authorizes only:

- an app-visible Hybrid simulation behind a main-process fake-only authority;
- one deterministic fake Local provider and one deterministic fake cloud
  structured-review provider in the simulation catalog;
- a dedicated production-shaped change-review coordinator that accepts only
  the fake-only runtime for PR6B0;
- host-owned simulation session creation, single-use consent challenge, fixed
  cap, policy, provider identities, and synthetic budget campaign;
- strict persisted simulation identity so fake cost cannot be reported as real
  provider spend;
- local evidence acquisition, risk extraction, exact review packet compilation,
  semantic message/provenance identity, immediate pre-invocation PR6A egress
  admission, checkpoint routing, atomic simulated reservation/settlement,
  tool-free fake cloud synthesis, strict `ReviewResultV1` acceptance, snapshot
  revalidation, one Local fallback, cancellation, recovery, and replay;
- route/cost/fallback/cancellation UX and accessibility work limited to the
  simulation and existing Local review surfaces;
- deterministic fixtures, injected failure seams, Electron E2E, packaging, and
  exact-SHA CI proof;
- removal of the manually invoked CLI credential-reader/provider-check script
  and package command; and
- current-truth documentation and append-only build-log entries.

Approval does **not** authorize:

- reading, writing, replacing, deleting, migrating, validating, or displaying
  any real or synthetic Keychain credential;
- a native addon, helper, XPC service, credential resolver, lease, or callback;
- a CLI `find-generic-password -w` executable path;
- constructing an OpenAI-compatible cloud transport, retaining a cloud API
  key, or making provider key/model/price/limit/health/account/inference calls;
- sending repository, task, artifact, path, tool, session, or evaluator content
  to any external cloud provider;
- enabling Hybrid in normal vLLM production mode;
- a real cloud campaign, real monetary reservation, real settlement, provider
  retry, model substitution, or paid canary; or
- claiming production Hybrid readiness, wire-byte identity, credential safety,
  provider availability, model capability, current price/limit truth, routing
  quality, cost saving, latency improvement, or release readiness.

PR6B0 setup and proof must cause zero requests to the separately configured
cloud candidate and `$0` selected metered-provider exposure. Existing Local
tasks may still contact the operator-configured vLLM route; that remains the
documented Local trust boundary and is not new PR6B0 authority. Deterministic
PR6B0 proof uses fake mode and must not contact that configured route either.

## Architecture decisions

### 1. A dedicated strict review coordinator

Do not make `run-session-v2.ts` production-capable by removing its fake brand.
That coordinator produces generic agent text and is mechanics evidence; it does
not own the strict `ReviewResultV1` compilation, grounding, acceptance, and
freshness invariants of the real review path.

Add a dedicated hybrid change-review coordinator that shares audited acquisition
and acceptance primitives with `run-local-change-review.ts`. The required
sequence is:

```text
host change acquisition
-> verified ReviewEvidenceV1 and coverage
-> deterministic risk extraction
-> exact ReviewResultV1 message compilation
-> host provenance manifest
-> immediate semantic egress admission
-> checkpoint route resolution
-> atomic simulated reservation and attempt-start
-> fake cloud invocation with tools disabled
-> atomic simulated settlement
-> host schema and semantic acceptance
-> post-response workspace revalidation
-> accepted completion or one eligible Local structured fallback
```

Refactoring may extract common functions, but the existing Local-only session's
events, route, acceptance, cancellation, freshness, and renderer behavior must
remain byte/semantically compatible. The simulation may not call the generic
tool-capable fake v2 runner for final acceptance.

### 2. Fake-only authority is structural

Introduce a nominal `HybridSimulationRuntimeV1` that requires a module-private
fake-only brand, exactly two allow-listed fake registrations, a fixed fake
campaign, synthetic pricing/health/credential facts, and a fixed disclosure
version. Only main-process bootstrap can construct it, and only when both are
true:

1. provider mode is `fake`; and
2. the explicit development/test simulation flag is enabled.

Normal vLLM mode rejects the flag at configuration validation. Renderer input,
stored setup state, environment-supplied provider/model IDs, and IPC payloads
cannot construct or widen the authority.

The fake cloud provider implements only no-tools structured change-review
completion, reports deterministic usage/model identity, and has no network
client. It cannot accept general prompts, tools, endpoint configuration, API
keys, or provider substitution. The simulation registry contains exactly the
fake Local and fake cloud registrations; the normal production registry still
contains exactly one Local registration.

### 3. Persist simulation identity and host-owned consent

Add strict persisted `hybrid_simulation_v1` execution-policy and
`simulation_cloud_synthesis_v1` consent identities. Real egress consent remains
`none`. Schema, router, replay, projection, recovery, and provider-construction
invariants must reject using either simulation identity for `hybrid_v0`, real
cloud consent, or an external provider.

Add an immutable `simulation | actual | legacy_unclassified` cost scope to every
campaign, reservation, routing decision, inference attempt/cost, terminal
settlement/release/overrun row, recovery adjustment, and corresponding event
identity. New runtime rows may use only `simulation` or `actual`; migration
assigns pre-PR6B0 rows `legacy_unclassified` rather than silently claiming real
spend. Database constraints reject missing or cross-scope links;
reconciliation requires the session, campaign, reservation, terminal row, and
event scopes to match. Actual-spend aggregations select only `actual`, while a
separate simulation projection returns explicitly labeled amounts. Migration
and replay fixtures prove legacy rows remain separately classified and excluded
from both new actual-spend and simulation totals, while reporting their
presence as **Unclassified historical exposure**. Any nonempty
`legacy_unclassified` campaign, reservation, terminal, or recovery state blocks
all future `actual` admission until a separately approved audit explicitly
classifies it; exclusion from a total never implies zero exposure. Inferring
scope from provider names or session policy is prohibited.

Before route selection, main issues the single-use consent challenge described
in the user promise. The renderer submits only the approved workspace, route
intent `local | hybrid_simulation`, challenge ID, and acknowledgement. Main
atomically consumes the challenge and owns/persists its exact disclosure
version/hash, simulation authority ID, fake candidate/model, `$0.25` cap,
simulation-consent identity, real egress consent `none`, risk/router policies,
health/pricing identities, attempt limits, deadline, and cost scope. Unknown,
replayed, expired, or mismatched challenges and forged provider/model/campaign/
cap/price/endpoint/real-consent/generic-Hybrid input fail before session,
ledger, provider, or workspace work.

### 4. Egress admission is real policy over fake dispatch

Build the exact semantic provider messages and host provenance manifest from
the accepted change evidence. Evaluate the PR6A egress policy immediately
before fake cloud invocation and assert that the admitted message/provenance
hashes are unchanged at the provider boundary.

Persist one strict `CloudEgressAdmissionRecordV1` for both pass and denial. It
contains only policy version, decision, sorted bounded reason codes, canonical
message hash, provenance-manifest hash, checkpoint ID, simulation authority ID,
and timestamp. It contains no message body, match, path, root, secret, or raw
diagnostic. The record is canonically paired with the routing decision; the
decision and any attempt/reservation reference its identity. Replay requires
exactly one valid admission record at the simulation evidence checkpoint and
re-derives the zero-reservation/zero-invocation consequence of denial.

For a passing fake-cloud attempt, the record's message hash must equal
`context.compiled.messagesSha256`, the routing input hash, and the semantic
provider-boundary hash. A crash, duplicate, missing/mismatched record, or hash
drift fails closed without a new invocation. Denial has no provider-boundary
hash claim because no invocation occurs.

Denied consent, incomplete provenance, roots, home paths, recognized secrets,
denied paths/artifacts, tool definitions, or semantic drift causes zero fake
cloud attempts and zero simulated reservation. The coordinator records bounded
reason codes and continues with Local synthesis when eligible.

This proves semantic request identity inside SOAR, not exact future HTTP bytes.
PR6B2 must establish freshly verified provider limits; PR6B3 must separately
bind admission to the real adapter's serialized inference request.

### 5. Simulated accounting uses real invariants

The fake cloud descriptor and immutable pricing snapshot produce a nonzero
simulated worst-case reservation capped at `250_000` micro-USD. The existing
budget ledger and attempt unit of work own atomic start, settlement, release,
unknown dispatch, overrun, cancellation, and recovery behavior.

Rules remain:

- missing consent, capability, credential fact, health, pricing, egress,
  deadline, or budget means no fake cloud invocation;
- one fake cloud attempt maximum;
- definitely not sent releases the simulated reservation and may create one
  Local fallback;
- sent or unknown without trustworthy usage settles conservatively;
- schema/model/usage/protocol failure or timeout settles once and permits at
  most one Local fallback;
- cancellation settles conservatively and creates no fallback;
- an overrun is recorded in full and disables the simulated campaign;
- a crash after committed attempt start is recovered as unknown/interrupted and
  is never dispatched again; and
- workspace drift after a response charges only the simulated attempt and
  rejects the stale review.

Every route, attempt, budget, usage, fallback, cancellation, and terminal event
must remain append-only and replay-valid.

### 6. App UX is a simulation, not a readiness claim

In simulation mode, the Review Current Changes setup offers native labeled
Local and Hybrid simulation radios. Selecting simulation reveals one inline
challenge-bound disclosure and an unchecked consent checkbox. The Start action
remains disabled until the current challenge is acknowledged. Local remains
available without Settings or consent. Stored, missing, and local-error
Keychain states cannot alter simulation availability, challenge terms, or copy;
the route repeats that it never reads the stored credential.

The review surface shows an ordered phase timeline with textual status,
provider/model, plain-language reason, latency, and cost provenance. It must
distinguish:

- maximum simulated cap;
- simulated reserved amount;
- simulated provider-reported or conservative settled amount; and
- actual external provider spend (`$0`).

The exact marker **Simulation only — fake models; no external provider
contacted; not a real review.** appears on the active/completed header, every
result/finding projection, history row, run details, notification, copied
Markdown, and replayed result. Both phase-provider labels include **Fake**.
Every synthetic amount includes **Simulated** in accessible text. Missing
attribution withholds ordinary result projection and copy.

Stop remains immediate. Cancellation before invocation shows zero fake cloud
attempts. Cancellation after invocation explains that no fallback was started;
because the provider is fake, actual external spend remains `$0`.

Use native radios and checkbox, textual live-region announcements, phase status
plus `aria-current="step"`, deterministic focus restoration, at least 32-pixel
action targets, and reduced-motion-safe transitions. Automated Electron checks
cover keyboard and focus behavior; a separate manual record covers VoiceOver,
keyboard-only traversal, 200% zoom without clipping, light/dark contrast, and
reduced motion. A failed manual check is retained and blocks a `Verified` UX
claim.

## Expected implementation surface

Expected new files:

- `src/main/agent/run-hybrid-change-review.ts`;
- `src/main/providers/fake-cloud-review-provider.ts`;
- `src/main/hybrid-simulation-runtime.ts` or an equivalent branded authority;
- strict shared simulation/challenge/creation/projection contracts; and
- focused coordinator, provider, IPC, renderer, recovery, and Electron tests.

Expected changed files:

- session execution-policy/events/reducer/replay contracts and fixtures;
- `src/main/agent/run-local-change-review.ts` only as needed to extract audited
  shared primitives without changing Local behavior;
- `src/main/providers/runtime-catalog.ts`, `src/main/agent/run-session.ts`,
  `src/main/local-change-review-session.ts`, `src/main/index.ts`, and
  `src/main/ipc.ts`;
- budget schema/migration, ledger/UOW, routing/attempt events, recovery,
  reconciliation, aggregation, and projection code so immutable simulation and
  legacy-unclassified rows never appear as actual spend;
- preload and renderer review contracts, `App.tsx`, styles, and accessibility
  tests;
- fake-mode Electron test configuration and fixtures;
- `.github/workflows/ci.yml` if a new explicit proof command is needed;
- architecture, readiness, routing, contributor, and build-log documentation;
  and
- tests and fixtures affected by the additive persisted contract.

Expected removal:

- `scripts/check-openrouter-key.mjs`; and
- the `check:cloud-key` package command.

The historical build log and plans retain their references to the removed CLI
form. Mechanical no-reader scans apply only to executable source, scripts,
package commands, generated production bundles, and imports—not immutable
historical documentation.

File names may change during implementation if the same persisted and authority
boundaries remain easier to audit. A change to the user promise, fake-only
brand, persisted cost scope, credential/provider/network boundary, or monetary
authority requires a superseding proposal and approval before implementation
continues.

## Pre-commit implementation evidence

PR6B0 may advance to `Implemented` only when the approved working tree passes:

- strict schema, reducer, replay, migration, and malformed-history tests for
  simulation identity, challenge consumption, and row-level cost scope,
  including fail-closed `legacy_unclassified` behavior;
- deterministic admitted, denied, timeout, failure, cancellation, stale
  workspace, crash recovery, unknown usage, overrun, and one-fallback cases;
- exact message/provenance identity and no-tools fake invocation;
- persisted pass/deny egress-admission records, canonical routing pairing,
  denial replay, and missing/duplicate/mismatched record rejection;
- every admission denial with zero fake-cloud invocation and zero simulated
  reservation;
- concurrent reservation and exact-cap boundaries;
- nonempty legacy-unclassified ledger history visibly blocks every future
  actual-scope admission and is never treated as zero exposure;
- forged IPC/config/provider inputs with zero session/ledger/provider work;
- stale, replayed, expired, workspace-mismatched, disclosure-mismatched,
  cap-mismatched, and authority-mismatched consent challenges with zero
  session/ledger/provider work;
- source/construction proof that normal production creates one Local provider,
  no cloud transport, no Hybrid authority, and no executable CLI secret reader;
- renderer tests for Local default, challenge-bound disclosure and invalidation,
  structural separation from real egress consent, Cloud Settings independence
  across stored/missing/error states, unavoidable simulation attribution,
  stamped copy, simulated-versus-actual cost, route phases, cancellation,
  restart, focus, announcements, and disabled normal-production Hybrid;
- fake-mode Electron E2E for admitted success, egress denial with Local
  continuation, cloud failure with one Local fallback, cancellation, and
  restart/replay without redispatch;
- unchanged Local Repository Investigator and Review Current Changes regression
  behavior;
- readiness, append-only ledger validation, typecheck, full tests, Electron
  bundles, Electron E2E, package verification, and `git diff --check`; and
- a separate manual UX record for VoiceOver, keyboard, 200% zoom, contrast, and
  reduced motion.

Every synthetic sentinel, raw packet, repository root, endpoint, and simulated
secret stays out of renderer-safe projections, SQLite values not explicitly
approved by existing evidence contracts, logs, errors, screenshots, and
tracked artifacts.

## Post-commit verification evidence

PR6B0 may advance from `Implemented` to `Verified` only after:

- clean `pnpm check:release-head` on the exact implementation SHA;
- exact-SHA Electron E2E and package verification;
- both exact-SHA Linux/check and macOS Electron GitHub Actions jobs pass;
- independent runtime, security, and UX review finds no open P0/P1 defect; and
- a status-only closure records every retry, timeout, flake, failed proof, manual
  gap, and non-claim without changing runtime behavior.

`Verified` is not `Released` and does not authorize a later milestone.

## Honest closure claims

A successful PR6B0 proves only that the app can simulate the complete
checkpoint-routed Hybrid review control flow with deterministic fake providers,
replayable events, semantic egress admission, simulated accounting, strict
review acceptance, one fallback, and truthful UX while normal production stays
locked.

It does not prove real credential safety, real provider validation, HTTP wire
identity, actual model capability, price/limit truth, paid-attempt accounting,
review quality improvement, cost saving, latency improvement, hostile-process
resistance, Developer ID/notarization, or release readiness.

## Approval and next gate

Before implementation, this proposed plan and its `Proposed` build-log entry
must be validated, committed, pushed, and pass exact-SHA Linux and macOS CI.
The project owner must then explicitly reply:

> Approve `pr6b0-hybrid-simulation-v1-plan-1` for local `$0` implementation
> only.

That approval must be appended to the build log, committed, pushed, and pass
its own exact-SHA Linux and macOS CI checkpoint before implementation begins.
Approval of PR6B0 does not approve PR6B1, PR6B2, PR6B3, any credential read or
Keychain mutation, provider contact, repository egress, or paid call.
