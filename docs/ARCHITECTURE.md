# Architecture

SOAR is a local Electron application organized around one invariant: every
observable task transition is persisted before the UI treats it as state. Model
providers can change over time; the canonical event history must remain
provider-independent and replayable.

## Process boundaries

```text
React renderer
    | typed, allow-listed IPC only
Sandboxed preload bridge
    |
Electron main process
    +-- SessionRunner -> bounded context compiler -> provider adapter
    |                -> bounded tool gateway -> selected workspace
    +-- LocalChangeReviewCoordinator -> host change acquisition
    |                               -> review context compiler -> provider
    +-- EventStore -> SQLite
    +-- redacted session/review projections -> renderer
```

The renderer has no Node.js integration and cannot access credentials or the
filesystem directly. The preload exposes only the methods in
`src/shared/contracts.ts`. `src/main/ipc.ts` validates every renderer payload and
requires the user to select a canonical workspace before a session can use it.

## Session lifecycle

1. IPC validates a task and selected workspace.
2. `EventStore` creates the session and appends its objective, versioned task
   track, ordered completion obligations, and versioned inference/tool-call
   policy as canonical events in SQLite. Legacy sessions may lack a task track;
   new app sessions persist either `repository-investigator-v1` or
   `change-review-v1` explicitly. The latter always uses
   `agentic-execution-v2`, `local_only_v1`, and no egress consent.
3. `SessionRunner` persists the start and route assignment before inference.
4. Before every provider call, the runner compiles observable state into a
   token-bounded `soar.context-packet.v1` and persists `context.compiled`.
5. The provider receives exactly two context messages: application-owned system
   policy and one canonical JSON packet. Working and finalization modes apply
   different tool policies to the same packet shape. While ordered tool
   obligations remain, the adapter exposes only the next required tool and
   requires a tool call at the transport layer.
6. Tool requests pass through the central registry and workspace policy; request
   and result events are persisted around execution.
7. Usage, latency, reasoning tokens, completion state, verified citations,
   completion-obligation checks, and terminal state are appended to the same
   history.
8. Snapshots are reduced from the event stream for the renderer. Running sessions
   found after restart become terminally interrupted rather than falsely
   completed, except a persisted cancelled v2 attempt closes as cancelled;
   continuing requires a new run.

Provider-native hidden reasoning, KV caches, and session state are not shared or
persisted. A future provider switch must use an explicit handoff built from
observable state and bounded evidence. Review Current Changes already uses
content-addressed change/evidence records and canonical-event provenance, but
the general Repository Investigator packet does not. The normative bounded-
context contract is [ADR 0001](adr/0001-context-handoff-engine-v1.md).

## Local change-review lifecycle

Review Current Changes is a separate app-created v2 path, not a reinterpretation
of the v1 Repository Investigator loop. The main process fixes its policy to
`local_only_v1`, selects the one configured OpenAI-compatible provider, checks
that provider's model-list health, and persists a `session_start` decision and
local lease. The configured vLLM endpoint may be on this Mac or another
machine. For a non-loopback endpoint, project policy requires the operator to
set `SOAR_VLLM_COST_POLICY=local_zero_cost` explicitly. The UI therefore says
that evidence is sent to the configured vLLM endpoint; “local” means the
operator-attested route, not necessarily loopback execution. The attestation
declares zero per-token fees but does not independently verify external billing
or infrastructure cost.

The first provider attempt is required to propose exactly one
`inspect_git_changes` call with the fixed versioned argument. That schema is
exposed only for this review attempt; the host executes the application-owned
operation. For each admitted modified, renamed, or type-changed working file
within the frozen tool/round budget, the coordinator then requires an exact
bounded `read_text_file` call. Every assistant, inference attempt, tool request,
tool result, route, lease, and context checkpoint is persisted before the next
boundary.

Before synthesis, the host rebuilds the snapshot, evidence set, evidence
bodies, and tool provenance from matching successful canonical events. The
review compiler admits the complete retained evidence-body set or fails; it
does not silently truncate review evidence and continue with a complete claim.
The same selected provider then receives one finalization request with tools
disabled and the exact `ReviewResultV1` JSON Schema. Empty, truncated,
filtered, tool-calling, malformed, identity-mismatched, ungrounded, or
semantically inconsistent output is not accepted.

