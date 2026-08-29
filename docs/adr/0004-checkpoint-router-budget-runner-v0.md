# ADR 0004: Checkpoint Router, Budget Ledger, and Fake-Provider Runner v0

- Status: Accepted for PR 4; production enablement is deferred
- Date: 2026-08-29
- Plan: `hybrid-lease-router-v0-plan-2`
- Scope: deterministic route selection, atomic paid-attempt accounting, and a
  test-only two-provider v2 coordinator

## Context

PR 1 established the additive v2 event grammar, PR 2 established provider
descriptors and registry admission, and PR 3 froze immutable change/risk input.
None of those foundations selected a provider at runtime or made the dormant
budget tables authoritative. The shipping Electron path still created v1
local-only sessions.

PR 4 must prove the mechanics without creating a production cloud provider,
loading a real credential, or making a paid request. It must also preserve the
existing v1 app path while contributors can exercise local-to-cloud routing
with deterministic test providers.

## Decision

### Route only at persisted checkpoints

`checkpoint-router-v0` is a pure, synchronous, deterministic two-stage
function:

1. proposal chooses the intended provider, phase, lease action, required
   capabilities, and tool mode from versioned policy, replayed state, and
   `review-risk-v1`;
2. resolution applies explicit health, pricing, credential, egress, deadline,
   packet, and locked-budget facts and returns either a persisted decision plus
   attempt specification or a terminal denial.

The router reads no clock, environment, registry, database, workspace, random
source, or network. IDs, `asOf`, deadline, provider facts, risk facts, and
admission observations are caller inputs. It runs only at `session_start`,
`evidence_complete`, and `provider_failure`; productive tool-result rounds keep
their existing lease and do not invoke the router.

`session_start` assigns a tool-enabled local investigation lease.
`evidence_complete` is legal only after at least one successful local
investigation attempt and completed successful evidence. Low or incomplete
risk retains local synthesis. High risk under `hybrid_v0` may propose one
tool-free cloud synthesis. A failed admitted-cloud attempt may assign one local
fallback only for provider, protocol, or timeout failure and only when one full
persisted attempt-timeout window remains. Cancellation, interruption, success,
a local failure, or a second failure never creates another fallback.

Every current-write routing decision embeds a bounded
`checkpoint-router-input-v0` snapshot. It contains canonical provider
descriptors, exact target, required capabilities, deadline arithmetic, and the
health/pricing observations reached by that decision. It excludes endpoints,
credential values, workspace roots, messages, and source content. Schema and
replay checks bind selected/proposed locality and accounting, target
provider/model, snapshot IDs, pricing rates, packet hashes, evidence facts, and
the resulting admission state. Older PR 1 v2 events remain readable without
the additive snapshot; PR 4 units of work refuse to create a new decision
without it.

### Reserve pessimistically with integer accounting

The budget ledger is append-only and uses integer micro-USD with `BigInt`
intermediates. `ceil_each_component_v1` rounds input, maximum output, cache,
and provider-fee components separately. The input allowance includes the exact
provider-specific serialized-request reserve once. `no_cache_credit` assumes
zero cached input at admission and therefore requires the cache-read rate not
to exceed the ordinary input rate.

Admission holds one SQLite `BEGIN IMMEDIATE` across the locked balance check,
reservation row, and canonical decision/route/message/context/attempt-start
event batch. Provider dispatch authority exists only after commit. Exact-cap
admission succeeds and one micro-USD beyond an episode cap, campaign automatic
stop, or campaign hard ceiling is denied. A prior recorded campaign overrun
also denies a new reservation even if the numeric balance would otherwise
cover it.

Finish settlement and the canonical attempt-finish/terminal event batch share
the same transaction. A definitely unsent request releases its reservation.
A sent or unknown request without trustworthy cost consumes the full
reservation. Trustworthy provider cost is rounded upward to micro-USD; otherwise
host pricing uses the immutable rates locked by the admitted decision. Cached
input is not also charged as ordinary input, and output billing includes
reported reasoning tokens. A trustworthy amount above the reservation is
recorded in full as `budget_overrun`, fails the session ahead of cancellation,
and permanently disables later campaign admission.

Startup recovery pages until every running session is closed. An open reserved
attempt becomes `interrupted` with unknown request disposition and consumes its
full reservation exactly once. A ledger/event reconciliation gate runs after
recovery and inside the admission transaction before a new reservation. It
fails closed on orphan, duplicate, mismatched, prematurely terminal, or
unsettled ledger/event identities.

SQLite callbacks are strictly synchronous. Transaction handles carry their own
lifetime and cannot be reused after their callback, including during a later
transaction on the same connection.

### Preserve v1 production behavior

`SessionRunner` receives a `ProviderRegistry`, while the v2 coordinator remains
separate from the v1 loop. The v2 coordinator binds one admitted provider
registration before compiling a request, uses that registration's exact input
reserve, persists the resulting packet/message hashes and requested output
limit, and dispatches that same provider and packet.

PR 4 production bootstrap still constructs one local provider, renderer IPC
still creates v1 local-only sessions, and the v2 path requires an explicit
fake-only runtime. Cloud credentials, Keychain, OpenRouter, and production
Hybrid are absent. A fake cloud result is test evidence only and can never be
shown as a user review.

## Consequences

- Routing and accounting decisions can be replayed from bounded persisted
  facts without re-querying mutable provider state.
- Concurrent sessions cannot oversubscribe through the supported unit of work,
  and reconciliation detects low-level ledger/event divergence before dispatch.
- The operational path now proves lease retention, one fake paid attempt,
  denials, timeout, cancellation, recovery, overrun, and one local fallback at
  zero paid cost.
- Provider quality, cost savings, latency improvement, egress safety against
  real content, and production cloud readiness remain unproven.
- PR 5 must add the strict `ReviewResultV1` contract and local Review Current
  Changes app workflow. PR 6 remains the separately approved gate for egress,
  Keychain, and any paid canary.

## Rejected alternatives

- **Run the full router after every tool result.** This creates route churn and
  makes routine agent-loop progress depend on mutable admission state.
- **Pre-plan every provider round.** Evidence, failure, cancellation, and
  remaining budget are only known at runtime checkpoints.
- **Let an LLM choose the provider.** Provider choice must be deterministic,
  bounded, explainable, and enforce budget/egress policy independently of model
  output.
- **Reserve expected cost or floating-point USD.** Expected cost does not bound
  exposure, and binary floating point cannot be the persisted accounting unit.
- **Compile again after admission.** A second packet could differ from the one
  priced, consented, hashed, and reserved.
- **Enable real cloud in PR 4.** Mechanical tests do not establish credential,
  egress, provider-limit, or product-quality readiness.

## Verification contract

PR 4 is verified only when deterministic tests prove identical-input routing,
evidence and boundary rejection, exact packet/provider binding, zero tool
exposure to fake cloud, exact-cap and concurrent-budget behavior, every
settlement provenance, crash rollback, paged recovery, ledger/event
reconciliation, timeout/cancellation/overrun precedence, at most one paid
attempt, and at most one local fallback. The full offline suite, typecheck,
production build, and Electron regression must also pass without a real
provider call.
