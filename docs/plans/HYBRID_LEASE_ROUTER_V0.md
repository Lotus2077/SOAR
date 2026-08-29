# Hybrid Lease Router v0 and Review Current Changes v1

Status: **Approved for PR 1 through PR 5 ($0 only); PR 6 remains unapproved**

- Plan version: `hybrid-lease-router-v0-plan-2`
- Created: 2026-08-29
- Approved: 2026-08-29 by the project owner in the project task
- Proposed-plan revision: `c73af96afba0e84a8d978cc2be62f0659069037c`
- Baseline revision: `4233eddf64b0f8e1ee290c9b067efb1494eadbff`
- Project log: [BUILD_LOG.md](../BUILD_LOG.md)

## Approval gate

This document is planning work, not evidence that hybrid routing exists. No
runtime, provider, event-schema, database, tool, or renderer implementation may
begin until this plan is explicitly approved. Approval adopts the recommended
defaults in [Decisions requiring approval](#decisions-requiring-approval),
unless an exception is recorded in the build log.

Approval is operational, not implied by a merge or silence. A project
maintainer or the project owner must explicitly accept this plan in a durable
issue, pull request, or project task. The approval is then recorded by:

1. changing the plan status to `Approved` without deleting the proposal
   history;
2. appending a build-log entry that cites the approval record and approved plan
   version; and
3. merging that status/log change before implementation starts.

Approval of plan 2 authorizes only the zero-paid PR 1 through PR 5 sequence.
PR 6 still requires a second, explicit paid-canary approval after provider,
pricing, credential-limit, and egress evidence is attached to the build log.
That first approval was granted on 2026-08-29 and is recorded as
`BL-20260829-1146-plan2-approved`. It does not authorize a paid call.

### Current implementation status

The approved PR 1 through PR 5 implementation is now present, including the
app-created local-only Review Current Changes slice. PR 5 creates a v2
`change-review-v1` session, keeps acquisition and structured synthesis on the
same configured vLLM provider, and exposes no separately configured metered-
provider path. The configured endpoint may be on this Mac or another machine;
the UI discloses that review evidence is sent to that endpoint. A non-loopback
endpoint requires the operator to set
`SOAR_VLLM_COST_POLICY=local_zero_cost` explicitly, attesting that it has no
per-token fee. Selected metered-provider exposure remains `$0` under that
attestation; SOAR does not independently verify the endpoint's external billing
or infrastructure cost.

The deterministic gates, Electron workflows, and one-shot synthetic empty-
snapshot structured-output canary passed on 2026-08-30 and are recorded in the
append-only build log. The canary demonstrates schema compatibility only, not a
post-fix real-repository flow. This is not a `Released` claim or complete
release proof. PR 6 remains unapproved, and its paid OpenRouter canary still
requires the separate approval and evidence in this section.

Any material scope or persisted-contract change after approval requires:

1. a new build-log entry explaining why;
2. an updated plan or superseding ADR;
3. explicit re-approval when the user promise, paid-call authority, privacy
   boundary, or evaluation claim changes.

## Decision summary

The next product milestone is **Review Current Changes v1**, enabled by a
minimal **Hybrid Lease Router v0**:

- a developer selects a repository and asks SOAR to review its current changes;
- the local vLLM owns bounded change inspection and every tool call;
- the local provider keeps its lease throughout productive investigation;
- the router is reconsidered once when required evidence collection completes;
- a deterministic, versioned risk policy either retains local synthesis or
  admits one paid, tool-free cloud synthesis attempt;
- a failed cloud attempt may fall back once to local synthesis;
- every route, attempt, budget decision, handoff, cost, and terminal outcome is
  append-only and replayable.

Full routing does **not** run for every session event. Cheap guards for
permissions, budget, deadline, open attempts, and provider health run at every
relevant transition; provider selection runs only at `session_start`,
`evidence_complete`, and `provider_failure` boundaries.

The v0 promise is:

> Produce an independent, evidence-backed change review while meeting a
> measurable quality floor, and use paid cloud inference only when a
> deterministic checkpoint justifies it.

It is not a claim that SOAR selects the globally best model for every task.

## Problem statement

Heavy users of Claude Code, Manus, Genspark, and similar agents can generate
changes quickly but still need an independent review before accepting them.
Today they must select a reviewer manually or send an entire repository to a
paid model without evidence that the additional cost improves the result.

SOAR has a verified local, read-only repository investigation path, but its
runtime constructs one provider and assigns one local route for the entire
session. It lacks cloud execution, router-grade failed-attempt telemetry,
atomic paid-call admission, and a user-visible provider choice. Without those
contracts, quality, cost, latency, and provider-health signals cannot drive an
honest router.

## Target users

- **AI-native developer:** wants an independent review of agent-generated or
  human-authored changes before accepting them.
- **Cost-aware power user:** wants cloud-level help for risky changes without
  paying for routine reviews.
- **Security-conscious maintainer:** needs to know exactly whether and why
  repository evidence leaves the machine.
- **SOAR maintainer/evaluator:** needs replayable evidence for route, cost,
  latency, grounding, and failure claims.

## Verified starting point

At baseline revision `4233edd`:

- the macOS Electron app, append-only SQLite history, cancellation, restart
  recovery, bounded repository tools, provider-neutral context packets, and
  deterministic local route are implemented;
- `SessionRunner` receives one provider object and assigns it once before its
  inference loop;
- `route.assigned` can represent multiple routes, but safe routing boundaries
  and lease cross-links are not enforced for hybrid sessions;
- `usage.recorded` follows successful provider returns but does not provide a
  one-to-one terminal record for failed, cancelled, timed-out, or interrupted
  attempts;
- the OpenAI-compatible adapter hardcodes the local provider identity and
  zero-cost policy and does not expose honest cloud cost accounting;
- the checked-in two-provider catalog is readiness documentation, not runtime
  configuration;
- the current example configuration has a $0.75 paid-episode cap; changing the
  runtime default to the proposed $0.25 cap is future implementation, not an
  already-active limit;
- no separate OpenRouter provider configuration or credential is loaded by the
  app; the generic configured vLLM endpoint remains an operator trust boundary
  and could incur external charges if it is classified incorrectly;
- the accepted schema-v5 Repository Investigator proof completed three guided
  tasks with 32 provider calls, 29 tool calls, 82,640 input tokens, zero paid
  cost, and exact retained evidence. It proves guided execution and context
  retention, not natural answer quality or dynamic routing.

## Goals

1. Complete a useful, read-only change review entirely through the macOS app.
2. Preserve a stable local lease during investigation and perform no more than
   one paid escalation per episode.
3. Deny every paid call that lacks explicit consent, a usable credential,
   fresh bounded pricing, safe egress, provider health, or available budget.
4. Record exactly one terminal inference-attempt event for every v2 context
   checkpoint, including failure, timeout, cancellation, and recovery.
5. Demonstrate one provider-neutral local-to-cloud handoff without regressing
   the accepted local-only proof.
6. Evaluate local-only, cloud-synthesis-all, and hybrid policies on the same
   held-out change-review fixtures before claiming a quality, cost, or latency
   benefit.

## Non-goals

- Editing, applying, testing, committing, or pushing a reviewed change.
- Shell access, browser research, PR posting, or external messaging.
- Cloud-side tools or any cloud-initiated workspace side effect.
- Learned, bandit, reinforcement-learning, or LLM-authored routing.
- Provider selection after every event or pre-assignment of the whole episode.
- Parallel reviewers, speculative execution, multi-cloud cascades, or more than
  one paid attempt.
- Supporting arbitrary historical revision ranges in v1.
- Shipping the public OpenAI-compatible endpoint.
- Starting the paid 42-workload campaign before its research and patch/test
  tool tracks and official evaluator workers exist.
- Claiming that a review with no blocking findings proves the change correct.

## User stories

### AI-native developer

- As a developer, I want to review staged, unstaged, renamed, deleted, and
  bounded untracked text changes so I can catch defects before accepting them.
- As a developer, I want findings to cite the implicated change and any relevant
  source evidence so I can inspect the issue directly.
- As a developer, I want cancellation and restart recovery so a long review is
  not lost.

### Cost-aware power user

- As a power user, I want local review to be the default so routine work costs
  no model-token fees.
- As a power user, I want an explicit per-review cloud cap so one session cannot
  consume the campaign budget.
- As a power user, I want the route reason, provider, cost, and latency visible
  so I can judge whether escalation was worthwhile.

### Security-conscious maintainer

- As a maintainer, I want cloud use to require per-session consent so selecting
  a workspace never silently authorizes egress.
- As a maintainer, I want the app to deny packets containing detected secrets
  or absolute machine paths rather than silently redact and continue.
- As a maintainer, I want cloud synthesis to receive no tool definitions so it
  cannot request a side effect.

### Maintainer/evaluator

- As an evaluator, I want each provider attempt linked to its decision, lease,
  context checkpoint, message, budget reservation, and terminal outcome.
- As an evaluator, I want immutable fixture, packet, model, policy, and result
  identities so comparisons remain reproducible.

## Planned hybrid product flow

1. The user chooses a Git workspace.
2. The app offers **Local only** by default and **Hybrid** as an explicit opt-in.
3. Hybrid shows the maximum paid amount and a concise egress disclosure before
   session creation. Consent applies to that session only.
4. SOAR creates a `change-review-v1` session with an immutable execution and
   routing policy snapshot.
5. The local provider calls the bounded change-inspection tool, then reads or
   searches admitted repository evidence.
6. When evidence obligations are complete, the router records one
   `evidence_complete` decision:
   - low-risk review: retain the local lease and synthesize locally;
   - admitted high-risk review: create one cloud lease and synthesize from the
     exact bounded, hash-bound messages with tools disabled;
   - denied cloud route: retain local synthesis and show the denial reason.
7. If a sent cloud request fails or times out, SOAR closes and accounts for the
   cloud attempt, assigns one local fallback lease, and makes one final local
   synthesis attempt. User cancellation never reroutes.
8. The app displays the review, evidence coverage, route timeline, denial or
   fallback reason, token/cost provenance, and latency.

### Implemented PR 5 local-only subset

- The app exposes Review Current Changes and creates only Local-only v2 review
  sessions; Hybrid is disabled with the explicit statement that no separately
  configured metered cloud provider or Hybrid route is present. The configured
  vLLM endpoint remains subject to the operator's cost-policy attestation.
- The local provider must propose the fixed `inspect_git_changes` call, after
  which the host executes acquisition and schedules bounded full reads for the
  admitted changed files that require them.
- The host reconstructs evidence and provenance from successful canonical
  attempt/tool events. The final review packet must retain the complete admitted
  evidence body set; omitted/truncated packet evidence cannot be promoted to a
  complete review.
- The same provider receives one tool-free synthesis request with the exact
  `ReviewResultV1` JSON Schema. Raw and attached result equality, identities,
  grounding, conclusion, coverage, completion check, and checkpoint provenance
  are re-proved before renderer exposure.
- The host reacquires the snapshot after synthesis and on each display/copy
  request. Drifted, unavailable, or terminally invalid results are withheld.
  Identity-matching incomplete coverage and model-declared omissions are shown
  as incomplete but cannot be copied.
- Review events use an allow-listed redacted renderer projection. Coverage sent
  to the renderer is aggregate-only and excludes changed paths, per-file
  coverage, and snapshot/evidence IDs. The accepted structured result may still
  include bounded evidence references for its findings.

## Requirements

### P0 -- required for v0

#### P0.1 Versioned session and routing policy

Add a new policy rather than reinterpreting `agentic-execution-v1`:

```ts
type RoutingPolicyId = "local_only_v1" | "hybrid_v0";

interface AgenticExecutionPolicyV2 {
  schemaVersion: "agentic-execution-v2";
  inferenceRounds: number;
  toolCalls: number;
  routingPolicy: RoutingPolicyId;
  maxProviderChanges: 2;
  maxPaidAttempts: 1;
  maxPaidEpisodeMicrousd: number;
  maxEpisodeDurationMs: number;
  attemptTimeoutMs: number;
  egressConsent: "none" | "session_cloud_synthesis_v1";
}
```

- Existing v1 sessions preserve their current single-local-route meaning.
- Missing policy remains readable for legacy history.
- `change-review-v1` hybrid sessions require v2.
- New monetary admission fields use integer micro-USD. Existing legacy USD
  projections remain readable and are not silently reinterpreted.
- The approved default per-review paid cap is 250,000 micro-USD ($0.25), but no
  runtime enforcement or paid-call authority exists until its later gates land.
- `session.started` v2 persists `startedAt` and the derived `deadlineAt`.
  `maxEpisodeDurationMs` is measured from that persisted start; no attempt may
  start at or after the deadline. `attemptTimeoutMs` bounds each provider call,
  and fallback is allowed only when enough episode time remains.

#### P0.2 Provider registry

Generalize `InferenceProvider` around a non-secret descriptor:

```ts
interface ProviderDescriptor {
  id: string;
  adapter: "openai-compatible";
  locality: "local" | "cloud";
  model: string;
  enabled: boolean;
  capabilities: readonly ProviderCapability[];
  contextWindowTokens: number;
  maxOutputTokens: number;
  requestReserveTokens: number;
  accounting:
    | { kind: "local_zero_cost" }
    | {
        kind: "metered";
        inputMicrousdPerMillionTokens: number;
        outputMicrousdPerMillionTokens: number;
        cacheReadMicrousdPerMillionTokens?: number;
        pricingVerifiedAt: string;
        pricingSource: string;
      };
}
```

- Provider ID, locality, capabilities, limits, and accounting are not hardcoded
  in the OpenAI-compatible transport.
- The compiler derives its safe input allowance from the context window,
  selected output allowance, request reserve, and safety margin. The requested
  output allowance is persisted per attempt and is used unchanged for context
  and cost admission.
- Duplicate IDs, invalid limits, stale/missing paid pricing, missing required
  capabilities, or an implicit zero-cost declaration fail closed.
- The current PR 5 adapter requires an operator to set
  `SOAR_VLLM_COST_POLICY=local_zero_cost` explicitly for a non-loopback endpoint.
  This attests that the configured endpoint has no per-token fee; it is not an
  independent check of external billing, service, hardware, or infrastructure
  cost.
- `change-review-v1` requires the OpenAI-compatible JSON Schema response
  mechanism and the exact `ReviewResultV1` schema. The PR 5 implementation
  advertises this capability after deterministic adapter contract tests; that
  advertisement is not evidence that an arbitrary configured endpoint/model
  honors it. The operator-attested zero-token-fee live schema canary passed once
  against the configured `RM-01 VLM` on 2026-08-30 using a synthetic empty
  snapshot; another endpoint/model must prove the contract independently. The
  canary proves neither a post-fix real-repository flow nor the endpoint's
  external billing status. There is no free-form JSON-suffix fallback; a
  configured vLLM/model that cannot satisfy the schema cannot produce an
  accepted review.
- The shipping app resolves the cloud secret lazily from a main-process-only
  credential store backed by macOS Keychain. Environment injection is limited
  to tests and explicit headless development.
- Provider-managed substitution to another model is disabled for v0; a served
  model mismatch fails the attempt.
- Paid pricing is model-specific and expires after 24 hours. A health snapshot
  comes from a bounded, non-inference model-list check and expires after 60
  seconds. Both snapshots, including timestamps and result codes, become
  persisted router inputs; replay evaluates the recorded inputs rather than
  silently querying live state.

#### P0.3 Checkpoint router and leases

The router is a pure deterministic function. It receives only replayable state,
versioned policy, bounded risk signals, provider metadata, health state, and
admission results. It performs no I/O and does not ask an LLM which model to
use.

Routing boundaries are:

- `session_start`: assign local investigation;
- `evidence_complete`: retain local or propose cloud synthesis;
- `provider_failure`: assign one local fallback after a non-cancellation cloud
  failure.

Routine tool results retain the lease and do not invoke the full router.

Proposed `review-risk-v1` escalation signals are observable and versioned:

| Signal | Weight |
| --- | ---: |
| Touches provider/routing, persistence/schema, IPC/preload, permissions/security, cancellation/concurrency, or budget code | 2 |
| Crosses at least three of main/preload/renderer/shared/test surfaces | 2 |
| Changes at least eight files | 1 |
| Changes at least 300 non-binary lines | 1 |
| Changes runtime code without changing a relevant test | 2 |

`hybrid_v0` proposes cloud synthesis at a score of 3 or greater. Incomplete,
oversized, binary, submodule, or unreadable evidence is not treated as a risk
score; it forces an explicitly incomplete review. Thresholds are hypotheses to
calibrate only on the dedicated calibration set and require a logged
policy-version change if altered.

The v1 extractor is deliberately mechanical:

- sensitive paths are a checked-in, sorted glob table covering
  `src/main/providers/**`, `src/main/routing/**`, persistence and migration
  files, `src/preload/**`, IPC contracts, permission/credential/egress code,
  cancellation/concurrency code, and budget code;
- surfaces are exactly `src/main/**`, `src/preload/**`, `src/renderer/**`,
  `src/shared/**`, and `tests/**`; one file belongs to at most one surface;
- the file-count signal includes every changed non-ignored path;
- the line-count signal is additions plus deletions in admitted non-binary
  hunks; a content-identical rename contributes zero lines;
- “runtime code without a relevant test” means at least one admitted file under
  `src/**` changes and no admitted `*.test.*` or `*.spec.*` path changes.

This is a routing feature, not a judgment that a test is actually sufficient.
During PR 3, build it from the real acquisition output and freeze it using a
labeled calibration set of at least 12 changes before router PR 4 begins.
The final held-out set is separately curated and sealed; its identities or gold
may not be used to tune features, weights, or the threshold.

#### P0.4 Routing decision events

Add a strict `routing.decision.recorded` payload with:

- decision ID, policy version, boundary, phase, action, and reason code;
- sorted candidate provider IDs and the selected provider/model, plus the
  rejected proposed provider/model when a denial retains local synthesis;
- prior and selected lease IDs when applicable;
- `riskPolicyId`, total score, the canonical sorted signal/value list, and an
  explicit incomplete reason when risk cannot be scored;
- bounded trigger facts, never source content;
- admission status and reason code for capability, credential, health, egress,
  deadline, and budget;
- health snapshot, pricing snapshot, campaign, reservation, and credential
  metadata IDs where applicable;
- billable input estimate, requested output-token cap, input/output/cache
  micro-USD-per-million rates, provider-fee ceiling, rounding policy,
  projected cost, and remaining episode/campaign micro-USD amounts;
- exact checkpoint, packet, and serialized-message hashes when paid admission
  runs. An admitted provider uses the selected-attempt fields; a rejected cloud
  proposal uses separate proposal checkpoint/hash fields so its egress and
  billing evidence cannot be mistaken for the retained local attempt.

Reason codes include local policy, local investigation, low-risk local review,
cloud admitted, disabled provider, missing credential, unhealthy provider,
capability mismatch, egress denial, budget denial, cloud failure, and local
fallback.

Denials still select local synthesis and persist the precise reason. A retained
lease does not emit another `route.assigned`. A new assignment must link to the
decision and may occur only with no streaming assistant, open attempt, or
pending tool call.

For v2, existing event payloads gain the following additive fields. They remain
optional to the standalone event parser so v1 history still parses, but the v2
reducer requires all of them:

| Event | Required v2 links |
| --- | --- |
| `route.assigned` | `decisionId`, `leaseId`, `phase` |
| `context.compiled` | active-lease `decisionId`, `leaseId`, `messageId`, `attemptId` |
| `assistant.message.started` | `decisionId`, `leaseId`, `checkpointId`, `attemptId` |
| `assistant.message.completed` | `attemptId`; for `change-review-v1`, the exact structured `reviewResult`, host-derived coverage, and parse status for an accepted review |

The normative Zod schemas, conditional invariants, and event-order state
machine are checked into an ADR at the start of PR 1. PR 1 enforces the attempt
link; the implemented PR 5 path enforces the strict `ReviewResultV1` payload
before the app accepts a change review. Implementation cannot rely on prose-only payloads.
This sequencing clarification does not relax the accepted-review contract.

#### P0.5 Attempt lifecycle

Add authoritative v2 events:

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
  allowedToolNames?: string[];
  requireToolCall: boolean;
  budgetReservationId?: string;
}

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

