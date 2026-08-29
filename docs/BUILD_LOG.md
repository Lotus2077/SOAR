# SOAR build and change log

This is the append-only project evidence ledger for crucial product,
architecture, implementation, evaluation, cost, and release decisions. It is
not a marketing changelog and it must not imply that planned work ships.

Current-state documentation lives in [README.md](../README.md) and
[MVP_READINESS.md](MVP_READINESS.md). Normative architectural decisions live in
[`docs/adr`](adr). This file preserves the chronology behind those current
documents.

## Log rules

1. After this ledger's first commit, append entries in merge chronology. Do not
   delete, reorder, or silently rewrite an earlier decision, failure, blocker,
   metric, limitation, or claim. The backfill below may be corrected only by a
   new entry after that point.
2. Correct an error by appending a `Correction` entry that cites the affected
   entry ID and explains the impact.
3. Use one of: `Proposed`, `Approved`, `In progress`, `Implemented`, `Verified`,
   `Released`, `Blocked`, `Failed`, `Superseded`, or `Reverted`. `Approved`
   authorizes scoped work but does not mean it is implemented. These words are
   not interchangeable.
4. A commit proves that code changed. A deterministic test proves its stated
   contract. A live proof proves only its stated live contract. None alone
   proves product quality, optimal routing, or user value.
5. Record negative results and invalid/blocked runs. Never convert a missing
   prerequisite into a model failure or omit a failed attempt from cost and
   reliability metrics.
6. Keep model-authored output, host/evaluator records, and human conclusions
   separately attributed.
7. Do not record credentials, raw endpoints, private user paths, personal data,
   benchmark gold, or unreviewed workspace contents. Generated traces stay
   ignored unless a separately reviewed, sanitized artifact is intentionally
   published.
8. A material implementation PR is not complete until its log entry and
   affected truth/ADR documents are updated.
9. New entries use collision-resistant IDs of the form
   `BL-YYYYMMDD-HHMM-<short-slug>` in UTC. Existing `BL-0001` through `BL-0008`
   are historical backfill IDs. A contributor rebases before merge and resolves
   a tail conflict by retaining both complete entries in merge order; an ID is
   never reused.
10. Until the planned ledger validator lands, these rules are enforced by
    review and the pull-request checklist. The validator must check structure,
    unique IDs, valid statuses, append-only history relative to the PR base, and
    correction references; its absence is a known governance limitation.

## What requires an entry

- a user-visible feature, behavior change, or milestone status change;
- a routing, provider, model, budget, cost, permission, privacy, or egress
  decision;
- a persisted event/schema, database migration, replay, recovery, or
  compatibility decision;
- a tool capability or workspace-side-effect change;
- a benchmark/evaluator methodology, fixture, threshold, or comparison change;
- an important bug, failed proof, rollback, superseded approach, or blocker;
- a release, deployment, paid experiment, or externally shared claim.

Typos, comment-only cleanup, and behavior-neutral refactors need no entry unless
they correct an earlier logged claim.

## Required entry fields

```text
### BL-YYYYMMDD-HHMM-short-slug -- YYYY-MM-DD -- Title

Status:
Scope or hypothesis:
Decisions:
Changes:
Evidence:
Failures or blockers:
Limitations and non-claims:
Paid exposure:
Next gate:
References:
```

Use an exact revision and clean/dirty state for live or release evidence. Record
test commands and exact pass/fail/blocked results. When available, record
fixture, evaluator, packet, artifact, and revision hashes; provider/model/policy
identities; projected versus provider-reported cost; tokens; latency; route
changes; and failure counts.

## Backfilled project history

These entries were reconstructed from Git history and the repository's checked
in documentation. They are intentionally high level and do not replace missing
contemporaneous notes.

### BL-0001 -- 2026-08-27 -- Project bootstrap

Status: `Implemented`

Scope or hypothesis: Establish SOAR as a macOS-first, app-first agentic task
router that can eventually assign task phases across local and cloud models.

Decisions:

- Optimize a constrained quality floor first, then paid cost, then latency.
- Keep a canonical observable session record across providers.
- Use an Electron app as the first product surface; an OpenAI-compatible API is
  a later compatibility surface.

Changes: Initial repository and product direction.

Evidence: Git commit `bd9e9cacb2229b9a4d4740e488ccfa333f574bcc`.

Failures or blockers: No routing/runtime proof existed.

Limitations and non-claims: Project creation did not prove a functioning app,
provider, tool loop, or router.

Paid exposure: No paid run recorded.

Next gate: Build a local desktop vertical slice.

References: [README.md](../README.md), [ROUTING_POLICY.md](ROUTING_POLICY.md).

### BL-0002 -- 2026-08-28 -- Local desktop vertical slice

Status: `Implemented`

Scope or hypothesis: Prove a local Electron session can stream, call bounded
tools, persist events, cancel, and recover without cloud execution.

Decisions:

- Keep filesystem capabilities behind a main-process gateway and selected
  workspace boundary.
- Use append-only SQLite events and replayed session state.
- Assign one local provider lease for the entire MVP session.

Changes: Added the Electron app, local OpenAI-compatible provider path,
persistence/recovery, tool loop, cancellation, and desktop test surface.

Evidence: Git commit `f22179852a5b26fe1e3faeebe9dd47488968c058`.

Failures or blockers: Development Electron failures required later packaging and
runtime hardening; the slice was not a routing comparison.

Limitations and non-claims: One provider, read-only tools, no paid calls, and no
evidence of optimal routing.

Paid exposure: $0 recorded.

Next gate: Add a real repository workload and executable evaluation contracts.

References: [ARCHITECTURE.md](ARCHITECTURE.md).

### BL-0003 -- 2026-08-28 -- Repository Investigator and benchmark harness

Status: `Implemented`

Scope or hypothesis: Create a useful zero-cloud-cost repository investigation
track and real, pinned research/coding workload manifests.

Decisions:

- Add bounded `list_files`, `search_text`, and `read_text_file` tools.
- Keep evaluator gold out of agent workspaces.
- Use 22 research and 20 coding workload records rather than invented prompts.

Changes: Added Repository Investigator v1, the tool registry/gateway, benchmark
manifests, fixture isolation, evaluator adapters, and result export.

Evidence: Git commit `017fecab9fc0925b2c19d40d8ae46140a0151c87`.

Failures or blockers: Official bulk SWE-bench evaluation remained blocked on a
native x86-64 Linux worker and evaluator dependencies. Early repository runs
were not clean-revision, comparable routing evidence.

Limitations and non-claims: Manifest and harness existence did not prove model
quality or dynamic routing.

Paid exposure: No paid benchmark campaign started.

Next gate: Establish an open-source baseline and harden context/replay contracts.

References: [benchmarks/README.md](../benchmarks/README.md),
[MVP_READINESS.md](MVP_READINESS.md).

### BL-0004 -- 2026-08-28 -- Open-source readiness baseline

Status: `Implemented`

Scope or hypothesis: Make the repository understandable and safe for outside
contributors before expanding the runtime.

Decisions:

- Treat generated traces, credentials, evaluator gold, and local databases as
  non-source artifacts.
- Require tests and explicit migration for persisted-contract changes.

Changes: Added contributor, security, architecture, benchmark, and third-party
documentation plus repository hygiene.

Evidence: Backfilled from Git commit
`0989811f3b0dda9f5b3d7626421ee5262db84c09`; no tagged/stable release is
claimed.

Failures or blockers: Open-source readiness did not close runtime/evaluation
gaps.

Limitations and non-claims: Documentation was a baseline, not proof that every
future contribution path was stable.

Paid exposure: $0.

Next gate: Bound provider context and preserve evidence across stateless calls.

References: [CONTRIBUTING.md](../CONTRIBUTING.md),
[SECURITY.md](../SECURITY.md).

### BL-0005 -- 2026-08-28 -- Context and handoff engine

Status: `Implemented`

Scope or hypothesis: Share a canonical provider-neutral session record while
fitting each stateless provider request inside an explicit context envelope.

Decisions:

- Compile a bounded Context Packet v1 before every provider call.
- Reserve provider-owned request overhead and use conservative UTF-8-byte token
  estimation.
- Preserve canonical history and persist packet/message hashes and telemetry.

Changes: Added token-bounded context compilation, evidence admission and
deduplication, provider-neutral handoffs, and per-round context checkpoints.

Evidence: Git commit `40d0bc7faf37991957984a4638d679bb5560110c`.

Failures or blockers: Later live proofs found completion, scheduler, and final
evidence-retention gaps that deterministic compiler tests alone had not exposed.

Limitations and non-claims: Context compilation changed provider requests, not
provider selection.

Paid exposure: $0.

Next gate: Exercise the real runner and fail closed on incomplete or unsupported
completion.

References: [ADR 0001](adr/0001-context-handoff-engine-v1.md).

### BL-0006 -- 2026-08-29 -- Guided proof hardening and failed attempts

Status: `Failed`

Scope or hypothesis: Produce a clean-revision, evidence-complete live proof for
three Repository Investigator tasks.

Decisions:

- Require scheduled tool rounds, completion-verified citations, independent
  symbol oracle comparison, and final-packet evidence retention.
- Reject incomplete, truncated, malformed, or unsupported final states.

Changes: A sequence of commits hardened repository sessions and the guided
proof: `564e309`, `ba99f28`, `d0154f9`, `33562c6`, `0db9f5e`, `aee5c17`, and
`d824526`.

Evidence: Multiple revision-addressed failed diagnostics were produced locally.
At `d824526`, route, tools, budgets, exact symbol search, and context retention
passed, but the model did not satisfy the evaluator's required prose/record
serialization.

Failures or blockers: The `d824526` proof failed. It must not be cited as an
accepted result. Repeated bugs showed that model-authored formatting was the
wrong authority for deterministic evaluator records.

Limitations and non-claims: Intermediate green unit/integration gates did not
make the failed live revisions accepted.

Paid exposure: $0; local vLLM only.

Next gate: Separate provider-attributed model output from host-derived proof
records and rerun a clean live proof.

References: [MVP_READINESS.md](MVP_READINESS.md),
[ADR 0001](adr/0001-context-handoff-engine-v1.md).

### BL-0007 -- 2026-08-29 -- Accepted Repository Investigator v7 proof

Status: `Verified`

Scope or hypothesis: Demonstrate bounded, guided local execution, evidence
verification, and accepted-answer context retention without attributing host
records to the model.

Decisions:

- Keep the persisted model result separately provider-attributed.
- Derive claim records from successful parsed tool observations intersected
  with the accepted completion's verified citations.
- Derive symbol occurrences from the exact successful global search, then
  independently cross-check the filesystem oracle.
- Publish an accepted artifact only after every gate and cleanup succeeds.