The host reacquires the change snapshot after synthesis before accepting the
result. Renderer projection later replays and re-proves the final completion
check, attempt, schema, raw-versus-attached result equality, checkpoint
identities, event provenance, derived coverage, and semantic acceptance before
performing another bounded freshness inspection. A changed snapshot or failed
reinspection withholds findings. An identity-matching review with incomplete
host coverage, or an accepted model-declared omission, remains explicitly
incomplete and visible but copying is disabled. Terminal results that cannot be
re-proved are `not_available`, not successful empty reviews.

Review session snapshots use an event-type allowlist and replace raw provider,
tool, path, endpoint, and diagnostic payloads with bounded status facts.
Streaming deltas for review sessions are replaced by redacted snapshots. The
dedicated review projection includes the accepted structured result plus an
aggregate coverage record (counts, status, changed-test count, runtime-without-
test signal, revalidation flag, and omission codes). That coverage record
excludes per-file coverage, changed paths, and snapshot/evidence IDs; the
accepted structured result may still include bounded evidence references for
its findings. The renderer snapshot also excludes raw model output and rejected
validator diagnostics.

## Context compilation

`src/shared/context-compiler.ts` is a pure projection over reduced session state.
It preserves the objective and distinct completed user constraints, extracts
completed assistant notes and terminal tool results, retains failed tool output
as explicitly failed state without citations, keeps the latest exact duplicate,
and admits bounded excerpts using a breadth-before-depth policy. Every admitted
citation carries a bounded supporting snippet even when the main evidence body
is truncated. Citation-support pairs are stored once across admitted evidence,
with grounded-tool trust, finalization-only strict repository-observation
trust, source fidelity, packet fidelity, targeted-search preference, and
recency applied in that order; the compiler does not emit a redundant citations
array. Compaction is non-destructive and retries initial breadth omissions to a
deterministic fixed point. A read that owns a globally preferred
citation-support pair overlapping any admitted or intentionally yielded search
cannot be evicted by another search; read-only lines may yield to a complete,
strictly validated targeted search when required by the packet budget.

The packet copies persisted `requirements` and derives replayable `progress`,
including the successful required-tool prefix, next missing tool, verified
citation count, and whether an accepted completion check already exists. Tool
evidence separately records `packetExcerptTruncated`, the tool-reported
`sourceResultTruncated`, and `sourceResultCount`; a shortened packet excerpt is
therefore not mistaken for an incomplete source observation.

Working packets retain full normalized tool arguments and structured
read/search projection labels for progress and duplicate-observation decisions.
Finalization packets preserve every admitted citation snippet and source field
while emptying those synthetic labels. After strict observation validation they
replace read arguments with the valid empty JSON object `{}` only when
`workspaceRelativePath` encodes the path, and
remove only that redundant path from search arguments while retaining all other
search semantics. Required string keys remain present. This projection is
applied before admission sizing; failed, malformed, argument-invalid,
unstructured, and `list_files` evidence is unchanged.
Finalization search snippets use a 32-192 character contextual lane around the
exact query, preserve longer queries in full, and mark packet shortening. The
anchored form is used only when its text-byte savings exceed the truncation
flag's JSON overhead. If an anchor is not provable, the existing snippet is
retained. Positive
read/search results with no representable citation keep their raw diagnostic
result instead of becoming empty or synthetic-only evidence.
Citation ownership uses this mode-specific emitted view, preserving a fuller
read witness over a shortened search excerpt.
Ownership does not erase provenance membership during deduplication: a complete
search keeps its local compact snippets even when an overlapping read also owns
fuller support. Later reference budgeting may still excerpt an envelope;
consumers that require complete membership must compare retained citations with
the declared result count or an independent oracle.
Under finalization citation-depth pressure, only a complete, strictly validated
positive search envelope can yield. Every citation must already have a better
owner, or a narrow equal-fidelity exception must provide a strict complete read
witness with consistent query presence; when both snippets are full and
untruncated, their text must also be equal. The simulated fitted selection must
retain every yielded citation and improve unique citation coverage; grouped
yields are revalidated against the remaining witnesses, and a final invariant
checks that no later allocation or eviction removed their support.
Reads, unmatched searches, zero-result/reference-free evidence,
source-truncated results, failures, and incomplete projections never yield.
Final reads allocate exact file-targeted and other search-observed citations
across all reads before generic context, including searches performed after the
read. Canonical events and artifacts remain the complete tool-call trace; the
bounded packet is an evidence projection and may omit a provenance envelope only
under these coverage-preserving conditions.