- One context checkpoint has exactly one started and one finished v2 attempt.
- Route, lease, provider, model, context, message, and attempt identities match.
- Tool requests and completion checks may follow only a successful attempt.
- A v2 session cannot terminate with an open attempt.
- Recovery closes an open attempt as interrupted, conservatively resolves its
  reservation, then interrupts the session.
- `usage.recorded` remains the v1 source and is not redefined. V2 usage derives
  from finished attempts; the reducer never aggregates both sources.

At a routing boundary, the start sequence is one SQLite transaction in this
exact order: `routing.decision.recorded`, optional `route.assigned`,
`assistant.message.started`, `context.compiled`, and
`inference.attempt.started`. For a productive routine round that retains the
lease, the transaction contains only `assistant.message.started`,
`context.compiled`, and `inference.attempt.started`, linked to the active lease
and its originating decision; it emits no new routing decision or assignment.
This preserves existing assistant-before-context replay semantics. All IDs are
allocated before either transaction. Only after commit may network dispatch
begin. A pre-dispatch error records `not_sent`; a crash where dispatch cannot be
proved records `unknown` and consumes the reservation. Completion, attempt
finish, and budget settlement/release are likewise committed together.

#### P0.6 Atomic paid-call admission

Add an operational, append-only SQLite budget ledger using integer micro-USD:

- admission and reservation insertion occur in one write transaction;
- a campaign has an immutable campaign ID, provider credential-metadata ID,
  opening provider exposure, soft stop, hard ceiling, and creation time;
- campaign exposure equals opening exposure plus settled spend plus outstanding
  reservations;
- concurrent sessions cannot oversubscribe the remaining amount;
- the per-episode cap, $90 automatic stop, and $100 campaign ceiling are all
  enforced before a paid request;
- exact-cap admission succeeds; one micro-USD over fails;
- a definitely unsent request releases its reservation;
- a sent or unknown-disposition request without trustworthy usage consumes the
  full reservation;
- provider-reported cost is preferred; otherwise a dated host pricing snapshot
  computes actual cost and preserves that provenance;
- startup recovery resolves orphaned reservations exactly once.

Each reservation persists the pricing-snapshot ID, billable estimated input,
requested maximum output, cache assumption, component rates, provider-fee
ceiling, and `ceil(tokens * rate / 1_000_000)` component-rounding rule. The
projection reserves the worst permitted output and provider fee, not an
expected value.

The $100 claim applies only to one SOAR campaign using a fresh, dedicated
provider credential with a non-resetting provider-side $100 hard limit. Before
the first paid call, SOAR must verify a zero opening exposure and remaining
provider limit through trustworthy provider metadata. If those facts cannot be
verified, paid routing remains disabled. Shared-key or external account spend
is not claimed to be controlled by the local ledger.