Changes: Added v7 evaluator provenance, fail-closed artifact publication, and
honest methodology/documentation; restored a general evidence synthesis
finalizer.

Evidence:

- Revision: `4233eddf64b0f8e1ee290c9b067efb1494eadbff`, clean at proof start and end.
- Deterministic suite: 228 tests passed, 2 skipped; typecheck and production
  build passed via `pnpm check`.
- Electron E2E: 2 passed via `pnpm test:e2e`.
- Live vLLM canary: 1 passed via `pnpm test:live-vllm`.
- Live Repository Investigator: 17 passed in 109.37 seconds via
  `pnpm test:live-repository`.
- Accepted episode: 3/3 tasks, 32 provider calls, 29 tool calls, 82,640 input
  tokens, 4,530 visible output tokens, zero reasoning tokens, $0 recorded cost,
  no tool errors or incomplete finishes.
- Exact symbol observation: 30/30 occurrences matched the independent oracle
  and survived the final packet.
- Local accepted artifact SHA-256:
  `694befdae9960512a104f4963efa1a6aa2c1ebd9719cf781e21864a3f4f3894c`.

Evidence provenance: Backfilled from the checked-in readiness record and the
local ignored proof artifact. The raw artifact is not published, so an outside
contributor cannot independently audit the full trace from this repository.

Failures or blockers: None for the stated guided proof. The accepted artifact is
ignored and contains workspace-derived trace content; it was not committed and
must be inspected before external sharing.

Limitations and non-claims: The proof is evaluator-guided, uses one local model,
does not grade general answer quality, and does not demonstrate cloud execution,
dynamic routing, editing, shell/browser tools, or optimality.

Paid exposure: $0; local-zero-cost policy. Infrastructure/electricity cost was
not measured.

Next gate: Plan and approve one controlled local-to-cloud lease handoff.

References: Git commit `4233edd`; [README.md](../README.md),
[MVP_READINESS.md](MVP_READINESS.md).

### BL-0008 -- 2026-08-29 -- Hybrid Lease Router v0 proposed

Status: `Proposed`

Scope or hypothesis: Deliver Review Current Changes as a read-only app workflow
with local investigation and at most one paid cloud synthesis attempt selected
at an evidence-complete checkpoint.

Decisions:

- Plan the persisted contracts, budget/egress boundary, evaluation, and PR
  sequence before runtime implementation.
- Default to Local only and require per-session Hybrid consent.
- Propose one paid attempt, a $0.25 episode cap, and one local fallback after a
  non-cancellation cloud failure.
- Require structured, evidence-validated findings, immutable change snapshots,
  a separate calibration set, and dedicated-key budget accounting.
- Limit first approval to $0 PR 1 through PR 5; require separate approval for
  the paid canary.
- Defer learned routing, autonomous patching, cloud tools, and the broad paid
  campaign.

Changes: Added plan version 2, the project ledger, contributor/agent governance,
and the pull-request checklist. Independent product and routing reviews exposed
and corrected gaps in untracked-file handling, approval semantics, credential
setup, attempt atomicity, budget scope, worktree snapshots, finding structure,
risk calibration, and evaluator definitions. No runtime behavior, provider
reachability, tool capability, or paid-call authority changed.

Evidence: Two independent read-only product/routing reviews against baseline
`4233edd` found no remaining P0/P1 plan blocker after revision. `pnpm check`
passed with readiness validation, typecheck, 228 tests passed/2 skipped, and a
production build. No live provider or paid run was made.

Failures or blockers: Explicit plan approval is required before PR 1 or PR 2.
The ledger validator is planned but not implemented. Cloud model
availability/pricing/credential-limit evidence and the secret policy require
later pre-live verification; the paid canary requires separate approval.
The first sandboxed `pnpm check` attempt was environment-invalid: loopback
listen returned `EPERM`, yielding 9 failures, 219 passes, and 2 skips. The exact
same command passed after loopback permission was granted; this is not recorded
as a product-test failure.

Limitations and non-claims: Proposed scope is not implemented, verified,
released, or evidence that hybrid routing improves quality/cost/latency.

Paid exposure: $0.

Next gate: User approval or a logged revision of the plan.

References: [Hybrid Lease Router v0 plan](plans/HYBRID_LEASE_ROUTER_V0.md).

### BL-20260829-1146-plan2-approved -- 2026-08-29 -- Plan 2 approved for $0 work

Status: `Approved`

Scope or hypothesis: Authorize the zero-paid foundation and local app sequence
in Hybrid Lease Router v0 plan 2 without authorizing the live cloud canary or
any paid provider use.

Decisions:

- Approve PR 1 through PR 5 exactly as scoped in plan 2.
- Preserve the separate approval gate for PR 6.
- Keep the paid exposure for the authorized sequence at $0.

Changes: Marked plan 2 approved for PR 1 through PR 5. No runtime, database,
event, provider, tool, renderer, credential, or routing behavior changed in this
approval checkpoint.

Evidence: The project owner explicitly wrote “Approve plan 2 for PRs 1–5 ($0
only).” in the project task on 2026-08-29. The reviewed proposed plan is Git
revision `c73af96afba0e84a8d978cc2be62f0659069037c`.

Failures or blockers: PR 6 remains blocked on a second explicit approval and its
documented provider, pricing, credential-limit, egress, and budget evidence.

Limitations and non-claims: Approval is authority to implement the scoped $0
work. It is not implementation, verification, release, provider availability,
or evidence of routing quality, cost savings, or latency improvement.

Paid exposure: $0; no provider call was made for approval.

Next gate: Implement and independently validate PR 1 and PR 2 without enabling
a production cloud provider.

References: [Hybrid Lease Router v0 plan](plans/HYBRID_LEASE_ROUTER_V0.md),
proposed-plan commit `c73af96`.

### BL-20260829-1236-pr1-replay-foundation -- 2026-08-29 -- PR 1 migration and replay foundation verified

Status: `Verified`

Scope or hypothesis: Establish additive database, event, attempt, recovery, and
project-ledger contracts that can fail closed before any hybrid runner or paid
provider exists.

Decisions:

- Keep shipping sessions on `agentic-execution-v1`; make every v2 contract
  additive and dormant until the later runner integration.
- Admit an unversioned nonempty database only when its complete normalized
  schema matches the frozen `4233edd` baseline and integrity checks pass.
- Reconstruct append authority from canonical events, persist separate rejected
  cloud-proposal evidence, require exact full-reservation accounting for
  `reserved_unknown`, and reject non-monotonic v2 timestamps.
- Treat the budget ledger as constrained storage only; expose no reservation or
  settlement API in this milestone.
- Clarify the approved plan sequencing: PR 1 persists the attempt link, while
  PR 5 must add strict `ReviewResultV1` before an accepted change review exists.

Changes: Added a checksummed append-only migration ledger, frozen legacy-schema
preflight, dormant integer-micro-USD budget tables, strict v2 routing/attempt
schemas and state machine, crash-window recovery, canonical replay-on-append,
ADR 0002, and a CI-enforced append-only build-log validator with material-change
entry requirements.

Evidence:

- Final `pnpm check`: readiness and ledger validation passed; 271 tests passed,
  2 skipped; typecheck and production Electron build passed.
- Final `pnpm test:e2e`: 2/2 desktop tests passed, covering restart restoration
  and active cancellation.
- Focused v2 replay/recovery/event-store review suite: 50/50 passed.
- Focused migration/governance suite: 12/12 passed; a concurrency stress check
  opened the same database 20 times without duplicating migrations.
- Independent event, database, integration, and truth-document reviews reported
  no remaining P0/P1 after their counterexamples were added as regressions.

Failures or blockers: Green intermediate suites initially missed cost
understatement, denied-proposal evidence, denial consent/policy parity, several
restart windows, malformed legacy-schema adoption, and direct-push ledger
enforcement. Those findings were fixed and the entire gate rerun. PR 3 change
acquisition and every runtime hybrid transition remain unimplemented.

Limitations and non-claims: This verifies persisted foundation contracts, not a
working router. The app still emits v1 local-only history. Budget mutation is
dormant; old binaries need not read v2 events; canonical replay on append is
linear in session history; exact legacy adoption intentionally rejects
semantically equivalent hand-authored schemas; repository-host branch
protection remains external configuration.

Paid exposure: $0. No remote provider or inference endpoint was called; tests
used deterministic providers, temporary loopback servers, SQLite, and Electron.

Next gate: Implement PR 3 immutable change acquisition and calibration
contracts without adding a provider call.

References: [ADR 0002](adr/0002-agentic-execution-v2-event-state-machine.md),
[Hybrid Lease Router v0 plan](plans/HYBRID_LEASE_ROUTER_V0.md),
[architecture](ARCHITECTURE.md).

### BL-20260829-1236-pr2-provider-foundation -- 2026-08-29 -- PR 2 provider foundation verified

Status: `Verified`

Scope or hypothesis: Parameterize the OpenAI-compatible transport and establish
a fail-closed provider registry without constructing a production cloud
provider or credential path.

Decisions:

- Bind provider identity, exact model, locality, enabled state, sorted
  capabilities, limits, and explicit accounting in validated descriptors.
- Check paid pricing only at selection/admission using an explicit replayable
  as-of time; parsing persisted descriptors remains timeless.
- Make transport fields capability-aware, reject unsupported tools before I/O,
  reject served-model substitution, and refuse structured-JSON advertisement
  until PR 5 implements and proves the exact response mechanism.
- Expose provider instances only through registry admission; metadata-only
  lookup cannot bypass enabled, capability, or paid-pricing checks.
- Rename the old two-provider JSON as a non-runtime readiness snapshot so it
  cannot be mistaken for the main-process runtime catalog.

Changes: Added provider descriptors, registry, local/fake runtime catalog,
main-process credential-store interface with a fake test implementation, and a
parameterized OpenAI-compatible provider. Production bootstrap now receives the
single selected local/fake described provider from the catalog. Cloud
construction and production secret retrieval do not exist.

Evidence:

- The final whole-tree `pnpm check` and `pnpm test:e2e` evidence is recorded in
  the preceding PR 1 integration entry and includes these changes.
- Provider registry/credential focused suite: 8/8 passed.
- OpenAI transport plus Repository Investigator integration: 29 passed and 1
  live-provider test skipped in the final pre-integration run.
- Readiness validation found 22 research and 20 coding workloads and no tracked
  or unignored live secret.

Failures or blockers: Independent review found that metered pricing could be
stale or future-dated, declared capabilities did not govern request fields, the
readiness JSON looked like a second runtime contract, and registry `get` exposed
an unchecked provider instance. Each issue was fixed before this entry. No
production Keychain implementation, health snapshot, or cloud provider exists.

