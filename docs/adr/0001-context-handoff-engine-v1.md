# ADR 0001: Token-bounded Context Packet v1

- Status: Accepted; local live-proof gate pending
- Date: 2026-08-28
- Owners: SOAR maintainers
- Scope: Provider request construction from canonical session state

## Context

SOAR persists a provider-independent, append-only session event stream and
derives session state from it. The original local runner rebuilt an OpenAI-style
conversation containing every completed message and tool result before each
inference request. The reserved final round separately flattened the full
investigation into a tool-free evidence message.

That retained replay correctness, but repeatedly resent older tool output as the
conversation grew. It is unsuitable as the handoff boundary for future routing,
especially if a later lease moves from a zero-cost local model to a paid cloud
model.

The ignored Local Repository Investigator report is a non-comparable historical
diagnostic, not a baseline and not proof that this decision has met its
acceptance gates:

| Task | Input tokens | Provider calls | Tool calls | Recorded latency | Citations |
| --- | ---: | ---: | ---: | ---: | ---: |
| Repository architecture | 327,808 | 20 | 19 | 135,763 ms | 51 |
| Session cancellation | 497,823 | 20 | 19 | 203,675 ms | 32 |
| `cancelSession` references | 108,680 | 9 | 8 | 94,934 ms | 15 |
| **Total** | **934,311** | **49** | **46** | **434,373 ms (~7m14s)** | **98** |

The report identifies its workspace as `f221798+working-tree`, has no fixture
content hash, and predates the current validator contract. It cannot support a
direct percentage-reduction claim. Citation counts are diagnostics, not quotas;
task-specific correctness and citation coverage on a pinned fixture define the
current standalone acceptance gate.

## Decision

Use `compileContextPacket` in `src/shared/context-compiler.ts` as the v1 boundary
between observable session state and provider adapters. It deterministically
compiles a bounded `ContextPacket` and renders exactly two provider messages:

1. an application-owned system prompt followed by SOAR's handoff policy; and
2. a user message containing `SOAR_CONTEXT_PACKET_V1`, a newline, and canonical
   JSON for the packet.

Compilation has `working` and `finalization` modes. Working mode allows the
active tool policy to remain in force. Finalization mode labels the same evidence
as inert and explicitly prohibits tool requests.

The compiler is a projection and admission layer. It is not a second session
store and it does not make a routing decision.

## Goals

- Bound each compiled provider request before it is sent.
- Preserve the objective, distinct completed user messages, and the most recent
  admissible completed evidence.
- Produce identical packets, messages, hashes, omissions, and truncation
  telemetry for identical observable state and compiler options.
- Deduplicate exact repeated evidence without mutating canonical history.
- Keep repository and tool content inside an explicit untrusted-data frame.
- Persist a bounded compilation manifest summarizing context admission for each
  inference checkpoint.
- Establish a provider-neutral packet that can later be evaluated for a
  local-to-cloud handoff without enabling cloud calls now.

## Non-goals

- A routing or model-selection decision after every session event.
- Cloud provider execution, credential setup, data egress, or paid tests.
- Provider-native session transfer, KV-cache transfer, hidden reasoning, or
  chain-of-thought persistence.
- A semantic-memory, embedding, or learned relevance system.
- Permissioned file edits or shell execution.
- Artifact and validator registries, phase plans, unresolved-question objects,
  or content-addressed snapshots in the v1 packet.

## Canonical-history invariant

The event stream remains the source of truth.

- `compileContextPacket` accepts a projected `SessionState`; it does not write to
  that state or to the database.
- Compaction does not update or delete messages, tool results, or events.
- SQLite append-only triggers and event replay remain authoritative.
- The packet admits only observable content. It does not include provider-native
  hidden reasoning or mutable provider session state.
- Compilation telemetry is appended separately as `context.compiled`; it is not
  evidence supplied back to the compiler.

## Implemented packet contract

The exported `ContextPacket` schema is:

```text
schema: "soar.context-packet.v1"
mode: "working" | "finalization"
objective: string
userConstraints: string[]
requirements:
  requiredSuccessfulTools: ("list_files" | "search_text" | "read_text_file")[]
  minimumVerifiedPathLineCitations: non-negative integer
progress:
  successfulToolCallCounts: {
    list_files: non-negative integer
    search_text: non-negative integer
    read_text_file: non-negative integer
  }
  successfulRequiredTools: string[]
  missingRequiredTools: string[]
  nextRequiredTool?: string
  verifiedPathLineCitationCount: non-negative integer
  remainingVerifiedPathLineCitations: non-negative integer
  readyForFinalization: boolean
  completionAccepted: boolean
policy:
  compilerVersion: "context-compiler-v1"
  systemPromptSha256: lowercase SHA-256
  maxInputTokens: positive integer
  safetyMargin: number in [0, 1)
  reservedInputTokens: non-negative integer
  estimator: "utf8-bytes-v1"
evidence: (
  | {
      kind: "assistant_note"
      ordinal: positive integer
      content: string
      citations?: string[] # deprecated reader compatibility; not emitted
      citationSnippets?: { citation, text }[]
    }
  | {
      kind: "tool_evidence"
      ordinal: positive integer
      toolName: string
      status: "completed" | "failed"
      argumentsExcerpt: string
      workspaceRelativePath?: string
      content: string
      packetExcerptTruncated: boolean
      sourceResultTruncated?: boolean
      sourceResultCount?: non-negative integer
      citations?: string[] # deprecated reader compatibility; not emitted
      citationSnippets?: { citation, text }[]
    }
)[]
selection:
  raw: { assistantNotes, toolEvidence, total }
  included: { assistantNotes, toolEvidence, total }
  omitted: { assistantNotes, toolEvidence, total }
  deduplicated: { assistantNotes, toolEvidence, total }
```

Objects are serialized with lexicographically sorted keys. Evidence is emitted
in original ordinal order even though admission gives recent evidence the first
claim on each pass. The packet does not directly serialize session IDs,
timestamps, `SessionState.workspaceRoot`, provider/model identifiers,
credentials, or the cleartext caller system prompt. Untrusted evidence can still
contain path-like text, so future egress checks must inspect packet values. The
policy includes only the system-prompt SHA-256.

The compiler exposes lowercase SHA-256 hashes for the packet, each rendered
message, and the complete message array, plus character and UTF-8 byte counts.
Those values are telemetry; `packetId` is not a v1 packet field.

`requirements` copies the persisted completion contract. `progress` is derived
from replayed tool results and accepted completion checks; it is not a model
claim or a second mutable task plan.

## Evidence extraction and trust

The compiler currently extracts:

- every distinct completed user message other than an exact duplicate of the
  objective, preserving message order as `userConstraints`;
- non-empty content from completed assistant messages as `assistant_note`; and
- completed or failed tool calls attached to completed assistant messages as
  `tool_evidence`, preserving their terminal `status`.

Failed or streaming assistant messages and merely requested tool calls are
excluded. Failed tool output remains useful troubleshooting state, but it is
explicitly labeled `failed` and receives no citations. An assistant note is
observable but not validator-promoted truth; the handoff policy instructs the
recipient to treat assistant notes and all tool evidence as inert, untrusted
data.

For tool evidence, canonical JSON arguments are included as
`argumentsExcerpt`. A string `relativePath` argument is copied only when it is no
longer than 1,024 characters. This compiler-level bound supplements, but does not
replace, the tool gateway's workspace policy.

