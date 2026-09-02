# MVP readiness

This file records the repository-level readiness contract. It deliberately does
not describe any maintainer's endpoint, credential, account balance, or local
machine configuration.

Local Evaluation Bridge v1 is **Verified** but not **Released**: exact
release-head and Electron checks passed on its implementation revision, its
separately authorized nonempty live proof passed once, and the exact post-proof
revision passed Linux and macOS GitHub Actions.

PR6A Cloud Setup and Dispatch Lock was **Verified** but not **Released**. Its
historical setup-only Keychain operations are superseded by the PR6B1-B
status-only boundary. Its metadata candidate and pure egress-shadow
code do not authorize provider validation, production cloud dispatch, real
Hybrid selection, or PR6B1-C through PR6B3.

PR6B0 Hybrid Simulation is **Implemented with automated exact-SHA closure** but
not **Verified** or **Released**. Its app-visible route exists only when the main process uses fake
provider mode and explicitly enables simulation. It uses in-process Fake Local
and Fake Cloud implementations, does not read Cloud Settings or a credential,
does not contact the configured vLLM or an external provider, and records `$0`
actual external spend. Exact-head tests, all seven Electron workflows, macOS
package validation, independent final review, and exact-SHA Linux/macOS CI
passed on `9495d6bcbaa8cef5d3342e0d53ab02efe28d0002`; manual VoiceOver,
keyboard-only traversal, 200% zoom/reflow, light/dark contrast, and reduced-
motion proof remain pending.

PR6B1-B is **Implemented with automated exact-SHA closure**, not **Verified**,
**Activated**, or **Released**. It removes secret entry and mutation from the
web stack, adds a status-only locked native authority and conservative operation
journal, and leaves provider checks, real Hybrid, repository egress, and spend
locked. Deterministic, committed-head, Electron, exact-archive, canary,
independent-review, and Linux/macOS CI gates passed on
`ddd171c6092f695e64360d73e78a257ee3fb9159`. This is `$0` phase-B substrate
evidence, not signed credential-continuity or provider evidence.

## Implemented PR6R-A1 checkpoint

PR6R-A is approved only for the `$0`, loopback-development sequence. Its A1
contracts, exact public-fixture materializer, development-only Electron graph,
canary store, and OS-user-local authority ledger are present in the current
working milestone and are **Implemented** on exact revision
`4cab8a7d61ef648fdfed6b03653c5bfbe367e28d` after independent review,
committed-head proof, and Linux/macOS CI run `33603435199`. A1 is not Verified
or Released. A2 and A3 are not implemented.

A1 proof is deliberately narrow:

- the special build admits exact repository modules and bare externals, carries
  distinct artifact identities, and is rejected by the normal package policy;
  the dual-flavor command then restores a verified normal `out/`;
- the explicit `cal-007-flask-jinja-name` command reconstructs the pinned
  nine-path, 62-line fixture from already-present local Git objects with no URL
  clone, fetch, provider call, credential, or paid spend; and
- the strict contracts and append-only stores bind checkpoint, request,
  campaign, guard, slot, terminal, accounting, fallback, and projection facts
  using opaque structural hashes. Payload-contract v6 also removes the internal
  fallback child-session ID from renderer output and bounds raw replay history
  to 17 records of at most 1 MiB each. The payload ceiling is four times the
  single-result ceiling: three bounded review outputs plus one result-sized
  allowance for the versioned projection envelope. Those hashes prove host-canonical
  equality, not secrecy, authenticity outside the host boundary, model quality,
  or an external provider event.

The following limitations are part of the readiness contract:

- `pr6r-development-module-graph.json` is an unsigned deterministic declaration,
  not an artifact-byte attestation. Public identities plus copied JSON can
  counterfeit it outside the canonical build, so it is not standalone proof;
- build-proof v5 parses allowlisted TypeScript/JavaScript and applies a
  dynamic-loader/global-network AST-node denylist. It remains a conservative
  regression guard, not semantic/data-flow analysis or standalone no-egress
  proof. Exact-source review and runtime evidence remain required;
- the authority files are a cooperative same-user ratchet. Deleting only the
  ledger root is detected, but a same-user process can delete both the separate
  guard and ledger; A1 is not hardened tamper-proof storage;
- structurally completed A1 output retains `outputValidity=deferred`. Only A3
  may recompute validity from admitted evidence;
- A1 renderer-safe citations are limited to the fixture's nine changed paths.
  Unchanged tests, helpers, and other repository context require an A3
  snapshot/evidence-set-bound allowlist and a persisted-contract revision;
