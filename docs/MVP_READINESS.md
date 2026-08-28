# MVP readiness

This file records the repository-level readiness contract. It deliberately does
not describe any maintainer's endpoint, credential, account balance, or local
machine configuration.

## Implemented

- macOS-first Electron shell with a sandboxed React renderer and typed preload
  bridge;
- append-only SQLite session events, restart recovery, and deterministic session
  reconstruction;
- one OpenAI-compatible local provider with streaming, cancellation, timeouts,
  token usage, and honest incomplete-response handling;
- bounded, read-only repository tools for listing, literal search, and text reads;
- provider-neutral, token-bounded context packets with deterministic evidence
  deduplication, breadth-first admission, explicit failed-tool state,
  compact source-result metadata, citation-support snippets, fail-closed
  mandatory intent, packet/message hashes, and persisted per-inference
  compilation telemetry;
- a persisted `repository-investigator-v1` task-track identity, ordered
  completion obligations, next-required-tool filtering, exact path-and-line
  citation validation with replayable acceptance/retry checks, and a tool-free
  finalization pass;
- duplicate-observation detection that marks repeated results failed and ends
  tool use after two no-progress observations;
- executable research and coding benchmark manifests, fixture isolation,
  preflight checks, evaluator adapters, and machine-readable result export;
- deterministic unit, integration, and Electron end-to-end tests.

## Not implemented

- production cloud-provider execution or macOS Keychain retrieval;
- hybrid routing, provider-health leases, or learned scheduling;
- one-to-one terminal telemetry for failed, cancelled, and timed-out provider
  attempts; successful calls record usage provenance, but replay does not yet
  enforce exactly one usage record per inference checkpoint, so failure-rate and
  attempt-cost metrics are not ready to drive a router;
- browser, shell, file-write, patch, or external-message tools;
- a stable public data migration policy or signed release channel;
- official bulk SWE-bench evaluation on a native x86-64 Linux worker.

## Provider contract

Development requires an OpenAI-compatible base URL ending in `/v1`. Reasoning
tokens can consume the provider's output allowance without producing visible
content, so every local request sets `reasoning_effort: "none"`; its serialized
request overhead is included in the context reserve. The runtime still records
any reported reasoning separately and rejects empty, truncated, filtered,
malformed, or tool-looping completion states rather than assuming the provider
honored that request.

The cloud benchmark design currently pins
`deepseek/deepseek-v4-flash-0731` through OpenRouter. That pin is evaluation
configuration, not an enabled application runtime. Pricing and availability are
external facts and must be revalidated before any paid campaign.

Context Packet v1 conservatively estimates one token per UTF-8 byte, reserves a
configurable safety margin, and subtracts adapter-estimated provider request
overhead before admitting evidence. `usage.recorded` remains the source for
actual provider token usage, while its `reported` flag distinguishes real
telemetry from a missing report represented by zero. The packet compiler changes
provider request construction, not route selection. The local route is still
assigned once and retained across the session.

## Live proof status

The prior Local Repository Investigator reports are diagnostics, not accepted
proof. The 934,311-token reference came from `f221798+working-tree`, did not
identify a content-hashed fixture, and predates the current claim-coverage and
exact-symbol validators. The later 101,321-token failed attempt also predates
the current schema-v5 isolated-fixture contract. Neither supports a direct 60%
before/after claim.

The pending live proof now runs against a temporary archive of the declared
clean HEAD with the evaluator implementation excluded and the archive SHA-256
recorded. Its agent-visible objectives deliberately disclose the required
paths, source substrings, and relational phrases. It is therefore a guided
execution, evidence-retention, and replay proof—not a blind test of repository
discovery skill or general answer quality.
It requires architecture and cancellation claims to state evaluator-owned
relational phrases and cite verified lines from evaluator-owned exact files and
source snippets. The symbol task has its own call-path manifest and requires
substantive prose outside the evaluator records to state, in order, the renderer
-> preload -> IPC -> `SessionRunner` -> `AbortController` -> provider/tool-signal
relationships. Successful complete reads must cover all five evidence files and
snippets, followed by five exact file-scoped searches that refresh every
non-`cancelSession` evidence snippet before synthesis. Its symbol gold comes
from a separate bounded UTF-8 filesystem scanner rather than the production
search implementation; the method, scope, occurrence set, and hash are
recorded. The final symbol audit must equal that set and report
`truncated: false`; only `SOAR_SYMBOL_AUDIT.occurrences` has an exactly-once
requirement. Provider and tool calls are bounded, each session attests the
persisted `repository-investigator-v1` track, and every provider call attests
the served model and local-zero-cost policy. Preflight hashes the normalized API
base and records only bounded `/models` metadata after requiring the configured
model to be advertised. The accepted-answer provider input is bound to the
unique accepted completion round and persisted packet/message hashes; all
verified answer citations, required claim snippets, and exact symbol-oracle
occurrences must survive in its completed tool evidence. This is structural
evidence coverage, not semantic grading of unrestricted prose beyond the
explicit relationships.

Only a revision-addressed `.accepted.json` report containing `passed: true` is
an accepted result. Legacy ambiguous filenames and same-revision stale reports
are quarantined before preflight. Once a full revision is declared, setup
failures write a distinct self-identifying preflight diagnostic. Attachable
reports replace repository and isolated-fixture absolute roots with stable
labels before serialization.

## Security boundaries

- credentials and endpoint overrides belong only in ignored machine-local
  configuration;
- raw credentials must never cross into the renderer, event log, trace export,
  test fixture, or error message;
- repository tools remain inside a user-selected canonical workspace and reject
  traversal, symlink escapes, and oversized output;
- repository content and retrieved benchmark material are untrusted input;
- destructive actions, publishing, credential access, and external side effects
  require new tools and an explicit permission design before they can ship.

## Release gate

A contribution is locally releasable when `pnpm check` and `pnpm test:e2e` pass,
the readiness validator reports no tracked secret, and the relevant opt-in live
or benchmark proof passes and is attached without committing its generated
artifacts. See
[CONTRIBUTING.md](../CONTRIBUTING.md),
[ARCHITECTURE.md](ARCHITECTURE.md), and the
[benchmark protocol](../benchmarks/README.md).