The `utf8-bytes-v1` estimate charges one token per UTF-8 byte of the canonical
rendered messages. The default configured ceiling is 18,432 tokens with a 20%
safety margin. The active provider adapter also reserves request overhead outside
the messages; the OpenAI-compatible adapter accounts for chat-template framing
and mode-specific fields such as tool schemas before evidence admission.

The compiler produces a working or finalization packet plus omission,
truncation, byte, estimate, and hash telemetry. The strict persisted
`context.compiled` event keeps checkpoint reason, provider/model, estimator,
provider reserve, effective budget, selection counts, and packet/message
SHA-256; the reducer exposes these manifests as
`SessionState.contextCompilations`. Compilation occurs once per stateless
provider call, but does not reconsider the local route. Checkpoint reasons are
`session_start`, `tool_result_boundary`, `obligation_retry_boundary`,
`no_progress_boundary`, `finalization_boundary`, and
`no_progress_finalization_boundary`.

`usage.recorded.reported` distinguishes actual provider token telemetry from a
missing usage report represented by zero. A qualifying live proof requires
positive reported input usage for every provider call.

Repository text and tool output remain escaped values in the packet's untrusted
evidence section. They do not become system instructions or action authority.
The tool gateway and workspace policy remain the enforcement boundary.

## Provider registry foundation

The Electron main process builds a validated runtime catalog around described
providers. A descriptor binds provider ID, locality, exact model, enabled
state, sorted capabilities, context/output/reserve limits, and explicit
accounting. The registry rejects duplicate identities, implementation/descriptor
mismatches, disabled or incapable selections, implicit zero-cost claims, and
paid pricing that is missing, future-dated, or at least 24 hours old when a
caller supplies an explicit replayable selection-time value.

The OpenAI-compatible transport derives its identity and request allowances
from that descriptor. Optional request fields are emitted only for advertised
capabilities, unsupported tool behavior fails before network I/O, and a served
model mismatch fails the attempt. Review Current Changes invokes the adapter's
configured-model health check before its provider attempt. That health admission
fails closed unless the unique selected `/models` entry supplies a positive
safe-integer `max_model_len` at least as large as the configured maximum input
plus maximum output allowances. Missing, invalid, or insufficient capacity is
unhealthy and blocks that review admission. With the current defaults, the
floor is 26,624 tokens (18,432 input + 8,192 output). The live Repository
Investigator proof separately applies the same inequality in preflight. The
adapter's generic completion method does not implicitly perform this check. An
advertised value is bounded endpoint metadata, not empirical capacity
verification or a universal provider guarantee. The adapter supports the one
exact `ReviewResultV1` JSON Schema contract only when tools are disabled and the
descriptor advertises `structured_json_schema`; arbitrary structured contracts
and prose-suffix repair are rejected. The current production catalog constructs
exactly one configured, operator-attested local provider; the deterministic
fake is test/development only. The credential-store interface currently has
only a fake implementation, so there is no separately configured production
metered provider or OpenRouter credential path. Because the local adapter takes
a generic OpenAI-compatible URL, that statement does not prove that a
misclassified configured endpoint cannot itself bill the operator.

The non-runtime provider snapshot at
`config/providers.readiness.example.json` names `SOAR_VLLM_COST_POLICY` through
`costPolicyEnv`. It documents readiness and benchmark assumptions; it is not
the runtime registry contract. Runtime configuration accepts only
`local_zero_cost` for the current local adapter. For a non-loopback endpoint,
the operator must set it explicitly after confirming that the endpoint charges
no token fee. This is operator-attested accounting provenance, not independent
billing verification or measured infrastructure cost.