- the current special signature denylist includes `local_only_v1`, which A3
  will legitimately need. A3 must replace or narrowly scope that heuristic
  through the exact graph/provenance policy and regression tests; and
- A1 has no loopback transport episode, attempt/budget unit of work, app
  coordinator, interactive canary UI, configured-provider request, credential
  resolution, off-device egress, actual-cost reservation, or paid inference.

Accordingly, A1 proves no review quality, best-result regret, routing benefit,
cost saving, latency improvement, production readiness, verification, or
release. Contributor commands and cleanup boundaries are documented in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Implemented

- macOS-first Electron shell with a sandboxed React renderer and typed preload
  bridge;
- append-only SQLite session events, restart recovery, and deterministic session
  reconstruction;
- a checksummed database migration ledger, exact frozen-baseline adoption check,
  and operational append-only integer-micro-USD budget storage whose supported
  paid-attempt mutations run through the atomic unit of work;
- one OpenAI-compatible, operator-attested local provider with streaming,
  cancellation, timeouts, token usage, structured `ReviewResultV1` JSON Schema
  output, and honest incomplete-response handling. Its configured vLLM endpoint
  may run on this Mac or another machine. For a non-loopback endpoint, the
  operator must explicitly set `SOAR_VLLM_COST_POLICY=local_zero_cost` after
  confirming that the endpoint charges no token fee;
- validated provider descriptors plus a main-process runtime catalog and
  registry. Normal vLLM mode constructs exactly the configured Local provider.
  Explicit fake simulation mode constructs only the branded Fake Local and
  tool-free Fake Cloud providers; one locked real-cloud candidate remains
  separate metadata and cannot be parsed as a dispatchable provider;
- a PR6B1-B status-only Cloud Credential boundary with no renderer/preload/IPC
  secret or mutation schema, exact current-window/top-frame authority, a
  locked Objective-C++ macOS broker, noninteractive legacy attribute status,
  a non-secret SQLite operation journal with conservative restart ambiguity,
  and provider-not-run/dispatch-locked projections;
- a pure canonical-message cloud-egress shadow guard that evaluates
  host-derived provenance and returns bounded finding codes and semantic
  hashes. It performs no I/O. Normal vLLM mode retains the PR6A shadow-only
  boundary; PR6B0 binds the policy to an in-process fake invocation only;
- bounded, read-only repository tools for listing, literal search, and text reads;
- a separate host-only `inspect_git_changes` gateway that acquires deterministic
  staged, unstaged, rename, delete, and bounded untracked change manifests
  without exposing arbitrary host invocation through renderer IPC. It is absent
  from the default model tool surface and is exposed only as the one required
  inspection tool in the dedicated review coordinator;
- strict, content-addressed `ChangeSnapshotV1`, `ReviewEvidenceSetV1`, evidence
  reference, and host-derived `ReviewCoverageV1` contracts with exact identity
  revalidation and fail-closed omission/coverage semantics;
- an app-created `change-review-v1`, `agentic-execution-v2`, `local_only_v1`
  Review Current Changes path. It keeps inspection, bounded full reads, and one
  tool-free synthesis on the same selected provider and records zero selected
  metered-provider exposure under that operator attestation;
- a separate main-owned `hybrid_simulation_v1` Review Current Changes path
  available only under explicit fake simulation configuration. It consumes a
  single-use workspace-bound disclosure challenge, acquires evidence locally,
  evaluates immediate semantic egress admission, may invoke one no-tools Fake
  Cloud synthesis, and permits one eligible Fake Local continuation/fallback;
- immutable `simulation | actual | legacy_unclassified` cost scope across
  campaigns, reservations, route decisions, attempts, terminal accounting, and
  recovery. PR6B0 uses only `simulation`, labels provider-reported, host-priced,
  conservative-full-reservation, or not-settled provenance, and excludes those
  values from actual-spend projections;
- a renderer-safe Hybrid simulation picker with Local selected by default,
  challenge-bound consent and invalidation, exact fake-only result/history/copy
  markers, replay-safe phase and provider trace, simulated cap/reserved/settled
  values, `$0` actual external spend, cancellation disclosure, focus restoration,
  textual phase status, and responsive reflow assertions;
- canonical-event review provenance reconstruction, a no-truncation review
  packet, exact raw-versus-attached result verification, host semantic
  acceptance, and post-synthesis snapshot revalidation;
- a renderer-safe review projection with allow-listed/redacted session events,
  no streaming raw deltas, aggregate-only coverage metadata, freshness
  reinspection, withheld drifted/unavailable/invalid results, and visible but
  non-copyable incomplete results. The accepted structured result may still
  expose bounded evidence references for its findings;