Limitations and non-claims: The shipping runner still receives one provider and
retains one local route. This does not implement hybrid selection, cloud
quality, cost savings, latency improvement, Keychain, provider health, or
structured review output. The configured local endpoint's structured-JSON
capability remains unproven and deliberately unadvertised.

Paid exposure: $0. No vLLM or cloud inference call was made in PR 2 validation;
network-shaped tests used temporary local loopback servers only.

Next gate: PR 3 immutable change acquisition, followed by PR 4 registry-driven
fake-provider routing and operational budget admission.

References: [provider registry architecture](ARCHITECTURE.md),
[MVP readiness](MVP_READINESS.md),
[Hybrid Lease Router v0 plan](plans/HYBRID_LEASE_ROUTER_V0.md).

### BL-20260829-1505-pr3-immutable-change-acquisition -- 2026-08-29 -- PR 3 immutable change acquisition verified

Status: `Verified`

Scope or hypothesis: Establish a host-authoritative, immutable, bounded view of
the current Git change and freeze the `$0` review-risk calibration before any
model-facing review workflow or hybrid router can consume it.

Decisions:

- Keep `inspect_git_changes` in a separate host-only registry. Providers,
  renderer IPC, and the shipping session runner cannot invoke it in PR 3.
- Bind the base commit, exact Git discovery streams, manifest, admitted sides,
  hunks, omissions, evidence sets, and host-derived coverage with strict
  content identities; incomplete acquisition can support only an explicitly
  incomplete result and cannot pass freshness revalidation.
- Run stage, visibility, status, raw, and numstat discovery against one secure
  temporary index copy, preserving the canonical index and its timestamp.
  Split indexes, hidden index flags, unsafe filters/protocol overrides,
  unmerged state, drift, and inconsistent views fail closed.
- Normalize every staged-plus-unstaged reversal into one honest
  base-to-working entry with `staged_unstaged_overlap`; do not pretend the
  unrepresented intermediate index body was reviewed.
- Freeze `review-risk-v1` at the approved weights and threshold. Count changed
  lines from identity-verified admitted host hunks both live and in calibration;
  Git numstat remains discovery evidence, not a competing routing definition.
- Keep the 12 curator attention labels unchanged, including the deliberate
  `cal-010` disagreement. Regeneration may update acquisition identities but
  must not tune labels or introduce held-out gold.

Changes: Added strict `ChangeSnapshotV1`, hunk, evidence-set, evidence-reference,
and `ReviewCoverageV1` contracts; bounded Git parsers/process/content/hunk
acquisition; host-only gateway registration; verified risk extraction; frozen
calibration schemas, generator, materializer, and 12 real public changes; the
pinned `diff@9.0.0` dependency and notice; readiness/architecture/ADR truth
updates; and adversarial tests for process, filesystem, identity, projection,
and calibration boundaries.

Evidence:

- Final `pnpm check`: readiness and 12-entry ledger validation passed; 425
  tests passed, 3 skipped; typecheck and production Electron build passed.
- Final focused PR 3 suite: 12 files, 163 tests passed, 1 opt-in case skipped.
- Final full `pnpm test`: 38 files passed and 1 skipped; 425 tests passed and 3
  skipped.
- Final `pnpm typecheck` and production `pnpm build`: passed.
- Final `pnpm test:e2e`: 2/2 macOS Electron tests passed, covering restart
  restoration and active cancellation.
- `$0` opt-in materialization using explicit full-history SOAR, Flask, and
  pytest clones: 6/6 test cases passed and all 12 revisions matched parent and
  commit metadata, patch application, snapshot-hunk source facts, snapshot
  identities, risk facts, and risk results.
- Frozen calibration SHA-256:
  `fed7fe79fa14c9fdb54263af827545202191edbb366597e93f16bc6b0c69fe0c`;
  protocol SHA-256:
  `91899b2de172e1d1e23079c5b18e4cb46dc87ef211560cfd8997f8a76694a890`.
  The protocol pin matches, with 5 low-risk and 7 high-risk changes and only
  the declared `cal-010-pytest-source-line-memoization` label disagreement.
- Readiness validation found 22 research and 20 coding workloads and no tracked
  or unignored live secret. Independent final contract review reported no
  remaining P0-P2 implementation or truth-document finding.

Failures or blockers: Intermediate green tests exposed real missing cases:
Git could refresh the canonical index; an epoch-dated temporary index hid valid
changes on Apple Git; `git diff --no-refresh` is unsupported there; nullable
path sentinels, set-based reconciliation, and duplicate records could collapse
rename identities; staged add/delete/rename reversals could throw or collide;
visibility flags, restored-mtime rewrites, rename configuration, non-owner
execute bits, result-size path metadata, identity-field overhead, derived
projection bounds, safe-integer omitted counts, rename-side risk/coverage, and
forged observation/body evidence were initially under-specified. A bare-CR
fixture also proved live hunk counts (300) could flip classification relative to
Git numstat (6). Each counterexample is now a regression. The readiness scanner
initially mistook `flask-*` text for an API key and was made boundary-aware.
Initial generator IPC, loopback-test, and Electron attempts were sandbox-blocked;
authorized local reruns passed. Earlier generated calibration hashes were
superseded after the acquisition and line-source contracts stabilized.

Limitations and non-claims: PR 3 has no app action, renderer IPC, provider tool,
session workflow, `ReviewResultV1`, canonical tool-event provenance, or dynamic
router consumer. It does not prove review quality, defect recall, cost savings,
latency improvement, or routing optimality; no held-out identities or gold are
present. Split indexes remain unsupported, incomplete snapshots deliberately
cannot revalidate as complete, inspection is POSIX-only, and an external actor
that concurrently rewrites repository configuration can still exploit the
documented config-preflight TOCTOU gap. Long metadata-heavy changes may evict
trailing manifest entries and remain explicitly incomplete.

Paid exposure: $0. No vLLM or cloud inference, credential access, clone, fetch,
or other network request was made; calibration used pre-existing local Git
objects and deterministic host code only.

Next gate: PR 4's pure checkpoint router, atomic micro-USD budget ledger, and
two-fake-provider runner. Production cloud construction, real credentials, and
paid calls remain forbidden.

References: [ADR 0003](adr/0003-immutable-change-acquisition-v1.md),
[change-review calibration protocol](../benchmarks/change-review/README.md),
[architecture](ARCHITECTURE.md),
[MVP readiness](MVP_READINESS.md),
[Hybrid Lease Router v0 plan](plans/HYBRID_LEASE_ROUTER_V0.md).

### BL-20260829-1523-pr4-implementation-start -- 2026-08-29 -- PR 4 implementation architecture fixed

Status: `In progress`

Scope or hypothesis: Implement PR 4's deterministic checkpoint router,
operational append-only budget ledger, and two-fake-provider v2 runner while
preserving the shipping v1 local-only app and making no real provider call.

Decisions:

- Split routing into a pure proposal step and a pure resolution step. IDs,
  observation time, provider facts, risk facts, admission facts, and packet
  identities are explicit inputs; the router performs no I/O, clock read,
  random generation, registry lookup, database access, or inference.
- Add a distinct pricing admission result instead of misreporting stale or
  missing pricing as health or budget failure. Persist a bounded immutable
  router-input snapshot sufficient to replay why the decision was made, while
  excluding endpoints, credential values, workspace roots, and source content.
- Join paid reservation or terminal ledger rows and their canonical session
  event batches inside one outer SQLite `BEGIN IMMEDIATE` on the same database
  connection. Provider dispatch may occur only after that transaction commits.
- Calculate authoritative exposure and worst-case projection with integer
  micro-USD and `BigInt` intermediates. Exact-cap admission succeeds; one
  micro-USD over is denied. A definitely unsent request releases its
  reservation; sent or unknown requests without trustworthy cost consume the
  full reservation; a trustworthy overrun is recorded rather than clamped.
- Inject the provider registry into `SessionRunner`, but isolate v2 coordination
  from the existing v1 loop. Production continues to construct one local
  provider and IPC continues to create v1 sessions; metered cloud providers
  exist only as deterministic test doubles in PR 4.
- Require a full persisted per-attempt timeout window to remain before starting
  a local fallback. A cloud cancellation, interruption, successful result,
  local failure, or second failure never creates another fallback.

Changes: Three parallel implementation lanes began after independent read-only
preflight: pure routing/risk adaptation, budget/atomic unit of work, and v2
runner/provider integration. This entry records the fixed integration contract;
it does not claim that any lane is complete.

Evidence: Three independent source-level preflight passes agreed on the same
transaction boundary, v1/v2 split, PR 3 risk adapter, exact-message dispatch,
and fake-only test boundary. The checkout started clean at
`4d21595df70697dd2c96f191c44d3114e5115b4f` with GitHub Actions run
`33259524881` green for the preceding PR 3 revision.

Failures or blockers: Existing PR 1 contracts had no explicit pricing admission
dimension or embedded immutable router inputs; `EventStore` and recovery had no
ledger-aware unit of work; the provider request did not carry the persisted
output allowance; and generic provider errors did not prove request
disposition. These are active PR 4 implementation gaps, not completed fixes.

Limitations and non-claims: No working hybrid runner, budget reservation,
dynamic routing result, quality comparison, cost saving, latency improvement,
production cloud provider, credential path, egress gate, or Review Current
Changes app flow is claimed by this entry. The implementation is dirty and
unverified while the three lanes are in progress.

Paid exposure: $0. Preflight read source and ran no provider, endpoint, network,
or credential operation. PR 4 validation is restricted to deterministic local
test doubles.

Next gate: Integrate the three lanes, run adversarial router/ledger/recovery and
fake-provider tests, independently audit the result, update ADR/current-state
documentation, then append a separate verified or failed entry.

References: [Hybrid Lease Router v0 plan](plans/HYBRID_LEASE_ROUTER_V0.md),
[ADR 0002](adr/0002-agentic-execution-v2-event-state-machine.md),
[ADR 0003](adr/0003-immutable-change-acquisition-v1.md).

### BL-20260829-1620-pr4-fake-hybrid-mechanics -- 2026-08-29 -- PR 4 fake-only hybrid mechanics verified

Status: `Verified`

Scope or hypothesis: Prove the deterministic routing, provider-binding,
deadline, and atomic accounting mechanics for one local investigation, one
optional fake-cloud synthesis, and one eligible local fallback without enabling
a production cloud provider or making a paid call.

Decisions:

- Run the pure router only at `session_start`, `evidence_complete`, and
  `provider_failure`; productive tool rounds retain their lease.
- Require a successful local investigation and completed successful evidence
  before `evidence_complete`, and persist the exact applicable provider, risk,
  health, pricing, deadline, packet, and locked-budget inputs.