## Completion integrity

A provider response is not success merely because the HTTP request succeeded.
The runner fails closed on empty, truncated, filtered, malformed, or incomplete
tool-call responses. Repository answers pass through citation normalization and
integrity checks.

An active completion contract is persisted with `session.created`: an ordered
sequence of required successful tool steps, including repeated tool names when
the task needs distinct observations, and a minimum verified `path:line`
citation count. It requires `agentic-execution-v1`, which freezes the inference
and tool-call ceilings and must contain enough rounds for each sequential tool
plus final synthesis. The runner refuses a policy that differs from its active
limits and passes only the next required tool through
`CompleteInput.allowedToolNames`, with `CompleteInput.requireToolCall` set for
that round. The caller prompt also states the one-based step ordinal and total,
so repeated tool names do not look like a restarted schedule. This is a
navigation cue, not an exact-argument contract: v1 obligations persist tool
names and citation minimums, while task-specific evaluators must still verify
planned arguments. The OpenAI-compatible adapter maps the signal to
`tool_choice: "required"`; unconstrained working rounds remain `"auto"`, and
finalization uses `"none"`. A provider that returns no tool call on a required
round fails immediately as a transport-protocol violation. A later no-tool
candidate is normalized against
successful evidence and recorded in `completion.obligations.checked` as
`accepted`, `retry`, or `exhausted`. An unmet candidate remains an incomplete
assistant message; a retry compiles a new packet at
`obligation_retry_boundary`, and only an accepted check can complete the
session.

Replay recomputes success from a complete repository observation: registered
tool name, strict executable arguments, safe request/output paths,
gateway-schema-conformant result fields, and—for search—query-consistent match
text. It does not cryptographically attest the gateway or re-read the workspace.
It also
binds every assistant ordinal to the persisted round budget. Under the versioned
policy, an assistant must match the active route, receive exactly one context
checkpoint while streaming, and cannot complete before that checkpoint.

The runner also compares successful results within the same semantic observation
scope. Different file paths, search queries, search paths, or list roots remain
distinct. For complete search and list results, only bounding arguments such as
maximum matches, items, or depth are ignored. A same-scope, byte-identical repeat
is persisted as a failed `DUPLICATE_OBSERVATION`, so it remains auditable without
being promoted as new evidence. After two such observations, tools are disabled
and the next checkpoint uses `no_progress_finalization_boundary` for a bounded
final synthesis. The normal reserved final round remains tool-free as well.
Finalization never waives active completion obligations.

## Filesystem tools

Model-visible repository tools are registered in the
`repository_agent_v1` registry in `src/main/tools/tool-registry.ts` and
executed by `tool-gateway.ts`. That registry is read-only:

- `list_files`: bounded directory discovery;
- `search_text`: bounded literal search with path and line evidence;
- `read_text_file`: bounded UTF-8 text reads.

The workspace policy canonicalizes roots, rejects absolute paths and traversal,
prevents symlink escapes, limits output and match counts, and observes
cancellation. New filesystem capabilities belong behind the same gateway and
need adversarial tests for boundary behavior.

The same module has a separate `host_change_acquisition_v1` registry for
application-owned operations. Its only member is `inspect_git_changes`.
It remains absent from the default `MODEL_TOOL_DEFINITIONS`; Repository
Investigator cannot call it. Review Current Changes has a separate explicit
model-only definition and may expose it only when the main-process coordinator
selects that exact required tool. The provider proposes the call, while the
host registry remains the execution authority. There is no general renderer
IPC that accepts arbitrary inspection arguments.

## Immutable change acquisition

`inspect_git_changes` turns the selected Git worktree's current
base-to-working state into a bounded `ChangeSnapshotV1`. It requires the
selected workspace to be the canonical worktree root and a committed `HEAD`;
an unborn repository, non-root selection, unmerged index, unsupported file
mode, or inconsistent Git view fails closed. It covers staged, unstaged,
renamed, deleted, and bounded untracked text changes. It does not change the
canonical index or working tree: discovery runs against an application-owned
temporary index copy and verifies that the real index's physical identity is
unchanged.