- a frozen `change-review-eval-v1` protocol and 12 real public calibration
  changes from SOAR, Flask, and pytest, materialized through the bounded host
  acquisition path; the mechanical policy classifies 5 low risk and 7 high
  risk and retains one curator-label disagreement;
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
- 22 research and 20 coding benchmark manifests plus fixture isolation,
  preflight checks, evaluator adapters, and machine-readable result export for
  already-produced submissions. These utilities do not execute an agent episode
  or prove that a caller-supplied trace came from the production runtime;
- a separate Local Evaluation Bridge v1 command that materializes one frozen
  nonempty public SOAR change without network access, runs the same production
  local-only review coordinator used by Electron, judges canonical replay, and
  writes a privacy-safe lossy proof under a run-ID reservation. The run ID is
  non-reusable while its ignored `.run-ledger` is preserved. Its one-live-episode
  authority is fixed to the committed plan ID in OS-user-local application
  state on this machine and is independent of disposable benchmark output;
- a separate offline held-out evaluator-readiness command with policy-neutral
  runner contracts, evaluator-only 24/8/16 oracle and witness contracts,
  domain-separated salted commitments, private semantic-finding bindings,
  manifest-bound Ed25519 coordinator keys, signed judgment commitments and
  signed joint resolutions, conservative all-assigned scoring, Wilson and
  fixed-seed cost/latency intervals, dispatch/usage consistency with explicit
  unreported-attempt counts, manifest-envelope checks, explicit valid-review
  yield, and no-replace safe aggregate publication.
  External trust-anchor approval remains a future campaign gate because the
  offline caller supplies both manifest and key. Its recursive import gate
  excludes the app runtime, providers, network, dynamic loading, and
  subprocesses. Tests use generated synthetic records; no real held-out corpus,
  run, or quality result exists. Exact implementation revision
  `0819a60f22ce442b481063d8575d1533540d0f4d` passed Linux Node 22 and macOS
  Electron CI and is Verified as an offline harness, not Executed or Released;
- deterministic unit, integration, and Electron end-to-end tests;
- strict additive v2 routing-decision and inference-attempt schemas, replay
  invariants, and crash-window recovery;
- a pure checkpoint router, immutable router-input snapshots, operational
  integer-micro-USD budget ledger, atomic attempt unit of work, paged recovery,
  event/ledger reconciliation, and an explicit two-fake-provider v2 runner that
  covers admission, denial, timeout, cancellation, overrun, and one local
  fallback at zero paid cost. PR6B0 now connects those mechanics to the strict
  change-review coordinator using branded in-process fakes. Normal vLLM mode
  still constructs no separately configured metered cloud provider: Repository
  Investigator emits v1 local-only sessions and Review Current Changes emits v2
  local-only sessions.

## Not implemented

- PR6R-A2 sealed one-use loopback transport and simulation accounting, PR6R-A3
  coordinator/UI/package proof, and every later PR6R-B credential/provider or
  PR6R-C paid-provider phase;
- production cloud-provider execution, dispatch-time credential retrieval, or
  remote credential validation;
- real/production hybrid routing, production provider-health/price acquisition, or
  learned scheduling;
- any production provider switch: the review v2 path is deliberately
  same-provider and Local only in normal vLLM mode, where Hybrid is visibly
  disabled and reports that no separate metered provider is configured;
- PR6B1-C's signed A/B credential-continuity proof, PR6B1-D's real native
  re-entry and protected lease activation, PR6B2's real credential/provider/
  health/pricing validation, and PR6B3's external transport, wire-bound
  admission, real reservation, and paid canary. Phase B authorizes none of
  them;
- complete release validation or current Repository Investigator live proof;
  the one-shot synthetic empty-snapshot structured-review schema canary and
  deterministic/Electron PR 5 gates passed on 2026-08-30, but the live canary
  proves only schema compatibility—not a post-fix real-repository flow—and does
  not substitute for those broader checks;
- browser, shell, file-write, patch, or external-message tools;
- test execution, patch application, commit/push, arbitrary historical-range
  review, or unbounded/binary/submodule evidence review;
- a signed release channel or general downgrade support for databases that
  contain v2 events;
- official bulk SWE-bench evaluation on a native x86-64 Linux worker;
- held-out review-quality evidence for Local Evaluation Bridge v1; its one live
  result is a production-path wiring proof, not a defect-recall or precision
  benchmark.

## Provider contract

Development requires an OpenAI-compatible base URL ending in `/v1`. Reasoning
tokens can consume the provider's output allowance without producing visible
content, so every local request sets `reasoning_effort: "none"`; its serialized
request overhead is included in the context reserve. The runtime still records
any reported reasoning separately and rejects empty, truncated, filtered,
malformed, or tool-looping completion states rather than assuming the provider
honored that request.