- Bind every current-write router snapshot's `asOf` to the atomic event-batch
  timestamp. Bind the exact admitted provider registration and its
  provider-specific request reserve before compilation, then dispatch that same
  registration and packet only after commit.
- Reserve and settle integer micro-USD in the same `BEGIN IMMEDIATE` units as
  their canonical attempt events. Reconcile ledger rows against canonical
  route/attempt history after paged startup recovery and before later paid
  admission.
- Treat paid overrun as authoritative ahead of late cancellation, conservatively
  charge sent/unknown requests, use locked pricing rather than mutable runtime
  state, and make the user-owned controller—not an adapter's generic abort
  label—the source of cancellation intent.
- Keep production IPC on v1 and production provider construction local-only.
  PR 4's v2 path requires nominally branded deterministic fake providers.

Changes: Added `checkpoint-router-v0`, the PR 3 risk adapter, immutable router
input snapshots, operational budget ledger and reconciliation, atomic attempt
unit of work, paged ledger-aware recovery, provider-registry-driven fake-only v2
coordination, exact per-attempt output limits and request reserves, fake-provider
fixtures, ADR 0004, and adversarial unit/integration coverage. Provider dispatch
is bounded by the persisted episode deadline even when an asynchronous provider
ignores abort.

Evidence:

- Implementation commit
  `8c37f9ab5f99969ad514c3da5307a87ed0fc9dc4`; the worktree was clean immediately
  after that commit and before this append-only verification entry.
- Final `pnpm check`: readiness and 13-entry build-log validation passed;
  typecheck passed; 44 test files passed and 1 opt-in file skipped, with 540
  tests passed and 3 skipped; production Electron build passed.
- Final `pnpm test:e2e`: 2/2 macOS Electron tests passed, covering restart
  restoration and active cancellation.
- Final focused event-store, atomic-unit, and v2 integration re-audit: 77/77
  passed; the complete v2 integration file passed 38/38.
- Fault injection rolls back after the budget mutation, after every one of five
  local-start event inserts, after every one of five admitted paid-start event
  inserts, after each finish-event insert, and after the complete batch.
- Recovery closes 1,001 running sessions across the storage page boundary and
  then requires complete ledger/event reconciliation.
- Independent final review found no remaining P0-P2 after its timeout
  classification, timestamp-binding, per-event crash-proof, and truth-document
  findings were fixed and rerun.

Failures or blockers: Intermediate green suites missed stale retained-local
health precedence, campaign-overrun denial, incomplete evidence, forged
locality/snapshot/rate bindings, request-reserve undercount and double count,
cached/reasoning-token charging, async/leaked transaction handles, raw orphan
ledger writes, paged recovery, mutable finish pricing, fractional-micro
rounding, incoherent usage totals, late-cancellation overrun, broken post-dispatch
clock/ID sources, non-cooperative providers, and timeout mislabeled as user
cancellation. Each became a regression. The first final `pnpm check` attempt
was invalid because the sandbox denied temporary loopback binding (`EPERM`),
causing 12 transport-test failures; the authorized rerun passed. No current
implementation blocker remains for PR 4.

Limitations and non-claims: Production still creates v1 local-only sessions;
the fake-cloud output is never a user review. The exported low-level ledger
transaction seam can deliberately create an orphan, but startup or the next
supported paid admission detects and blocks it; compile-time unforgeable
mutation authority remains debt. Reconciliation currently scans historical
attempt starts and replays paid-session histories. Timeout bounds asynchronous
providers but cannot preempt code that synchronously blocks the JavaScript event
loop. This does not prove real-provider routing, egress safety, review quality,
cost savings, latency improvement, optimal scheduling, packaging, or release
readiness.

Paid exposure: $0. Validation used deterministic local test doubles, SQLite,
temporary loopback servers, and Electron. It made no real inference, external
provider, credential, vLLM, or OpenRouter request.

Next gate: PR 5's `$0` local Review Current Changes app slice, strict
`ReviewResultV1` acceptance/provenance, and zero-paid live local vLLM structured
output canary. Production Hybrid remains visibly disabled; PR 6 and every paid
call remain separately approval-gated.

References: [ADR 0004](adr/0004-checkpoint-router-budget-runner-v0.md),
[Hybrid Lease Router v0 plan](plans/HYBRID_LEASE_ROUTER_V0.md),
[architecture](ARCHITECTURE.md), [MVP readiness](MVP_READINESS.md).

### BL-20260830-0025-pr4-ci-portability-correction -- 2026-08-30 -- Correction: PR 4 Linux worker proof was not green

Status: `Implemented`

Scope or hypothesis: Correct the remote-CI claim in
`BL-20260829-1620-pr4-fake-hybrid-mechanics` and make the concurrent budget
admission proof portable to GitHub's Linux Node ESM worker runtime.

Decisions:

- Preserve the earlier append-only entry and supersede only its implication
  that the pushed revision had complete remote proof.
- Give the TypeScript worker fixture explicit `.ts` specifiers because it is
  loaded directly by Node with the `tsx` import hook rather than through
  Vitest's normal module transform.
- Reject all worker lifecycle promises from one guarded startup failure path,
  attach rejection observers immediately, and use a 15-second test deadline so
  loader failures surface directly without producing unrelated unhandled
  rejection noise or a misleading five-second timeout.

Changes: Updated the budget reservation worker's three source imports and the
concurrency harness's ready/result/exit failure propagation. No production
runtime or routing behavior changed.

Evidence: GitHub Actions run `33262781416` failed on Linux with
`ERR_MODULE_NOT_FOUND` for the extensionless `src/main/budget-ledger` import in
`budget-reservation-worker.ts`; all four worker rejections then appeared as
unhandled while the test timed out waiting for `ready`. After the correction,
`pnpm exec vitest run tests/unit/budget-ledger-concurrency.test.ts
--testTimeout=15000` passed 1/1 locally in 418 ms.

Failures or blockers: The replacement commit has not yet passed the full local
gate or remote GitHub Actions. Therefore PR 4 is not remotely verified at this
entry.

Limitations and non-claims: A local macOS pass cannot prove Linux portability.
This correction does not add production routing, cloud access, review quality,
cost savings, or PR 5 behavior.

Paid exposure: $0. Diagnosis and validation used local source, the existing
GitHub Actions log, SQLite, and deterministic worker threads; no inference,
provider, endpoint, credential, or paid service was invoked.

Next gate: Run the complete local gate, commit and push the correction, require
a green replacement GitHub Actions run, then append a separate verification
entry before beginning PR 5.