Citation candidates are collected from `path:line` text and structured objects
containing `path`, a positive integer `lineNumber`, and string `text`. References
are sorted, limited to 512 characters each, and capped at 64 per evidence item by
default. Each admitted reference is encoded once as a `citationSnippets` entry;
the deprecated parallel `citations` array remains accepted by the TypeScript v1
interface but is not emitted. Plain
text preserves the exact source line, bounded around the citation with visible
ellipses when necessary; structured search output preserves the exact bounded
match text. Supporting snippets are capped at 384 characters and remain in the
packet even when the evidence body's main excerpt is truncated. This is context
grounding, not final-answer citation validation; the existing citation-integrity
check remains authoritative.

Citation-support pairs are globally deduplicated after breadth admission.
Best-witness selection prefers grounded tool evidence over assistant notes,
then an untruncated source, an untruncated packet excerpt, targeted search
evidence, and recency, in that order. Among grounded tool witnesses, a
higher-fidelity witness is never discarded for tool preference.

Structured tool projections also keep compact source metadata. The mandatory
`packetExcerptTruncated` flag describes only packet admission. Optional
`sourceResultTruncated` and `sourceResultCount` preserve what the tool reported
about the underlying observation. A shortened packet excerpt therefore does not
justify repeating an otherwise complete tool call.

## Exact deduplication

Deduplication is deterministic and deliberately conservative:

- Assistant notes are identical only when their full content is identical.
- Tool evidence is identical only when tool name, terminal status, canonical
  arguments, and full result content are identical.
- The latest occurrence is retained so admission reflects the newest observable
  state. Earlier exact duplicates are recorded in telemetry with their ordinal
  and the retained `duplicateOfOrdinal`.
- Results with changed arguments or content are not duplicates and remain
  separate candidates.

The v1 packet does not include source event sequences, multiple-observation
lists, artifact hashes, or validator provenance. Those require an additive
future schema rather than being inferred during compilation.

## Persisted completion and no-progress guards

`session.created` may persist `completionObligations` containing an ordered
required-tool sequence and a minimum verified `path:line` citation count. Tool
names may repeat when distinct observations are required. Sessions without this
field default to no required tools and zero citations. The reducer derives only
the successful ordered prefix; an out-of-order success does not advance the
contract.

While a required tool step is missing, `SessionRunner` supplies only that tool in
`CompleteInput.allowedToolNames` and sets `CompleteInput.requireToolCall`. The
OpenAI-compatible adapter sends only that schema with `tool_choice: "required"`;
unconstrained working requests use `"auto"`, and finalization uses `"none"`.
The same selection and choice are included in provider-overhead estimation. A
provider response with no tool call on a required round fails immediately as an
incomplete transport response, without an identical obligation retry. A model
cannot satisfy the contract by substituting another tool; a repeated name
advances only when it is the next declared step and its observation succeeds.

Every otherwise-complete no-tool candidate under an active contract passes
through citation normalization and produces a strict
`completion.obligations.checked` event. The event records the successful and
missing tool sequences, sorted unique verified citations, unresolved-citation
count, remaining rounds, and one outcome:

- `accepted` completes the session;
- `retry` keeps the candidate as an incomplete assistant message and compiles
  the next request at `obligation_retry_boundary`; or
- `exhausted` fails closed when no actionable round remains.

The final answer must write citations as one contiguous token such as
`src/main/index.ts:42`. A visually separated file and line is not a verified
citation.

Runtime no-progress detection complements packet deduplication. It requires the
same tool, the same semantic observation scope, and byte-identical successful
content. Scope preserves distinct file paths, search queries, search paths, and
list roots. For complete `search_text` and `list_files` results, scope ignores
only bounding arguments such as maximum matches, items, or depth; incomplete
results retain those bounds. A qualifying repeat is persisted as a failed result
with code `DUPLICATE_OBSERVATION`, and the next checkpoint uses
`no_progress_boundary`. After two duplicate observations, the runner disables
tools and compiles a final synthesis at `no_progress_finalization_boundary`.
This guard preserves the first successful evidence and the failed repeats in
canonical history. Forced finalization does not waive completion obligations;
an unsupported synthesis is exhausted and fails closed.

## Budget, admission, and truncation

