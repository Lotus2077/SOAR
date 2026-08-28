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
    +-- SessionRunner -> provider adapter
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
2. `EventStore` creates the session and appends its objective as canonical
   events in SQLite.
3. `SessionRunner` persists the start and route assignment before inference.
4. Each provider round receives context rebuilt from observable events.
5. Tool requests pass through the central registry and workspace policy; request
   and result events are persisted around execution.
6. Usage, latency, reasoning tokens, completion state, citations, and terminal
   state are appended to the same history.
7. Snapshots are reduced from the event stream for the renderer. Running sessions
   found after restart become interrupted rather than falsely completed.

Provider-native hidden reasoning, KV caches, and session state are not shared or
persisted. A future provider switch must use an explicit handoff built from
observable events and verified artifacts.

## Completion integrity

A provider response is not success merely because the HTTP request succeeded.
The runner fails closed on empty, truncated, filtered, malformed, or incomplete
tool-call responses. Repository answers pass through citation normalization and
integrity checks. When the investigation loop ends without a usable answer, a
separate tool-free finalization request receives an evidence packet rather than
unbounded raw history.

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
