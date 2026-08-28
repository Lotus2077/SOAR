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
    +-- EventStore -> SQLite
    +-- session snapshots / streamed deltas -> renderer
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
   new app sessions persist `repository-investigator-v1` explicitly.
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
   completed; continuing requires a new run.

Provider-native hidden reasoning, KV caches, and session state are not shared or
persisted. A future provider switch must use an explicit handoff built from
observable state and bounded evidence. Content-addressed artifacts and validator
provenance are future packet extensions. The normative bounded-context contract
is [ADR 0001](adr/0001-context-handoff-engine-v1.md).

## Context compilation

`src/shared/context-compiler.ts` is a pure projection over reduced session state.
It preserves the objective and distinct completed user constraints, extracts
completed assistant notes and terminal tool results, retains failed tool output
as explicitly failed state without citations, keeps the latest exact duplicate,
and admits bounded excerpts using a breadth-before-depth policy. Every admitted
citation carries a bounded supporting snippet even when the main evidence body
is truncated. Citation-support pairs are stored once across admitted evidence,
with grounded-tool trust, source fidelity, packet fidelity, targeted-search
preference, and recency applied in that order; the compiler does not emit a
redundant citations array. Compaction is non-destructive and retries initial
breadth omissions to a deterministic fixed point. A read that owns a globally
preferred citation-support pair overlapping any admitted search cannot be
evicted by another search; read-only lines may yield to a complete targeted
search when required by the packet budget.

The packet copies persisted `requirements` and derives replayable `progress`,
including the successful required-tool prefix, next missing tool, verified
citation count, and whether an accepted completion check already exists. Tool
evidence separately records `packetExcerptTruncated`, the tool-reported
`sourceResultTruncated`, and `sourceResultCount`; a shortened packet excerpt is
therefore not mistaken for an incomplete source observation.

The `utf8-bytes-v1` estimate charges one token per UTF-8 byte of the canonical
rendered messages. The default configured ceiling is 16,384 tokens with a 20%
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

The public provider catalog names `SOAR_VLLM_COST_POLICY` through
`costPolicyEnv`, and runtime configuration accepts only `local_zero_cost` for
the current local adapter. This is explicit accounting provenance, not measured
infrastructure cost.

Repository text and tool output remain escaped values in the packet's untrusted
evidence section. They do not become system instructions or action authority.
The tool gateway and workspace policy remain the enforcement boundary.

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
that round. The OpenAI-compatible adapter maps the signal to
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

All tools are registered in `src/main/tools/tool-registry.ts` and executed by
`tool-gateway.ts`. The current registry is read-only:

- `list_files`: bounded directory discovery;
- `search_text`: bounded literal search with path and line evidence;
- `read_text_file`: bounded UTF-8 text reads.

The workspace policy canonicalizes roots, rejects absolute paths and traversal,
prevents symlink escapes, limits output and match counts, and observes
cancellation. New filesystem capabilities belong behind the same gateway and
need adversarial tests for boundary behavior.

## Persistence contracts

`src/shared/session-events.ts` owns event schemas. `EventStore` validates them at
the write and read boundaries, assigns a monotonic sequence per session, and
uses transactions for multi-event transitions. Reducers should derive views;
they must not mutate history or infer success from missing evidence.

Changing an existing event's meaning risks corrupting replay. Prefer adding an
optional field with a safe default, introducing a new event, or defining an
explicit migration with compatibility tests.

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

## Current and future routing

The checked-in runtime has one deterministic local route. The intended hybrid
design creates a provisional plan, keeps a provider lease across productive tool
loops, and reconsiders it only at phase, failure, budget, deadline, capability,
or health boundaries. See [ROUTING_POLICY.md](ROUTING_POLICY.md). Adding cloud
routing requires cost admission, credential isolation, provider-health evidence,
and same-harness evaluator proof; configuration alone does not enable it.
Compiling context before each stateless provider request is not a routing
decision and does not end the current lease.