`CompileContextOptions` supplies `maxInputTokens` and may override:

- `safetyMargin` (default `0.2`);
- `reservedInputTokens` for provider-owned request overhead (default `0`);
- `maxEvidenceCharacters` (default `8,000`); and
- `maxReferencesPerEvidence` (default `64`).

Application configuration exposes `SOAR_CONTEXT_MAX_INPUT_TOKENS` (default
`16,384`) and `SOAR_CONTEXT_SAFETY_MARGIN` (default `0.2`). The effective budget
is:

```text
maxInputTokens
  - ceil(maxInputTokens * safetyMargin)
  - reservedInputTokens
```

The `utf8-bytes-v1` estimator assigns one estimated token to each UTF-8 byte of
the canonical rendered message array. This is a provider-neutral upper bound for
byte-fallback tokenizers and prevents CJK or emoji from being undercounted. It is
deliberately more conservative than a provider tokenizer.

The runner asks the active adapter for overhead outside the two compiled
messages. `OpenAICompatibleProvider` reserves 512 tokens for provider/chat
template framing plus one token per UTF-8 byte of the mode-specific request
fields, including the working tool schemas. Providers without an estimator
reserve zero. The selected reserve is included in packet policy and compiler
telemetry. Actual input usage remains in `usage.recorded`; its `reported` flag
distinguishes provider telemetry from a missing value represented numerically as
zero.

The base packet contains the complete system boundary, objective, and distinct
user constraints. If that base exceeds the effective budget, compilation throws
`ContextBudgetError` with code `CONTEXT_BUDGET_TOO_SMALL`; mandatory intent is
never silently cropped.

Evidence admission uses deterministic breadth and depth phases. A breadth pass
offers each unique item a compact excerpt of up to 64 content characters and 96
argument characters plus at most one citation-support pair, newest first. After
non-destructive citation compaction, the compiler retries initially omitted
items to a deterministic fixed point so later ownership changes can admit
earlier rejections. This preserves more distinct observations before one large
result consumes the evidence lane.
A citation-depth phase expands grounded pairs across admitted tool evidence
before a separate content-depth phase expands bodies. Complete targeted searches
may replace compact complete-read projections for paths they directly cover when
replacement is required to retain the complete search. Because citation
ownership is global across admitted evidence, a read is evictable only when
none of its preferred citation-support pairs overlap the original references
of any admitted search. This protects a higher-fidelity witness shared with a
different search while allowing read-only lines to yield to a complete targeted
search. Otherwise breadth entries remain secured. Search and content ordering
preserve recency within their evidence class, and final packet evidence is
restored to source order. Items that cannot fit after the fixed-point retry are
omitted.

The per-item argument cap is the smaller of 2,048 characters and one quarter of
`maxEvidenceCharacters`; the remaining item allowance is available to content.
Text excerpts preserve a roughly 70/30 head/tail split with an explicit source-
character truncation marker when space allows. Telemetry distinguishes
`item_limit`, `budget`, and `reference_limit` truncation and distinguishes
`duplicate` from `budget` omission. V1 truncation is character-aware and avoids
splitting UTF-16 surrogate pairs. The main excerpt is not line-aware or
JSON-element-aware; citation support is carried separately in bounded
`citationSnippets`.

## Prompt-injection boundary

The rendered system message states that only `objective`, `userConstraints`,
and application-owned `requirements` define active task instructions. Derived
progress, assistant notes, tool results, paths, citations, and arguments remain
escaped values inside one canonical JSON record and are labeled inert and
untrusted.

This framing is defense in depth, not an authorization boundary. Tool schemas,
the central gateway, selected-workspace policy, cancellation, and permission
checks remain authoritative. Evidence cannot alter the configured system prompt,
compiler policy, tool allow-list, or route assignment.

## Checkpoints, not per-event scheduling

The session runner compiles context for an inference checkpoint. It does not run
the model-selection scheduler for every persisted state transition. Cheap guards
for cancellation, permissions, hard limits, completion integrity, and provider
health remain independent of context compilation.