The configured URL may point to a vLLM server on another machine. Review
evidence is transported to that endpoint, so the Local-only label is an
execution-policy statement, not a claim that evidence never leaves the Mac.
For a non-loopback endpoint, the operator must explicitly set
`SOAR_VLLM_COST_POLICY=local_zero_cost`; SOAR treats this as an attestation that
the endpoint charges no token fee. It does not independently identify the
service behind an arbitrary URL, inspect external billing, or measure
infrastructure cost. Review synthesis uses the exact OpenAI-compatible JSON
Schema response format with tools disabled; arbitrary structured contracts and
a free-form JSON-suffix fallback are not supported.

Locked PR6A candidate metadata records
`deepseek/deepseek-v4-flash-0731` through OpenRouter as product intent. It is not
an enabled application runtime or evidence of current availability, capability,
limits, or pricing; those external facts require fresh validation under a
separately approved PR6B2 plan.

Context Packet v1 conservatively estimates one token per UTF-8 byte, reserves a
configurable safety margin, and subtracts adapter-estimated provider request
overhead before admitting evidence. `usage.recorded` remains the source for
actual provider token usage, while its `reported` flag distinguishes real
telemetry from a missing report represented by zero. The packet compiler changes
provider request construction, not route selection. Repository Investigator
retains its single local route. In normal vLLM mode, Review Current Changes
records a v2 local lease and keeps that same selected provider through
synthesis. Explicit fake simulation mode instead uses its fixed main-owned
Fake Local/Fake Cloud catalog and simulation-only checkpoint policy; renderer
input and stored credential state cannot alter that catalog.

## Live proof status

The PR6B0 source, persistence, IPC, renderer, and deterministic-test
implementation passed its automated exact-SHA closure on corrective revision
`9495d6bcbaa8cef5d3342e0d53ab02efe28d0002`: exact-head tests, seven Electron
workflows, package validation, independent review, and GitHub Linux/macOS jobs
passed. This remains implementation evidence, not a real-provider run or a
release. Manual VoiceOver, keyboard-only traversal, 200% zoom/reflow,
light/dark contrast, and reduced-motion proof is pending. Normal vLLM mode
remains Local-only and Hybrid-locked throughout.

The PR 5 local Review Current Changes implementation has deterministic adapter,
event/replay, Git, coordinator, IPC, projection, and Electron test coverage.
The one-shot `pnpm test:live-review-schema` run passed against the configured
`RM-01 VLM` on 2026-08-30, as recorded in the build log. It proves exact-schema
compatibility on a synthetic empty snapshot, not a post-fix real-repository
flow or real-review quality. The final full-suite/release gate and current
Repository Investigator live proof remain separate. The app constructs no
separate OpenRouter or metered provider, and no such PR 5 route was selected.
The canary's `$0` cost provenance relies on the operator's configured-endpoint
attestation and is not independent billing evidence.

Local Evaluation Bridge v1 now adds deterministic production-path coverage for
the frozen two-file `cal-001-soar-plan-approval` change, including four terminal
attempts, three successful read-only tools, two routing boundaries, one retained
provider lease, exact snapshot acceptance, safe canonical projection, and
no-replace result-file publication followed by a last-written
`publication.complete-v1.json` marker. The final directory is not atomically
published and is incomplete until that marker exists. Content hashes make later
mutation detectable, not impossible. Focused deterministic tests use a scripted
local provider and do not contact an endpoint. Exact release-head and Electron
gates passed on implementation revision
`5be93c100c945cfdebb310f5e36dafa1827b9101`. The one authorized nonempty
real-vLLM episode then passed with a fresh complete host-accepted result, four
terminal inference attempts, three successful read-only tools, two routing
decisions, no provider switch, and 34 safe canonical events. Final remote CI on
the exact post-proof revision passed on Linux and macOS.

The authority ledger is a cooperative guard for processes using the same OS
account, not a hardened security boundary. A sent or disposition-unknown
attempt retains the claim, and a crash after claim may conservatively consume
it. Another live attempt requires new explicit approval and a new committed
plan authority ID. A run namespace reserved before a classified blocked outcome
also consumes that run ID while the ignored run ledger remains present.
Emergency safe-projection or unsafe-output records preserve bounded execution
and safe trace data where each is independently scannable and omit it
fail-closed otherwise. Accepted review prose and relative evidence references
remain untrusted and require inspection before sharing.

