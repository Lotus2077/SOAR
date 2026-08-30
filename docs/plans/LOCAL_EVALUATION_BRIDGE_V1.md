# Local Evaluation Bridge v1

Status: **Approved and Implemented for one $0 local-only milestone;
deterministic full/exact-commit verification and the one live proof remain
pending; not Verified or Released; PR 6 remains unapproved**

- Plan version: `local-evaluation-bridge-v1-plan-1`
- Created: 2026-08-30
- Approved: 2026-08-30 by the project owner in the project task
- Baseline revision: `1b86b696b8488a809f3ecd9c3ad2cbd4c8db2f7a`
- Approval ledger: `BL-20260830-0852-local-evaluation-bridge-approved`
- Project log: [BUILD_LOG.md](../BUILD_LOG.md)

The implementation is present, but the full deterministic release gates have
not yet passed on its exact committed revision and no nonempty live episode has
run under this plan. Those pending gates prevent both a `Verified` claim and any
`Released` claim.

## Approval boundary

This plan authorizes one zero-paid milestone. It does not authorize PR 6,
OpenRouter, Keychain access, cloud egress, a paid request, a provider fallback,
or the broader research/coding benchmark campaign.

The milestone may contact only the already configured operator-attested vLLM
route. Exactly one nonempty live review episode is authorized after the
deterministic and release gates pass on the exact clean committed revision.
The cooperative authority guard is fixed to plan ID
`local-evaluation-bridge-v1-plan-1` in OS-user-local application state on this
machine; it is not a hardened security boundary against another process running
as the same account. Once an inference attempt has request disposition `sent`
or `unknown`, that authority is consumed even if the episode fails. A crash
after the claim may conservatively consume it when the harness cannot prove
that dispatch did not occur. A further live episode requires new explicit
approval and a new committed plan authority ID, plus its build-log entry. A
model-list or other definitely pre-dispatch failure does not consume inference
authority, but it must be recorded as blocked when its run namespace has
already been reserved.

## Current truth and problem

The Electron app already creates a production `change-review-v1` session and
runs it through `SessionRunner` and the local-review coordinator. That path is
v2, uses `local_only_v1`, has no egress consent, retains one provider for the
episode, uses bounded read-only review tools, persists canonical events, and
accepts only a host-validated structured result.

The generic research/coding benchmark CLI does not execute an agent episode. It
prepares fixtures and evaluates caller-supplied submissions, and its optional
trace is also caller supplied. Therefore its result export cannot prove that
the production agent path ran. The implemented specialized
`benchmark:local-review` bridge is the narrow exception: it executes the
canonical local-only change-review coordinator for its one fixed fixture.

Earlier tracked configuration and readiness text presented proposed cloud and
campaign settings as if they were active runtime inputs. The implementation
separates that proposed, unapproved snapshot from the production inputs before
the bridge can publish a new evaluation claim.

## User promise

For one frozen, nonempty, public change, a maintainer can invoke a specialized
local command that:

1. materializes and verifies the frozen change without network access;
2. starts the exact production local-review session contract;
3. waits for the canonical terminal state;
4. validates the accepted review and route/tool/attempt invariants from the
   append-only event store; and
5. exports a no-replace, tamper-evident, privacy-safe, explicitly
   lossy evaluation record.

The command will fail closed. A completed provider response is not a passing
evaluation unless every host acceptance and trace invariant passes.

## Approved scope

- Correct active-versus-proposed environment, provider-readiness, routing, and
  benchmark documentation.
- Extract the smallest Electron-free local-review session service needed for
  IPC and the specialized command to share session construction and startup.
- Extract the duplicated v2 non-cooperative-provider abort race without
  changing timeout ownership, persistence, accounting, or v1 behavior.
- Add a specialized `tsx` local-review evaluation command. The existing
  research/coding benchmark CLI and record format remain unchanged.
- Materialize one selected frozen calibration change from explicit local Git
  objects with the existing network-disabled local shared-clone protocol. The
  command never performs a remote clone or fetch.
- Run deterministic fake-provider tests through the production runner and
  local-review coordinator.
- Export a strict safe projection derived from canonical events and a bounded
  result record under ignored `benchmarks/runs` storage.
- Run at most one authorized nonempty episode against the configured local
  vLLM after deterministic gates pass.

## Non-goals

- Arbitrary private-repository evaluation.
- Research or coding episode execution for the 42 workload manifests.
- New tools, workspace writes by the model, shell access, patching, testing,
  browser access, commits, pushes, or external messages.
- A persisted event, database, routing-policy, provider, renderer, IPC, or
  public API contract change.
- A new scheduler decision, model choice, provider switch, retry, fallback, or
  paid admission path.
- Defect gold, a quality score, held-out evaluation, or byte-deterministic model
  prose.