If trustworthy late cost exceeds a reservation despite worst-case projection,
SOAR records the full actual cost and a `budget_overrun` failure, disables all
future paid calls in that campaign, and does not clamp the ledger to the cap.
The provider-side limit is the final hard backstop. A new campaign or reset
requires a new credential-limit verification and a build-log entry; balances
are never reset in place.

Reservations, settlements, releases, overruns, and recovery adjustments are
immutable rows linked by reservation ID. Session events remain the canonical
explanation of each route and cost; the operational ledger is independently
reconcilable but is not reconstructed by mutating historical events.

The exact already-compiled message set is reused for admission and the request;
SOAR must not compile one packet for pricing and send a different packet.

#### P0.7 Cloud-egress admission

Cloud use requires per-session consent. Check the exact serialized provider
messages and deny, rather than silently remove, when they contain:

- the canonical workspace root or user-home absolute paths;
- a known credential value or recognized private-key/API-token form;
- content from a denied secret/config path;
- an artifact body not admitted by the task policy.

Persist only policy version, pass/deny result, bounded finding codes, and packet
hashes. Never persist rejected cloud message content. Workspace-relative source
and change evidence is allowed after consent. Cloud synthesis always has tools
disabled and receives no tool definitions.

Provider setup lives in an app Settings surface. The user can add, validate,
replace, and delete the cloud credential. A typed secret necessarily exists
transiently in the renderer input and typed IPC request; after submission the
field is cleared and the main process writes it to Keychain. The secret is never
returned to the renderer, persisted in renderer state/storage, logged, included
in errors, or retained in session data. The UI receives only provider ID,
masked status, last validation time/result, and dedicated-limit status.
Replacing or deleting a credential invalidates cached health/pricing/limit
snapshots and disables Hybrid until validation succeeds. This boundary protects
at-rest data, not a renderer that is already compromised while the user types.

#### P0.8 Bounded change acquisition

Add a read-only `inspect_git_changes` tool behind the existing registry and
gateway. It must:

- require a selected Git workspace and use argument-array process execution,
  never a shell;
- allow only `rev-parse`, `status --porcelain=v2`, `ls-files --stage`,
  `diff --raw/--numstat` against the captured base, and `cat-file` for an
  already-resolved object ID; arbitrary revisions and every network-capable or
  mutating Git subcommand are denied;
