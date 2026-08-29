# ADR 0002: Agentic Execution v2 Event and Replay State Machine

- Status: Accepted for Hybrid Lease Router v0; implementation is part of PR 1
- Date: 2026-08-29
- Plan: `hybrid-lease-router-v0-plan-2`
- Scope: persisted session-event grammar and deterministic replay

## Context

Agentic Execution v1 records a local route, assistant messages, context
checkpoints, tool calls, and aggregate usage. It does not identify every
provider attempt or prove that failures, cancellations, timeouts, and crashes
were accounted for exactly once. Reinterpreting those events would make old
sessions ambiguous.

Hybrid routing therefore uses an additive v2 policy and new events. The event
parser keeps the new cross-links optional on pre-existing event types so stored
v1 history remains readable. The reducer requires every link for a v2 session
and rejects missing, duplicate, reordered, or mismatched records.

This ADR is normative for the PR 1 event/replay implementation. Database
migrations and the operational budget ledger have their own migration
contract. Provider construction, runtime routing, paid calls, and the Review
Current Changes result schema are outside this ADR.

## Decision

### Policy identity

`AgenticExecutionPolicySchema` is discriminated by `schemaVersion`.
`agentic-execution-v1` is unchanged. `agentic-execution-v2` is the following
strict object; unknown keys fail parsing:

```ts
interface AgenticExecutionPolicyV2 {
  schemaVersion: "agentic-execution-v2";
  inferenceRounds: number; // integer 1..32
  toolCalls: number; // integer 1..32
  routingPolicy: "local_only_v1" | "hybrid_v0";
  maxProviderChanges: 2;
  maxPaidAttempts: 1;
  maxPaidEpisodeMicrousd: number; // safe non-negative integer
  maxEpisodeDurationMs: number; // safe positive integer
  attemptTimeoutMs: number; // positive and <= episode duration
  egressConsent: "none" | "session_cloud_synthesis_v1";
}
```

`local_only_v1` requires `egressConsent: "none"`. The v2 `session.started`
payload requires canonical ISO `startedAt` and `deadlineAt`. `startedAt` equals
the stored event timestamp and `deadlineAt` equals `startedAt +
maxEpisodeDurationMs`. An attempt cannot start at or after that deadline.

### Routing decision event

`routing.decision.recorded` has a strict
`RoutingDecisionPayloadSchema`. Its required fields are:

- `decisionId`, `policyVersion: "hybrid-lease-router-v0"`, `boundary`,
  `phase`, `action`, and `reasonCode`;
- sorted unique `candidateProviderIds`, `selectedProviderId`, `selectedModel`,
  and `selectedLeaseId`;
- `riskSignals` and `triggerFacts`, both bounded and canonically sorted;
- the six strict admission checks: capability, credential, health, egress,
  deadline, and budget.

The boundaries are `session_start`, `evidence_complete`, and
`provider_failure`. `session_start` is the only investigation-phase boundary;
the other two are synthesis boundaries. Actions are `assign_new_lease` and
`retain_lease`. A retained decision requires equal `priorLeaseId` and
`selectedLeaseId`; a new assignment cannot reuse the prior lease.

The reason-code set is:

```text
local_policy, local_investigation, low_risk_local_review, cloud_admitted,
disabled_provider, missing_credential, unhealthy_provider,
capability_mismatch, egress_denial, budget_denial, deadline_denial,
cloud_failure, local_fallback
```

Each admission check is one of `passed`, `denied`, or `not_applicable`, with a
category-specific reason. For example, capability accepts only
`capability_ok`, `capability_mismatch`, or `not_applicable`. The mapped decision
reasons `missing_credential`, `unhealthy_provider`, `capability_mismatch`,
`egress_denial`, `budget_denial`, and `deadline_denial` require their
corresponding denied admission check. `disabled_provider` has no separate
admission category, so it has no synthetic denied check; provider identity and
the remaining not-applicable/completed checks are persisted directly.

Risk data is legal only at `evidence_complete` and is absent at the other two
boundaries. When `riskPolicyId` is present, exactly one of `riskScore` or
`riskIncompleteReason` is present. For a scored decision, `riskScore` equals
the sum of the canonical signal contributions.

The following fields are optional for decisions where they do not apply and
strictly typed when present:

- `priorLeaseId`, `riskPolicyId`, `riskScore`, and `riskIncompleteReason`;
- `proposedProviderId` and `proposedModel` for a rejected cloud candidate;
- `healthSnapshotId`, `pricingSnapshotId`, `campaignId`,
  `budgetReservationId`, and `credentialMetadataId`;
- a billing projection containing token estimates, integer micro-USD rates,
  an explicit cache-read-token estimate, provider fee ceiling,
  `ceil_each_component_v1`, projected cost, and remaining episode/campaign
  amounts;
- `checkpointId`, `packetSha256`, and `messagesSha256` for the admitted,
  selected cloud attempt;
- `proposalCheckpointId`, `proposalPacketSha256`, and
  `proposalMessagesSha256` for an exact rejected cloud packet.