The snapshot binds:

- the captured base commit OID;
- a SHA-256 identity for canonical `ls-files --stage -z` records, falling back
  to the exact emitted bytes when an unsafe path cannot enter the decoded
  contract;
- `discoverySha256`, which binds hashes of the exact NUL-delimited index,
  index-visibility, porcelain-status, raw-diff, and numstat bytes plus the base
  commit, including discovery state that cannot enter the safe decoded
  manifest;
- a sorted manifest of change kind, staged/unstaged state, old and new paths,
  mode, byte size, admitted-content hash, omission codes, and bounded textual
  hunks; and
- explicit omitted-path and omitted-hunk counts.

Each hunk and the whole snapshot have SHA-256 identities over canonical,
ID-free JSON preimages. The result's side-aware evidence map is exactly derived
from those hunks. Host validation recomputes hunk and snapshot identities and
the exact evidence-map projection rather than trusting caller-supplied fields.

The acquisition is bounded to 200 changed paths, 256 KiB per admitted file
side, 4 MiB total admitted source, 200 hunks, a 192 KiB gateway result, and a
20-second overall deadline. Each Git subprocess has a 5-second deadline, 4 MiB
stdout and 64 KiB stderr limits, and cancellation terminates its POSIX process
group before a bounded kill grace. Working files are opened with no-follow
semantics and checked before, during, and after the read. The inspector captures
Git discovery twice, rechecks admitted working-file fingerprints and hashes,
and rejects observed index, metadata, or content drift.

The status, raw, and numstat parsers reconcile multiplicity-preserving nullable
old/new path identities; rename sides and duplicate records cannot collapse
into an ordinary path. Valid staged/index changes that are reversed, deleted,
or recreated in the worktree are normalized to one final base-to-working
manifest entry. Every such staged-plus-unstaged entry carries the explicit
`staged_unstaged_overlap` omission because the intermediate index body is not
part of the v1 evidence contract.

Binary, symlink, submodule, sensitive/ignored, unreadable, oversized, unsafe,
or truncated content receives an omission code rather than fabricated text. A
path with both staged and unstaged changes is also explicitly incomplete:
version 1 binds base and final-working sides, not a separately admitted index
content side. Symlinks are never followed for content. Submodule worktrees are
never entered; conservatively, any gitlink in the index marks the manifest
incomplete because nested dirtiness was not inspected. `verifyChangeSnapshot`
refuses freshness for any snapshot with an omission, then otherwise reruns
acquisition and requires the same snapshot ID. An incomplete snapshot can
support an explicit incomplete result, but cannot support an unqualified clean
conclusion.

Git runs through a fixed semantic-operation API, an absolute executable,
argument arrays, `shell: false`, and a minimal environment that does not inherit
caller Git, SSH, proxy, transport, or credential settings. Global and system
configuration, replacement objects, optional locks, prompting, pagers, lazy
fetch, external diff, text conversion, fsmonitor, hooks, submodule recursion,
and user-selected protocols are disabled. Fixed overrides require file-mode and
stat checking (`core.fileMode=true`, `core.ignoreStat=false`,
`core.trustctime=true`, and `core.checkStat=default`). Stage, visibility,
status, raw, and numstat discovery share one private `0600` temporary index in a
private `0700` directory; the copy retains the canonical index timestamp so
Git's racy-clean decision is stable without refreshing the real index. The copy
is removed after success, error, or cancellation. Split indexes and nonbaseline
assume-unchanged/skip-worktree visibility flags fail closed. Object reads are
restricted to full OIDs already observed by the runner. A partial clone with an
unavailable object therefore fails rather than fetching it. Repository diff
drivers do not create admitted hunks; the pinned host `diff` library compares
captured blobs with bounded no-follow workspace reads.