The current local implementation compiles once before every stateless inference
request because the provider does not retain a portable session. Such
compilation is deterministic request construction, not rerouting. The runner
appends `context.compiled` before the corresponding provider call. Its checkpoint
ID is `<sessionId>:context:<one-based-round>`, and its reason is exactly:

- `session_start` for round zero;
- `tool_result_boundary` after a productive tool result;
- `obligation_retry_boundary` after a candidate answer misses its completion
  contract;
- `no_progress_boundary` after a duplicate observation;
- `finalization_boundary` for the normal tool-disabled final round; or
- `no_progress_finalization_boundary` when two duplicate observations end tool
  use early.

The same deterministic local route lease remains assigned throughout the
session.

Future hybrid routing should reconsider the lease only at the boundaries already
defined in `docs/ROUTING_POLICY.md`: initial assignment, phase completion,
material objective change, repeated lack of progress, validator contradiction,
capability/budget/deadline change, or provider failure/health change.

## Persisted telemetry contract

`src/shared/session-events.ts` defines the strict append-only
`context.compiled` event. Its implemented payload is:

```text
checkpointId: <sessionId>:context:<one-based-round>
compilerVersion: "context-compiler-v1"
reason: one of the six checkpoint reasons above
mode: "working" | "finalization"
providerId: non-empty string
model: non-empty string
maxTokens: positive safe integer
estimatedTokens: non-negative safe integer
estimator: "utf8-bytes-v1"
reservedInputTokens: non-negative safe integer
effectiveInputTokenBudget: non-negative safe integer
sourceMessageCount: non-negative safe integer
messageCount: non-negative safe integer
evidenceCount: non-negative safe integer
deduplicatedEvidenceCount: non-negative safe integer
omittedEvidenceCount: non-negative safe integer
packetSha256: 64 lowercase hexadecimal characters
messagesSha256: 64 lowercase hexadecimal characters
safetyMargin: finite number in [0, 1)
```

`effectiveInputTokenBudget` must equal `maxTokens` minus the ceiling of its
safety-margin share minus `reservedInputTokens`, and must be non-negative.
`estimatedTokens` cannot exceed that effective budget.

The reducer appends these payloads, together with event sequence and timestamp,
to `SessionState.contextCompilations`. Projected state written before this field
existed is read compatibly as an empty list. Terminal-state rules still apply:
context telemetry cannot be appended after completion, failure, cancellation,
or interruption. For `agentic-execution-v1`, each streaming assistant receives
exactly one checkpoint before it can complete, and the checkpoint must match the
active route and assistant provider/model.

The full compiler return value also includes in-memory omission/truncation
details, character and UTF-8 byte counts, effective budget, safety-margin tokens,
packet and message hashes, and selection counts. Those detailed arrays are not
persisted in the v1 event. Ordinary logs should not print packet contents.

## Failure behavior

- Invalid numeric options and an empty system prompt fail before compilation.
- If the safety margin plus provider reserve leaves no capacity, or mandatory
  intent cannot fit, `ContextBudgetError` prevents a provider call.
- Cancellation before inference prevents the call through the runner's existing
  abort path.
- Provider context-length errors must not be treated as successful completion or
  hidden provider-side truncation.
- Raw events remain available after any compilation or provider failure.

There is no `context.rejected` event in v1. A stable, redacted rejection schema,
tokenizer-error classification, and persisted omission detail are future work.

## Compatibility and migration

The change is additive:

1. Existing session events retain their meaning.
2. New app sessions persist `session.created.taskTrack` as
   `repository-investigator-v1`; the field remains optional so legacy history
   replays without rewriting.
3. `session.created.completionObligations` is optional; absent obligations
   replay as an empty tool sequence and zero required citations.