- set `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `GIT_PAGER=cat`,
  `PAGER=cat`, `GIT_CONFIG_NOSYSTEM=1`, and an empty global-config path; pass
  command overrides that disable `core.fsmonitor`, external diff, textconv,
  submodule recursion, and pager behavior;
- cover staged, unstaged, renamed, deleted, and bounded untracked text changes;
- exclude ignored paths and refuse symlinks escaping the workspace;
- identify binary, submodule, unreadable, oversized, or truncated coverage;
- enforce per-file, total-byte, file-count, hunk-count, and cancellation bounds;
- return a deterministic manifest and bounded hunks without changing the index
  or working tree.

Git discovers state and supplies already-resolved base blobs; a pinned host
diff library constructs textual hunks from those blobs and bounded workspace
reads. Repository diff drivers never produce model-visible content.

The tool records index/worktree metadata before and after its subprocesses and
fails closed on drift or unexpected writes. Cancellation terminates the child,
waits a bounded grace interval, then kills the process tree. No submodule
process is started.

Bounded, safe untracked text content is included in local inspection under both
Local only and Hybrid. Hybrid consent affects only whether that content may be
placed in the cloud packet. An incomplete manifest can produce an incomplete
review but never an unqualified clean result.

Every review is bound to one immutable `ChangeSnapshotV1` containing the base
commit OID, a hash of canonical `ls-files --stage` output, and a sorted manifest
of changed tracked/untracked paths with state, mode, size, and admitted-content
hashes. The snapshot ID is the SHA-256 of that canonical record. SOAR recomputes
the identity before accepting and before displaying a result. Drift marks the
review stale/incomplete; it never presents an earlier result as a review of the
new current changes.

Change evidence uses a versioned reference that distinguishes working and base
lines:

```ts
interface ChangeEvidenceRef {
  kind: "change";
  snapshotId: string;
  path: string;
  side: "working" | "base";
  line: number;
  hunkSha256: string;
}

interface RepositoryEvidenceRef {
  kind: "repository";
  snapshotId: string;
  evidenceSetId: string;
  observationId: string;
  path: string;
  line: number;
  contentSha256: string;
}