Git may still consult repository/worktree configuration while computing status
or diff. The runner rejects effective repository configuration declaring clean
or process filters and protocol overrides immediately before each such
operation. Git provides no lock spanning that preflight and the following
process, so an external actor with concurrent control of repository config can
change it between the two. SOAR serializes its own sensitive Git operations but
does not close this external configuration TOCTOU window. Until a stronger
isolation boundary exists, the selected repository must not be concurrently
hostile.

`ReviewEvidenceSetV1` binds a snapshot to retained hunk hashes, complete changed
bodies, and bounded repository observations with its own canonical SHA-256 ID.
Structured change, metadata, and repository references are admitted only after
the snapshot/evidence identities and referenced side, path, line, hunk, or
observation match. `ReviewCoverageV1` is host-derived from those verified
records plus explicit final-packet-retention and snapshot-revalidation facts.
Replay validation derives the entire coverage record again; a model-authored
or otherwise forged `complete` field cannot promote an incomplete review.
Complete-body evidence is admitted only for the required one-sided bodies of
added, deleted, or untracked files; modified, renamed, and type-changed files
require a matching full-read repository observation. Coverage and risk inspect
both old and new rename paths, including test classification.

The local review workflow now binds every admitted repository observation to a
matching successful canonical attempt, model-proposed tool request, and host
tool result. It rejects missing, duplicate, mismatched, truncated, malformed,
or unauthorized provenance before synthesis and persists the provenance hash in
the review checkpoint. The standalone schemas still do not claim that shape
validation alone proves event origin. The normative decision and trust limits
are recorded in
[ADR 0003](adr/0003-immutable-change-acquisition-v1.md).

## Persistence contracts

`src/shared/session-events.ts` owns event schemas. `EventStore` validates them at
the write and read boundaries, assigns a monotonic sequence per session, and
uses transactions for multi-event transitions. Reducers should derive views;
they must not mutate history or infer success from missing evidence.

Changing an existing event's meaning risks corrupting replay. Prefer adding an
optional field with a safe default, introducing a new event, or defining an
explicit migration with compatibility tests.

Database startup uses an append-only, checksummed migration ledger. Before an
unversioned nonempty database can be adopted, its complete normalized schema
must match the frozen `4233edd` baseline and pass integrity and foreign-key
checks. Schema version 2 adds constrained append-only budget-ledger storage.
The fake-only hybrid runner exercises atomic reservation and settlement; the
production local review path makes no metered-provider reservation and records
zero selected paid exposure under the operator's `local_zero_cost` attestation.

Strict `agentic-execution-v2`, routing-decision, and inference-attempt contracts
are additive foundations for the hybrid runner. V2 replay cross-checks route,
lease, decision, context, message, model, reservation, usage, and terminal
attempt identity; startup recovery explicitly closes each supported crash
window. Canonical state is reconstructed from append-only events before every
append rather than trusting mutable projection JSON. Repository Investigator
still creates v1 sessions, while Review Current Changes creates local-only v2
history with the same replay invariants. See
[ADR 0002](adr/0002-agentic-execution-v2-event-state-machine.md).

Projected sessions created before context telemetry existed default
`contextCompilations` to an empty list. `session.created.taskTrack` is optional
only for compatibility with legacy history. Sessions without completion
obligations default to an empty tool sequence and zero required citations and
may omit the new execution policy. Active completion obligations require the
versioned policy at the event-validation boundary; existing no-obligation rows
require no rewrite.

## Benchmark isolation

Benchmark manifests identify public source records without embedding evaluator
gold. Fixture preparation separates agent-visible inputs from private evaluator
oracles. Agent workspaces must live outside `benchmarks/cache`; hashes and pinned
revisions make result records reproducible. Official evaluators run only after
inference and generated caches and traces remain ignored by Git.

The guided Local Repository Investigator proof additionally applies
task-specific exact-call validators. Its architecture task requires one bounded
non-recursive root listing, one exact `src/main/index.ts` read, and seven ordered
file-scoped evidence searches. The artifact stays on schema v5 while this
strengthened evaluator is task-validator contract v7. The persisted model result
remains model-attributed. Additive evaluator records are explicitly host-derived
and not model-authored. Claim manifests provide IDs, summaries, and evidence
requirements; claim citations must occur both in successful parsed tool events
and in the accepted completion check. The symbol record instead originates in
the exact global-search observation and is then cross-checked with the
independent oracle; the oracle alone cannot create it.
Those harness checks do not grade general answer quality, make the runtime a
generic exact-argument scheduler, or demonstrate dynamic provider routing.