`cloud_admitted` is legal only at `evidence_complete`, requires all admission
checks to pass, assigns a new synthesis lease, and requires every snapshot,
reservation, billing, selected-attempt checkpoint, and hash field. It cannot
also carry rejected-proposal fields. During replay cloud admission also
requires `hybrid_v0`, per-session cloud-synthesis consent, and projected cost
within the persisted episode cap. The operational budget ledger, not this event
alone, provides cross-session atomic admission.

A cloud-proposal denial is also legal only at `evidence_complete`. It retains
the active local synthesis lease and persists a distinct proposed provider and
model drawn from the candidate set; the proposed provider must differ from the
selected local provider. Replay requires `hybrid_v0`; an egress check recorded
as passed also requires `session_cloud_synthesis_v1` consent. An
`egress_denial` may record absent consent without claiming that egress passed.
A denial never carries `budgetReservationId` because no paid request was
admitted. Completed credential and health checks require their immutable
metadata/snapshot IDs. A completed egress check requires the proposal
checkpoint and both exact hashes as an all-or-none tuple. A billing projection
additionally requires pricing, campaign, and that proposal packet tuple.
`budget_denial` requires the exact projection and requires it to exceed at
least one persisted remaining balance; a passed budget check rejects that same
overage. Thus denial records retain the immutable inputs that were reached
without pretending the proposed cloud packet was the subsequently selected
local attempt. Ordinary local-policy, local-investigation, low-risk,
cloud-failure, and local-fallback decisions cannot carry pricing, campaign,
reservation, credential, billing, selected-cloud packet, or rejected-proposal
identity/packet fields. `healthSnapshotId` remains optional where a local
provider health observation is itself a routing input.

The projection is recomputed exactly with integer arithmetic:

```text
ceil(input_tokens * input_rate / 1_000_000)
+ ceil(max_output_tokens * output_rate / 1_000_000)
+ ceil(cache_read_tokens * cache_read_rate / 1_000_000)
+ provider_fee_ceiling
```

Each component is rounded independently. A nonzero cache-read-token estimate
requires a cache-read rate. An overflow beyond the JavaScript safe-integer
range or a persisted projection differing by even one micro-USD is rejected.
Budget capacity is evaluated at the decision level so the same exact projection
can truthfully record either a passing admission or a `budget_denial`.

### Additive links on existing events

The standalone parser leaves these fields optional for v1 compatibility. The
v2 reducer requires them as shown:

| Event | Required v2 fields |
| --- | --- |
| `route.assigned` | `decisionId`, `leaseId`, `phase` |
| `assistant.message.started` | `decisionId`, `leaseId`, `checkpointId`, `attemptId` |
| `context.compiled` | `decisionId`, `leaseId`, `messageId`, `attemptId` |
| `assistant.message.completed` | `attemptId` |

The exact `ReviewResultV1` payload is deliberately not admitted yet. PR 1 does
not enable `change-review-v1` or accept an untyped result. The later review
contract must add its strict schema before any v2 review can be rendered or
called accepted.

### Attempt lifecycle events

`inference.attempt.started` has this strict payload:

```ts
interface InferenceAttemptStarted {
  attemptId: string;
  round: number;
  checkpointId: string;
  messageId: string;
  decisionId: string;
  leaseId: string;
  providerId: string;
  requestedModel: string;
  phase: "investigation" | "synthesis";
  requestedMaxOutputTokens: number;
  allowTools: boolean;
  allowedToolNames?: string[]; // sorted, unique, required when tools are enabled
  requireToolCall: boolean;
  budgetReservationId?: string;
}
```

Synthesis attempts are tool-free. Tool-free attempts cannot declare or require
tools. The round equals the one-based assistant-message ordinal. The attempt
must match its immediately preceding checkpoint, active assistant, active
lease, selected decision, provider, requested model, and phase. Attempt IDs are
unique, at most one attempt is open, at most one reserved/paid attempt exists,
and the attempt reservation must match its decision.

`inference.attempt.finished` has this strict payload:

```ts
interface InferenceAttemptFinished {
  attemptId: string;
  checkpointId: string;
  outcome:
    | "succeeded"
    | "provider_error"
    | "protocol_error"
    | "cancelled"
    | "timeout"
    | "interrupted";
  requestDisposition: "not_sent" | "sent" | "unknown";
  finishReason?: string | null;
  servedModel?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens?: number;
    reported: boolean;
  };
  cost: {
    amountMicrousd: number;
    provenance:
      | "local_zero_cost_policy"
      | "provider_reported"
      | "host_pricing_snapshot"
      | "reserved_unknown";
    reservationId?: string;
  };
  latencyMs: number;
  ttftMs?: number;
  errorCode?: string;
}
```