type ReviewEvidenceRef = ChangeEvidenceRef | RepositoryEvidenceRef;
```

Each hunk records `oldPath` and `newPath`; a base reference must use `oldPath`
and a working reference must use `newPath`. The renderer displays working
references as `path:line` and base references as
`old/path@<base-short-oid>:line`. This is a presentation form, not parsed by the
legacy citation grammar. `inspect_git_changes` returns a strict, versioned
request/result schema and a side-aware evidence map; validation uses the
structured reference, snapshot ID, side, path, line, and hunk hash before
rendering.

Repository references come only from a successful bounded `read_text_file` or
`search_text` observation. `contentSha256` binds the admitted file or exact
matched line, and `observationId` links the immutable tool result. At
`evidence_complete`, SOAR freezes the sorted admitted observations into a
`ReviewEvidenceSetV1` hash. Every repository reference must match that set, and
every cited working file hash is rechecked with the change snapshot before
acceptance.

#### P0.9 Review completion contract

- The raw model result remains separately model-attributed; evaluator or host
  records are not appended to it as if the model authored them. Change-review
  evidence uses the new structured validator rather than legacy prose-citation
  normalization.
- The provider returns one bounded, provider-attributed `ReviewResultV1`
  object through the adapter's structured-output path. Raw provider output and
  parse status remain auditable; the renderer, not the model, produces readable
  Markdown. V0 does not scrape a JSON suffix from prose or depend on exact prose
  phrases.
- Every finding, regardless of severity, states severity, title, impact,
  suggested correction, suggested test, and at least one structured, verified
  `ChangeEvidenceRef` tying it to the reviewed change. Additional
  `RepositoryEvidenceRef` values may support the call path or impact.
- Severity is versioned: P0 data loss/security/system unusable; P1 likely
  functional defect; P2 bounded correctness/maintainability risk; P3 optional
  improvement.
- “No blocking findings” is accepted only after required manifest, diff,
  source, and test coverage. The UI says “No blocking findings found in the
  inspected evidence,” never “The change is correct.”

```ts
interface ReviewResultV1 {
  schemaVersion: "change-review-result-v1";
  snapshotId: string;
  summary: string;
  conclusion:
    | "blocking_findings"
    | "no_blocking_findings"
    | "incomplete";
  evidenceSetId: string;
  omissions: Array<{ code: string; description: string }>;
  findings: Array<{
    findingId: string;
    severity: "P0" | "P1" | "P2" | "P3";
    title: string;
    impact: string;
    suggestedCorrection: string;
    suggestedTest: string;
    evidence: ReviewEvidenceRef[];
  }>;
}
```

All strings and arrays have explicit size limits in the strict schema. Every
finding reference is host-validated against the unchanged snapshot and
side-aware evidence map. Unknown fields, duplicate finding IDs, invalid
references, an inconsistent conclusion, or an ungrounded finding make the
attempt a protocol error rather than a successful review. A structured-output
repair is a new local checkpoint/attempt; a failed paid structured result uses
the single allowed local fallback and never triggers a second paid call. Host
evaluation matches the accepted manifest but remains separately attributed.

The host also derives and persists `ReviewCoverageV1`; the model does not author
its coverage record. It contains snapshot/evidence-set IDs, complete/incomplete
manifest status, admitted and omitted path/hunk counts, per-changed-file full
read status, changed-test paths, the runtime-without-test signal, packet
retention status, snapshot revalidation status, and bounded omission codes.
`no_blocking_findings` is accepted only when:

1. no changed path is binary, submodule, unreadable, oversized, truncated, or
   otherwise omitted;
2. every changed text hunk and complete new/deleted text body is in the final
   evidence set;
3. every changed text file has a successful bounded full read of its working
   content, or base content when deleted;
4. every changed test file is included, and the host records whether runtime
   code changed without a changed test (test execution remains a non-goal);
5. the final provider packet retained the complete evidence set; and
6. the change snapshot still matches before acceptance and display.

The canonical `ReviewCoverageV1` remains in main-process history. The renderer
receives only a separate aggregate coverage projection with counts, status,
changed-test count, runtime-without-test signal, revalidation state, and
omission codes. It receives no per-file coverage, changed paths, or
snapshot/evidence IDs from that coverage record. The accepted structured result
may still include bounded evidence references for its findings. Raw provider
output, rejected results, tool bodies, workspace paths, endpoints, and validator
diagnostics are also excluded from the allow-listed review event projection.

#### P0.10 App experience

- Add a dedicated **Review Current Changes** entry point.
- PR 5 defaults to Local only and displays Hybrid as unavailable because no
  separately configured metered provider or Hybrid route is present. The
  configured vLLM endpoint remains operator-attested. PR 6 must add explicit
  Hybrid selection plus the maximum paid amount and egress summary before
  creation.
- Persist the active local selection, policy version, zero egress consent, and
  configured cap in session history; future Hybrid consent remains PR 6 work.
- Show a phase timeline: local inspection, routing checkpoint, local/cloud
  synthesis, and optional fallback.
- Show provider/model, reason code in plain language, evidence coverage,
  projected versus reported cost, and phase/end-to-end latency.
- Empty diff, incomplete evidence, missing credential, cap denial, cloud
  failure, timeout, cancellation, restart/replay, and copy-review states are
  explicit and testable.
- Credentials are never returned, stored, logged, or retained by the renderer
  after the transient submission described in P0.7. Endpoints and raw rejected
  packets never enter renderer data.
- Settings supports secure credential add, validation, replacement, and
  deletion with only masked validation/limit metadata returned to the renderer.

#### P0.11 Comparable evaluation

PR 3 begins by creating a versioned `change-review-eval-v1` protocol and at
least 12 labeled calibration changes, then freezes both before PR 4. Separately
curate at least 24 held-out, real,
testable changes: at least 8 clean and at least 16 faulty, with at least 20 total
P0/P1 gold defects and at least 8 total P2/P3 gold defects. Changes use seeded
defects derived from real failure modes or pinned historical defects. Fixtures
pin repository, base, change snapshot, tool bounds, packet, model/config, and
evaluator version. Held-out labels and gold remain sealed outside the agent
workspace and are not inspected during router calibration or implementation.

Run every fixture through the same harness under:

1. `local_only_v1`;
2. `cloud_synthesis_all_eval` (evaluation only, not an app routing policy);
3. `hybrid_v0`.

All three policies receive the same immutable, host-collected evidence packet;
only the synthesis provider decision differs. This isolates the routing
decision. A separate end-to-end app cohort exercises local tool investigation,
but it is not used to claim causal synthesis quality. Cloud synthesis is
tool-free in every comparison.

Evaluator definitions are fixed before the held-out run:

- a successful review is a valid, grounded `ReviewResultV1` accepted against an
  unchanged snapshot;
- high-severity recall is uniquely matched P0/P1 gold defects divided by all
  P0/P1 gold defects;
- finding precision is uniquely matched valid findings divided by all findings;
  a duplicate after the first match counts as a false positive;
- all-severity recall is uniquely matched P0/P1/P2/P3 gold defects divided by
  all P0/P1/P2/P3 gold defects;
- a false accept is `no_blocking_findings` or an unqualified clean conclusion
  while any P0/P1 gold defect remains unmatched;
- a low-risk fixture is one whose frozen `review-risk-v1` score is below 3 with
  complete evidence;
- cost per successful review is total paid micro-USD divided by successful
  reviews; local infrastructure/electricity is reported separately, not called
  free;
- weighted quality is `0.5 * P0/P1 recall + 0.3 * all-severity recall +
  0.2 * finding precision`, each component in `[0, 1]`.

A finding matches gold only when its structured evidence overlaps the gold
region and its claimed defect/impact satisfies the frozen rubric. Two human
adjudicators, blinded to policy/provider, resolve semantic matches; disagreement
and resolution are reported. A newly discovered valid defect becomes a fixture
correction and invalidates that fixture's current comparison rather than being
silently scored. Report raw counts, Wilson 95% intervals for proportions, and
bootstrap intervals for cost/latency alongside point estimates. Invalid,
blocked, flaky, and retried runs are separate populations, not model failures.

Also run an end-to-end app cohort of at least 12 frozen fixtures: at least 4
clean, 6 faulty, 6 low-risk, and 6 high-risk, containing at least 10 P0/P1 gold
defects including at least 2 P0 defects. These sessions begin from workspace
selection and let the local model drive bounded acquisition before routing. At
least 11 of 12 must reach a valid grounded review; all 12 must preserve the
workspace, enforce snapshot/egress/budget boundaries, and produce complete
route/attempt/coverage telemetry. Report quality for this cohort, but do not use
it as the causal synthesis comparison.

### P1 -- fast follows

- Economy and Quality profiles after Balanced has evidence; Fast waits for
  latency data.
- Incremental re-review of only newly changed hunks.
- Exportable Markdown/JSON review artifact and a copy-ready prompt for the
  originating coding agent.
- User feedback on finding usefulness and false positives.
- More granular egress preview and per-phase budget controls.
- Provider circuit breaker based on terminal attempt history.

### P2 -- explicitly later

- Disposable-worktree edits and test execution.
- Multiple cloud providers or provider-managed fallback.
- Learned checkpoint routing.
- Parallel or adversarial reviewers.
- GitHub/PR integration.
- Research-artifact review using the same lease and attempt architecture.

## Router coordination sequence

At a routing boundary:

1. Reconstruct canonical state and confirm there is no streaming assistant,
   pending tool, open attempt, or unresolved reservation.
2. Derive boundary, phase, bounded risk signals, deadline observation, and the
   initial pure route proposal.
3. For a paid proposal, acquire bounded credential, model-health, dedicated-key
   limit, and pricing snapshots; feed those immutable snapshots back into the
   pure router/admission decision.
4. Compile the candidate provider packet in memory using
   that provider's context limit and request reserve.
5. Run egress checks over the exact rendered messages.
6. Project worst-case cost from compiled estimated input and the configured
   maximum output allowance.
7. Atomically reserve episode/campaign budget.
8. In one transaction persist the resolved decision, optional new lease,
   assistant start, context checkpoint, and attempt start with matching IDs.
9. Send the exact already-hashed messages and persisted output allowance to the
   selected provider.
10. In one transaction persist assistant completion, attempt finish, and budget
    settlement/release.
11. Process tool or completion obligations only after that transaction.
12. On a non-cancellation cloud failure, repeat once with a local fallback
    decision, newly compiled local packet, and local attempt.

Routine local tool rounds do not enter this full routing sequence. They use the
atomic retained-lease start sequence defined in P0.5 and create no decision or
route event.

## Persistence and migration

- Add new event types and optional cross-link fields; never change the meaning
  of an existing event.
- Existing v1 state defaults `routingDecisions` and `inferenceAttempts` to empty
  arrays and replays identically.
- V2 conditionally requires decision, lease, checkpoint, message, and attempt
  links.
- Add an explicit database migration ledger before the budget table. An upgrade
  test opens a database created by baseline `4233edd`, migrates it, appends a
  local event, and proves legacy replay remains equivalent.
- New binaries are backward-readable. Old binaries are not expected to read new
  v2 event types; this limitation must be logged and included in release notes.
- The cross-session budget table is operational admission state. Canonical
  session decisions and terminal costs remain represented by append-only events.
- No migration deletes or rewrites existing events, totals, proof records, or
  failed diagnostics.

## Delivery plan and dependency graph

### PR 0 -- planning and project ledger (this document)

- Persist this proposed plan.
- Add the append-only build/change log, repository agent instruction, pull
  request checklist, and contributor requirement.
- Make no runtime claim and perform no provider call.

### PR 1 -- migrations, v2 events, and attempt replay ($0)

- Database migration ledger and budget-table schema only.
- A normative ADR with strict Agentic policy v2, routing decision, attempt,
  budget, and additive cross-link schemas plus the complete event-order state
  machine.
- Reducer/state/event-store/recovery compatibility.
- A build-log validator that checks unique IDs, required fields, valid status,
  chronological append order, and, in CI, that committed history was not edited
  or deleted.
- Adversarial event-order, duplicate, mismatch, interruption, and old-database
  tests.
- App continues to create v1 local-only sessions.

### PR 2 -- provider registry and parameterized transport ($0)

- Runtime provider catalog and descriptors.
- Parameterized OpenAI-compatible provider identity, capabilities, limits, and
  accounting.
- Credential-store interface with fake/test implementation.
- No separately configured production metered/cloud provider construction.

PR 1 and PR 2 may proceed in parallel only after plan approval.

### PR 3 -- immutable change acquisition and calibration contracts ($0)

- Implement the strict `ChangeSnapshotV1`, `ReviewEvidenceSetV1`,
  `ReviewCoverageV1`, change/reference schemas, and deterministic manifest/hunk
  builder behind host-only APIs.
- Add the bounded `inspect_git_changes` gateway and adversarial Git isolation,
  drift, cancellation, rename/delete, untracked, binary, and size tests; no app
  entry point yet.
- Freeze `change-review-eval-v1`, the 12-change calibration set, the mechanical
  risk feature extractor, and threshold using the real acquisition output; keep
  the independently curated final held-out gold sealed.
- No model-facing review workflow and no provider call.

Depends on PR 1. It may proceed in parallel with PR 2 after plan approval.

### PR 4 -- pure router, budget ledger, and two-fake-provider runner ($0)

- Deterministic checkpoint router and versioned risk signals.
- Atomic micro-USD reservation/reconciliation.
- Provider registry injected into `SessionRunner`.
- Local lease retention, fake local-to-fake-cloud synthesis, denials, timeout,
  and local fallback.
- No real credential and no paid call.

Depends on PR 1 through PR 3.

### PR 5 -- local Review Current Changes app slice ($0)

- Implemented `change-review-v1` app-created local-only v2 sessions and explicit
  model-facing use of the bounded host change tool.
- Implemented canonical-event provenance, no-truncation review evidence,
  change-evidence/coverage validation, exact structured completion, freshness
  revalidation, incomplete/copy behavior, and aggregate/redacted renderer
  projection.
- Implemented standard JSON Schema request support and the opt-in,
  operator-attested zero-token-fee live vLLM schema-canary command. Its one-shot
  `RM-01 VLM` run passed on 2026-08-30 against a synthetic empty snapshot; this
  proves schema compatibility only, not a post-fix real-repository flow, final
  release-suite, review quality, or external-billing status. An endpoint that
  cannot produce accepted `ReviewResultV1` output remains unusable for review.
- Implemented the app entry point, Local-only state, disabled Hybrid disclosure,
  phase timeline, aggregate coverage, and route detail states. Paid consent and
  credential controls remain PR 6 work.
- Fake cloud exists only in tests. Production Hybrid remains visibly disabled
  with an honest “cloud setup is not available in this build” state until PR 6;
  it can never show fake output as a user review.

Depends on PR 1 through PR 4.

### PR 6 -- egress gate, Keychain, and OpenRouter canary (paid opt-in)

- Exact-message egress admission.
- Production macOS credential store and Settings flows to add, validate,
  replace, and delete the dedicated credential.
- Cloud health/preflight and one pinned OpenRouter model.
- The candidate is `deepseek/deepseek-v4-flash-0731` (DeepSeek V4 Flash),
  subject to live model/price verification rather than assumed availability.
- Verify the dedicated credential's zero opening exposure and non-resetting
  provider-side hard limit before enabling Hybrid.
- Revalidate model slug, availability, context/output limits, and pricing
  immediately before the canary.
- One explicitly authorized live run with a maximum $0.25 reservation.
- Do not start the broad campaign.

Depends on PR 1 through PR 5.

### PR 7 -- held-out evaluation and launch decision

- Execute the independently frozen set of at least 24 real change-review
  fixtures without opening its gold to the runtime or router authors.
- Local-only/cloud-synthesis-all/hybrid comparison.
- The 12-fixture end-to-end app cohort with model-driven acquisition.
- Publish failures, invalid runs, and non-claims with the metrics.
- Ship or revise the policy only after meeting the release gates below.

```text
PR 0 proposed plan/ledger -- explicit approval gate
  |-- PR 1 events/replay -----|
  |       |-- PR 3 acquisition/calibration --|
  |-- PR 2 providers -------------------------|-- PR 4 router/budget
                                                       |
                                                       +-- PR 5 review app
                                                               |
                                                               +-- PR 6 paid OpenRouter canary
                                                                       |
                                                                       +-- PR 7 evaluation