Review Current Changes invokes configured-model health admission before its
provider attempt. That admission fails closed unless the unique selected
`/models` entry supplies a positive safe-integer `max_model_len` at least as
large as the configured maximum input plus maximum output allowances. The
default floor is 26,624 tokens (18,432 input + 8,192 output). Missing, invalid,
or insufficient capacity is unhealthy for that review admission. The live
Repository Investigator proof independently applies the same inequality in
preflight. The adapter's generic completion method does not implicitly perform
this capacity check.

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
the oracle; it never derives a passing record from oracle data alone. The proof
retains the conservative `utf8-bytes-v1` estimator, a 20% safety margin, and a
per-call provider-overhead reserve within an 18,432 maximum-input-token policy.
The episode is bounded to 34 provider calls, 29 tool calls, and
626,688 reported input tokens. Each session attests the
persisted `repository-investigator-v1` track, and every provider call attests
the served model and local-zero-cost policy. Preflight hashes the normalized API
base and records only bounded `/models` metadata after requiring the configured
model to be advertised and applying the same 26,624-token minimum-capacity
check. One configured-endpoint availability response on 2026-08-30 advertised
`max_model_len` of 262,144 for `RM-01 VLM`; this was a one-time `$0` response,
not proof of universal provider support or empirically verified capacity. The
accepted-answer provider input is bound to the
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
- host change acquisition uses fixed, non-shell Git operations with an isolated
  environment, disables lazy fetch, external diff/textconv execution, hooks,
  prompts, pagers, fsmonitor, submodule recursion, and caller transport
  settings, and restricts object reads to already-observed full OIDs;
- status and diff discovery share a secure application-owned temporary index;
  the canonical index is fingerprinted and not refreshed or rewritten, while
  split indexes and assume-unchanged/skip-worktree visibility flags fail closed;
- missing partial-clone objects fail rather than fetch; symlink contents and
  submodule worktrees are not inspected, and any gitlink conservatively makes
  review coverage incomplete;
- a path changed in both the index and worktree is represented but explicitly
  incomplete—including add/delete and rename reversal states—because version 1
  does not admit a separate index-content side;
- effective repository clean/process filters and protocol overrides are
  rejected before status/diff. Git cannot atomically lock that config check to
  the following operation, so a concurrent external repository-config writer
  remains a documented TOCTOU trust limitation;
- repository content and retrieved benchmark material are untrusted input;
- Hybrid simulation authority is main-owned, fake-only, and unavailable in
  normal vLLM mode. Its challenge acknowledges simulation only, real egress
  consent remains `none`, and no Keychain or external transport is reachable
  from that path;
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

PR6B0 has not met that release gate. Automated exact-SHA closure passed, but its
manual accessibility record remains outstanding, so **Implemented** must not be
read as **Verified**, **Released**, or safe for real Hybrid dispatch.

## PR 3 through PR 5 verification boundaries

The default change-review calibration test is offline and `$0`: it validates
the checked-in strict schemas, manifest hash, risk arithmetic, 5/7 split, single
label disagreement, and structural absence of held-out identities or gold. It
does not reacquire the 12 historical revisions in ordinary CI. An opt-in local
materialization test accepts explicit SOAR, Flask, and pytest clone paths and
reconstructs all 12 changes without a provider call or implicit network fetch.
Frozen per-file additions and deletions are projected from those same acquired
snapshot hunks used by live risk; Git numstat remains a bound discovery view,
not a second routing-line-count definition.

The frozen curator labels represent review attention, not defect correctness.
No held-out quality corpus, model-facing review workflow, quality improvement,
cost saving, or latency benefit is proved by PR 3. PR 4 adds deterministic
routing and accounting mechanics only through nominally branded fake providers.
Its original fake cloud lease is not a production cloud path and was not
rendered as a user review. PR6B0 separately connects a strictly branded fake
simulation to the app without creating a real cloud route. PR 5 implements the
app-created local-only workflow,
repository-observation event provenance, no-truncation evidence packet, strict
same-provider structured result, freshness/copy rules, and renderer redaction.
It does not prove review quality or dynamic routing and is not a claim that the
final release validation or Repository Investigator live proof passed. The
local structured-schema canary did pass once on 2026-08-30, but only against a
synthetic empty snapshot; it is not post-fix real-repository or release proof.
PR6A is Verified but not Released. PR6B0 has automated exact-SHA closure but is
not Verified or Released; its Fake Cloud label never denotes an external
provider. PR6B1-B is Implemented with automated exact-SHA closure for local
`$0` phase B, not Verified, Activated, or Released. PR6B1-C signed proof,
PR6B1-D real re-entry, PR6B2, and PR6B3 remain separately gated and are required
before a real credential lease, provider validation, production cloud dispatch,
or a paid OpenRouter canary.