4. Active obligations require `session.created.executionPolicy` with schema
   `agentic-execution-v1`, fixed inference/tool-call ceilings, and enough
   capacity for the sequential tools plus final synthesis. No-obligation legacy
   sessions may omit it.
5. `context.compiled` adds a strict event and reducer projection.
6. `completion.obligations.checked` adds a strict replayable acceptance record;
   legacy sessions have no checks.
7. Legacy projected state without `contextCompilations` defaults to an empty
   list.
8. Existing databases require no destructive rewrite.
9. `buildProviderContext` and `buildFinalizationContext` remain available as
   compatibility helpers while bounded packets are verified.

Removing the legacy builders requires replay, interruption-recovery, and live
quality coverage and is not part of this decision's proof claim.

## Implemented verification scope

The unit suite is expected to cover deterministic output and non-mutation,
latest-observation exact deduplication, completed and failed tool state,
breadth-before-depth admission, excerpts and omissions, citation-support
coupling, CJK/emoji byte estimation, reserved provider overhead, hostile-text
JSON framing, fail-closed mandatory budget, hash changes, SHA-256 compatibility,
compact source metadata, ordered completion progress, strict event validation,
legacy projection defaults, and terminal-state rules. Runner integration covers
next-required-tool filtering, citation retry and acceptance, and two-strike
duplicate-observation finalization.

These tests establish contract behavior. They do not establish repository-task
quality, a comparable episode reduction, real-provider latency, or routing
optimality.

## Pending live acceptance gate

Run the three Local Repository Investigator tasks against a temporary workspace
copied from one clean, declared Git HEAD. The harness creates a deterministic
`git archive`, excludes its own evaluator source from the agent-visible copy,
and records the archive SHA-256. Evaluation reads the copied fixture, not the
developer worktree.

The task objectives disclose evaluator-owned paths, source substrings, required
relationships, and output-record shapes to the agent. The gate therefore proves
guided bounded execution, evidence verification, and accepted-answer context
retention. It does not claim blind repository discovery or benchmark answer
quality.

The evaluator does not use production `search_text` as the symbol gold oracle.
It independently scans every regular UTF-8 file in the extracted archive,
records one occurrence per matching line, fails closed on its file/byte bounds,
and records the method, scope, occurrence set, and SHA-256. This avoids a shared
search bug making both expected and observed results omit the same reference.

The 934,311-token report and the later 101,321-token failed attempt are retained
only as historical diagnostics. They lack parity with the current fixture and
validator contract, so the old 60% threshold is not part of this acceptance
gate and no before/after reduction is claimed.

All of the following are required before claiming the gate passed:

- 3/3 tasks complete with no unexpected tool error or incomplete provider
  transport finish state;
- any `DUPLICATE_OBSERVATION` events remain within the enforced two-event
  per-session bound and are reported separately from tool failures;
- the report uses the current schema version and records the persisted
  `repository-investigator-v1` task track, completion obligations, and checks;
- the candidate declares the exact clean Git HEAD, the evaluator is absent from
  the copied fixture, and the fixture archive SHA-256 is recorded;
- the configured, declared, and response-served model is `RM-01 VLM`; before
  task execution, `/v1/models` must advertise it exactly once. The report stores
  only a normalized API-base hash, bounded `id`/`owned_by`/`max_model_len`
  metadata, and the response hash—not the endpoint, key, model root, or raw
  response;
- the context policy is exactly 16,384 maximum input tokens with a 0.2 safety
  margin;
- architecture is bounded to 12 provider calls and 10 tool calls,
  cancellation to 11 and 9, and symbol references to 13 and 11; the episode is
  therefore bounded to 36 provider calls, 30 tool calls, and a derived maximum
  of 589,824 reported input tokens;
- every provider call has one `context.compiled` checkpoint and reports positive
  actual input usage no greater than 16,384 tokens;
- every usage record reports zero cost,
  `costProvenance: "local_zero_cost_policy"`, and
  `servedModel: "RM-01 VLM"`;