```

## Validation matrix

| Area | Required evidence |
| --- | --- |
| Legacy compatibility | Baseline event fixtures and a baseline SQLite file replay equivalently after migration |
| Event integrity | Missing, duplicate, reordered, or mismatched decision/lease/checkpoint/attempt/reservation fails closed |
| Terminal attempts | Exactly one terminal attempt for every v2 checkpoint, including error, timeout, cancellation, and recovery |
| Atomic start/finish | Crash injection at every event boundary cannot leave a committed checkpoint without its attempt or a terminal attempt without settlement |
| Safe route boundary | Route change while streaming, during an open attempt, or with a pending tool is rejected |
| Router determinism | Identical state and policy produce byte-equivalent proposals and decisions |
| Lease stability | Productive routine tool rounds create no new decision or route |
| Local policy | Local only makes zero calls to a separately configured metered/cloud provider under every trigger; the configured vLLM endpoint remains operator-attested |
| Paid attempts | Hybrid makes at most one paid attempt; only cloud failure may create one local fallback |
| Cloud tools | Cloud finalization has `allowTools: false`, no enabled tool names, and no tool definitions |
| Context identity | Admission and request use identical packet/message hashes and provider-specific limits |
| Provider snapshots | Expired/mismatched pricing, health, model, or credential-limit snapshots make zero cloud requests and replay from recorded inputs |
| Egress | Root, home path, secret, and denied-artifact cases make zero cloud requests; relative evidence passes |
| Secret isolation | Credential field and request cleared after submission; secret never returned, persisted, logged, placed in errors/events/snapshots/artifacts, or retained in renderer state |
| Credential lifecycle | Add, validate, replace, delete, validation failure, and Keychain denial are explicit; replacement/deletion invalidates Hybrid readiness |
| Budget boundaries | Exact cap succeeds; cap plus one micro-USD, $90 stop, and $100 ceiling fail |
| Concurrency | Concurrent reservations cannot oversubscribe campaign or episode balances |
| Cost settlement | Provider-reported, host-priced, definitely unsent, sent-unknown, timeout, and recovery cases settle once |
| Change tool | Staged, unstaged, rename, delete, untracked, binary, submodule, symlink, ignored, oversized, cancellation |
| Change snapshot | Index, base, tracked, or untracked drift before acceptance/display produces stale/incomplete, never a current-review claim |
| Review grounding | Every finding cites structured admitted evidence; invented, wrong-side, stale, deleted, or renamed-path references fail validation |
| Review schema | Malformed, duplicate, oversized, inconsistent, or ungrounded structured results are protocol errors and never rendered as accepted reviews |
| Clean coverage | Host-derived coverage proves every required changed file/hunk/read/test record and packet retention before accepting `no_blocking_findings` |
| UX | Empty diff, local success, cloud admit/deny/fail, cancel, restart/replay, and copy review pass Electron E2E |
| Remaining regression release gate | Re-run `pnpm check` and `pnpm test:e2e` at the final revision, plus current operator-attested live Repository Investigator v7 proof; the PR 5 schema canary passed once on a synthetic empty snapshot on 2026-08-30 and is not post-fix real-repository or release proof |
| PR 6 paid OpenRouter canary | At most two provider changes and three leases including fallback, one paid attempt, complete accounting, no endpoint/key/root leak |
| Project ledger | Unique complete entries, immutable committed history, correction entries, and concurrent-PR collision behavior pass validation |
| Artifact honesty | Model output, evaluator records, route evidence, cost provenance, failures, and limitations remain separately attributed |

## Release gates

### Routing mechanics gate

- 100% of v2 checkpoints have exactly one terminal attempt.
- Zero route churn during productive tool loops.
- Zero cloud requests on missing consent, credential, health, capability,
  egress, or budget admission.
- Zero cloud tool exposure or workspace mutations.
- No concurrent budget oversubscription in stress tests.
- Before release, Local-only deterministic, Electron, live-vLLM, and accepted
  repository-proof regressions must be green; this plan does not assert their
  current result.
- Every accepted finding validates against the unchanged change snapshot.

### Product-quality gate

On the frozen held-out set of at least 24 clean/faulty changes and at least 20
P0/P1 gold defects:

- at least 90% recall for P0/P1 defects;
- at least 75% finding precision;
- zero P0/P1 false accepts in the evaluated sample;
- hybrid weighted quality within five percentage points of
  cloud-synthesis-all;
- paid cost per successful hybrid review no more than 50% of
  cloud-synthesis-all;
- at least 50% of low-risk fixtures remain local;
- p50 end-to-end latency no more than 90 seconds and p95 no more than 180
  seconds;
- 100% of shipped findings have host-verified evidence;
- every invalid, blocked, flaky, or retried run is reported separately.
- at least 11 of 12 end-to-end app-cohort sessions produce a valid grounded
  review, with zero workspace mutations or snapshot/egress/budget violations
  and complete telemetry for all 12.
- end-to-end P0/P1 recall is at least 80%, with zero P0 false accepts.

The 24-fixture result is a launch pilot, not statistical proof of general
optimality. Raw counts and uncertainty intervals ship with every claim.

These are launch hypotheses, not current achievements. If data misses a gate,
the build log records the miss and the milestone remains unshipped or is
explicitly rescoped.

## Decisions requiring approval

Approval of this plan adopts these defaults:

1. **First product job:** Review Current Changes, not autonomous patching.
2. **Routing cadence:** start, evidence complete, and cloud failure only.
3. **Consent:** per session; Local only is always the default.
4. **Paid ceiling:** one paid attempt and a default $0.25 episode cap.
5. **Fallback:** one local synthesis attempt after a non-cancellation cloud
   failure; therefore a failed hybrid episode may contain two provider changes.
6. **Unknown sent cost:** settle the full reservation when disposition is sent
   or unknown and trustworthy usage is unavailable.
7. **Money:** integer micro-USD in new admission and attempt contracts.
8. **Provider fallback:** no provider-managed model substitution in v0.
9. **Cloud authority:** tool-free synthesis only.
10. **Privacy:** selected evidence may leave the device only after session
    consent; detected roots and secrets are denied without override.
11. **Review contract:** provider-attributed structured findings, host-rendered
    Markdown, and verified evidence for every finding.
12. **Evaluation:** a separate 12-change calibration set and at least 24
    held-out change reviews with 20 P0/P1 and 8 P2/P3 defects, plus a 12-session
    end-to-end cohort, before a quality claim; the 42-workload campaign remains
    deferred.
13. **Live provider:** use the configured OpenRouter candidate
    `deepseek/deepseek-v4-flash-0731` only after fresh availability,
    context-limit, pricing, zero-exposure, and dedicated $100 hard-limit
    verification.
14. **Authorization scope:** first approval permits only PR 1 through PR 5 and
    $0 provider spend; PR 6 requires a separately logged paid-canary approval.

## Remaining open questions

- The exact secret detector and denied-path set need an engineering/security
  spike before PR 6.
- The app now has the PR 5 Local-only review states. Detailed egress-consent,
  credential, cloud-denial, and fallback copy still needs review before PR 6.
- A native x86-64 Linux worker is still required before official bulk coding
  benchmark claims; it does not block the separately approved paid OpenRouter
  canary.
- Research-artifact review needs browser/retrieval tools and its own plan after
  this coding-focused slice.

## Progress reporting

Every PR and every meaningful experiment updates [BUILD_LOG.md](../BUILD_LOG.md)
before it is described as complete. An entry records the decision, actual
changes, tests and their exact outcomes, paid exposure, failures, limitations,
and next gate. Failed approaches and superseded decisions remain in the log;
corrections are appended instead of rewriting history.