- Signed/notarized distribution or an OpenAI-compatible endpoint.

## Reused production contracts

The bridge must use the production implementations rather than copy their
logic:

- `loadConfig` and `createRuntimeProviderCatalog`;
- an isolated `createSoarDatabase` plus `EventStore`;
- `SessionRunner` dispatch to `runLocalChangeReviewV1`;
- the fixed `change-review-v1`, `agentic-execution-v2`, `local_only_v1`
  execution policy used by the app;
- `toChangeReviewView` for fresh, accepted review reconstruction; and
- the existing host Git acquisition, context compiler, tool gateway, structured
  schema, semantic acceptance, and snapshot revalidation.

The shared session service owns only readiness validation, fixed session
creation, and starting the supplied runner. It returns a nonblocking
`{ session, completion }` handle. IPC retains workspace authorization, projects
the initial snapshot, starts the runner, and returns without observing or
awaiting the completion handle; the command awaits that handle and then judges
only canonical replay and `toChangeReviewView`. Promise resolution alone is
never success.

## Implemented narrow execution consolidation

The implementation extracts the former duplicated v2 promise race for a
provider that ignores abort. The shared helper combines the user and timeout
signals, attaches a terminal rejection observer immediately, races a
still-pending completion against abort, snapshots partial content, classifies
user cancellation ahead of timeout while pending, and removes its listener. It
returns an already-resolved provider result unchanged; both callers retain
their existing post-resolution cancellation and timeout checks.

It does not own timers, persistence, accounting, sensitive-output rules,
streaming, response validation, or fallback. `invoked = true`, message-hash
assertions, and attempt timing boundaries remain at their current call sites.
The v1 runner is intentionally unchanged.

## Command contract

The bridge uses a separate pinned-`tsx` entry so production modules with
extensionless imports are not forced through the existing Node strip-types CLI:

```text
pnpm benchmark:local-review -- \
  --calibration-id cal-001-soar-plan-approval \
  --source-repository . \
  --run-id local-review-001 \
  --live-local-vllm
```

The command accepts only the fixed calibration ID, an explicit local source
repository, a safe run ID, and the live opt-in. It rejects provider, model,
policy, trace, submission, cloud, fallback, egress, and endpoint overrides.
`SOAR_RUN_LIVE_LOCAL_REVIEW_V1=true` and `--live-local-vllm` are both required
before provider dispatch. Release-head checks forcibly clear the environment
opt-in.

The live command also rejects parsed fake-provider mode; creates its own
temporary evaluation database rather than using `SOAR_DB_PATH`; ignores the
application test-workspace setting; and requires the parsed context, round,
tool, and output limits to equal the recorded live-proof configuration before
session creation.

Structured stdout contains only status, stable identifiers, relative artifact
names, counts, and hashes. It never contains credentials, endpoints, absolute
paths, objectives, raw source/model/tool bodies, or raw diagnostics. Exit 0 is
passing; exit 2 is a classified blocked, failed, invalid, or admission outcome;
exit 130 is cancellation; and exit 1 is invalid invocation or an unclassified
harness defect.

## Fixture and context bounds

The live fixture is `cal-001-soar-plan-approval`, a frozen real public SOAR
change with two changed files and 43 changed lines. The source repository must
already contain its pinned base and change objects. `--source-repository .` is
valid when the current directory is a clean full clone containing those objects;
no shallow or partial source may depend on lazy retrieval. Materialization uses the
existing network-disabled local shared-clone protocol, verifies the direct
parent and frozen commit metadata, applies the exact binary full-index patch to
the index, and requires the host-acquired snapshot and feature facts to match
the frozen manifest. The temporary repository has no usable remote and the
command never fetches.

The selected fixture's full files are too large for the shipping 18,432-token
input default. The live proof therefore uses a recorded bounded configuration
of 163,840 maximum input tokens, 0.2 safety margin, four inference rounds,
three tool calls, and 8,192 maximum output tokens. Preflight must prove the
endpoint-reported context capacity can contain the configured input and output
allowances. This proves the configurable production path, not the default
context configuration.

The expected successful episode has four terminal inference attempts:
inspection, two exact reads, and tool-free synthesis. It has three successful
tool calls, one provider, one lease, two routing decisions at
`session_start` and `evidence_complete`, and no provider switch, retry, or
fallback. These are pass predicates, not assumptions that may be waived.

## Evaluation record

Do not reuse the generic benchmark exporter. Local review uses a separate
strict `local-change-review-evaluation-v1` result and
`local-review-safe-v1` event projection derived from ordered canonical replay.