- architecture and cancellation each emit a strict authoritative claim
  manifest. Every claim must contain evaluator-owned relational phrases and
  distinct, completion-guard-verified citations to exact required files and
  lines containing the required source snippets;
- cancellation must perform exactly nine ordered, case-sensitive,
  file-scoped `search_text` calls, one for every evaluator evidence row with
  `query` equal to its required source substring and `relativePath` equal to its
  required path; no broad, missing, extra, reordered, or mismatched search is
  accepted;
- the symbol task emits an evaluator-owned structural call-path manifest,
  includes substantive prose outside its machine-readable records stating the
  renderer -> preload -> IPC -> `SessionRunner` -> `AbortController` ->
  provider/tool-signal relationships in evaluator-owned order, and has a
  successful complete `read_text_file` observation for every required evidence
  path containing all required snippets. After all five reads, five exact
  file-scoped searches must reproduce every non-`cancelSession` evidence
  snippet in evaluator-owned order so its exact line remains available to final
  synthesis. These gates
  prove structural evidence and ordered relationship coverage; they do not
  claim semantic grading of unrestricted prose beyond those relationships;
- the symbol task performs the required full-workspace exact search, whose tool
  result has no missing, duplicate, or extra occurrence and reports
  `truncated: false` with no unreadable or oversized source file; both that
  result and the strict final audit must reproduce the independent oracle's
  exact sorted set. The exactly-once requirement applies only to
  `SOAR_SYMBOL_AUDIT.occurrences`; prose and claim citations may repeat those
  path-and-line tokens;
- each accepted-answer provider input is selected by the unique accepted
  completion-check round and hash-bound to its persisted `context.compiled`
  checkpoint. Completed tool evidence in that exact packet must retain every
  completion-guard-verified answer citation, every evaluator-required claim
  snippet with distinct citation witnesses, and, for the symbol task, every
  independent-oracle occurrence. The report stores only bounded counts and
  hashes, not messages, packet contents, snippets, or source lines;
- route, tool, `context.compiled`, usage, and evaluator traces remain complete
  and exportable; and
- the revision-addressed schema-v5 `.accepted.json` artifact is written only
  with `passed: true` after every gate succeeds. A failed run writes a separate
  `.failed.json` diagnostic. Same-revision and ambiguous legacy artifacts are
  quarantined before preflight. Once a full revision is declared, model,
  repository, configuration, fixture, database, or provider setup failures also
  write a self-identifying preflight diagnostic.

An exact citation count or match to stale `f221798+working-tree` line numbers is
not required. If the fixture, model, limits, or evaluator changes, treat the
result as a different standalone run rather than a direct comparison.

No item in this section is passed merely because the compiler or this ADR exists.

## Future handoff extensions

The current packet is provider-neutral but is used only by the local route. A
later version may add a richer phase plan or model-suggested next action beyond
the current deterministic required-tool progress, per-evidence source sequences,
content-addressed artifacts, validator results, unresolved questions,
side-effect records, trust promotion, and richer rejection telemetry. Those
fields need an explicit schema version and replay tests; they are not implicit
v1 behavior.

A future local-to-cloud shadow check may validate a packet for secrets, absolute
paths, hidden reasoning, and unapproved artifact bodies without calling a cloud
provider. Actual cloud execution remains disabled until a separate decision
defines explicit user admission, credential isolation, data-egress disclosure,
per-task and episode cost ceilings, provider health, cancellation, and
evaluator-backed quality/cost comparisons.

## Consequences

The runtime gains a bounded and inspectable boundary between durable task state
and ephemeral provider context. Repeated evidence can be removed and large items
can be excerpted without altering history. The same packet shape can eventually
support a provider change.

The tradeoff is that one-token-per-byte estimation and recency-first exact
deduplication are deliberately simple and conservative. A bounded packet can
omit useful older evidence. Live quality and citation parity therefore remain
release gates rather than assumed consequences of a smaller prompt.