References: [affected PR 4 entry](#bl-20260829-1620-pr4-fake-hybrid-mechanics----2026-08-29----pr-4-fake-only-hybrid-mechanics-verified),
[failed GitHub Actions run](https://github.com/Lotus2077/SOAR/actions/runs/33262781416),
[ADR 0004](adr/0004-checkpoint-router-budget-runner-v0.md).

### BL-20260830-0031-pr4-node22-worker-correction -- 2026-08-30 -- Correction: Node 22 strip-only mode bypassed the worker hook

Status: `Implemented`

Scope or hypothesis: Correct the incomplete portability fix recorded in
`BL-20260830-0025-pr4-ci-portability-correction` and make the worker entrypoint
execute through an explicit full-TypeScript transform on the minimum supported
Node version.

Decisions:

- Reproduce the remote environment with the exact free Node `v22.22.2` runtime
  before making a second push.
- Enter the worker through a plain `.mjs` bootstrap, then load the TypeScript
  implementation with the documented `tsx/esm/api` `tsImport` function. This
  avoids both direct Node strip-only parsing and reliance on preload-hook order
  for a worker entrypoint.
- Retain explicit `.ts` imports inside the TypeScript worker; direct ESM
  resolution still requires them once the scoped transformer handles the
  module graph.

Changes: Added `budget-reservation-worker.mjs` as the worker bootstrap and
pointed the concurrency test at it. Removed the ineffective worker `execArgv`
preload attempt. Production code remains unchanged.

Evidence: Replacement GitHub Actions run `33263014476` advanced past module
resolution but failed 1/543 tests with `TypeScript parameter property is not
supported in strip-only mode` under Node `v22.22.2`. The same failure reproduced
locally with `npx --yes node@22.22.2 node_modules/vitest/vitest.mjs run
tests/unit/budget-ledger-concurrency.test.ts --testTimeout=15000`. After the
bootstrap change, that exact command passed 1/1 in 504 ms, and the normal local
Node `v26.7.0` focused command passed 1/1 in 349 ms.

Failures or blockers: The full local gate and a new remote GitHub Actions run
are still pending. PR 4 therefore remains without a green pushed Node 22 proof
at this entry.

Limitations and non-claims: Exact-version focused validation proves the loader
path, not the complete suite or remote Linux environment. The npm-delivered
Node runtime was used only as a test runtime and was not added as a dependency.
No production provider or routing behavior changed.

Paid exposure: $0. The exact Node runtime download and all tests were free;
there was no inference, provider endpoint, credential, or paid API use.

Next gate: Run the full local quality gate, commit and push this second
correction, and require its GitHub Actions run to pass before appending PR 4's
replacement verification entry or beginning PR 5.

References: [prior correction](#bl-20260830-0025-pr4-ci-portability-correction----2026-08-30----correction-pr-4-linux-worker-proof-was-not-green),
[second failed GitHub Actions run](https://github.com/Lotus2077/SOAR/actions/runs/33263014476),
[Node 22 TypeScript documentation](https://nodejs.org/docs/latest-v22.x/api/typescript.html),
[`tsx` developer API](https://github.com/privatenumber/tsx/blob/master/docs/dev-api/index.md).

### BL-20260830-0035-pr4-remote-verification -- 2026-08-30 -- PR 4 replacement remote proof verified

Status: `Verified`

Scope or hypothesis: Close the two CI corrections after proving the PR 4
concurrency harness, full quality gate, and Electron application on the pushed
minimum-runtime-compatible revision.

Decisions:

- Treat GitHub Actions run `33263277828`, not the earlier local-only evidence,
  as PR 4's definitive portability proof.
- Keep failed runs `33262781416` and `33263014476` in the historical record;
  this entry closes their stated next gates without rewriting them.
- Preserve Node `>=22.22.2` support and the explicit `tsx` developer-API
  bootstrap rather than hiding the test-loader incompatibility by raising the
  engine floor.

Changes: No new runtime change is introduced by this entry. It records the
verified state of worker-bootstrap commit
`fb9dd1be9cd56787d172c7b4ab311238857c9912`.

Evidence:

- Exact local Node `v22.22.2` focused concurrency proof: 1/1 passed in 504 ms.
- Local Node `v26.7.0` focused concurrency proof: 1/1 passed in 349 ms.
- Full local `pnpm check`: readiness, 16-entry log validation, typecheck, 44
  test files passed and 1 skipped with 540 tests passed and 3 skipped, and the
  production Electron build passed.
- GitHub Actions run `33263277828` passed its Node `v22.22.2` Linux `check` job
  in 50 seconds and its macOS `electron-e2e` job in 50 seconds; the latter ran
  both Electron end-to-end tests.
- The checkout and `origin/main` both resolved to the verified commit before
  this append-only entry was added.

Failures or blockers: The first pushed harness used extensionless worker
imports; the second let Node strip-only mode parse syntax requiring a transform.
Both failures are preserved in the two preceding correction entries and are
closed by the explicit `.mjs`/`tsImport` bootstrap. No current PR 4 verification
blocker remains.

Limitations and non-claims: PR 4 remains fake-only. This proof does not enable a
production cloud provider, demonstrate review quality, compare models, prove
cost or latency savings, or complete the PR 5 application slice.

Paid exposure: $0. All proof used local or GitHub-hosted test runtimes,
deterministic providers, SQLite, and Electron; no inference, provider endpoint,
credential, OpenRouter, or paid API call occurred.

Next gate: Begin PR 5 planning and implementation: a local Review Current
Changes app flow, strict `ReviewResultV1` validation and provenance, and a
zero-paid live local-vLLM canary. Production Hybrid stays disabled.

References: [first correction](#bl-20260830-0025-pr4-ci-portability-correction----2026-08-30----correction-pr-4-linux-worker-proof-was-not-green),
[second correction](#bl-20260830-0031-pr4-node22-worker-correction----2026-08-30----correction-node-22-strip-only-mode-bypassed-the-worker-hook),
[green GitHub Actions run](https://github.com/Lotus2077/SOAR/actions/runs/33263277828),
[ADR 0004](adr/0004-checkpoint-router-budget-runner-v0.md).

### BL-20260830-0043-pr5-implementation-start -- 2026-08-30 -- PR 5 local review architecture fixed before implementation

Status: `In progress`

Scope or hypothesis: Implement the approved `$0` PR 5 as a real local Review
Current Changes application slice with strict structured results and immutable
evidence, without weakening PR 4's fake-only Hybrid boundary or making any
cloud call.

Decisions:

- Add one strict, bounded `ReviewResultV1` structural contract and one canonical
  standard JSON Schema. Host semantic acceptance separately enforces snapshot
  and evidence-set identity, admitted references, unique findings/references,
  conclusion precedence, coverage, and freshness. Existing
  `change_metadata` references count as change-origin evidence for mode-only or
  content-identical rename findings.
- Let callers select only the fixed `change-review-result-v1` structured-output
  contract. The OpenAI-compatible adapter owns the exact response-format body,
  forbids tools in the structured round, counts the complete schema envelope in
  its request reserve, and preserves raw output separately from the accepted
  parsed result. The schema ID and SHA-256 are persisted with the attempt.
- Derive `ReviewEvidenceSetV1` only from canonical successful
  `tool.call.requested`/`tool.call.completed` event pairs. Host event-envelope
  IDs identify observations; result hashes, snapshot/hunk identities, tool
  admission, untruncated search lines, and full-file content hashes are
  rechecked before provenance is frozen.
- Use a dedicated `review-context-compiler-v1` synthesis packet containing the
  exact snapshot, evidence, observation IDs, evidence set, and provenance hash.
  It never truncates after the evidence-set identity is chosen: the entire
  packet fits the provider budget or the workflow fails closed.
- Add a narrowly admitted production local-only v2 review coordinator. Do not
  remove or generalize the nominal fake-provider guard on PR 4's Hybrid runner.
  `inspect_git_changes` is model-visible only inside the local review track;
  generic Repository Investigator and every tool-free synthesis route remain
  unable to use it.
- Add review-specific IPC so the renderer submits only an approved workspace.
  Main fixes and persists `change-review-v1`, `local_only_v1`, no egress
  consent, and the inert 250,000-micro-USD future cap. Production Hybrid is
  visibly disabled with “Cloud setup is not available in this build” and is
  impossible to request through renderer-controlled fields.
- Render only host-accepted structured review data. Do not stream raw JSON into
  the UI. Recheck workspace freshness in main before display or copy; distinguish
  fresh complete, identity-same but incomplete, drifted, and unavailable.
- Run deterministic adapter/workflow/UI gates before one no-retry live local
  vLLM canary. `/v1` is the configured API base and `/v1/models` is bounded
  discovery only. No OpenRouter or production cloud provider is permitted.

Changes: Three independent read-only preflight lanes mapped the contract and
provenance boundary, Electron UX/IPC surface, and local-vLLM capability gate.
No PR 5 source change or provider request has been made at this entry.

Evidence: The checkout and `origin/main` were clean and equal at
`8f6a9e734ce9f475bb1dd355b856faf9f9156906`. GitHub Actions runs
`33263277828` and `33263400097` were green. Source inspection confirmed the
current intentional blockers: no final review-result schema, structured output
is rejected by the adapter, `inspect_git_changes` is host-only, production v2
is fake-only, and the app can create only repository-investigator v1 sessions.

Failures or blockers: The configured local endpoint/model has not yet proved
the exact JSON Schema response. Under the approved plan, inability to return one
strict grounded `ReviewResultV1` blocks PR 5; prompt-only JSON, fenced/suffix
extraction, `json_object`, regex, OpenRouter fallback, or an internal live retry
will not be substituted.

Limitations and non-claims: This entry is a build contract, not working review
software. It claims no app flow, accepted review, model quality, live endpoint
compatibility, Hybrid route, cloud safety, cost saving, latency improvement,
packaging, or release readiness.

Paid exposure: $0. Preflight read local source and existing public technical
documentation only. It made no inference, endpoint, credential, OpenRouter, or
paid API request.

Next gate: Implement deterministic result/provider/provenance/packet contracts,
then the local-only coordinator and safe app projection, run all local tests and
Electron E2E, and only then execute the single zero-paid live local canary.

References: [Hybrid Lease Router v0 plan](plans/HYBRID_LEASE_ROUTER_V0.md),
[ADR 0003](adr/0003-immutable-change-acquisition-v1.md),
[ADR 0004](adr/0004-checkpoint-router-budget-runner-v0.md),
[vLLM OpenAI-compatible server](https://docs.vllm.ai/en/stable/serving/openai_compatible_server.html),
[`tsx` worker correction proof](https://github.com/Lotus2077/SOAR/actions/runs/33263277828).

### BL-20260830-0157-pr5-local-review-verified -- 2026-08-30 -- PR 5 local Review Current Changes slice verified before push

Status: `Verified`

Scope or hypothesis: Complete the approved `$0` PR 5 as an app-created,
local-only Review Current Changes vertical slice. Prove the exact structured
result contract against the configured vLLM once, while keeping production
Hybrid, OpenRouter, credentials, and paid inference unreachable.

Decisions:

- Schedule only at meaningful boundaries rather than on every session event.
  The review coordinator fixes a local lease at session start and records the
  evidence-complete checkpoint before same-provider synthesis; ordinary tool
  progress does not invoke a general scheduler.
- Keep tool authority on the app host. The provider receives only the explicitly
  selected `inspect_git_changes` or `read_text_file` schema, proposes a call,
  and receives the bounded host result. The final exact-schema synthesis is
  tool-free.
- Treat the canonical append-only event history as the sole acceptance source.
  Rebuild provenance, snapshot/evidence identities, coverage, checkpoint links,
  raw-versus-attached structured output, semantic acceptance, and the terminal
  completion check before any model result crosses IPC.
- Fail closed on incomplete lifecycle state. A result is displayable only after
  completed-session replay; invalid terminal state is `not_available`, while an
  identity-matching but incomplete review remains visible with omissions and
  cannot be copied.
- Send review evidence to the configured vLLM endpoint and say so in the UI and
  documentation. Here `local` means the self-hosted zero-paid route, not that
  the endpoint necessarily runs on the same Mac or that transport has no cost.
- Project review state through an explicit allowlist. Review event payloads and
  coverage expose only bounded route/attempt/usage facts and aggregate counts,
  not raw tool bodies, raw structured output, or per-file coverage. The accepted
  result retains its contract-required evidence-reference identities, and
  review streaming deltas are replaced by redacted snapshots.
- Revalidate the workspace after synthesis, before display, before copy, on
  window focus, and when a hidden app becomes visible. Use monotonically ordered
  requests so a stale asynchronous response cannot restore copy access.
- Report end-to-end wall time separately from summed provider-call time, and
  include reasoning tokens in displayed total tokens. Continue to distinguish
  reported, policy-derived zero, reserved-unknown, and unreported cost.
- Preserve the one-shot live rule. The schema canary makes one bounded
  `/models` request and one structured inference with no retry or fallback.
  After the run, add `--disableConsoleIntercept` so future canaries expose their
  bounded attestation; do not repeat this canary merely to recover telemetry
  hidden by the original Vitest reporter.

Changes: Added the strict `ReviewResultV1` Zod and standard JSON Schema
contracts, parameterized OpenAI-compatible structured output and bounded model
discovery, canonical review-event provenance, the no-truncation review context
compiler, host semantic acceptance, and the production local-only review
coordinator. Added the review task track, v2 events/reducer/recovery links,
review-specific IPC, approved-workspace revalidation, renderer-safe event and
coverage projections, and the dedicated Electron setup/result/timeline UI.
Added deterministic adapter, contract, replay, crash-window, cancellation,
privacy, Markdown-injection, freshness-race, metrics, integration, and Electron
tests plus the opt-in live schema canary. Updated public architecture,
readiness, and plan documentation without enabling PR 6.

Evidence:

- Consolidated PR 5 focused suite passed 87/87 tests across 12 files after the
  loopback test server was permitted outside the restricted sandbox.
- Full local `pnpm check` passed readiness and the then-18-entry build-log
  validator, TypeScript, 52 test files with 610 tests passed and 2 files/4 tests
  skipped, and all three production Electron bundles.
- `pnpm test:e2e` passed 3/3 macOS Electron workflows: Repository Investigator
  restart restore, active-inference cancellation, and local review with stale
  Markdown-copy refusal.
- The first and only `pnpm test:live-review-schema` run passed 1/1 in 5.86
  seconds of test time. Its assertions prove exactly one configured-model
  availability check found one `RM-01 VLM`, exactly one tool-free structured
  inference ended with `finish_reason: stop`, reported positive token usage,
  streamed the same raw content returned by the provider, and passed complete
  host acceptance against the exact empty-snapshot `ReviewResultV1` fixture.
- A safe configuration read confirmed provider mode `local`, an exact `/v1`
  API base, model `RM-01 VLM`, `local_zero_cost`, an 8,192 output-token limit,
  and a 300,000-ms request timeout without printing the credential.
- Three independent reviews covered host acceptance/replay, cancellation and
  crash windows, renderer privacy/Markdown safety, freshness races, and metric
  attribution. Their regressions are included in the passing suites.

Failures or blockers: The independent reviews found and corrected several real
honesty and replay gaps before this verification: accepted incomplete output
could be labeled fresh and copyable; remote-capable vLLM transport was described
too locally; model-authored Markdown could create links/images; renderer
coverage exposed per-file identities; review event projection was not
default-deny; interrupted or forged accepted output could survive replay; raw
and attached results were not re-compared; cancellation normalization and the
last-evidence synthesis boundary could disagree; a renderer callback exception
could unwind canonical execution; model discovery happened before persisted
start intent; a replaced workspace symlink could inherit approval; returning to
the app did not refresh freshness; and provider-call time was mislabeled as
end-to-end latency while reasoning tokens were omitted. Earlier deterministic
test execution also produced 17 `listen EPERM` failures because the restricted
sandbox denied the loopback fixture server; the identical 12-file suite passed
87/87 when that local bind was permitted. The live canary passed, but Vitest's
original console interception suppressed the detailed usage/duration
attestation, so this entry records only asserted facts and test-process timing.
No current deterministic, Electron, or configured schema-capability blocker
remains before push.

Limitations and non-claims: The live canary uses a synthetic empty change
snapshot and proves response-format compatibility, not model review quality or
an end-to-end real-repository review. Electron E2E uses the deterministic fake
provider. The app cannot edit files, apply patches, run tests or shell commands,
review arbitrary historical ranges, or dynamically route to a second provider.
Binary, submodule, mixed index/worktree, oversized, unavailable, and otherwise
omitted evidence remains explicitly incomplete. There is no held-out quality,
cost-savings, or latency comparison; no production cloud provider, Keychain,
egress gate, or paid route exists. A zero token-fee declaration does not measure
GPU electricity, hosting, networking, or operator cost. This is a pre-push
local verification entry, not remote CI, a signed release, or PR 6 approval.

Paid exposure: `$0`. Deterministic validation used local fixtures and GitHub-
independent tooling. The sole live inference used the configured self-hosted
provider under `local_zero_cost`; it made no OpenRouter request and selected no
paid route. Infrastructure and electricity costs are unmeasured.

Next gate: Re-run the non-live gate after this append-only documentation change,
commit and push PR 5, require green Node 22 Linux and macOS Electron GitHub
Actions, and append a separate remote-verification entry. PR 6 and every paid
call remain unapproved.

References: [approved plan](plans/HYBRID_LEASE_ROUTER_V0.md),
[architecture](ARCHITECTURE.md), [readiness boundary](MVP_READINESS.md),
[ADR 0003](adr/0003-immutable-change-acquisition-v1.md), and
[ADR 0004](adr/0004-checkpoint-router-budget-runner-v0.md).

### BL-20260830-0212-pr5-precommit-audit-corrections -- 2026-08-30 -- Final independent audit corrected four release-significant boundaries

Status: `Implemented`

Scope or hypothesis: Resolve every P1 found by the independent final working-
tree audit after the initial PR 5 local verification entry, and correct the
macOS distributable's pre-existing Electron/Chromium license collision before
commit. Preserve the one-shot live-canary rule and make no additional provider
call.

Decisions:

- Make the synthesis prompt use the host contract's exact conclusion
  precedence: any admitted P0/P1 finding is `blocking_findings` even when
  coverage or the model's omissions are incomplete; absent P0/P1, incomplete
  evidence is `incomplete`; only complete coverage without blockers may be
  `no_blocking_findings`.
- Stop treating an arbitrary remote OpenAI-compatible URL as independently
  known to be free. A non-loopback vLLM base now requires the raw configuration
  to explicitly contain `SOAR_VLLM_COST_POLICY=local_zero_cost`. UI, IPC, and
  public docs call `$0` a declared token fee, state that external billing and
  infrastructure cost are not verified, and distinguish the configured adapter
  from a separately configured paid provider.
- Reject vLLM URLs containing username/password userinfo. Provider/server
  `Error.message` is never persisted by the review coordinator; stable
  host-authored codes own durable failure text instead.
- Keep only an explicitly configured API key—not the fallback `local-vllm`
  literal—and the exact vLLM base URL as main-process-only sensitive values.
  Recursively reject a completed provider result that echoes either exact value
  before parsing or persistence. Persist no failed/aborted provider partial at
  all because an abort may split a secret before exact matching is possible.
- Treat exact-value filtering as defense in depth, not proof against a malicious
  endpoint that transforms or encodes a secret. The configured endpoint remains
  an operator trust boundary.
- Package SOAR's, Electron's, and Chromium's legal resources under distinct
  names. Make the packaging script fail if any required resource is missing or
  empty in either the built app or the extracted archive. State plainly that
  the hand-maintained third-party notice is not an exhaustive generated SBOM.

Changes: Updated the local-review prompt and added an incomplete-coverage P1
workflow fixture. Added explicit remote cost-policy admission, IPv4/IPv6
loopback and URL-userinfo handling, conditional sensitive-key retention, stable
review failure codes, sensitive-result rejection, and unconditional failed-
partial omission. Updated the availability contract, IPC/UI labels, and public
cost/reachability documentation. Added distinct Electron and Chromium
`extraResources`, package-time legal-resource verification, and a static
packaging-license contract test.

Evidence:

- The combined affected config, IPC, renderer, coordinator, and packaging suite
  passed 31/31 tests across five files; TypeScript and `git diff --check` passed.
- Adversarial coordinator tests prove an opaque non-`sk-` credential and
  credentialed URL echoed in `Error.message`, a valid structured result echoing
  exact sensitive values, and an arbitrary aborted partial are absent from both
  raw canonical events and renderer snapshots.
- The real-Git bounded-coverage regression completes an accepted P1 review as
  `blocking_findings`, projects it as identity-matching incomplete, and keeps
  Markdown copy disabled.
- `pnpm package:mac` rebuilt and ad-hoc signed the arm64 app, checked all four
  legal resources in the built and extracted app, and produced
  `dist/SOAR-mac-arm64.zip`. Archive inspection found `LICENSE` (1,062 bytes),
  `LICENSE.electron.txt` (1,096 bytes), `LICENSES.chromium.html` (15,715,960
  bytes), and `THIRD_PARTY_NOTICES.md` (31,968 bytes). The ignored archive's
  SHA-256 was
  `d8d0b44103b45ff6750c4ba2efd8fba80f3692a2ca85b9342d8caa56f48bd5c5`.
- The readiness validator still reports 22 research workloads, 20 coding
  workloads, and no tracked or unignored live secret.

Failures or blockers: The final audit found four issues after the initial local
verification: prompt/host conclusion precedence could fail a valid P1 found
under incomplete coverage; remote endpoint billing was silently inferred from
a default label; opaque provider errors/results/abort partials could violate the
durable credential boundary; and the distributable omitted distinct
Electron/Chromium license resources. All four now have regressions. The complete
post-correction local suite and Electron E2E have not yet run at this entry, so
PR 5 is not ready to push here.

Limitations and non-claims: Exact-value filtering cannot recognize encoded,
hashed, split-across-successful-fields, or otherwise transformed exfiltration
from a malicious endpoint. Users must trust the configured vLLM operator and
its billing declaration. The rebuilt app is ad-hoc signed and not notarized.
`THIRD_PARTY_NOTICES.md` remains hand-maintained; automating a complete direct
and transitive runtime-license inventory is still release follow-up. This entry
does not rerun or widen the synthetic schema-canary result and does not prove
real-repository review quality, dynamic routing, external cost, or release
readiness.

Paid exposure: `$0` selected under the operator-attested local token-cost
policy. These corrections and their package/test evidence made no inference or
provider request and did not access OpenRouter or a separately configured paid
service. Local build, signing, electricity, and infrastructure costs are not
measured as token spend.

Next gate: Run the complete non-live `pnpm check` and all Electron E2E on this
corrected tree, append their exact results, then commit/push and require green
remote CI. PR 6 and every paid call remain unapproved.

References: [preceding PR 5 local verification](#bl-20260830-0157-pr5-local-review-verified----2026-08-30----pr-5-local-review-current-changes-slice-verified-before-push),
[architecture](ARCHITECTURE.md), [readiness boundary](MVP_READINESS.md), and
[approved plan](plans/HYBRID_LEASE_ROUTER_V0.md).

### BL-20260830-0214-pr5-final-local-verification -- 2026-08-30 -- Corrected PR 5 tree passed every local gate

Status: `Verified`

Scope or hypothesis: Close the pre-commit audit-correction gate on the exact
working tree that will be committed, without repeating the one-shot live schema
canary or contacting any provider.

Decisions:

- Treat this post-correction result, rather than the earlier pre-audit local
  gate, as the definitive local PR 5 verification.
- Preserve the earlier canary as a narrowly scoped provider/schema fact. The
  subsequent changes affect prompt precedence, configuration admission,
  sensitive-output persistence, UI truthfulness, and packaging—not the exact
  JSON Schema request that passed—and do not authorize a second live call.
- Require remote Linux/Node 22 and macOS Electron CI before declaring the pushed
  revision verified. A local pass is necessary but not a remote portability
  claim.

Changes: No source change is introduced by this entry. It records verification
after `BL-20260830-0212-pr5-precommit-audit-corrections` and all preceding PR 5
implementation changes.

Evidence:

- Final `pnpm check` passed readiness, the then-20-entry build-log validator,
  TypeScript, 53 test files with 615 tests passed and 2 files/4 tests skipped,
  and the production Electron main/preload/renderer build.
- Final `pnpm test:e2e` passed 3/3 macOS workflows in 7.7 seconds: Repository
  Investigator restart restoration, active-inference cancellation, and Review
  Current Changes with stale Markdown-copy refusal.
- The immediately preceding signed package proof verified all four legal
  resources in the built and extracted archive; its exact hash and sizes are in
  the correction entry.
- The first and only local structured-schema canary remains the passing 1/1
  2026-08-30 run recorded in `BL-20260830-0157-pr5-local-review-verified`.

Failures or blockers: No local PR 5 blocker remains. Remote GitHub Actions has
not yet run on the corrected commit, so pushed portability is still pending.

Limitations and non-claims: The structured live result is still a synthetic
empty-snapshot schema compatibility proof, not a real-repository review-quality
result. Electron E2E uses a deterministic fake provider. The app remains
same-provider and read-only, with no patch/test/shell tools, production Hybrid,
OpenRouter construction, Keychain flow, held-out evaluation, notarization, or
signed release channel. Remote endpoint billing is operator-attested, not
independently verified. Exact-value filtering cannot prove safety against a
malicious endpoint that transforms sensitive values. A complete generated
direct/transitive dependency-license inventory remains release follow-up.

Paid exposure: `$0` selected under the declared local token-cost policy. This
post-correction gate used only local deterministic tests, Electron, filesystem,
Git, and build tooling; it made no inference or provider request.

Next gate: Commit and push the complete PR 5 tree, require green GitHub Actions,
then append a distinct remote-verification entry. PR 6, OpenRouter, and every
paid call remain unapproved.

References: [audit corrections](#bl-20260830-0212-pr5-precommit-audit-corrections----2026-08-30----final-independent-audit-corrected-four-release-significant-boundaries),
[initial local canary entry](#bl-20260830-0157-pr5-local-review-verified----2026-08-30----pr-5-local-review-current-changes-slice-verified-before-push),
[architecture](ARCHITECTURE.md), and [readiness boundary](MVP_READINESS.md).

### BL-20260830-0237-pr5-remote-ci-capacity-correction -- 2026-08-30 -- Remote CI invalidated the pre-commit PR 5 verification

Status: `In progress`

Scope or hypothesis: Treat failed GitHub Actions run `33267686671` as the
authoritative PR 5 gate, explain why the preceding local verification missed
the failure, and correct the declared Repository Investigator context envelope
without weakening exact evidence retention or making another inference call.

Decisions:

- Preserve the exact complete-search and 250-byte objective-drift assertions.
  Do not exclude new source references, pin an older revision, accept a partial
  evidence envelope, or silently change the `utf8-bytes-v1` estimator.
- Raise the generic configured and proof input ceiling from 16,384 to 18,432
  tokens while retaining the 20% safety margin and provider-owned request
  reserve. The configured model's zero-cost `/v1/models` discovery response on
  2026-08-30 advertised a 262,144-token maximum, so the corrected local default
  remains below the currently declared endpoint capacity. This observation is
  specific to that response and is not a guarantee for another provider.
- Keep ordinary development checks usable on a dirty tree, but add a distinct
  clean committed-HEAD release gate. A test that intentionally archives `HEAD`
  cannot substantiate a claim about uncommitted source.
- Defer compact exact-search membership and an explicit atomic-search
  completion obligation to a separately designed change. Raising the bounded
  envelope corrects this approved PR 5 proof; it does not make exact search
  retention unbounded.

Changes: Implementation is underway. The intended correction updates the
runtime/proof default, exact assertions, derived episode cap, public current
contract, and a clean committed-HEAD verification command. Historical entries
and failed remote evidence remain unchanged.

Evidence:

- GitHub Actions run `33267686671` failed the Linux Node 22 `check` job because
  the accepted final packet retained 22 of 42 exact cancellation-symbol
  occurrences; macOS Electron E2E was consequently skipped.
- The exact committed test failed locally on Node 20, 22, 24, and 26. Comparing
  code and fixtures isolated the cause to the PR 5 revision adding eight real
  symbol occurrences, increasing the independent oracle from 34 to 42; the
  provider reserve and tool schemas were unchanged.
- The earlier local full check ran before commit. Its fixture used
  `git archive HEAD`, so it exercised base commit `50ba9f2` rather than the
  uncommitted PR 5 files later recorded in `7ba9c80`.
- At the old policy, the effective packet budget was 12,538 estimated tokens
  after safety and the 569-token finalization reserve. The complete current
  packet and its 250-byte drift variant exceeded that envelope; the compiler's
  bounded projection therefore retained only a prefix.
- One read-only `/v1/models` request returned the configured model exactly once
  and advertised `max_model_len` 262,144. It made no inference request and
  exposed no credential.

Failures or blockers: The pushed PR 5 revision is not verified. The context-cap
correction, committed-HEAD guard, complete non-live suite, Electron E2E, and a
replacement green GitHub Actions run are still pending.

Limitations and non-claims: The discovery response is operator-provided
metadata, not independent proof of every usable prompt length. A larger bounded
default does not solve arbitrary repository growth, compact large result sets,
or give the current completion contract a way to designate one search result
as atomic. It does not prove model answer quality, dynamic routing, cost or
latency advantage, real-repository review quality, or release readiness.

Paid exposure: `$0`. Diagnosis used deterministic local tests and GitHub-hosted
CI. The only endpoint access was one model-metadata GET under the configured
zero-token-fee policy; no inference, OpenRouter request, paid route, retry, or
fallback occurred. Infrastructure and electricity remain unmeasured.

Next gate: Finish the narrow correction, commit it, run the clean committed-HEAD
gate plus Electron E2E, push, and require replacement Linux Node 22 and macOS
Electron jobs to pass. Append a separate verification entry only after those
facts exist. PR 6 and every paid call remain unapproved.

References: [failed GitHub Actions run](https://github.com/Lotus2077/SOAR/actions/runs/33267686671),
[preceding local verification](#bl-20260830-0214-pr5-final-local-verification----2026-08-30----corrected-pr-5-tree-passed-every-local-gate),
[context handoff ADR](adr/0001-context-handoff-engine-v1.md), and
[approved plan](plans/HYBRID_LEASE_ROUTER_V0.md).

### BL-20260830-0246-pr5-release-gate-live-opt-in-correction -- 2026-08-30 -- Release-head verification made deterministically provider-free

Status: `Implemented`

Scope or hypothesis: Independently audit the new clean committed-HEAD wrapper
before treating it as evidence, with particular attention to whether ordinary
release verification could accidentally contact a configured provider.

Decisions:

- Treat inherited live-test opt-in flags as a release-blocking defect. A command
  described as deterministic and `$0` must not change behavior because the
  invoking shell happens to contain an earlier live-test opt-in.
- Force every current live-provider opt-in to the string `false` in the child
  environment used by `check:release-head`, while preserving unrelated
  environment values.
- Keep the individual live scripts explicitly opt-in and separate. The release
  wrapper is not an authorization boundary for repeating a canary or contacting
  a provider.
- Preserve the wrapper's narrow contract: reject any staged, unstaged, or
  untracked non-ignored change before running `pnpm check` once, then require the
  same clean commit afterward.

Changes: Added an explicit deterministic child-environment constructor to the
release-head verifier, set `SOAR_RUN_LIVE_VLLM`,
`SOAR_RUN_LIVE_REVIEW_SCHEMA`, and `SOAR_RUN_LIVE_REPOSITORY` to `false`, added
a regression proving those values are overridden without mutating the parent,
and documented the behavior for contributors.

Evidence:

- The independent security reviewer identified the inherited-environment path
  as P1 because the full Vitest command includes live test files whose own
  guards read these opt-ins.
- The focused release-head verifier suite passed 8/8 tests after the correction,
  including clean, dirty, changed-HEAD, failing-child, ignored-artifact, and
  live-opt-in cases.
- TypeScript validation passed after the correction.
- Invoking `pnpm check:release-head` on the current deliberately dirty tree
  failed before running the child check with the stable clean-HEAD error, which
  proves the precondition is active but is not yet committed-revision evidence.

Failures or blockers: The complete non-live suite has not yet been rerun after
this security correction. The correction is uncommitted, so the clean
committed-HEAD gate, Electron E2E on that commit, and replacement GitHub Actions
run remain pending.

Limitations and non-claims: This environment hardening covers the three live
opt-ins currently defined by the repository; future live scripts must be added
to the explicit deny list and its regression. It does not sandbox arbitrary test
code or independently prove that a configured endpoint is free. It does not
change the context compiler, solve unbounded repository growth, add atomic
large-search retention, or prove routing quality.

Paid exposure: `$0`. The correction and evidence used only local Git, unit
tests, and TypeScript validation. No inference, provider, OpenRouter, retry, or
fallback request occurred, and the one-shot structured-schema canary was not
repeated.

Next gate: Run the complete deterministic check, review the final diff and
secret scan, commit the correction, run `pnpm check:release-head` and macOS
Electron E2E against that exact commit, then push and require green Linux
Node 22 and macOS Electron jobs.

References: [release verifier](../scripts/verify-release-head.ts),
[release verifier tests](../tests/unit/release-head-verifier.test.ts),
[contributor gate](../CONTRIBUTING.md), and
[capacity correction](#bl-20260830-0237-pr5-remote-ci-capacity-correction----2026-08-30----remote-ci-invalidated-the-pre-commit-pr-5-verification).

### BL-20260830-0253-pr5-advertised-model-capacity-correction -- 2026-08-30 -- Provider admission now reserves both input and output capacity

Status: `Implemented`

Scope or hypothesis: Audit whether the raised 18,432-token input allowance is
actually compatible with the context length advertised by the selected model
before either ordinary review inference or the live Repository Investigator
proof can begin.

Decisions:

- Define the fail-closed admission inequality as
  `advertised max_model_len >= configured maximum input + maximum requested output`.
  With the current defaults and proof policy, the minimum is
  `18,432 + 8,192 = 26,624` tokens.
- Treat missing, non-integer, non-positive, or undersized selected-model
  capacity metadata as unhealthy. Distinguish unknown metadata from known but
  insufficient capacity in the durable health result code.
- Apply one shared capacity validator to production model-list health and the
  live proof preflight. The proof must reject an inadequate endpoint before
  building a repository fixture or dispatching inference.
- Preserve exact-boundary admission: a model advertising exactly 26,624 tokens
  is sufficient for the configured maximums; 26,623 is not.
- Correct the wording in the preceding capacity entry: the authenticated
  model-list request printed or persisted no credential. When configured, the
  selected endpoint necessarily received the Authorization header; the earlier
  phrase "exposed no credential" was too broad.

Changes: Added a reusable advertised-capacity validator, two explicit unhealthy
model-availability codes, production model-list enforcement, live-proof
preflight enforcement, and unit/integration boundary regressions. Updated the
proof fixture's model metadata from the input-only value to the sufficient
combined-context value.

Evidence:

- The production provider already sends the per-attempt output allowance as
  `max_completion_tokens`; its descriptor already separates maximum input and
  maximum output allowances, so the required total is deterministic.
- Focused provider and Repository Investigator tests passed 37 tests with the
  opt-in live proof skipped. They cover missing capacity, 4,095 against a 4,096
  requirement, exact 4,096 equality, 26,623 against the proof's 26,624
  requirement, and exact 26,624 equality.
- TypeScript validation and `git diff --check` passed after the correction.
- The first sandboxed provider-test attempt could not bind its loopback fixture
  server and failed 19 cases with `EPERM`; an authorized local-loopback rerun
  passed. This was a test-environment restriction, not a provider response.

Failures or blockers: The complete deterministic suite has not yet been rerun
after this capacity correction. The tree remains uncommitted, so the clean
committed-HEAD gate, Electron E2E on that exact revision, and replacement remote
CI remain pending.

Limitations and non-claims: Production OpenAI-compatible health now requires
the selected model entry to expose vLLM-style `max_model_len`; a future cloud
adapter whose model-list schema omits that field will need an independently
verified capability source rather than weakening this local fail-closed rule.
Metadata is still an endpoint assertion, not an independent load test. This
does not solve unbounded evidence growth, atomic large-search retention, model
quality, dynamic routing, or provider cost verification.

Paid exposure: `$0`. Implementation and evidence used local source, fixture
servers, deterministic tests, and TypeScript only. No provider, inference,
OpenRouter, retry, or fallback request occurred, and the structured-schema
canary was not repeated.

Next gate: Finish the normative documentation and independent diff audit, run
the complete deterministic check, commit the candidate, then run the clean
committed-HEAD gate and macOS Electron E2E before pushing for Linux Node 22 and
macOS Electron CI.

References: [OpenAI-compatible provider](../src/main/providers/openai-compatible.ts),
[provider health contract](../src/main/providers/types.ts),
[provider boundary tests](../tests/unit/openai-compatible.test.ts),
[Repository Investigator proof](../tests/integration/local-repository-investigator.test.ts),
and [preceding capacity correction](#bl-20260830-0237-pr5-remote-ci-capacity-correction----2026-08-30----remote-ci-invalidated-the-pre-commit-pr-5-verification).

### BL-20260830-0258-pr5-correction-committed-local-verification -- 2026-08-30 -- Corrected PR 5 candidate passed clean committed-HEAD and Electron gates

Status: `Verified`

Scope or hypothesis: Verify that the complete PR 5 capacity correction works
from the exact committed source revision rather than an uncommitted tree, while
preventing every live-provider opt-in and repeating no canary.

Decisions:

- Bind the local release claim to commit
  `31049bb9a907d1cc36388f8cd9783de1eccdcb86` and the release wrapper's observed
  unchanged clean HEAD.
- Treat macOS Electron E2E as a separate required gate because the deterministic
  release wrapper builds Electron but does not launch the application.
- Retain the exact Node 22 affected-suite run as additional portability evidence,
  not as a substitute for replacement Linux CI on the pushed revision.
- Keep remote verification pending until GitHub Actions reports both Linux
  Node 22 and macOS Electron jobs green.

Changes: No runtime source change is introduced by this entry. It records the
first exact-commit local verification after the 18,432-token envelope,
advertised-capacity guard, deterministic release wrapper, and both independent
audit corrections were committed.

Evidence:

- `pnpm check:release-head` resolved and retained commit
  `31049bb9a907d1cc36388f8cd9783de1eccdcb86`, validated 24 build-log entries,
  revalidated 22 research and 20 coding workloads with no tracked or unignored
  live secret, passed TypeScript, passed 54 test files and 625 tests with two
  files/four opt-in live tests skipped, and built Electron main, preload, and
  renderer bundles.
- The release wrapper forced all three live-provider opt-ins to `false`; no
  live test ran and no endpoint request was dispatched.
- `pnpm test:e2e` passed 3/3 macOS workflows in 7.8 seconds: local tool-loop
  restart restoration, active-inference cancellation, and Review Current
  Changes with stale Markdown-copy refusal.
- Before commit, the affected OpenAI-compatible provider and Repository
  Investigator suites passed 37 tests with one opt-in live proof skipped under
  the cached exact Node 22.22.2 runtime.
- Independent correction, security, and final-diff reviews reported no remaining
  P0-P2 finding after the capacity-scope documentation was narrowed to the paths
  that actually invoke admission.

Failures or blockers: No local blocker remains for this candidate. The new log
entry itself is not yet committed, so the exact final revision still needs the
same committed-HEAD and Electron gates. Replacement GitHub Actions has not run.

Limitations and non-claims: The live Repository Investigator proof was not
rerun; its prior failure remains useful historical evidence and the corrected
capacity is deterministic until separately authorized live proof. The single
structured-schema canary remains synthetic and was not repeated. Electron E2E
uses a deterministic fake provider. This does not prove real-repository answer
quality, unbounded evidence retention, atomic large-search preservation,
dynamic routing, cloud construction, cost/latency advantage, notarization, or a
signed release channel.

Paid exposure: `$0`. Verification used local deterministic tests, Git,
TypeScript, Electron build/E2E, and a cached Node 22 runtime. No provider,
inference, OpenRouter, retry, fallback, or model-list request occurred.

Next gate: Commit this verification entry, rerun the clean committed-HEAD and
macOS Electron gates on that final revision, push it, and require replacement
Linux Node 22 and macOS Electron GitHub Actions jobs to pass before recording
remote verification.

References: [capacity implementation entry](#bl-20260830-0253-pr5-advertised-model-capacity-correction----2026-08-30----provider-admission-now-reserves-both-input-and-output-capacity),
[release verifier](../scripts/verify-release-head.ts),
[contributor gate](../CONTRIBUTING.md), and
[readiness boundary](MVP_READINESS.md).

### BL-20260830-0303-pr5-remote-retention-timeout-correction -- 2026-08-30 -- Replacement CI exposed a proof-test timing boundary

Status: `In progress`

Scope or hypothesis: Treat replacement GitHub Actions run `33269767743` as
authoritative after the corrected assertions began executing on Linux, and
distinguish a deterministic proof failure from an under-provisioned test timeout.

Decisions:

- Do not weaken, skip, split, or reduce the real-revision retention assertions.
  Preserve both the exact current objective and the 250-byte drift scenario in
  one proof test.
- Raise only that integration test's timeout from Vitest's default 5 seconds to
  15 seconds. Do not change the global test timeout or any production runtime
  limit.
- Use a bound above the observed 5.726-second Linux execution while keeping a
  finite failure deadline. A timeout is test-runner scheduling allowance, not a
  context-capacity concession.
- Require another clean committed-HEAD gate, macOS Electron E2E, push, and fresh
  Linux/macOS CI cycle before replacing the failed remote status.

Changes: Added a 15,000-millisecond per-test timeout to the deterministic
real-symbol retention and objective-drift integration test. No context,
provider, tool, evaluator, or production behavior changed.

Evidence:

- GitHub Actions run `33269767743` reached the corrected test and reported its
  duration as 5,726 milliseconds before Vitest raised
  `Test timed out in 5000ms` at the test declaration.
- All other reported assertions passed: 53 test files and 624 tests passed, two
  files/four live tests skipped. The job stopped before the build, and macOS
  Electron E2E was skipped because the Linux check failed.
- The earlier exact Node 22 focused run completed the whole provider/proof pair
  in 3.00 seconds, while local full runs also passed. The remote duration shows
  that the previous default depended on machine load rather than proof logic.

Failures or blockers: The pushed revision remains failed and is not remotely
verified. The narrow timeout change and this entry are uncommitted; all local
and remote gates must be repeated.

Limitations and non-claims: A 15-second bound reduces scheduler sensitivity but
does not prove the test can never regress in runtime; its actual durations must
remain visible in CI. This correction does not improve application performance,
model quality, context compaction, atomic large-search retention, routing, or
provider capacity. The failed run provides no macOS result.

Paid exposure: `$0`. Diagnosis used GitHub Actions logs and local source only.
No provider, inference, model-list, OpenRouter, retry, fallback, or canary
request occurred.

Next gate: Run the affected test under exact Node 22 and within the full local
suite, obtain independent review of the narrow timeout, commit, run the clean
committed-HEAD and macOS Electron gates, push, and require a new green GitHub
Actions run.

References: [failed replacement run](https://github.com/Lotus2077/SOAR/actions/runs/33269767743),
[retention test](../tests/integration/local-repository-investigator.test.ts),
and [preceding local verification](#bl-20260830-0258-pr5-correction-committed-local-verification----2026-08-30----corrected-pr-5-candidate-passed-clean-committed-head-and-electron-gates).

### BL-20260830-0307-pr5-timeout-correction-local-verification -- 2026-08-30 -- Timeout-corrected candidate passed exact-commit local gates

Status: `Verified`

Scope or hypothesis: Verify that the per-test timeout correction survives both
the remote job's exact Node major and the full clean committed-revision gate,
without changing the proof assertions or dispatching a live request.

Decisions:

- Bind this local claim to commit
  `78fb129d0f8f622e3d66ec698fb54ea93f4f2ee6` and the release wrapper's unchanged
  clean HEAD.
- Require the full exact Node 22 test suite in addition to the isolated timed-out
  test so local concurrency can exercise the new deadline.
- Preserve replacement remote CI as the only resolution for the failed Linux
  run; local timing results cannot mark the pushed state green.

Changes: No production or test change is introduced by this entry. It records
verification of the one-test timeout already committed in `78fb129`.

Evidence:

- The isolated retention proof passed under cached Node 22.22.2 in 2.21 seconds
  of test time, with one selected test passed and 16 unselected tests skipped.
- The complete deterministic suite under cached Node 22.22.2 passed 54 test
  files and 625 tests with two files/four opt-in live tests skipped.
- `pnpm check:release-head` retained clean commit
  `78fb129d0f8f622e3d66ec698fb54ea93f4f2ee6`, validated 26 log entries and all
  42 workload manifests with no tracked or unignored live secret, passed
  TypeScript and the same 625 deterministic tests, and built Electron main,
  preload, and renderer bundles.
- `pnpm test:e2e` passed 3/3 macOS workflows in 7.7 seconds.
- Independent review confirmed the executable correction is one per-test
  timeout argument, leaving both retention scenarios, every assertion, global
  Vitest configuration, and all production limits unchanged.

Failures or blockers: No local blocker remains for this correction. This entry
must still be committed and the exact final revision rechecked before push.
GitHub Actions run `33269767743` remains failed until a new pushed revision
passes both jobs.

Limitations and non-claims: Local Node 22 runs on macOS, not the GitHub Linux
runner. Timing is load-dependent; the finite 15-second test deadline remains an
operational bound rather than a performance guarantee. No live proof or canary
was repeated. The prior product and evaluation non-claims remain unchanged.

Paid exposure: `$0`. Verification used cached local runtimes, deterministic
tests, Git, TypeScript, and Electron build/E2E only. No provider, inference,
model-list, OpenRouter, retry, fallback, or canary request occurred.

Next gate: Commit this entry, rerun the clean committed-HEAD and macOS Electron
gates on the resulting final revision, push it, and require a fresh green Linux
Node 22 plus macOS Electron GitHub Actions run.

References: [timeout correction](#bl-20260830-0303-pr5-remote-retention-timeout-correction----2026-08-30----replacement-ci-exposed-a-proof-test-timing-boundary),
[release verifier](../scripts/verify-release-head.ts), and
[failed replacement run](https://github.com/Lotus2077/SOAR/actions/runs/33269767743).