A successful attempt was sent, has the exact requested served model, has no
error code, and follows its non-streaming assistant-completed event. The
canonical message may be marked incomplete when a completion obligation asks
for a retry; that does not turn a successful provider call into a provider
failure. An unsuccessful
attempt has an error code and fails its assistant message. `not_sent` means
zero usage and cost. `local_zero_cost_policy` means zero micro-USD.
`reserved_unknown` requires a reservation and a sent or unknown disposition.
`ttftMs` cannot exceed total latency. Start and finish reservation IDs must
match exactly. An unreserved attempt must use zero micro-USD
`local_zero_cost_policy`; a reserved attempt cannot use that provenance.
`reserved_unknown` must also equal the originating admitted decision's exact
worst-case `projectedCostMicrousd`; zero or an understated reservation charge is
rejected during replay.

V2 aggregate usage is derived once from finished attempts. `usage.recorded`
remains authoritative for v1 and is rejected in a v2 replay, preventing double
counting.

## Event-order state machine

At a routing boundary, the committed order is exact:

```text
routing.decision.recorded
  -> route.assigned                    (only for assign_new_lease)
  -> assistant.message.started
  -> context.compiled
  -> inference.attempt.started
```

For `retain_lease`, `route.assigned` is forbidden. A routine round is legal
only immediately after `tool.call.completed` or a retrying
`completion.obligations.checked`, and uses the exact existing decision and
lease:

```text
tool.call.completed
  -> assistant.message.started
  -> context.compiled
  -> inference.attempt.started
```

An obligation retry uses the same suffix with
`reason: "obligation_retry_boundary"`; it does not invoke the router.

No routing decision or assignment is created for that routine transition.
Each boundary may occur at most once in v0. A route cannot change while an
assistant streams, an attempt is open, or a tool call is pending. Provider
changes cannot exceed the persisted limit.

V2 replay also requires event `createdAt` values to be nondecreasing in sequence
order. Equal timestamps remain legal because one atomic `appendMany` batch uses
one timestamp; an event earlier than the immediately replayed state timestamp
fails closed. V1 timestamp behavior is unchanged.

While an attempt is open, only assistant deltas, assistant completion, or its
attempt finish are accepted. A success follows this order:

```text
inference.attempt.started
  -> assistant.message.delta*          (optional)
  -> assistant.message.completed
  -> inference.attempt.finished        (outcome succeeded)
```

A pre-dispatch or provider failure may finish without an assistant-completed
event. The reducer then marks that assistant failed. If a successful result
requires or declares a tool call, `tool.call.requested` must be next, followed
immediately by `tool.call.completed`. Tool and completion-obligation events are
accepted only after a successful terminal attempt. A cancelled attempt must be
followed by `session.cancelled`; an interrupted attempt must be followed by
`session.interrupted`. A provider failure may either fail the session or enter
the single `provider_failure` fallback boundary only when the failed attempt
belongs to the admitted, reserved cloud-synthesis decision. A failed local
attempt cannot manufacture a fallback boundary.

A terminal v2 session has:

- no open attempt, streaming assistant, or pending tool call;
- exactly one started and one finished attempt for every context checkpoint;
- a successful final attempt when the session completes.

### Recovery

Startup recovery never terminates a v2 session while its attempt is open. In
one append transaction it first records `inference.attempt.finished` with
`outcome: "interrupted"` and `requestDisposition: "unknown"`, then records
`session.interrupted`. A local attempt records zero cost. A reserved attempt
uses `reserved_unknown`, its original reservation ID, and the persisted
worst-case projected amount; recovery fails closed if that projection is
missing. A crash after a successful `tool_calls` finish but before request
persistence is closed as `session.interrupted`. A persisted pending tool call
is first closed by a deterministic failed `tool.call.completed` with
`startup_recovery`, then the session is interrupted. A persisted cancelled
attempt is closed by `session.cancelled`, never re-routed or relabeled as an
interruption. Re-running recovery is idempotent because the session is no
longer running.

Recovery does not fabricate a missing event from an incomplete boundary-start
transaction. Such a prefix violates the atomic-write contract and replay fails
closed.

## Projection and compatibility

`SessionState` adds `routingDecisions` and `inferenceAttempts`. Old stored
projections default both to empty arrays, as do v1 replays. Existing v1 event
payloads retain their meanings and do not acquire synthetic decision, lease,
checkpoint, or attempt links. V1 continues to aggregate `usage.recorded` and
continues to accept its original `session.started: {}` payload.

New binaries read v1 and v2 events. Old binaries are not expected to understand
the new v2 event types. No event is rewritten during projection upgrade.
Before every append, the event store reconstructs state from the append-only
`session_events` rows inside the write transaction. Mutable `sessions.state_json`
is a cache and is overwritten from canonical replay; deleting an attempt or
changing policy/status in that projection cannot authorize a forged append.

## Consequences and limits

- Replay can now distinguish planned inference from every terminal outcome and
  fail closed on partial or forged traces.
- The exact start/finish ordering is enforceable independently of a provider or
  router implementation.
- The new events do not prove that SQLite start/finish groups are atomic; crash
  injection against the database transaction layer is separate evidence.
- A routing decision records admission inputs but does not reserve money by
  itself. The budget ledger remains required before any paid provider exists.
- No runtime currently emits v2 events, no cloud provider is constructed, no
  paid call is authorized, and this ADR is not evidence of hybrid quality.