The safe projection allow-lists event identity and sequence; local route,
decision, attempt, checkpoint, message, and lease cross-links; provider/model
locality; tool name/status/duration; context counts and packet/message hashes;
usage, cost, latency, terminal outcome, and completion status. Unknown event
types invalidate the export.

It omits the objective, workspace root, home path, endpoint, credential,
assistant and tool bodies, arguments, results, raw errors, and diagnostics.
The accepted structured review is stored only in the bounded result record.
The record explicitly states:

- `source = canonical_event_store`;
- `projection = local-review-safe-v1`;
- `lossy = true`;
- `rawCanonicalTraceExported = false`;
- token cost is zero by `local_zero_cost_policy` operator attestation; and
- endpoint billing, infrastructure, electricity, and network cost were not
  independently measured.

Artifacts are written with restrictive permissions, scanned for configured
sensitive values, absolute source paths, URLs, and high-confidence secret
patterns, and flushed. The final directory is exclusively created and its
fixed files use no-replace publication, but the directory is not atomically
published as a unit. Readers must treat it as complete only after
`publication.complete-v1.json` is written last. Content hashes make later
mutation detectable; they do not make the files immutable. A run ID cannot be
overwritten or reused while the ignored
`benchmarks/runs/local-review-v1/.run-ledger` is preserved. A blocked outcome
after namespace reservation also consumes that run ID. The fixed live-authority
claim is stored separately in the signed-in OS account's application-state
ledger (under `Library/Application Support/soar/evaluation-ledger` on macOS), so
deleting disposable benchmark output does not restore it. Failed and blocked
records after reservation are retained; SQLite and raw events are never
exported.

For `safe_projection_failed` or `unsafe_output`, the emergency result keeps
bounded execution facts and the safe trace when each is independently
scannable. It drops either one fail-closed when retaining it cannot be proven
safe. Accepted review prose and relative evidence references remain untrusted
model output and must be inspected before sharing.

## Acceptance gates

### 1. Governance

This approved plan and its build-log entry are committed before runtime work.
PR 6 remains unapproved.

### 2. Truth correction

Tracked environment examples contain shipping runtime inputs only. Provider
readiness data labels cloud/campaign material as proposed, unapproved, and
non-runtime. Current docs distinguish fixture/evaluator utilities from an
episode runner and distinguish the v1 Repository Investigator from the v2
local-only change-review path.

### 3. Deterministic implementation

- Exact fixture materialization and snapshot identity pass offline.
- A scripted fake provider reaches the production coordinator through the
  shared session service and produces an accepted fresh review.
- Exactly four attempts and three successful tools are reconstructed.
- IPC and the command share the same session creation implementation. IPC
  returns before a blocking provider completes, the runner starts exactly once,
  and the command awaits the same completion handle but judges success only
  from canonical terminal state.
- Missing opt-ins, unknown arguments, provider overrides, fixture drift,
  incomplete acquisition, cancellation, timeout, malformed telemetry,
  sensitive echo, unknown event types, and output overlap fail closed.
- The event projection and result exporter prove allow-listing, exclusive
  no-replace file publication, refusal to overwrite while the ledger is
  preserved, tamper-evident hashes, restrictive permissions, last-written
  completion-marker publication, redaction, and cleanup. They do not claim
  atomic directory publication or immutable files.
- The shared abort helper retains the existing v1 and v2 cancellation and
  timeout contracts.
- `pnpm check:release-head` and `pnpm test:e2e` pass on the committed
  implementation revision.

### 4. One live proof

- The exact clean implementation SHA and frozen fixture identity are recorded.
- The session reaches canonical `completed`; `toChangeReviewView` reports
  `fresh_complete` with a host-accepted nonempty structured result.
- Every attempt and tool is terminal and replayable; usage is positive and
  valid; cost is exactly zero under the local operator attestation.
- One provider/model is used with no switch, metered provider, paid budget
  reservation, retry, or fallback.
- Tokens, reasoning tokens, latencies, route/attempt/tool/event counts, and
  safe artifact hashes are recorded whether the episode passes or fails.
- An invalid or failed episode is logged honestly and is not rerun under this
  approval.

### 5. Publication

The exact implementation SHA must first pass the deterministic release-head and
Electron gates before the authorized live command runs. After the one live
result is recorded, the final exact SHA must pass Linux Node 22 and macOS
Electron GitHub Actions. The milestone may then be marked `Verified`, never
`Released`.

## Explicit non-claims

This milestone does not demonstrate review quality, defect recall, precision,
false-accept rate, arbitrary-repository safety, the default context budget,
same-device execution, zero infrastructure cost, dynamic routing, cloud
readiness, quality/cost/latency advantage, execution of the 42 workload
manifests, general reliability, or release readiness. “Local only” constrains
provider selection; repository evidence can still leave this Mac when the
configured vLLM endpoint runs remotely.