The separate `change-review-eval-v1` routing calibration is frozen from 12
real parent-to-commit changes: 3 SOAR, 6 Flask, and 3 pytest revisions. Every
record pins the public source and a complete host-acquired snapshot/index
identity. Its `host_change_snapshot_admitted_hunks_v1` source facts project
per-file additions and deletions from those exact host-admitted hunks; Git
numstat is discovery/reconciliation evidence and does not separately define
routing line counts. The mechanical `review-risk-v1` policy assigns one point
each for at least 8 changed files and at least 300 changed lines, and two points
each for crossing three code surfaces, changing runtime code without a
relevant changed test, and touching a sensitive path. Complete evidence scoring
below 3 is low risk; any incomplete acquisition is classified incomplete
instead of scored. Rename facts use both old and new paths, so moving code
across a surface boundary cannot erase the old-side runtime or sensitivity
signal.

The frozen set contains 5 low-risk and 7 high-risk changes. Its derived
attention agrees with the independent curator label on 11 of 12 changes; the
retained `cal-010-pytest-source-line-memoization` disagreement is visible
rather than tuned away. Those labels express review attention only, not defect
correctness or quality gold. Default tests verify the checked-in schemas,
hashes, arithmetic, split, disagreement, and absence of held-out identities
without network or model use. Opt-in materialization against explicit local
clones can reconstruct all 12 snapshots. The held-out fixture identities and
gold required for a quality comparison do not exist in this repository, so the
calibration proves neither routing benefit nor review quality.

## Current and future routing

The production app has two local-only paths. Repository Investigator retains
one deterministic v1 route. Review Current Changes creates a v2
`change-review-v1` session, persists its session-start decision and lease, and
retains the same configured provider through inspection, evidence reads, and
structured synthesis. Host immutable change acquisition is connected only to
that dedicated review workflow. PR 4's separate fake-only v2 coordinator still
proves future hybrid mechanics without constructing a production cloud
provider.

`checkpoint-router-v0` is a pure proposal/resolution pair. It consumes replayed
state plus explicit provider, risk, health, pricing, deadline, egress, packet,
and locked-budget facts. It reads no environment, clock, database, registry, or
network. It assigns local investigation at session start, chooses local or
fake-cloud synthesis after complete evidence, and may assign one local fallback
after an eligible cloud failure. Productive tool rounds retain the current
lease and do not call the router.

Every PR 4 decision persists a bounded immutable input snapshot. The exact
provider registration and provider-specific request reserve used to compile a
cloud packet are bound before admission; the same registration, packet hashes,
and requested output allowance are dispatched after the reservation/event
transaction commits. The append-only micro-USD ledger pessimistically reserves
the request, atomically settles it with attempt-finish events, conservatively
charges unknown dispatch, records overruns in full, and reconciles ledger rows
against canonical events at startup and before later admission. See
[ADR 0004](adr/0004-checkpoint-router-budget-runner-v0.md).

Production cloud routing still requires PR 6 credential isolation,
exact-message egress admission, live health and pricing evidence, and a
separately approved paid OpenRouter canary. PR 6 remains unapproved; the app
reports that no separate metered provider or Hybrid route is configured, and
the implemented PR 1 through PR 5 slice has selected paid exposure of `$0`
under the local endpoint attestation. The generic vLLM URL is still an operator
trust boundary; SOAR does not independently prove that it cannot bill.
Configuration alone does not enable the separately configured PR 6 cloud route.
Compiling context before each stateless provider request is not a routing
decision and does not end the current lease. The current documentation records
a passing one-shot synthetic empty-snapshot structured-output canary on
2026-08-30. That is schema-compatibility evidence only, not a post-fix real-
repository flow, complete release suite, or current Repository Investigator
live proof.
