# MVP readiness

This file records the repository-level readiness contract. It deliberately does
not describe any maintainer's endpoint, credential, account balance, or local
machine configuration.

## Implemented

- macOS-first Electron shell with a sandboxed React renderer and typed preload
  bridge;
- append-only SQLite session events, restart recovery, and deterministic session
  reconstruction;
- a checksummed database migration ledger, exact frozen-baseline adoption check,
  and dormant append-only integer-micro-USD budget storage with no mutation API;
- one OpenAI-compatible local provider with streaming, cancellation, timeouts,
  token usage, and honest incomplete-response handling;
- validated provider descriptors plus a main-process runtime catalog and
  registry; the catalog currently constructs only the selected local or
  deterministic fake provider;
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
- deterministic unit, integration, and Electron end-to-end tests;
- strict additive v2 routing-decision and inference-attempt schemas, replay
  invariants, and crash-window recovery; these are foundations and the current
  app runner still emits v1 local-only sessions.

## Not implemented

- production cloud-provider execution or macOS Keychain retrieval;
- hybrid routing, provider-health leases, or learned scheduling;
- runtime emission of v2 attempt telemetry, operational budget reservation and
  settlement, or registry-driven provider switching; the dormant contracts do
  not yet produce router metrics;
- immutable change acquisition, the Review Current Changes result contract, or
  its app workflow;
- browser, shell, file-write, patch, or external-message tools;
- a signed release channel or general downgrade support for databases that
  contain v2 events;
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

The live proof runs against a temporary archive of the declared
clean HEAD with the evaluator implementation excluded and the archive SHA-256
recorded. Its agent-visible objectives deliberately disclose the required
paths, source substrings, relationships, and exact tool schedules. It is
therefore a guided execution, evidence-retention, and replay proof—not a blind
test of repository discovery skill or general answer quality. The persisted
model result remains model-attributed; additive `evaluatorRecords` are derived
by the host and explicitly marked as not model-authored.
Architecture must first perform exactly one bounded,
non-recursive root listing, one exact read of `src/main/index.ts`, and seven
ordered, case-sensitive, file-scoped evidence searches in evaluator-owned
order; missing, extra, reordered, broad, or argument-mismatched calls fail the
task. Cancellation likewise requires its nine ordered searches. The symbol task
has its own call-path manifest. Successful complete reads must cover all five
evidence files and snippets, followed by five exact file-scoped searches that refresh every
non-`cancelSession` evidence snippet in evaluator-owned order before synthesis.
Its symbol gold comes
from a separate bounded UTF-8 filesystem scanner rather than the production
search implementation; the method, scope, occurrence set, and hash are
recorded. The host derives the symbol evaluator record only from the successful
complete global-search observation, then independently cross-checks it against
the oracle; it never derives a passing record from oracle data alone. The
episode is bounded to 34 provider calls, 29 tool calls, and
557,056 reported input tokens. Each session attests the
persisted `repository-investigator-v1` track, and every provider call attests
the served model and local-zero-cost policy. Preflight hashes the normalized API
base and records only bounded `/models` metadata after requiring the configured
model to be advertised. The accepted-answer provider input is bound to the
unique accepted completion round and persisted packet/message hashes; all
verified answer citations, required claim snippets, and exact symbol-oracle
occurrences must survive in its completed tool evidence. The fully admitted
global-symbol-search envelope retains its own compact citation membership even
when an overlapping read keeps fuller support. Contract v7 identifies that
exact envelope, sorts its citations and the
independent oracle separately, and compares the exact sets rather than accepting
the union of citations from all tools. Evaluator manifests supply deterministic
claim IDs, summaries, and required evidence; the host binds those claims to
distinct citations present in both successful parsed tool observations and the
accepted completion check. This is structural evidence coverage; the model
answer is checked for completion and citation integrity, not general semantic
quality. Artifact schema v5 remains unchanged; this strengthened task evaluator
is contract v7.
The exact schedules are
task-specific guided proof checks, not a generic runtime exact-argument
scheduler or evidence of dynamic provider routing.

Only a revision-addressed `.accepted.json` report containing `passed: true` is
an accepted result. Legacy ambiguous filenames and same-revision stale reports
are quarantined before preflight. Once a full revision is declared, setup
failures write a distinct self-identifying preflight diagnostic. Attachable
reports replace repository and isolated-fixture absolute roots with stable
labels before serialization. Reports still contain objectives, model results,
and workspace-derived event/tool trace content and must be inspected before
sharing.

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
