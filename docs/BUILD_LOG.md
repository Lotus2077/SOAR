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

### BL-20260830-0312-pr5-correction-remote-verification -- 2026-08-30 -- Corrected PR 5 revision passed Linux and macOS GitHub Actions

Status: `Verified`

Scope or hypothesis: Verify the complete PR 5 correction on the pushed source
revision after both the context-capacity assertion failure and the subsequent
Linux test-timeout failure were corrected and preserved in the ledger.

Decisions:

- Bind remote verification to GitHub Actions run `33270128877` and commit
  `713dabae44e80b3aedeaf43dfa6756c674320c03` only.
- Require both the Linux Node 22 `check` job and its dependent macOS
  `electron-e2e` job to succeed; one green job is not sufficient.
- Preserve failed runs `33267686671` and `33269767743` as historical evidence.
  This successful run supersedes their release status but does not erase the
  defects they revealed.
- Add this remote evidence append-only, then require the resulting log-only
  commit to pass the same local release gate and a fresh GitHub Actions run.

Changes: No production or test behavior is changed by this entry. It records
remote verification of the pushed timeout-corrected PR 5 source revision.

Evidence:

- GitHub Actions run `33270128877` completed with conclusion `success` for exact
  head SHA `713dabae44e80b3aedeaf43dfa6756c674320c03`.
- Linux Node 22 job `99147015114` passed in 1 minute 4 seconds. It validated the
  27-entry log append-only against `9dd724b`, revalidated 22 research and 20
  coding workloads with no tracked or unignored live secret, passed TypeScript,
  passed 54 test files and 625 tests with two files/four opt-in live tests
  skipped, and built all three Electron bundles.
- Dependent macOS job `99147148566` passed in 1 minute 35 seconds. Its Electron
  run passed 3/3 workflows in 32.4 seconds: local tool-loop restart restoration,
  active-inference cancellation, and Review Current Changes with stale
  Markdown-copy refusal.
- The formerly timed-out retention test completed inside the Linux check; the
  full step passed rather than timing out or skipping the assertion.

Failures or blockers: No source-revision local or remote blocker remains for
PR 5. This new log entry is uncommitted and therefore still needs exact-commit
local and remote verification before the branch can be declared fully green.

Limitations and non-claims: CI is deterministic and does not run the live
Repository Investigator proof or structured-schema canary. The remote result
does not prove real-provider quality, endpoint truthfulness, real-repository
review quality, unbounded evidence retention, atomic large-search retention,
dynamic multi-provider routing, cost/latency advantage, notarization, or a
signed release channel.

Paid exposure: `$0` under the approved scope. GitHub-hosted CI ran deterministic
tests and Electron only; all live-provider opt-ins remained off. No provider,
inference, model-list, OpenRouter, retry, fallback, or canary request occurred.

Next gate: Commit this remote-verification entry, run `check:release-head` on
that exact clean commit, push it, and require its Linux Node 22 and macOS
Electron jobs to remain green. After that, PR 5 is closed and PR 6 remains
unapproved.

References: [green GitHub Actions run](https://github.com/Lotus2077/SOAR/actions/runs/33270128877),
[green Linux job](https://github.com/Lotus2077/SOAR/actions/runs/33270128877/job/99147015114),
[green macOS job](https://github.com/Lotus2077/SOAR/actions/runs/33270128877/job/99147148566),
[timeout correction](#bl-20260830-0303-pr5-remote-retention-timeout-correction----2026-08-30----replacement-ci-exposed-a-proof-test-timing-boundary),
and [local verification](#bl-20260830-0307-pr5-timeout-correction-local-verification----2026-08-30----timeout-corrected-candidate-passed-exact-commit-local-gates).

### BL-20260830-0420-pr5-ci-lineage-correction -- 2026-08-30 -- Correction: PR 5 closure includes the failed 9dd724b candidate

Status: `Verified`

Scope or hypothesis: Correct the lineage presentation associated with
`BL-20260830-0312-pr5-correction-remote-verification` by explicitly mapping each
PR 5 closing candidate to its CI outcome. The earlier entry's final green result
is accurate, but the closure is incomplete if presented as an uninterrupted
green sequence.

Decisions:

- Bind commit `9dd724bdd67a1eeaa6f657d8f0c3e2427adc72d` to failed GitHub
  Actions run `33269767743`. Its exact-SHA remote CI failed. The `Verified`
  status inside that documentation commit refers to local verification of
  predecessor `31049bb`, not remote verification of `9dd724b` itself.
- Bind commit `713dabae44e80b3aedeaf43dfa6756c674320c03` to successful
  replacement run `33270128877`, and commit
  `6759b47966e57a2e3276ae7f8c8958b94617c9f8` to successful log-tail run
  `33270368072`.
- Preserve the failed candidate as first-class evidence. Later green revisions
  supersede its branch status but do not erase or convert its result.
- Adopt a bounded non-recursive closure rule for future log-only tails: a commit
  that changes only `docs/BUILD_LOG.md` must still receive the required
  exact-SHA CI checks. The entry may durably record its own ledger decision in
  that commit, as this correction does. If the later checks succeed without
  revealing a new failure or material observation, their immutable status is
  supporting publication evidence, not a distinct ledger-triggering change, so
  it closes the tail without another log-only entry. A failed, skipped,
  cancelled, or materially informative tail run always requires a new
  append-only entry.
- The non-recursive rule is not a CI waiver. It does not cover commits that also
  change runtime, tests, configuration, or other documentation, nor a later
  log-only commit that introduces a new product, architecture,
  persisted-contract, provider, cost, permission, evaluation, failure, or
  milestone decision that has not already been recorded in that same entry.

Changes: Appended this lineage and governance correction only. No runtime,
test, provider, tool, evaluator, context, or routing behavior changed.

Evidence:

- Commit `9dd724bdd67a1eeaa6f657d8f0c3e2427adc72d` changed only
  `docs/BUILD_LOG.md`, but run `33269767743` failed its Linux Node 22 job after
  the retention proof took 5.726 seconds against Vitest's 5-second default
  timeout. The dependent macOS Electron job was skipped.
- Commit `78fb129d0f8f622e3d66ec698fb54ea93f4f2ee6` introduced the narrow
  15-second timeout for that proof without weakening its assertions.
- Run `33270128877` passed both Linux Node 22 and macOS Electron for exact commit
  `713dabae44e80b3aedeaf43dfa6756c674320c03`.
- Run `33270368072` passed both required jobs for exact commit
  `6759b47966e57a2e3276ae7f8c8958b94617c9f8`, which changed only
  `docs/BUILD_LOG.md`: Linux job `99147659808` and macOS Electron job
  `99147789193`.
- Before this correction was appended, `main` was clean at `6759b47`, matched
  `origin/main`, and therefore had a green current exact-SHA CI result despite
  the failed intermediate candidate.

Failures or blockers: The missing explicit commit-to-run mapping in the prior
closure summary is corrected by this entry. This entry is not yet committed,
and no future CI result for its eventual commit is claimed here. If that
exact-SHA CI does not pass, the branch must not be described as green and the
negative result must be appended.

Limitations and non-claims: This is an evidence-lineage and governance
correction, not new product verification. It does not repeat a live proof or
canary and does not prove real-provider quality, real-repository review quality,
dynamic multi-provider routing, cloud execution, cost/latency advantage,
notarization, or a signed release channel. The non-recursive rule relies on
required CI remaining attached durably to the exact log-tail SHA. This entry ID
preserves the ledger's already-committed monotonic local-wall-clock sequence; it
does not resolve the pre-existing mismatch between that sequence and the
written UTC ID rule.

Paid exposure: `$0`. Inspection used local Git history and existing GitHub
Actions results only. No provider, inference, model-list, OpenRouter, retry,
fallback, or canary request occurred.

Next gate: Commit this append-only correction, validate the ledger, run
`pnpm check:release-head` and macOS Electron E2E via `pnpm test:e2e` on the clean
committed HEAD, push, and require both Linux Node 22 and macOS Electron checks
on the exact new SHA. If both pass without a new material observation, close
the log tail under the non-recursive rule; otherwise append the resulting
failure or correction.

References: [affected remote-verification entry](#bl-20260830-0312-pr5-correction-remote-verification----2026-08-30----corrected-pr-5-revision-passed-linux-and-macos-github-actions),
[failed run](https://github.com/Lotus2077/SOAR/actions/runs/33269767743),
[first replacement green run](https://github.com/Lotus2077/SOAR/actions/runs/33270128877),
[green log-tail run](https://github.com/Lotus2077/SOAR/actions/runs/33270368072),
and [timeout correction](#bl-20260830-0303-pr5-remote-retention-timeout-correction----2026-08-30----replacement-ci-exposed-a-proof-test-timing-boundary).

### BL-20260830-0852-local-evaluation-bridge-approved -- 2026-08-30 -- Local Evaluation Bridge v1 approved for one zero-paid production-path proof

Status: `Approved`

Scope or hypothesis: Authorize a narrow zero-paid milestone that connects a
specialized evaluation command to the existing production local-only Review
Current Changes coordinator, corrects active-versus-proposed configuration and
evaluation documentation, and executes at most one bounded nonempty local-vLLM
episode.

Decisions:

- Approve `local-evaluation-bridge-v1-plan-1` only.
- Reuse the exact production `change-review-v1`, `agentic-execution-v2`, and
  `local_only_v1` session contract and coordinator rather than implementing a
  benchmark-only agent.
- Permit only the smallest Electron-free session-service extraction needed by
  IPC and the specialized command, plus a behavior-preserving extraction of
  the duplicated v2 non-cooperative-provider abort race.
- Bind the one live episode to the frozen public
  `cal-001-soar-plan-approval` change from explicit local Git objects. The
  command may use only the existing network-disabled local shared-clone
  materialization; it may not remotely clone, fetch, or accept an arbitrary
  workspace.
- Permit deterministic tests and exactly one live local-vLLM episode after the
  committed deterministic gates pass. A `sent` or disposition-`unknown`
  inference consumes that authority; another live inference requires new
  explicit approval.
- Keep selected metered-provider exposure at zero. PR 6, OpenRouter, Keychain,
  cloud egress, paid calls, fallback, and the broad research/coding campaign
  remain unapproved.
- Make no persisted event, database, routing-policy, provider, tool-permission,
  renderer, IPC, or public API contract change.

Changes: Added the approved Local Evaluation Bridge v1 plan and recorded its
authority boundary. No runtime, provider, inference, credential, egress, or
paid behavior changed at this approval checkpoint.

Evidence: The project owner explicitly approved the named Local Evaluation
Bridge v1 zero-paid milestone in the project task on 2026-08-30. The clean
baseline was `1b86b696b8488a809f3ecd9c3ad2cbd4c8db2f7a`, matching
`origin/main`. Inspection confirmed that the app already owns the local-only
production coordinator, while the benchmark CLI has no agent-episode command
and tracked paid environment variables are not parsed by runtime
configuration. The frozen `cal-001` Git objects are present in the baseline;
no fixture, provider, or network action was needed for approval.

Failures or blockers: The documentation truth corrections, bridge command,
shared service, safe canonical projection, deterministic nonempty fixture
proof, and live nonempty proof are not implemented or verified at this entry.

Limitations and non-claims: Approval is authority to perform the scoped work.
It is not implementation, verification, release, real-review quality evidence,
held-out evaluation, dynamic routing, cloud readiness, cost or latency
advantage, default-context proof, or general reliability evidence.

Paid exposure: `$0`. This approval and its audit used repository inspection
only. No provider, inference, model-list, OpenRouter, credential, retry,
fallback, evaluator, clone, or fetch request occurred.

Next gate: Commit this approval and plan before implementation, then complete
the truth corrections and deterministic bridge without contacting a provider.

References: [Local Evaluation Bridge v1 plan](plans/LOCAL_EVALUATION_BRIDGE_V1.md),
[Hybrid Lease Router plan](plans/HYBRID_LEASE_ROUTER_V0.md),
[benchmark protocol](../benchmarks/README.md), and
[MVP readiness](MVP_READINESS.md).

### BL-20260830-1054-local-evaluation-bridge-implemented -- 2026-08-30 -- Local Evaluation Bridge v1 implemented without provider dispatch

Status: `Implemented`

Scope or hypothesis: Implement the approved
`local-evaluation-bridge-v1-plan-1` zero-paid vertical slice so one specialized
command can run the production local-only change-review coordinator against the
frozen nonempty `cal-001-soar-plan-approval` fixture and judge a privacy-safe
projection of canonical replay. This entry records implementation and focused
deterministic evidence only. It does not claim the pending clean exact-commit
release gates or the authorized real-vLLM episode passed.

Decisions:

- Keep the generic research/coding benchmark CLI as a fixture/evaluator utility
  for caller-supplied submissions. Add a separate
  `pnpm benchmark:local-review` entry that accepts only the fixed calibration,
  an explicit local source repository, a safe run ID, and the live-local flag.
- Require both the command flag and `SOAR_RUN_LIVE_LOCAL_REVIEW_V1=true`, the
  exact recorded context/round/tool/output configuration, local-only provider
  accounting, configured-model health, and an unchanged clean implementation
  revision before inference authority can be claimed. Release-head children
  forcibly clear every live opt-in.
- Share fixed review-session creation between Electron IPC and the bridge. IPC
  retains workspace authorization and returns the created snapshot without
  awaiting background completion; the bridge awaits the same completion handle
  and judges only canonical terminal replay plus `toChangeReviewView`.
- Extract only the duplicated v2 non-cooperative-provider abort race. Timer
  ownership, persistence, attempt accounting, sensitive-output checks, and v1
  execution remain at their existing call sites.
- Reserve the run namespace before later admission and retain a permanent
  ignored `.run-ledger` tombstone. A run ID is non-reusable only while that
  ledger is preserved; a blocked run after reservation consumes the run ID.
- Store the one-live-episode claim separately in fixed OS-user-local
  application state under the committed plan ID. A `sent`, `unknown`, or
  unfinished attempt retains the claim. A definite no-dispatch outcome releases
  it only after its classified result is durably published. A publication
  failure or crash after claim conservatively retains it. This is cooperative
  governance for the same OS account, not a hardened security boundary.
- Publish a strict lossy allow-list of canonical events plus a bounded result.
  Provider bodies, tool bodies, endpoints, credentials, absolute paths, and raw
  diagnostics are excluded and scanned. Emergency projection/output failures
  retain execution facts and safe events only when independently scannable.
- Use exclusive run-directory creation and no-replace fixed files, followed by
  a last-written `publication.complete-v1.json` marker. The directory is not
  atomically published; marker absence means incomplete. Hashes are
  tamper-evident, not immutable.
- Treat the bridge preflight and coordinator admission health checks plus one
  production-reachable synthesis TTL revalidation as the valid passing range of
  two or three checks.
- Isolate both live-evaluator and release-head Git inspection from inherited
  `GIT_*` repository/configuration overrides. The deterministic child also
  removes inherited `GIT_*` values so a clean alternate repository cannot
  substitute for the executing checkout.
- Correct tracked truth: `.env.example` now contains only parsed runtime inputs;
  proposed cloud/provider-pricing and USD 100 campaign data are explicitly
  unapproved non-runtime metadata. PR 6, OpenRouter, Keychain, cloud egress,
  paid inference, fallback, and the 42-workload execution campaign remain
  unapproved and unavailable.

Changes: Added the specialized bridge CLI, frozen-fixture materializer,
OS-user-local one-shot authority ledger, permanent run reservation and safe
result exporter, canonical evaluation logic, and deterministic tests. Added a
shared local-review session service used by IPC and the bridge, plus the bounded
v2 provider-abort helper used by both v2 coordinators. Added final publication
marker metadata to the safe stdout summary and exact cancellation/admission exit
mapping. Updated release-head live-opt-in and Git-environment isolation, provider
readiness schema/validator, environment example, routing/readiness/architecture
truth, and operator documentation. No persisted event, SQLite, renderer, IPC,
public app API, model tool, workspace-write, routing-policy, or production
provider-selection contract changed.

Evidence:

- The focused evaluator/export/CLI matrix passed 46 tests after adding
  cancellation-before-catalog, cancellation-during-revalidation, no-dispatch
  publication-failure retention, unsafe-review evidence retention, write-once
  marker, admission classification, and exact exit-code cases.
- The exact-revision override regressions passed for two independent temporary
  repositories and a dirty requested target. The paired release-head and
  evaluator admission files passed 10 of 10 tests.
- An earlier independent final audit reported no remaining actionable findings.
  Its aggregate bridge review passed 79 focused tests; the
  authority/publication audit passed 42 of 42 tests and the runtime/IPC audit
  passed 72 of 72 tests. A subsequent pre-commit audit found the two issues
  recorded below; neither was allowed into the implementation commit.
- `pnpm typecheck`, `pnpm validate:readiness`, and `git diff --check` passed on
  the implemented working tree. The readiness validator reported 22 research
  and 20 coding manifests and no high-confidence tracked-file secret-pattern
  match; that is a scoped pattern scan, not a proof that secrets cannot exist.
- The deterministic three-health-check regression advances the injected
  coordinator clock beyond its 60-second TTL and still requires a passing
  four-attempt, three-tool canonical episode.
- After correcting the parallel-load clock race described below, `pnpm check`
  passed the final working tree: readiness and the 31-entry build-log validator,
  both TypeScript projects, 62 test files with 692 tests passed and 4 skipped,
  and all Electron-vite main/preload/renderer production builds.

Failures or blockers: The first sandboxed `pnpm check` attempt failed 19
OpenAI-compatible transport tests because the sandbox denied their loopback
listener with `listen EPERM`; 60 other files passed. Re-running outside that
network sandbox passed 61 files, 689 tests with 4 skipped, and the production
build, but later Git-environment and health-count hardening means that earlier
full run is not claimed as the final exact-tree gate. Review also found and
corrected, before commit: disposable-output authority placement; run reservation
after possible dispatch; symlink, no-replace, provider-scalar, trace-coherence,
and false-pass gaps; cancellation misclassification at the second health check;
loss of safe execution evidence on rejected output; implementation-HEAD TOCTOU;
release before failed publication; the valid third health check being rejected;
and inherited `GIT_DIR`/`GIT_WORK_TREE` substitution in both exact-revision
gates. An early temporary-path test used the macOS `/var` alias and returned
`live_authority_unavailable`; inspection confirmed that it neither created nor
consumed the production authority ledger. The first final-tree full-suite run
then passed 61 files but failed the new synthesis-TTL regression: its injected
clock began only one second ahead of wall time, so parallel suite load let the
real session creation timestamp overtake it and only the two normal health
checks occurred. The test clock was moved one day ahead before applying the
same 60,001-millisecond advance, preserving the intended production-reachable
third-check assertion without a wall-time race. No provider request occurred in
any of these failures. The final pre-commit audit then found that absolute-path
scanning used a narrow preceding-character allow-list and could miss POSIX,
Windows, UNC, or home-relative paths immediately following Markdown delimiters;
the scanner now uses a non-path boundary and has delimiter regressions. That
audit also found that the bridge plan said IPC observed the completion promise
even though IPC intentionally discards it; the plan now matches the tested
non-observing behavior.

Limitations and non-claims: Implementation is not `Verified` or `Released`.
The tree is not yet committed at this entry, so the full deterministic
release-head and Electron gates have not run against its exact clean SHA. The
one authorized nonempty real-vLLM episode has not run. Scripted acceptance proves
production-path wiring and strict trace predicates, not review quality, defect
recall, precision, arbitrary-repository behavior, the shipping default context
budget, same-device execution, endpoint billing, infrastructure cost, dynamic
routing, cloud readiness, quality/cost/latency advantage, or execution of the
42 workload manifests. Local-only provider policy can still send fixture
evidence off this Mac when the configured vLLM endpoint is remote. Accepted
review prose and relative evidence references remain untrusted and require
inspection before sharing.

Paid exposure: `$0` selected metered-provider exposure under the existing
operator `local_zero_cost` attestation. No model-list, inference, OpenRouter,
credential, paid reservation, retry, fallback, clone, fetch, evaluator, or other
provider/network request occurred while implementing or deterministically
testing this milestone.

Next gate: Validate this appended entry, run the full deterministic suite and
build, commit the implementation, and require `pnpm check:release-head` plus
macOS Electron E2E on the exact clean commit. Only after those gates pass may
the one authorized local-vLLM episode run. Record its result without rerunning a
sent/unknown attempt, then require Linux Node 22 and macOS Electron GitHub
Actions on the final exact SHA before marking the milestone `Verified`.

References: [approved bridge plan](plans/LOCAL_EVALUATION_BRIDGE_V1.md),
[benchmark operator contract](../benchmarks/README.md#local-evaluation-bridge-v1),
[architecture](ARCHITECTURE.md#benchmark-isolation),
[MVP readiness](MVP_READINESS.md), and
[approval entry](#bl-20260830-0852-local-evaluation-bridge-approved----2026-08-30----local-evaluation-bridge-v1-approved-for-one-zero-paid-production-path-proof).

### BL-20260830-1915-local-evaluation-bridge-cli-separator-correction -- 2026-08-30 -- The documented live command failed closed before provider dispatch

Status: `Implemented`

Scope or hypothesis: Correct the first exact-commit operator invocation after
the documented `pnpm benchmark:local-review -- ...` command exposed a package
runner/CLI argument-boundary mismatch. Preserve the unused one-shot authority
and require a new exact-commit gate before any live retry.

Decisions:

- Accept exactly one conventional standalone `--` only at the beginning of the
  specialized CLI argument vector. Continue rejecting a separator in any other
  position, duplicates, positional inputs, unknown options, and every provider
  override.
- Treat commit `df564fd7b92bb0c5170223acf1d9cd1d117640e6` as deterministic
  evidence but no longer as the live candidate: its release-head and Electron
  gates passed, yet its documented operator command could not enter the
  evaluator.
- Permit a later attempt under the existing approval only because the failed
  command returned `argument_unknown` before fixture materialization, run
  reservation, authority claim, model-list health, or inference dispatch. The
  authority and selected run namespace were both confirmed absent afterward.
- Supply `SOAR_VLLM_COST_POLICY=local_zero_cost` explicitly to the eventual live
  command as the approved operator attestation. Do not persist that
  machine-specific setting in tracked runtime examples or weaken the remote
  endpoint admission check.

Changes: The specialized argument parser now strips one package-runner
separator at position zero. CLI regressions cover the documented form and
continue to reject trailing or repeated separators. No production session,
provider, tool, persisted-event, IPC, renderer, routing, cost, or permission
contract changed.

Evidence:

- Before the operator attempt, `pnpm check:release-head` passed the exact clean
  `df564fd7b92bb0c5170223acf1d9cd1d117640e6` revision: 62 test files and 692
  tests passed with two files and four opt-in tests skipped, both TypeScript
  projects passed, readiness and the 31-entry build log validated, and all
  Electron production bundles built.
- Electron E2E then passed all three macOS workflows on that same exact clean
  revision.
- A read-only configuration probe first rejected the remote route because the
  explicit zero-token-fee operator attestation was absent. Adding the approved
  process-local attestation produced only boolean output and confirmed local
  provider mode, an exact `/v1` base shape, a configured model, exact live
  limits, and the zero-token-fee policy. Neither probe entered the evaluator or
  made a network request.
- The first documented CLI invocation exited 1 with `argument_unknown` because
  the leading separator reached the script. Immediate checks found the live
  authority file, run reservation, and run namespace absent, and the Git tree
  remained clean. No model-list or inference request occurred.

Failures or blockers: The correction is not yet committed and therefore has
not passed `pnpm check:release-head` or Electron E2E on its own exact revision.
The authorized live episode remains pending and must not run until those gates
pass again.

Limitations and non-claims: This is a narrow package-runner compatibility fix,
not new runtime capability. The earlier exact gates do not verify the corrected
tree. A process-local `local_zero_cost` declaration is an operator attestation;
it does not independently prove endpoint billing, infrastructure, electricity,
or network cost. No review-quality, arbitrary-repository, routing-optimization,
cloud, or release claim follows.

Paid exposure: `$0` selected metered-provider exposure. No provider, model-list,
inference, OpenRouter, retry, fallback, clone, fetch, or other network request
occurred in the failed probes or command.

Next gate: Run the focused CLI regressions and validators, commit the correction,
then require release-head and macOS Electron E2E on that exact clean revision.
Only after both pass may the still-unused one-shot local-vLLM authority be
claimed once.

References: [specialized CLI](../scripts/benchmark-local-review.ts),
[CLI tests](../tests/unit/benchmark-local-review-cli.test.ts),
[operator contract](../benchmarks/README.md#local-evaluation-bridge-v1), and
[approved bridge plan](plans/LOCAL_EVALUATION_BRIDGE_V1.md).

### BL-20260830-1930-local-evaluation-bridge-darwin-authority-path-correction -- 2026-08-30 -- Canonical macOS app-state spelling blocked the live authority claim

Status: `Implemented`

Scope or hypothesis: Diagnose and correct the classified
`live_authority_unavailable` result from the first evaluator-entering preflight,
without relaxing filesystem defenses, reusing its run ID, or treating the
pre-inference failure as a live proof.

Decisions:

- Change only the Darwin application-state segment from `SOAR` to canonical
  `soar`, matching the package name and Electron's default user-data namespace.
  Retain the Linux `.local/state/SOAR` locator and all exact `realpath`, symlink,
  ownership-by-handle, exclusive-create, permission, and directory-sync checks.
- Treat this as a pre-verification persisted-locator correction, not a ledger
  migration: both the legacy uppercase spelling and canonical lowercase
  spelling were checked and contained no plan-authority claim. On the current
  case-insensitive volume they identify the same directory; a future migration
  on a case-sensitive volume would require a separate fail-closed decision.
- Permanently retain the blocked `local-review-v1-20260830-01` run reservation
  and safe result. Use a new run ID only after the correction passes exact
  release-head and Electron gates.
- Keep the existing one-live-episode approval available because the failure
  occurred before authority-file creation, session start, canonical event
  persistence, or inference dispatch. Do not count the successful model-list
  health request as the required nonempty episode and do not claim `$0`
  infrastructure cost from the operator's token-fee attestation.

Changes: The Darwin fixed ledger locator and its three documentation references
now use the canonical lower-case app namespace. Tests cover the exact Darwin
and unchanged Linux locators, claim/release/reclaim beneath a pre-existing
lowercase Darwin app-state directory, restrictive ledger/file modes, and
rejection of a symlinked `soar` ancestor. No session, provider, tool, event,
IPC, renderer, routing, evaluator-result, or paid-admission contract changed.

Evidence:

- The corrected CLI candidate
  `afe6441037fe03ea8a78dfec71b17e06138270d2` passed its exact clean
  release-head gate with 62 test files and 694 tests passed, two files and four
  opt-in tests skipped, both TypeScript projects, readiness, the 32-entry build
  log, and all Electron production bundles. Its macOS Electron E2E gate passed
  all three workflows.
- The evaluator then published a classified blocked record for run
  `local-review-v1-20260830-01`: `source = preflight`,
  `failureCode = live_authority_unavailable`, zero safe events, a 1,434-byte
  result with SHA-256
  `cab631fb83ab6392a749bbd5982287b81327357e1e01cf655ccd683d8beb1c66`,
  an empty safe trace with the standard empty SHA-256, and a 283-byte
  last-written completion marker with SHA-256
  `7da0413a7f479328a42afaf1bbddc94c9cbc0274500d46b22c762fd74a22b065`.
  All three files were mode 0600 and their hashes matched the marker.
- Read-only inspection showed that the existing Electron application-state
  directory's canonical basename is lower-case `soar`; resolving the requested
  uppercase candidate returned that canonical spelling, so the intentionally
  strict equality check rejected the alias before creating `evaluation-ledger`.
- Immediately afterward the selected run reservation and completion marker
  existed, both possible authority-file spellings were absent, and the Git tree
  remained clean. By code order and the zero-event record, no session or
  inference attempt began.

Failures or blockers: This locator correction is not yet committed or verified
on an exact clean revision. The selected run ID is consumed. The one authorized
nonempty episode remains pending, and no retry may occur before the corrected
exact gates pass.

Limitations and non-claims: A healthy model-list response proves only that the
configured model was reachable and advertised sufficient capacity at that
moment. It does not prove inference, result quality, zero endpoint or
infrastructure cost, arbitrary-repository behavior, routing advantage, cloud
readiness, or release readiness. The cooperative authority remains a
same-account governance guard, not a security boundary against a malicious
same-user process.

Paid exposure: `$0` selected metered-provider exposure under the operator's
`local_zero_cost` token-fee attestation. One configured-route model-list health
request occurred. No inference, OpenRouter, paid reservation, retry, fallback,
remote clone, or fetch request occurred.

Next gate: Run the authority and evaluator admission regressions, validators,
typechecks, and diff audit; commit the correction; then require release-head and
macOS Electron E2E on that exact clean revision. Only after both pass may a new
run ID attempt to claim the still-unused plan authority once.

References: [authority ledger](../src/benchmark/local-review-authority.ts),
[authority tests](../tests/unit/local-review-authority.test.ts),
[operator contract](../benchmarks/README.md#local-evaluation-bridge-v1),
[architecture](ARCHITECTURE.md#benchmark-isolation), and
[approved bridge plan](plans/LOCAL_EVALUATION_BRIDGE_V1.md).

### BL-20260830-1940-local-evaluation-bridge-live-proof-passed -- 2026-08-30 -- One authorized nonempty production-path episode passed

Status: `Implemented`

Scope or hypothesis: Execute the one authorized zero-selected-metered-exposure
Local Evaluation Bridge v1 episode only after the corrected exact implementation
revision passed release-head and macOS Electron gates, then retain and verify a
privacy-safe proof without treating one accepted review as quality evidence.

Decisions:

- Bind the live claim to implementation revision
  `5be93c100c945cfdebb310f5e36dafa1827b9101`, frozen fixture
  `cal-001-soar-plan-approval`, and fresh run ID
  `local-review-v1-20260830-02`. Retain blocked run 01 and never reuse either run
  ID while the ignored run ledger is preserved.
- Treat the plan authority as consumed because all four inference attempts have
  request disposition `sent`. No further live episode may run under
  `local-evaluation-bridge-v1-plan-1`, even though this episode passed.
- Record the accepted result's bounded shape, execution facts, hashes, and
  non-claims, but not its raw review prose. A model conclusion of no blocking
  findings is untrusted output and is not a defect-quality label.
- Keep the milestone `Implemented`, not `Verified`, until the post-proof
  documentation revision passes both Linux Node 22 and macOS Electron GitHub
  Actions. Never use a documentation-only tail to imply a new live run.

Changes: Updated readiness, architecture, benchmark operator, plan, and root
documentation to record the passed exact local gates and one-shot live proof,
the consumed authority, the required explicit remote-route token-fee
attestation, and pending remote CI. No runtime source, provider, session, tool,
event, IPC, renderer, routing, cost, permission, or evaluator contract changed
after the live proof.

Evidence:

- `pnpm check:release-head` passed exact clean revision
  `5be93c100c945cfdebb310f5e36dafa1827b9101`: readiness and the 33-entry build
  log validated, both TypeScript projects passed, 62 test files and 696 tests
  passed with two files and four opt-in tests skipped, and Electron main,
  preload, and renderer production bundles built.
- `pnpm test:e2e` then passed all three macOS workflows in 9.0 seconds on the
  same clean revision.
- The live result is `passed`, `source = canonical_event_store`, projection
  `local-review-safe-v1`, lossy, with no raw canonical trace export. The session
  completed with review freshness `fresh_complete`, complete two-of-two path
  and three-of-three hunk coverage, zero omissions, snapshot revalidation, a
  53-character nonempty summary, and no emitted finding. The no-finding model
  conclusion is recorded only as result shape, not as correctness gold.
- Canonical reconstruction reports one `local-vllm` provider using `RM-01 VLM`,
  two health checks, two routing decisions at `session_start` and
  `evidence_complete`, zero provider switches, four terminal sent attempts with
  finish reasons `tool_calls`, `tool_calls`, `tool_calls`, and `stop`, and three
  completed tools: `inspect_git_changes`, `read_text_file`, and
  `read_text_file`.
- Usage was 30,770 input tokens, 267 output tokens, zero reported reasoning or
  cache-read tokens, across four reported attempts. Recorded inference latency
  was 15,692.452 ms, tool latency 585.925 ms, and end-to-end latency
  17,080.919 ms. These are one-episode observations, not comparative latency
  evidence.
- The safe canonical trace is contiguous with 34 events. `result.json` is 3,227
  bytes with SHA-256
  `984302948828da2ba2e12c6e4468701a9befc21039c77bf1b4c7a6cd1ba2b0b4`;
  the 17,549-byte safe trace SHA-256 is
  `2db06c1d250086aec25442b2b6dced934d6bbf9dfa9cfc476320519be0e49699`;
  and the 287-byte last-written marker SHA-256 is
  `4b940248e6e31bbf048c2df58317939a048fffdd1def69b9f0d8930635f87037`.
  The marker's embedded result and trace hashes matched recomputation, and all
  three artifacts were mode 0600.
- The plan authority file now exists under the canonical OS-user-local app-state
  ledger, both run reservations are retained, and the tracked Git tree remained
  clean after artifact publication.

Failures or blockers: No local deterministic or live-proof blocker remains.
The documentation and this entry are not yet committed or remotely verified.
The first evaluator-entering run remains a retained classified pre-inference
failure as recorded in the preceding entry; it is not erased by this pass.

Limitations and non-claims: One frozen two-file review proves production-path
wiring, canonical trace integrity, bounded tool use, result acceptance, and
safe publication for that episode only. It does not prove defect recall,
precision, false-accept rate, arbitrary-repository behavior, the shipping
default context budget, same-device execution, zero endpoint/infrastructure
cost, dynamic routing, cloud readiness, quality/cost/latency advantage, the 42
workload campaign, general reliability, or release readiness. Repository
evidence left this Mac because the configured vLLM endpoint was remote.

Paid exposure: Selected metered-provider exposure was exactly 0 microusd under
the operator's `local_zero_cost` token-fee attestation. Endpoint billing,
infrastructure, electricity, and network cost were not independently measured.
This episode used the configured local provider only; no OpenRouter, cloud
provider, paid reservation, retry, fallback, remote clone, or fetch occurred.

Next gate: Validate the documentation diff and build log, commit and push the
post-proof record, then require Linux Node 22 and macOS Electron GitHub Actions
on that exact SHA. Only after both pass may a final documentation-only entry mark
the milestone `Verified`; it must remain not `Released`.

References: [approved bridge plan](plans/LOCAL_EVALUATION_BRIDGE_V1.md),
[operator contract](../benchmarks/README.md#local-evaluation-bridge-v1),
[architecture](ARCHITECTURE.md#benchmark-isolation), and
[MVP readiness](MVP_READINESS.md).

### BL-20260830-1947-local-evaluation-bridge-verified -- 2026-08-30 -- Exact post-proof revision passed Linux and macOS CI

Status: `Verified`

Scope or hypothesis: Close Local Evaluation Bridge v1 only after the retained
live proof, exact local gates, and both required GitHub Actions jobs all passed,
while keeping `Verified` distinct from `Released` and from the original hybrid
routing goal.

Decisions:

- Bind remote verification to exact post-proof revision
  `d5d39d80cbdb7841c4160ca9256b7d4a0b210788` and GitHub Actions run
  `33309497966`; do not infer success from a branch name or a later HEAD.
- Mark only Local Evaluation Bridge v1 `Verified`. Do not mark the app,
  Repository Investigator, hybrid routing, PR 6, the 42-workload campaign, or a
  release as verified by this milestone.
- Keep the consumed plan authority and both run reservations unchanged. This
  status-only closure authorizes no provider contact and cannot be used to
  repeat the live episode.
- Require this documentation-only closure commit to pass the same exact-SHA CI.
  If it fails, append a correction rather than rewriting this entry. If it
  passes, no further self-referential evidence entry is required.

Changes: Updated the root, benchmark, architecture, readiness, and approved-plan
status text from `Implemented; remote CI pending` to `Verified; not Released`.
No runtime source, provider, session, tool, event, IPC, renderer, routing, cost,
permission, evaluator, fixture, or artifact changed.

Evidence:

- GitHub Actions run `33309497966` targeted exact SHA
  `d5d39d80cbdb7841c4160ca9256b7d4a0b210788` and concluded success.
- The Linux Node 22 `check` job completed in 1 minute 3 seconds. It passed
  checkout, dependency installation, pushed append-only build-log verification,
  readiness validation, TypeScript, the full non-live test suite, and the
  production build.
- The macOS `electron-e2e` job completed in 1 minute 29 seconds. It built the
  app and passed the three Electron workflows.
- Before push, the same post-proof SHA passed local `pnpm check:release-head`
  with 62 test files and 696 tests passed, two files and four opt-in tests
  skipped, both TypeScript projects, the 34-entry build log, readiness, and all
  Electron bundles; local Electron E2E passed three of three workflows.
- The preceding entry retains the exact live result, safe-trace, marker hashes,
  token/latency facts, authority consumption, and non-claims. This closure adds
  no new inference evidence.

Failures or blockers: No Local Evaluation Bridge v1 verification blocker
remains. This documentation-only closure commit still needs its own exact-SHA
GitHub Actions run; a failure would invalidate the closure until an append-only
correction passes.

Limitations and non-claims: `Verified` means the narrow frozen-fixture
production-path promise in the approved plan is evidenced. It is not a quality
benchmark, a held-out result, proof of arbitrary-repository behavior, proof of
the shipping default context budget, same-device execution, independent cost
verification, dynamic or cloud routing, a quality/cost/latency optimum, bulk
workload execution, general reliability, or release readiness. The model's
no-blocking-finding conclusion remains untrusted output rather than gold.

Paid exposure: `$0` selected metered-provider exposure under the operator's
token-fee attestation. This closure made no provider, model-list, inference,
OpenRouter, paid reservation, retry, fallback, clone, fetch, or other network
request except the Git push and GitHub Actions status queries.

Next gate: Commit and push this status-only closure and require both exact-SHA
GitHub jobs to remain green. After that, the next product milestone must be
planned and approved separately; PR 6 and every paid or cloud provider path
remain unapproved.

References: [approved bridge plan](plans/LOCAL_EVALUATION_BRIDGE_V1.md),
[operator contract](../benchmarks/README.md#local-evaluation-bridge-v1),
[MVP readiness](MVP_READINESS.md), and
[GitHub Actions run](https://github.com/Lotus2077/SOAR/actions/runs/33309497966).

### BL-20260830-2050-heldout-readiness-approved -- 2026-08-30 -- Offline held-out corpus and evaluator readiness approved

Status: `Approved`

Scope or hypothesis: Interpret the project owner's instruction to proceed with
the next milestone as approval to build the `$0` deterministic held-out corpus
and evaluator readiness layer that was recommended after Local Evaluation
Bridge v1, while refusing to manufacture a quality baseline without sealed gold
and two blinded human adjudicators.

Decisions:

- Approve plan `held-out-corpus-evaluator-readiness-v1-plan-1` for offline
  implementation only. It adds strict private-input contracts, isolation,
  deterministic scoring, safe aggregate publication, a CLI, and synthetic
  tests.
- Keep the frozen `change-review-eval-v1` minimums: exactly 24 fixtures for this
  harness profile, 8 clean, 16 faulty, at least 20 P0/P1 defects, at least 8
  P2/P3 defects, and two humans blinded to policy/provider for semantic finding
  matches.
- Emit no recall, precision, false-accept, or weighted-quality metric while
  adjudication is missing, disputed, or invalid. A region overlap is a
  candidate, not proof that free-text defect and impact semantics match gold.
- Keep runner-facing data and public aggregate free of fixture identity, gold,
  raw review prose, individual judgments, endpoints, credentials, and absolute
  paths. Gold remains external and evaluator-only.
- Keep corpus commitments policy-neutral. Bind policy, provider, model,
  deployment, and configuration in a separate future run manifest so every
  comparison cohort can receive the same immutable evidence packet.
- Keep all 24 fixtures' gold in the primary recall denominators. Non-accepted
  fixtures contribute zero matches, valid novel defects suppress the current
  semantic score pending a new corpus version, and accepted-only diagnostics
  remain separately labeled.
- Treat two-person blinding as a signed external-coordinator trust assertion.
  The harness can verify distinct random study IDs, record independence, and
  signature integrity; it cannot mechanically observe human identity or
  blindness.
- Define deterministic domain-separated salted SHA-256 commitments, cost and
  latency bootstraps, stable non-disclosing errors, stdin-only private CLI
  control, and a no-provider/network import boundary for the offline evaluator.
- Do not generalize or reuse Local Evaluation Bridge v1. Its public fixture,
  four-attempt/three-tool contract, artifacts, and consumed authority remain
  unchanged and retain their Verified status.
- Authorize no provider or model-list request. A future live campaign needs a
  second plan after the set commitment and token envelope are frozen, using a
  new authority ID and at most one no-retry local-only synthesis per slot.

Changes: Added only the approved plan and this ledger entry. No runtime source,
provider, model, session, tool, event, IPC, renderer, routing, cost, permission,
evaluator implementation, private corpus, gold, generated artifact, or live
authority changed.

Evidence:

- The current checkout was clean at baseline
  `b707f4af59d858d06af487073c8af0d99d1f8dbb`, matched `origin/main`, and its
  exact Linux and macOS GitHub Actions closure was green before planning.
- The frozen checked-in protocol already records the 24/8/16 and defect-count
  minimums, separate sealed storage, evaluator formulas, two-human blinded
  adjudication, Wilson intervals, bootstrap cost/latency reporting, and
  invalid/blocked/flaky separation. This milestone adds and freezes a
  deterministic bootstrap seed and replicate contract.
- Repository inspection confirmed that no held-out identity, oracle, gold file,
  or 24-case provider result exists in the project. The 12 checked-in changes
  are routing calibration with attention labels only.
- Three independent read-only reviews agreed that a real quality result is
  blocked by external curation and adjudication. Their pre-commit findings
  corrected policy-dependent commitments, metric populations, novel-defect
  handling, adjudication trust, semantic packets, cost intervals, commitment
  derivation, privacy boundaries, and proof wording in the approved plan.
- A second review pass removed commitment and publication self-references,
  fixed the 32-byte/`0x00` commitment encoding, bound witness-freeze evidence
  and the pre-approved Ed25519 coordinator trust anchor, and made every
  zero-denominator/bootstrap outcome explicitly non-estimable.

Failures or blockers: The first uncommitted draft had ambiguous recall
denominators, contradictory novel-defect precision credit, policy-dependent set
commitments, overclaimed human/blinding verification, and incomplete privacy,
cost-interval, commitment, trust-anchor, zero-denominator, witness-binding, and
publication semantics. Independent review caught and this approval checkpoint
corrects those defects before implementation. A true
held-out baseline still cannot finish under this approval: no independent
curator bundle, two-person adjudication team/coordinator attestations, private
repository map, deterministically executed witnesses, exact deployment
fingerprint, or committed campaign/token envelope exists. These block live
execution and a quality claim, not the approved offline harness.

Limitations and non-claims: Approval is not implementation, verification,
execution, a quality result, end-to-end app evidence, routing benefit, cloud or
hybrid comparison, cost saving, latency advantage, generalization, or release.
The future fixed-provider synthesis cohort will still not measure model-driven
repository acquisition.

Paid exposure: `$0`. Planning used only local source and deterministic
inspection. No model-list, inference, provider, OpenRouter, paid reservation,
retry, fallback, clone, fetch, or other network request occurred.

Next gate: Validate and commit this approval checkpoint before implementation.
Then implement the strict offline contracts, scorer, intervals, safe aggregate
exporter, CLI, and adversarial synthetic tests. Require exact local and remote
gates before marking the harness `Verified`; do not contact a provider.

References: [approved readiness plan](plans/HELD_OUT_CORPUS_EVALUATOR_READINESS_V1.md),
[frozen protocol](../benchmarks/change-review/protocol-v1.json),
[calibration boundary](../benchmarks/change-review/README.md#held-out-boundary),
and [MVP readiness](MVP_READINESS.md).

### BL-20260830-1454-build-log-utc-reset -- 2026-08-30 -- Correction: resume UTC build-log IDs after the legacy local-clock sequence

Status: `Implemented`

Scope or hypothesis: Correct the pre-existing mismatch between the ledger's
written UTC-ID rule and its already-committed local-wall-clock ID sequence
without rewriting immutable entries or inventing a future UTC timestamp. The
immediately preceding approval entry encoded Asia/Shanghai wall time as though
it were UTC, so the honest current UTC minute appeared to move backward under
the validator.

Decisions:

Timestamp sequence reset after: `BL-20260830-2050-heldout-readiness-approved`.

- Preserve every earlier ID byte-for-byte as an immutable identifier. In
  particular, do not rename the immediately preceding entry or the earlier
  `BL-20260830-0420-pr5-ci-lineage-correction` that first documented the
  local-wall-clock/UTC mismatch.
- Permit exactly one machine-readable timestamp-basis reset. It is valid only
  on an `Implemented` entry whose title begins `Correction`, whose exact marker
  names the immediately preceding entry, whose new ID actually moves backward,
  and when no prior reset has been consumed.
- After this correction, resume normal monotonic UTC IDs from this entry's real
  UTC minute. Reject an unnecessary, malformed, non-immediate, non-correction,
  non-implemented, repeated, or later backward reset.
- Keep physical append order as merge chronology. The reset changes only the
  validator's timestamp watermark; it does not reorder, reinterpret, or erase
  any earlier product, failure, cost, or verification evidence.

Changes: Added a one-time fail-closed timestamp-sequence reset contract to
`scripts/validate-build-log.ts` and adversarial unit coverage in
`tests/unit/build-log-validator.test.ts`. Appended this correction before the
new held-out implementation entry. No prior build-log byte, runtime, provider,
session, evaluator result, permission, cost, or release state changed.

Evidence:

- The reset marker is exact and names the immediately preceding
  `BL-20260830-2050-heldout-readiness-approved` entry.
- Unit fixtures cover one valid reset followed by a normal UTC entry and reject
  a non-correction title, non-Implemented status, non-immediate target,
  malformed marker, unnecessary reset, second reset, and later backward ID.
- The focused build-log validator suite passed 15 of 15 tests; the repository
  ledger validated with 38 entries and passed byte-for-byte append-only
  validation against `HEAD`.
- Both TypeScript projects and `git diff --check` passed after the reset.
  Final exact-tree `pnpm check` then passed the same ledger/readiness gates, 68
  test files and 805 tests with two files and four opt-in tests skipped, and all
  production bundles. The eventual committed clean-HEAD gate remains pending.

Failures or blockers: A true UTC implementation ID initially failed with
`timestamp precedes the previous timestamped entry` because the committed
high-water mark was the local-clock `2050` approval ID. Continuing with a
fabricated later UTC minute would violate the written rule; rewriting the
approval entry would violate append-only history. This explicit single-use
reset is the narrow correction. The underlying mismatch was already disclosed
by `BL-20260830-0420-pr5-ci-lineage-correction`; later entries continued that
legacy sequence until this correction.

Limitations and non-claims: The validator checks canonical ID syntax,
append-only order, uniqueness, reset shape, and post-reset monotonicity. It
cannot independently observe an author's wall clock or prove that any ordinary
ID was created at its encoded minute. This governance repair does not verify
the held-out evaluator, repeat any live run, change routing, improve review
quality, authorize a provider, or release the app.

Paid exposure: `$0`. The correction used local ledger inspection and
deterministic tests only. No provider, model-list, inference, OpenRouter,
reservation, retry, fallback, clone, fetch, or other network request occurred.

Next gate: Commit the exact locally passing tree, run the clean-HEAD release
gate, push it, and require exact-SHA Linux and macOS CI. Keep the following
held-out milestone `Implemented` until both remote jobs pass.

References: [affected immediately preceding approval](#bl-20260830-2050-heldout-readiness-approved----2026-08-30----offline-held-out-corpus-and-evaluator-readiness-approved),
[earlier mismatch disclosure](#bl-20260830-0420-pr5-ci-lineage-correction----2026-08-30----correction-pr-5-closure-includes-the-failed-9dd724b-candidate),
and [build-log rules](#log-rules).

### BL-20260830-1454-heldout-readiness-implemented -- 2026-08-30 -- Offline held-out evaluator implemented; exact-tree and remote verification pending

Status: `Implemented`

Scope or hypothesis: Implement only the `$0`, deterministic, offline
runner/evaluator boundary approved by
`held-out-corpus-evaluator-readiness-v1-plan-1`. The milestone should make a
future independently curated 24-case review campaign mechanically evaluable
without placing gold in the runner or public output. It must not create a real
corpus, contact a provider, execute a campaign, or claim measured review
quality.

Decisions:

- Keep the runner contract policy-neutral and fixed at 24 opaque ordered
  assignments. Corpus identity, gold, witnesses, semantic findings,
  adjudication, salts, and human records remain evaluator-private.
- Bind the 8-clean/16-faulty corpus, minimum 20 P0/P1 and 8 P2/P3 gold counts,
  evidence/prompt/limit commitments, corrected-candidate witnesses, run
  manifest, and terminal result records with strict schemas and
  domain-separated canonical SHA-256 commitments.
- Require all 24 terminal outcomes. Accepted records must internally assert at
  least one inference, positive input/output usage, complete usage reporting,
  measured latency, and non-`no_dispatch` cost provenance. Treat those as
  checked operator assertions, not independent execution proof.
- Require two distinct study-ID judgments for every finding. Bind every full
  judgment disposition to a coordinator Ed25519 attestation and every
  disagreement to a separately signed joint resolution. Verify the manifest's
  coordinator-key fingerprint while retaining external approval, personhood,
  and actual blinding as explicit trust boundaries.
- Keep all assigned gold in primary recall denominators, penalize duplicate
  matches in precision, expose valid-review yield over 24 assignments, and
  suppress semantic metrics for incomplete or unverified adjudication and
  valid novel defects. Use exact Wilson 95% calculations and fixed-seed
  Mulberry32 bootstrap contracts with explicit zero/unknown states.
- Publish only a strict allow-listed aggregate and a last-written completion
  marker under a no-replace private namespace. Reparse and cross-check the
  public aggregate before publication, scan bounded canonical JSON for private
  values and unsafe path/URL/key forms, and return stable non-disclosing JSON.
- Use `node --no-warnings --experimental-strip-types` with explicit `.ts`
  imports for the standalone CLI. Do not use the `tsx` CLI or loader because
  that dependency graph can import networking and local IPC machinery.
- Treat recursive source/import scanning as a conservative regression gate,
  not an operating-system egress sandbox or proof of formal noninterference.
- Keep this milestone `Implemented`. Focused synthetic proof is not a real
  campaign, `Verified` exact-SHA status, execution result, or release.

Changes:

- Added the strict runner/run-manifest/run-result contracts in
  `src/shared/heldout-review-runner-contracts.ts` and evaluator-private corpus,
  witness, finding, judgment, attestation, and resolution contracts in
  `src/benchmark/heldout-review-evaluator-contracts.ts`.
- Added deterministic scoring and strict public-aggregate validation in
  `src/benchmark/heldout-review-evaluator.ts`, Wilson/bootstrap operational
  statistics in `src/benchmark/heldout-review-statistics.ts`, and exclusive
  aggregate/marker publication in
  `src/benchmark/heldout-review-publication.ts`.
- Added the stdin-only offline CLI in
  `scripts/benchmark-heldout-review.ts` and the
  `pnpm --silent benchmark:heldout-review` operator command. Enabled explicit
  TypeScript import extensions in the no-emit renderer typecheck so the same
  shared graph works under Node's native strip-only loader.
- Added generated in-memory synthetic inputs and unit/adversarial coverage for
  contracts, semantic scoring, operational statistics, public aggregate
  integrity, privacy-safe publication, clean-process CLI behavior, and
  recursive import isolation. No real fixture, gold, salt, signature, result,
  database, or generated publication was added.
- Updated the root, benchmark, architecture, readiness, and approved-plan
  documentation to describe the implemented offline boundary, operator
  assertions, external trust dependencies, and remaining campaign gate.

Evidence:

- The focused held-out suite passed 101 of 101 tests across six files after
  the final native-entrypoint and aggregate-integrity repairs.
- Both Node and renderer TypeScript projects passed. `git diff --check` also
  passed.
- A clean-process `pnpm --silent benchmark:heldout-review` with empty standard
  input returned only the stable bounded `control_invalid` JSON and exit code
  1, rather than an uncaught loader or module-resolution exception.
- Synthetic success exercises all 24 accepted assignments, signed complete
  adjudication, deterministic semantic and operational metrics, strict
  aggregate reparsing, and no-replace publication. Adversarial tests reject
  corpus, witness, run-envelope, usage, key, signature, resolution, metric,
  cost, privacy, loader, and output-integrity mutations.
- Final exact-tree `pnpm check` passed readiness and the 38-entry build-log
  validators, both TypeScript projects, 68 test files and 805 tests with two
  files and four opt-in tests skipped, and the Electron main, preload, and
  renderer production bundles.
- `pnpm test:e2e` passed all three macOS workflows in 9.9 seconds: a local tool
  loop with restart restoration, active-inference cancellation, and current-Git
  review with stale-copy refusal.
- Two final independent reviews found no remaining P0/P1 code blocker after
  the native-strip and aggregate cross-field corrections. Commit, push, and
  exact-SHA Linux/macOS CI are still pending and therefore are not claimed by
  this entry.

Failures or blockers:

- Pre-commit review found and corrected nondeterministic locale-dependent
  ordering, a zero-finding blocking conclusion, missing strict public-output
  allowlisting, unsafe publication-ID treatment, nondeterministic parallel read
  errors, and acceptance of a private signing key as a verification key.
- Adversarial review found that judgment dispositions and disputed resolutions
  could initially be rewritten without the coordinator key. The contracts now
  use non-circular signed judgment commitments and separately signed joint
  resolutions.
- Initial run validation allowed accepted records with zero inference/usage,
  allowed non-accepted attempted work to claim `no_dispatch`/zero cost, ignored
  a manifest/key mismatch when no finding existed, omitted unreported-attempt
  counts and valid-review yield, and failed to enforce several manifest
  envelope totals. Those paths now fail closed or remain explicitly visible.
- The first isolation test used bypassable regular expressions. It was replaced
  with recursive TypeScript parsing plus strict process/member and module
  allowlists, including computed-loader and alias counterexamples.
- The first package command used the `tsx` loader. Independent review showed
  that loader's dependency graph imports `node:net`, worker/module loading, and
  local IPC code. After switching prematurely to native stripping, the real
  standalone command crashed with `ERR_MODULE_NOT_FOUND` because its relative
  imports lacked `.ts` suffixes; the Vitest subprocess had masked that defect.
  The final command uses native strip-only loading, explicit suffixes, and a
  clean minimal subprocess environment. The standalone negative result is
  retained here and is not erased by the passing correction.
- The exported public aggregate schema initially allowed mathematically
  contradictory direct inputs, including a 120-outcome partition and forged
  completion/adjudication states. Cross-field refinements and table-driven
  mutation tests now bind outcome, adjudication, Wilson/raw/weighted semantic,
  operational, cost, bootstrap, usage, infrastructure, and fixed non-claim
  fields.
- A later cost audit found the inverse run-record gap: zero inference attempts
  could still claim provider or host token cost on invalid, blocked, or
  cancelled outcomes. Zero attempts now require `no_dispatch`, zero selected
  token cost, and zero provider usage while retaining honest pre-inference tool,
  latency, and infrastructure facts. The public aggregate now also requires
  accepted count not to exceed attempts, reported attempts, aggregate input
  tokens, or aggregate output tokens, and zero aggregate attempts require 24
  known zero selected costs. Further direct-schema counterexamples added tight
  corpus gold and accepted-finding caps, bounded unknown-cost assignments by
  dispatched non-unstarted capacity, and prevented false-accept erasure or
  forgery through infeasible eligible-fixture, accepted, or unmatched-gold
  counts.
- The publisher's first trusted-system-alias implementation allowed macOS
  `/tmp` during component inspection but rejected the same exact trusted
  symlink when it was the nearest existing ancestor of a missing output root.
  It now canonicalizes only the exact allow-listed alias and retains strict
  rejection for every other symlink; a Darwin-only unique-child regression
  covers the previously failing path without replacing an existing target.
- An earlier full-suite attempt inside the restricted sandbox failed 19 local
  OpenAI-compatible integration tests with `listen EPERM 127.0.0.1`. That was
  an environment-level loopback denial rather than a product assertion; the
  final exact tree passed the full suite after loopback binding was explicitly
  allowed. The negative attempt remains recorded here.
- A real quality baseline remains blocked by independent corpus curation,
  deterministic witness execution, two blinded humans, an external
  coordinator and approved trust anchor, deployment fingerprints, and a new
  committed one-shot campaign authority. These are intended external gates,
  not implementation defects to paper over with synthetic data.

Limitations and non-claims: The current tests prove deterministic behavior for
generated synthetic and adversarial records only. They do not prove a real
fixture identity, gold correctness, personhood, blinding, signature-key
preapproval, provider execution, review correctness, recall, precision,
false-accept rate, general code-review quality, routing benefit, cost saving,
latency advantage, cloud/hybrid readiness, or release readiness. Operator run
records are unsigned assertions and the evaluator cannot independently re-prove
individual attempt timeouts or failed tool-attempt ceilings from the retained
fields. The safe aggregate intentionally omits the complete private manifest
hash, implementation revision, and campaign authority, so aggregate-only
comparisons require retained private manifests or a future privacy-safe public
binding. Hashes detect later mutation; they do not make storage immutable.

Paid exposure: `$0`. Implementation and proof used local source, generated
in-memory records, local cryptography, and local deterministic tests only. No
model-list, inference, configured provider, OpenRouter, paid reservation,
retry, fallback, clone, fetch, or other network request occurred.

Next gate: Commit the exact locally passing tree, run the clean-HEAD release
gate, push the implementation, and require Linux Node 22 and macOS Electron
GitHub Actions on that exact SHA. Only a subsequent append-only closure may
mark this milestone `Verified`; no provider campaign is authorized.

References: [approved readiness plan](plans/HELD_OUT_CORPUS_EVALUATOR_READINESS_V1.md),
[operator contract](../benchmarks/README.md#held-out-corpus-and-evaluator-readiness-v1),
[architecture](ARCHITECTURE.md#offline-held-out-runnerevaluator-boundary),
[frozen protocol](../benchmarks/change-review/protocol-v1.json), and
[MVP readiness](MVP_READINESS.md).

### BL-20260830-1523-heldout-readiness-verified -- 2026-08-30 -- Exact held-out evaluator implementation passed Linux and macOS CI

Status: `Verified`

Scope or hypothesis: Close only Held-out Corpus and Evaluator Readiness v1
after the complete deterministic offline implementation passed clean committed-
HEAD local gates and both required GitHub Actions jobs on the exact pushed SHA.
Keep evaluator-readiness verification distinct from a real corpus campaign,
quality measurement, product execution, and release.

Decisions:

- Bind verification to exact implementation revision
  `0819a60f22ce442b481063d8575d1533540d0f4d` and GitHub Actions run
  `33319354110`; do not infer success from `main` or a later revision.
- Mark only the deterministic offline harness `Verified`. Do not mark a real
  held-out set, witnesses, human adjudication, provider campaign, review-quality
  result, routing advantage, app execution, or release as verified.
- Preserve all negative pre-commit findings in
  `BL-20260830-1454-heldout-readiness-implemented`, including loader failure,
  cost and aggregate-integrity counterexamples, macOS alias failure, and the
  sandbox loopback denial. Later green evidence does not erase them.
- Keep the external curator, two blinded humans, coordinator/trust-anchor
  approval, private manifest retention, and new one-shot campaign authority as
  future gates. This closure authorizes no provider or model-list contact.
- Require this status-only documentation closure to receive the same exact-SHA
  Linux and macOS CI. Under the existing non-recursive log-tail rule, a clean
  green closure run needs no third status-only entry; any failure, skip,
  cancellation, or material observation requires an append-only correction.

Changes: Updated root, readiness, and approved-plan status text from
`Implemented; remote verification pending` to `Verified as an offline harness;
not Executed or Released`, and appended this closure. No runtime, evaluator,
contract, test, provider, model, session, tool, IPC, renderer, permission,
fixture, gold, artifact, routing, or cost behavior changed.

Evidence:

- Local `pnpm check:release-head` verified clean committed HEAD
  `0819a60f22ce442b481063d8575d1533540d0f4d`: readiness, the 38-entry build
  log, both TypeScript projects, 68 test files and 805 tests passed with two
  files and four opt-in tests skipped, and all Electron production bundles
  built.
- Local `pnpm test:e2e` then passed all three macOS workflows in 9.9 seconds on
  the same commit.
- GitHub Actions run `33319354110` targeted exact SHA
  `0819a60f22ce442b481063d8575d1533540d0f4d` and concluded success.
- The Linux Node 22 `check` job `99278479749` completed in 1 minute 10 seconds
  after passing pushed append-only ledger validation and the full
  validate/typecheck/test/build command.
- The dependent macOS `electron-e2e` job `99278630318` completed in 1 minute
  17 seconds after building the app and passing all Electron workflows.
- Final independent correctness and governance reviews reported no remaining
  P0/P1 blocker after the recorded native-loader, public-aggregate, cost,
  trusted-alias, and UTC-ledger corrections.

Failures or blockers: No deterministic offline evaluator-readiness blocker
remains. This documentation-only closure commit still needs its own exact-SHA
GitHub Actions run. Until it passes, the implementation evidence is green but
the branch's closure status is pending publication verification. Every earlier
negative result remains in the preceding implementation and UTC-correction
entries.

Limitations and non-claims: `Verified` means the strict offline contracts,
scorer/statistics, safe publisher, CLI, isolation regression gates, and
synthetic/adversarial tests passed on the exact implementation SHA. It does not
prove real corpus identity or gold, witness correctness, personhood, blinding,
trust-anchor preapproval, provider execution, review quality, recall,
precision, false-accept rate, routing benefit, cloud/hybrid readiness, cost or
latency advantage, general reliability, or release readiness. Run telemetry
remains operator-asserted; the public aggregate omits the full private manifest,
implementation binding, and campaign authority; static isolation is not an OS
egress sandbox.

Paid exposure: `$0`. Verification used local deterministic tests, local
Electron, Git push, and GitHub Actions only. No model-list, inference,
configured provider, OpenRouter, paid reservation, retry, fallback, clone,
fetch, or campaign request occurred.

Next gate: Validate, commit, and push this status-only closure, then require
both exact-SHA GitHub jobs to pass. After that, any real held-out campaign needs
a separately proposed and approved plan with independently supplied private
evidence and explicit execution authority; no provider campaign is authorized
here.

References: [verified implementation entry](#bl-20260830-1454-heldout-readiness-implemented----2026-08-30----offline-held-out-evaluator-implemented-exact-tree-and-remote-verification-pending),
[UTC correction](#bl-20260830-1454-build-log-utc-reset----2026-08-30----correction-resume-utc-build-log-ids-after-the-legacy-local-clock-sequence),
[approved plan](plans/HELD_OUT_CORPUS_EVALUATOR_READINESS_V1.md),
[operator contract](../benchmarks/README.md#held-out-corpus-and-evaluator-readiness-v1),
[MVP readiness](MVP_READINESS.md), and
[GitHub Actions run](https://github.com/Lotus2077/SOAR/actions/runs/33319354110).

### BL-20260830-1629-pr6a-cloud-setup-approved -- 2026-08-30 -- PR6A Cloud Setup and Dispatch Lock approved at zero provider exposure

Status: `Approved`

Scope or hypothesis: Correct the post-PR5 product sequence by freezing further
evaluator expansion and authorizing the smallest local foundation for a future
production cloud route. PR6A adds cloud Settings, direct macOS Keychain
credential lifecycle, metadata-only readiness, pure canonical-message egress
admission, and structural dispatch interlocks while production remains
Local-only.

Decisions:

- Approve `pr6a-cloud-setup-dispatch-lock-v1-plan-1` for local `$0`
  implementation only. The project owner's contextual instruction to proceed
  followed an explicit calibration that named the PR6A/PR6B split, kept the paid
  canary separately gated, and stopped evaluator-only work.
- Split parent PR 6. PR6A is cloud setup with no provider contact; PR6B is
  provider validation and one paid canary and remains unapproved.
- Keep candidate metadata separate from runtime providers. Production
  `ProviderRegistry` remains local-only, no cloud `InferenceProvider` is
  constructed, and the fake-only hybrid coordinator remains test-only.
- Use a direct generic-password item in macOS Keychain. The main process invokes
  `/usr/bin/security` without a shell, supplies writes through stdin with `-w`
  last, and never places the credential in argv, environment, logs, errors,
  events, SQLite, renderer storage, or returned IPC data.
- Keep cloud onboarding optional. Settings may add, replace, report local
  presence, and delete a credential, but it must say `stored, not validated`
  and `Hybrid locked`; there is no validation action in PR6A.
- Implement the egress guard as a pure shadow check over canonical candidate
  messages plus a host-derived provenance manifest. It returns only version,
  pass/deny, bounded codes, and semantic message/provenance hashes; it neither
  attaches to a live session nor performs egress. The hash is not an HTTP-wire-
  byte claim; PR6B must re-run admission immediately before dispatch.
- Preserve every production execution interlock: review creation remains
  `local_only_v1` with consent `none`, Hybrid remains disabled, no real campaign
  or reservation exists, and any forged Hybrid request fails before credential,
  runtime, budget, or network work.
- Use only isolated synthetic credential identities in tests. Do not read,
  migrate, validate, or exercise the user's existing real credential.

Changes: Added the approved PR6A plan and this append-only decision entry. No
runtime, credential, Keychain, renderer, IPC, provider, model, session, egress,
budget, evaluator, database, event, tool, or network behavior changed at this
approval checkpoint.

Evidence:

- Baseline `e73f5d3012e0e478eb158fea740f9dd60b82ae08` was clean, matched
  `origin/main`, and exact-SHA GitHub Actions run `33319679991` was green before
  planning.
- Live source inspection confirmed that production constructs one local or fake
  provider, passes no real hybrid runtime, creates only local change-review
  sessions, exposes no credential Settings IPC, and visibly disables Hybrid.
- Independent runtime, product/UX, and governance audits agreed that a truthful
  offline milestone can add a locked cloud candidate and local setup foundation
  but cannot claim a second runtime provider or cloud readiness.
- The installed macOS `security` help explicitly warns that passing a password
  as a `-w` argument is insecure and supports prompting when `-w` is last. The
  implementation must prove stdin handling without exposing the synthetic
  sentinel in argv or output.
- The first uncommitted `pnpm check` attempt ran inside the restricted execution
  sandbox. Its loopback adapter fixture could not bind `127.0.0.1` and 19
  OpenAI-compatible tests failed with `listen EPERM`; the other 786 tests passed
  and four were skipped. The same checkout reran outside that loopback
  restriction: readiness and the 40-entry build log passed, both TypeScript
  projects passed, 68 test files and 805 tests passed with two files/four tests
  skipped, and all Electron bundles built.

Failures or blockers: PR6A is not implemented. Direct Keychain subprocess
behavior, renderer secret clearing, setup lifecycle, the pure egress
guard, and all dispatch-lock assertions remain to be built and verified. The
dated proposed provider snapshot is stale for runtime admission and is not
approved as a source of model, price, capability, or limit truth. The restricted
sandbox result is not a code failure, but it is retained because the initial
verification environment could not satisfy the loopback test prerequisite.

Limitations and non-claims: Approval is authority for the exact local plan, not
implementation, verification, release, production cloud readiness, credential
validity, provider availability, egress proof against a real repository,
provider switching, quality, cost saving, latency improvement, or a general
Manus/Genspark/Claude Code agent. The bounded scanner will not be general DLP.

Paid exposure: `$0`. Planning used local repository and installed-tool
inspection only. No configured vLLM, OpenRouter, model-list, key-metadata,
pricing, health, limit, inference, retry, fallback, evaluator, or other network
request occurred. No real credential was read or written.

Next gate: Validate, commit, and push this plan/approval checkpoint and require
its exact-SHA Linux and macOS CI to pass. Only then begin PR6A implementation.
PR6B still requires a separate proposed plan and explicit approval before any
provider contact, credential validation, repository egress, paid reservation,
or cloud inference.

References: [approved PR6A plan](plans/PR6A_CLOUD_SETUP_DISPATCH_LOCK_V1.md),
[parent Hybrid Lease Router plan](plans/HYBRID_LEASE_ROUTER_V0.md),
[MVP readiness](MVP_READINESS.md),
[checkpoint-router ADR](adr/0004-checkpoint-router-budget-runner-v0.md), and
[baseline CI run](https://github.com/Lotus2077/SOAR/actions/runs/33319679991).

### BL-20260830-1726-pr6a-cloud-setup-implemented -- 2026-08-30 -- PR6A Cloud Setup and Dispatch Lock implemented locally

Status: `Implemented`

Scope or hypothesis: Implement the approved PR6A local-only boundary for a
future cloud route: optional credential Settings, direct macOS Keychain setup
lifecycle, metadata-only cloud-candidate state, a pure canonical-message egress
guard, and structural production dispatch interlocks. Preserve immediate Local
review, make no configured or external LLM-provider request from the PR6A setup
path or proof, spend `$0`, and keep PR6B unapproved.

Decisions:

- Keep the cloud candidate outside `ProviderRegistry` and outside the
  `InferenceProvider` type. Production still constructs exactly one local or
  deterministic fake provider and passes no real hybrid runtime.
- Give PR6A a setup-only credential-store interface with status, write/replace,
  and delete. It has no secret read or dispatch-time resolution method.
- Serialize credential mutations and fail a concurrent save/delete with a
  stable `operation_in_progress` result before the rejected secret reaches the
  store. Coalesce concurrent metadata reads, but do not make Local review wait
  for Keychain status.
- Keep all Hybrid availability copy state-neutral: storing a credential does
  not enable Hybrid. A forged Hybrid review request is rejected before
  credential, provider, session, campaign, budget, or network work.
- Treat canonical-message provenance as an exact UTF-16 segment partition bound
  to semantic hashes. Deny missing consent, incomplete provenance, roots and
  traversal variants, recognized secrets, denied paths, unadmitted artifacts,
  tool definitions, and any assistant-owned `tool_calls` field. Return only
  bounded reason codes and hashes.
- Keep Settings optional and renderer-secret handling one-way: the uncontrolled
  password field is cleared synchronously before IPC, no browser storage is
  used, and IPC returns metadata only. Add deliberate keyboard focus entry,
  confirmation, cancellation, deletion, and return behavior.
- Keep the setup adapter on the documented terminating `/usr/bin/security`
  write form for PR6A. An attempted `-T ""` ACL tightening required interactive
  authorization and hit both the test and adapter timeout, so it was reverted.
  The current staged item is not app-identity-isolated; native Security-
  framework identity/ACL design plus migration or recreation is a hard PR6B
  prerequisite before any read capability.
- Treat `/usr/bin/security` exit status as the protocol and discard bounded
  stdout/stderr. The approved plan's `malformed-output` wording means stream
  errors and output-limit violations fail closed; PR6A does not parse or claim
  semantic validity for arbitrary diagnostic text.

Changes:

- Added strict shared cloud-setup contracts, a locked metadata-only candidate,
  direct `/usr/bin/security` Keychain adapter, an ephemeral fake-mode presence
  store, credential lifecycle service, and pure egress-policy module.
- Added narrow main/preload/renderer status, save/replace, and delete methods;
  optional Cloud Settings; accurate stored-but-unvalidated and Hybrid-locked
  states; and production construction that contains no cloud transport.
- Added bounded subprocess time, output, kill, and close handling. Credential
  writes use argument-array execution with no shell, put `-w` last, and provide
  the synthetic value only through standard input.
- Added unit, integration, renderer, IPC, provider-registry, and Electron tests
  for lifecycle, restart, concurrency, secret isolation, focus, forged inputs,
  Local readiness, path/secret/provenance adversaries, and construction locks.
- Replaced raw strict-schema exceptions at the credential IPC boundary with a
  constant `invalid_credential` status, added unknown-presence recovery after
  resolved Keychain failures, and closed egress scanning over bounded Unicode,
  percent, slash, and path transforms with fail-closed transform exhaustion.
- Updated the architecture, routing, readiness, README, and approved-plan status
  to describe the implemented local boundary without claiming cloud readiness.

Evidence:

- The evidence below applies to the dirty implementation working tree based on
  approval checkpoint `21db5e988dce42e70fbfaf0bd69accc528672e66`; it is not a
  clean release-head or exact implementation-SHA claim.
- Approval checkpoint `21db5e988dce42e70fbfaf0bd69accc528672e66`
  predates runtime work and passed exact-SHA GitHub Actions run `33323059340`,
  including Linux check job `99288305404` and macOS Electron job
  `99288440431`.
- `pnpm typecheck` passed both TypeScript projects. The nine-file focused
  `pnpm exec vitest run` command over cloud contracts/service/stores, egress,
  IPC, provider-registry, and renderer review/Settings tests passed 132 tests.
- Final dirty-tree `pnpm check` passed readiness for 22 research plus 20 coding
  workloads, the 41-entry ledger, both TypeScript projects, 74 test files with
  three skipped, 914 tests with five skipped, and all main, preload, and
  renderer bundles.
- Before the late IPC, renderer, and egress-only corrections, the opt-in command
  `SOAR_RUN_KEYCHAIN_INTEGRATION=true pnpm exec vitest run` over the integration,
  native-store, credential-service, and ephemeral-store files passed four files
  and 46 tests. It used one unique synthetic item, observed
  add/status/reconstruction/replace/delete, and verified absence after cleanup;
  it did not read or modify a real credential. The adapter source was restored
  to that same command form after the later rejected ACL experiment, but a
  post-revert platform rerun is currently blocked as recorded below.
- Final dirty-tree `pnpm test:e2e` passed all three Electron workflows,
  including restart, cancellation, and Local current-change review with the
  optional Settings and disabled-Hybrid assertions embedded in the review
  workflow.
- An earlier dirty-tree `pnpm package:mac` built and locally signed the app,
  verified the app and extracted archive signatures, and produced a verified
  arm64 archive before the late corrections. The final package rerun rebuilt
  the corrected bundles but did not finish, as recorded below. Readiness found
  no high-confidence tracked-file secret pattern and `git diff --check` passed.

Failures or blockers: The first real Keychain attempt inside the restricted
execution sandbox returned stable `keychain_write_failed`; the same isolated
suite then passed outside that restriction and cleaned up its synthetic item.
Initial adversarial review found over-broad renderer metadata, message-index-
only provenance, Unicode/percent and parent-traversal bypasses, tool definitions
outside admission, premature subprocess completion, empty `tool_calls`, an
unbounded mutation queue, incomplete focus restoration, false global no-
provider-contact copy, and Local readiness coupled to Keychain status. Late
review additionally found that a raw Zod strict error could echo a credential
used as an unknown property name, resolved `local_storage_error` results entered
the save/delete success path, retry/status changes were not announced or
focused accessibly, field/error contrast was insufficient, and four-layer,
full-width, and eight-digit Unicode escape forms bypassed egress scanning. Each
code defect was corrected and its focused regression passes.

The `-T ""` Keychain ACL experiment then timed out first at Vitest's five-
second limit and again at the adapter's ten-second limit with
`keychain_timeout`; it was reverted. Test cleanup hooks returned without an
additional cleanup failure. Subsequent post-revert CRUD attempts still hit the
five-second harness timeout because the host's macOS authentication agent was
wedged; even metadata-only `security show-keychain-info` hung. Eight orphaned
GitHub credential-lookup subprocesses were terminated with explicit approval,
but the system SecurityAgent remained unresponsive and a force kill was
rejected as unsafe. The exact final-tree native CRUD rerun therefore remains
blocked on the user safely dismissing/unlocking the macOS Keychain dialog or
restarting the host.

The final `pnpm package:mac` rerun rebuilt the corrected bundles but then spent
several minutes stalled in Electron packaging after module discovery and was
cancelled with SIGINT; the earlier archive proof is not exact-final-tree proof.
A governance review also stopped closure until this entry recorded the late
negatives and corrected its evidence scope. Exact implementation-commit CI has
not run. This milestone remains `Implemented`, not `Verified`.

Limitations and non-claims: The PR6A setup path does not read the stored
credential, validate it, contact a cloud provider, prove provider/model
availability or price, construct a cloud runtime, enable Hybrid, create cloud
consent or a campaign, or dispatch repository content. The existing Local route
remains intentionally network-capable toward its configured vLLM endpoint, and
tests exercise synthetic loopback OpenAI-compatible transports; zero dispatch
is a structural cloud-path result, not an OS network sandbox.

The CLI-created Keychain item retains `/usr/bin/security`'s default creator ACL
and is not app-identity-isolated. PR6B must use a separately approved native
Security-framework identity/ACL design, migrate or recreate staged CLI items,
and must not add a CLI `find ... -w` secret resolver. Provenance source
classification remains trusted host input, the scanner is bounded rather than
general DLP, and semantic hashes do not prove eventual HTTP wire bytes. No real
VoiceOver or 200% zoom run occurred. Packaging uses the default Electron icon,
is not notarized, and needs an exact-final-tree rerun. No quality, cost,
latency, routing, hostile-same-account-process resistance, or release-readiness
improvement is claimed.

Paid exposure: `$0`. Proof used deterministic tests, synthetic loopback
OpenAI-compatible fixtures, isolated synthetic Keychain identities, local
Electron/packaging, and the already-green approval-checkpoint CI. The PR6A
setup/proof work made no configured vLLM, OpenRouter, external model-list,
credential-validation, price, limit, health, inference, retry, fallback,
evaluator, or other external LLM-provider request.

Next gate: Safely clear the host Keychain authorization state, rerun exact-tree
synthetic CRUD and `pnpm package:mac`, then validate and commit this
implementation. Require clean exact-commit `pnpm check:release-head`, Electron
E2E, push, and both exact-SHA GitHub Actions jobs before appending a status-only
`Verified` closure. PR6B still needs a separate committed plan and explicit
approval before any credential read for dispatch, provider contact, repository
egress, paid reservation, or canary.

References: [approved PR6A plan](plans/PR6A_CLOUD_SETUP_DISPATCH_LOCK_V1.md),
[MVP readiness](MVP_READINESS.md), [architecture](ARCHITECTURE.md),
[routing policy](ROUTING_POLICY.md), and
[approval-checkpoint CI](https://github.com/Lotus2077/SOAR/actions/runs/33323059340).

### BL-20260831-1419-pr6a-cloud-setup-verified -- 2026-08-31 -- PR6A exact implementation revision verified

Status: `Verified`

Scope or hypothesis: Determine whether exact implementation revision
`d6cb1e77c7fe021e3c08f627df0217687e718bae` satisfies the approved PR6A local-
only verification matrix: deterministic release-head, Electron workflows,
native synthetic Keychain lifecycle and cleanup, macOS packaging/signature
verification, dispatch-lock review, and exact-SHA Linux/macOS CI, all at `$0`
external LLM-provider exposure.

Decisions:

- Advance PR6A from `Implemented` to `Verified` because every required local
  and remote gate passed on the exact implementation revision. Do not advance
  it to `Released` and do not authorize PR6B.
- Retain the first release-head timeout and first exact package stall as
  negative evidence. Their isolated and full retries passed; this supports a
  host-load diagnosis but does not erase the observed flakiness.
- Retain the default `/usr/bin/security` creator-ACL limitation. Verification
  covers setup-only storage with no read/resolve path, not app-identity
  isolation or hostile-same-account-process resistance. Native Security-
  framework identity/ACL design and staged-item migration/recreation remain a
  hard PR6B prerequisite.
- Keep the cloud egress guard unwired and shadow-only. Verification proves the
  pure local admission contract and production dispatch interlocks, not a real
  provider request, HTTP wire binding, or general DLP.

Changes: Updated only current-truth status documentation and appended this
closure entry. No runtime, credential, Keychain, provider, model, session,
router, egress, budget, tool, database, renderer behavior, or network authority
changed after the verified implementation revision.

Evidence:

- Clean `pnpm check:release-head` passed on exact commit
  `d6cb1e77c7fe021e3c08f627df0217687e718bae`: readiness validated 22 research
  plus 20 coding workloads and the tracked-file secret scan, the 41-entry log
  validated, both TypeScript projects passed, 74 test files passed with three
  skipped, 914 tests passed with five skipped, and all Electron bundles built.
- Exact-commit `pnpm test:e2e` passed all three macOS Electron workflows:
  restart restoration, active cancellation, and Local current-change review
  with optional cloud Settings and locked Hybrid behavior.
- Exact-commit opt-in Keychain verification passed four files and 46 tests. A
  fresh unique synthetic item was added, observed after adapter reconstruction,
  replaced, deleted, and confirmed absent by bounded cleanup. No real
  credential was read or modified.
- Exact-commit `pnpm package:mac` built the arm64 application, performed local
  signing, verified the packaged app on disk and against its designated
  requirement, created the archive, extracted it, reverified the signature,
  and produced `dist/SOAR-mac-arm64.zip` as an ignored local artifact.
- GitHub Actions run `33401604875` passed for the exact implementation SHA:
  Linux/check job `99518983165` completed in 1m7s and macOS Electron job
  `99519357633` completed in 1m27s.
- Independent architecture, security, and UX reviews reported no remaining
  P0/P1 code defect. Focus, live-region behavior, and measured light/dark
  contrast passed focused review; default ACL, VoiceOver, and 200% zoom were
  retained as explicit limitations rather than silently claimed.

Failures or blockers: The first clean release-head attempt on the exact SHA
failed because two established heavy fixture tests exceeded their 5s and 15s
timeouts while 912 other tests passed. Each timed-out test then passed alone in
1.61s and 2.34s, and the unchanged full release-head rerun passed all 914 tests.
The first exact packaging attempt rebuilt corrected bundles but stalled for
several minutes after Electron module discovery and was cancelled; the unchanged
exact-commit retry completed full signing and archive verification. Earlier
post-revert Keychain reruns were blocked by a wedged macOS authentication agent,
as retained in the implementation entry; after credential access recovered,
the unchanged exact commit passed the full synthetic CRUD/cleanup suite in
415ms. No deterministic PR6A verification blocker remains. This status-only
closure commit still requires its own publication CI.

Limitations and non-claims: `Verified` means the narrow PR6A setup lifecycle,
metadata projection, pure egress guard, dispatch interlocks, optional Settings,
and regression suite passed on the exact implementation SHA. It does not mean
the stored credential is valid, app-identity-isolated, or readable by a
production adapter; that a provider/model/price/limit is reachable or current;
that Hybrid, cloud consent, repository egress, a paid campaign, or fallback is
enabled; or that routing improves quality, cost, or latency. The configured
Local vLLM route remains an operator trust boundary and may be remote; synthetic
loopback tests are not an OS network sandbox. The package is locally signed,
uses the default Electron icon, and is not notarized. VoiceOver and 200% zoom
remain manual release checks. PR6A is not Released.

Paid exposure: `$0`. Verification used local deterministic and synthetic
loopback fixtures, isolated synthetic Keychain items, local Electron/packaging,
Git push, and GitHub Actions. The PR6A proof made no configured vLLM,
OpenRouter, model-list, key-metadata, credential-validation, pricing, limit,
health, inference, retry, fallback, evaluator, or other external LLM-provider
request.

Next gate: Validate, commit, and push this status-only closure, then require its
own Linux/check and macOS Electron GitHub jobs to pass. PR6B remains separately
unapproved and requires a committed proposed plan plus explicit owner approval
before any credential read, provider validation/contact, repository egress,
production Hybrid construction, paid reservation, or canary. Release work also
needs product icon/notarization and manual VoiceOver/zoom proof.

References: [verified implementation entry](#bl-20260830-1726-pr6a-cloud-setup-implemented----2026-08-30----pr6a-cloud-setup-and-dispatch-lock-implemented-locally),
[approved PR6A plan](plans/PR6A_CLOUD_SETUP_DISPATCH_LOCK_V1.md),
[MVP readiness](MVP_READINESS.md), [architecture](ARCHITECTURE.md),
[routing policy](ROUTING_POLICY.md), and
[exact implementation CI](https://github.com/Lotus2077/SOAR/actions/runs/33401604875).

### BL-20260831-2246-pr6b0-hybrid-simulation-proposed -- 2026-08-31 -- PR6B0 Hybrid simulation vertical slice proposed

Status: `Proposed`

Scope or hypothesis: Calibrate the next milestone after verified PR6A by
splitting the former provider-validation-and-paid-canary scope into separately
authorized changes. Propose PR6B0 as a local `$0` app-visible Hybrid simulation
that connects the strict review, egress, router, simulated budget, fake cloud,
Local fallback, replay, cancellation, and UX path while normal production stays
Hybrid-locked. No credential, configured vLLM, or external provider is touched;
authority is limited to two nominally branded in-process fakes.

Decisions:

- Do not implement the former PR6B as one change. Separate fake-only
  production-shaped Hybrid proof, signed native credential leasing, real
  provider validation, and one paid public-fixture canary into PR6B0 through
  PR6B3.
- Reject native real-credential re-entry as the immediate next milestone. The
  current ad-hoc package cannot prove upgrade-stable item authority, and
  synchronous Security.framework item mutations have no cancellable timeout.
  Inviting re-entry now could create an inaccessible duplicate without enabling
  Hybrid.
- Make PR6B0 the fake-only vertical slice because it advances the original
  routing goal without credential, signing, external-provider, external-egress,
  or real monetary authority. Native identity remains a hard prerequisite
  before any real secret resolver, not before two deterministic in-process fake
  providers.
- Require a dedicated strict hybrid change-review coordinator. Do not remove
  the brand from the generic fake v2 runner, whose generic completion does not
  own `ReviewResultV1` grounding, acceptance, or freshness.
- Persist an explicit simulation policy/cost scope, use exactly two branded
  fake providers, run the real checkpoint/egress/budget/attempt invariants with
  simulated nonzero amounts, and exclude those amounts from actual spend.
- Persist simulation-only consent while real egress consent remains `none`.
  Require a main-issued single-use consent challenge bound to the workspace,
  exact disclosure, cap, route, authority, fake providers, and expiry; reject
  stale/replayed/mismatched challenges before session or ledger work.
- Add immutable `simulation | actual | legacy_unclassified` scope across every
  campaign, reservation, routing decision, attempt/cost, terminal row, recovery
  adjustment, and event. New rows cannot be legacy-unclassified; migrated rows
  remain separately reported and excluded from actual and simulation totals.
  Any nonempty unclassified history blocks later actual admission until a
  separately approved explicit audit/classification. Require same-scope
  reconciliation and never infer scope from provider names or excluded totals.
- Persist bounded pass/deny cloud-egress admission records with policy/reason,
  message/provenance hashes, checkpoint and simulation-authority identity;
  require canonical routing/attempt binding and replay zero-dispatch denials.
- Retain unavoidable **Simulation only** and **Simulated** attribution in every
  active, completed, history, notification, result/finding, copy, and replay
  projection; label both providers Fake and keep availability independent of
  Cloud Settings.
- Expose Hybrid simulation only when fake provider mode and an explicit
  main-process simulation flag are both present. Normal production still
  constructs one Local provider and keeps Hybrid disabled.
- Remove the repository's manually invoked CLI credential-reader/provider-check
  script during the approved implementation; do not replace it with another
  secret resolver or provider check.

Changes: Added proposed plan `pr6b0-hybrid-simulation-v1-plan-1` and this
append-only proposal entry.
No runtime, native addon, dependency, Keychain item, credential, provider,
model, IPC, renderer, database, session, router, budget, tool, evaluator, or
network behavior changed.

Evidence:

- The live checkout was clean at verified PR6A closure revision
  `90531899bc16b3862616a709ac8396257ebdd46c`, equal to `origin/main`, before
  this proposal was written.
- Repository inspection confirmed production constructs only the configured
  Local or deterministic fake provider; Hybrid availability remains false;
  the cloud setup service has no secret-read method; and the PR6A egress policy
  remains pure and unwired.
- Repository inspection also confirmed that the manually invoked
  `check:cloud-key` command reads the staging item with the forbidden CLI
  secret-resolver form and contacts the candidate provider. It is not called by
  normal app startup or `pnpm check`, but the proposal removes it rather than
  treating it as a future runtime foundation.
- Independent product/UX, runtime, and credential-security reviews agreed that
  provider validation and the paid canary must be separate gates. Review of the
  first native-re-entry draft found the ad-hoc identity, non-cancellable native
  mutation, destructive-cleanup, test-namespace, and packaged-app proof gaps;
  that approach was rejected before implementation.
- Runtime inspection confirmed that the existing fake-only v2 coordinator is
  useful mechanics evidence but produces generic completion, while
  `run-local-change-review.ts` owns the strict structured review compiler,
  evidence grounding, host acceptance, and freshness behavior. PR6B0 therefore
  proposes a dedicated coordinator rather than weakening the fake-only brand.
- The first full `pnpm check` attempt inside the restricted sandbox passed
  readiness, the 43-entry log, typecheck, 73 test files and 895 tests, but 19
  OpenAI-compatible tests failed immediately because loopback bind returned
  `listen EPERM` on `127.0.0.1`; three files and five tests were skipped. The
  unchanged checkout reran outside that restriction: 74 test files and 914
  tests passed with three files/five tests skipped, and all Electron bundles
  built.
- The first `pnpm test:e2e` attempt correctly refused to launch Electron inside
  the restricted GUI sandbox. The unchanged checkout reran with approved GUI
  access and all three existing Electron workflows passed in 9.0 seconds:
  restart restoration, active Local cancellation, and Local current-change
  review with stale-copy refusal.
- Two adversarial review rounds covered product/UX, runtime/persistence, and
  credential/security boundaries. They rejected the initial native-re-entry
  direction, then found challenge-binding, consent separation, immutable ledger
  scope, replayable egress evidence, persistent simulation attribution,
  Settings independence, bounded-DLP wording, and legacy-exposure admission
  gaps in the replacement plan. After corrections, all three reviews reported
  no remaining P0/P1 planning issue. This is plan review, not implementation
  review or runtime proof.

Failures or blockers: PR6B0 is not approved or implemented. The current staged
item remains setup-only and not app-identity-isolated, but PR6B0 neither reads
nor changes it. The repository still contains the manual CLI key-check command
until an approved implementation removes it. The configured fake catalog still
contains one provider, the strict local review has no cloud checkpoint, and
the app has no simulation consent/cost/route UX. The restricted-loopback test
failure and restricted-GUI refusal are retained above. GitHub CLI
authentication was invalid during this planning pass; push and exact-SHA CI
observation must be proven rather than assumed.

Limitations and non-claims: This proposal is not authority to change a Keychain
item, delete the manual script, implement runtime code, resolve a secret,
contact a provider, send repository content externally, enable real Hybrid,
reserve real money, or run a canary. Even an eventual passing PR6B0 will prove
only deterministic fake control-flow integration, not credential safety,
hostile-process denial, upgrade-stable app identity, provider/model/price/limit
truth, HTTP wire identity, production Hybrid, routing quality, cost saving,
latency improvement, or release readiness.

Paid exposure: `$0`. Planning used local source/configuration inspection,
public Apple platform documentation, and deterministic reasoning only. No
configured vLLM, OpenRouter, model-list, key-metadata, pricing, limit, health,
account, inference, retry, fallback, evaluator, or other provider request
occurred. No Keychain item or real credential was read, written, replaced, or
deleted.

Next gate: Revalidate this corrected proposal, commit and push it, and require
exact-SHA Linux/check and macOS Electron CI to pass. Then require the project
owner's exact explicit approval of `pr6b0-hybrid-simulation-v1-plan-1` for local
`$0` implementation. Append that approval, commit and push the approval
checkpoint, and require its own exact-SHA Linux/macOS CI before runtime work
begins. PR6B1, PR6B2, PR6B3, credential resolution, provider contact, external
repository egress, and paid inference remain separately unapproved.

References: [proposed PR6B0 plan](plans/PR6B0_HYBRID_SIMULATION_V1.md),
[verified PR6A plan](plans/PR6A_CLOUD_SETUP_DISPATCH_LOCK_V1.md), [parent Hybrid
Lease Router plan](plans/HYBRID_LEASE_ROUTER_V0.md), [MVP
readiness](MVP_READINESS.md), [architecture](ARCHITECTURE.md), and [routing
policy](ROUTING_POLICY.md).

### BL-20260901-0052-pr6b0-hybrid-simulation-approved -- 2026-09-01 -- PR6B0 Hybrid simulation approved for local zero-cost implementation

Status: `Approved`

Scope or hypothesis: Record the project owner's explicit authority for the
exact fake-provider Hybrid simulation plan after its proposal revision and
Linux/macOS planning checkpoint passed. This approval permits local `$0`
implementation of the app, runtime, persistence, accounting, consent, replay,
and UX contracts in `pr6b0-hybrid-simulation-v1-plan-1` only.

Decisions:

- Approve `pr6b0-hybrid-simulation-v1-plan-1` for local `$0` implementation.
  The plan ID fixes the scope to the fake-provider simulation and the owner's
  approval does not broaden any later milestone.
- Authorize the dedicated strict Hybrid simulation coordinator, two branded
  in-process fake providers, single-use simulation-consent challenge,
  simulation-scoped ledger and egress-admission evidence, persistent
  simulation attribution, app UX, deterministic tests, and removal of the
  manual CLI cloud-key check named by the approved plan.
- Preserve every external-exposure gate. The implementation may not read or
  change a Keychain item, construct or contact a configured vLLM or external
  provider, send repository content off-device, create an actual cost
  reservation, or spend money.
- Require this approval checkpoint to be committed, pushed, and green on its
  exact-SHA Linux and macOS workflows before runtime implementation begins.
  PR6B1 credential work, PR6B2 provider validation, and PR6B3 paid inference
  remain unapproved.

Changes: Updated the proposed plan's authority status and appended this
approval record. No runtime, native addon, dependency, credential, provider,
model, IPC, renderer, database, session, router, budget, tool, evaluator, or
network behavior changed at this checkpoint.

Evidence:

- The project owner explicitly instructed: `Approve
  pr6b0-hybrid-simulation-v1-plan-1 for local $0 implementation`.
- Proposal revision `21f98a35375c052d44a401da1cc9077ffa6f3041` was clean,
  equal to `origin/main`, and its exact GitHub Actions run `33408742376`
  passed Linux job `99542754551` and macOS Electron job `99543151654` before
  this approval was recorded.
- On the exact proposal revision, local `pnpm check:release-head` passed 74
  test files and 914 tests with three files/five tests skipped, built all
  Electron bundles, and local Electron E2E passed all three existing workflows.
- Three independent plan-review lanes reported no remaining P0/P1 planning
  issue after the proposal incorporated their runtime/persistence,
  product/UX, and credential/security corrections. That is plan evidence, not
  implementation evidence.

Failures or blockers: PR6B0 is Approved but not Implemented or Verified. Its
runtime, schema, migrations, challenge, accounting, replay, cancellation, fake
providers, coordinator, and app projections do not exist yet. Implementation
is still blocked until this distinct approval checkpoint is committed, pushed,
and both exact-SHA CI jobs pass.

Limitations and non-claims: This approval is not evidence of working Hybrid
simulation, production Hybrid, credential safety, provider/model/pricing
truth, HTTP identity, routing quality, cost saving, latency improvement, or
release readiness. An eventual passing PR6B0 will prove only bounded,
deterministic fake-provider control-flow integration unless separately stated.

Paid exposure: `$0`. This authority change performed no configured vLLM,
OpenRouter, model-list, key-metadata, pricing, limit, health, inference,
retry, fallback, evaluator, or other provider request. No Keychain item or real
credential was read, written, replaced, or deleted.

Correction to the proposal timestamp: the committed
`BL-20260831-2246-pr6b0-hybrid-simulation-proposed` ID again encoded local wall
time after the one-time UTC reset documented by
`BL-20260830-1454-build-log-utc-reset`. That committed identifier cannot be
rewritten and the validator intentionally permits only one reset, so this
entry preserves physical chronology with the next local-wall-clock ID while
making the defect explicit. Its host-observed creation time was 2026-08-31
16:52 UTC / 2026-09-01 00:52 Asia/Shanghai. Future ledger work must repair the
validator/governance contract before claiming that post-proposal IDs are UTC.

Next gate: Validate and commit this approval-only change, push the exact
revision, and require its Linux/check and macOS Electron workflows to pass.
Only then may local fake-provider PR6B0 implementation begin. Any credential
work, provider validation, external egress, actual reservation, or paid
inference requires a new durable plan and explicit approval.

References: [approved PR6B0 plan](plans/PR6B0_HYBRID_SIMULATION_V1.md),
[proposal entry](#bl-20260831-2246-pr6b0-hybrid-simulation-proposed----2026-08-31----pr6b0-hybrid-simulation-vertical-slice-proposed),
[verified PR6A plan](plans/PR6A_CLOUD_SETUP_DISPATCH_LOCK_V1.md), and [parent
Hybrid Lease Router plan](plans/HYBRID_LEASE_ROUTER_V0.md).

### BL-20260901-0340-pr6b0-hybrid-simulation-implemented -- 2026-09-01 -- PR6B0 Hybrid simulation implemented locally

Status: `Implemented`

Scope or hypothesis: Implement the approved
`pr6b0-hybrid-simulation-v1-plan-1` as an app-visible, fake-provider-only Hybrid
change-review vertical slice. Exercise the production-shaped checkpoint,
semantic egress admission, simulated budget, tool-free fake Cloud synthesis,
bounded Local fallback, cancellation, recovery, replay, and renderer contracts
without reading a credential, contacting a configured model endpoint, sending
repository evidence off-device, creating actual cost exposure, or spending
money.

Decisions:

- Keep the feature behind both `SOAR_ENABLE_HYBRID_SIMULATION` and deterministic
  fake provider mode. A normal configured vLLM runtime remains Local-only and
  cannot construct or select this Hybrid route.
- Use a dedicated strict Hybrid change-review coordinator. Local inspection
  produces the immutable review evidence; the evidence-complete checkpoint may
  select one tool-free deterministic Fake Cloud synthesis; one eligible
  provider failure may select one strict Fake Local synthesis fallback.
- Preserve central tool ownership. Only the local inspection attempt can invoke
  `inspect_git_changes`; Fake Cloud receives a bounded compiled evidence packet
  and cannot request or execute a tool.
- Require a main-process, single-use simulation-consent challenge bound to the
  disclosure, route, cap, authority, fake providers, workspace identity, and
  expiry. Per-workspace invalidation epochs close same-path challenge races, and
  the final admission lease revalidates directory device/inode identity before
  fake Cloud dispatch.
- Persist the simulation authority, egress admission, routing/attempt binding,
  reservation, settlement, and zero-actual-spend attribution. Database migration
  3 adds immutable `simulation | actual | legacy_unclassified` cost scope;
  pre-scope history remains quarantined as legacy-unclassified and cannot be
  silently counted as actual or simulation spend.
- Keep the older generic fake runner available only to tests. Production has no
  import or bundle path to it, and its historical unscoped records cannot
  populate the PR6B0 production simulation or actual ledger.
- Recover pre-migration running/open attempt state conservatively, reconcile
  reservations once, and make replay renderer-only: opening, copying, or
  replaying a completed review performs no redispatch.
- Fail renderer projections closed unless exact simulation marker, Fake
  provider identity, model, cost scope, safe reservation, settlement
  provenance, explicit actual `$0`, aggregate reconciliation, and matching
  session identity are all present. Failed Fake Cloud synthesis and successful
  Local fallback remain distinct phases with causal Cloud-before-Local order
  and the persisted terminal failure reason.
- Remove the manual CLI credential-reader/provider-check script and its package
  command. Do not replace it with a secret resolver, external health check, or
  provider validation path in PR6B0.
- Classify this checkpoint as Implemented only. Automated evidence is strong,
  but required manual VoiceOver, keyboard-only, true 200% zoom, full light/dark
  contrast, and reduced-motion checks are not complete; the app package also
  lacks release identity, icon, and notarization.

Changes:

- Added deterministic Fake Cloud review and shared fake synthesis providers,
  Hybrid runtime admission, consent authority, semantic egress gate, and the
  strict Hybrid change-review coordinator.
- Extended the checkpoint router, event grammar, reducer, event store, budget
  ledger, attempt unit of work, recovery, database migration, safe session
  projection, and local review route to preserve simulation-scoped authority,
  evidence, cost, cancellation, fallback, and replay invariants.
- Added IPC/preload/app flows for challenge issuance, consent confirmation,
  Hybrid review creation, Stop, history, route trace, phase/cost attribution,
  notifications, copy, replay, fail-closed display, and persistent
  `Simulation only - no external provider called` disclosure.
- Updated architecture, routing, readiness, approved plan, README, and benchmark
  safe-record documentation to describe the implemented boundary and remaining
  non-claims.
- Added unit, integration, migration, concurrency, recovery, renderer, and seven
  Electron workflows for success, denial, provider failure plus fallback,
  committed-attempt cancellation, local review, restart, and stale-copy refusal.
- Deleted `scripts/check-openrouter-key.mjs` and the `check:cloud-key` package
  command.

Evidence:

- Approval checkpoint `be8e4c71ca8892988caae28e2717ede2d5048165`
  was clean, pushed, and passed exact-SHA GitHub Actions run
  `33416882090` before runtime implementation began.
- Final current-tree `pnpm check` passed readiness, the pre-entry 44-entry build
  log, typecheck, 80 test files and 1,007 tests; three files and five tests were
  deliberately skipped. All main, preload, and renderer Electron bundles built.
- Focused post-review proof passed five files and 71 tests covering the strict
  view, renderer validation, metrics, Hybrid integration, and safe session
  projection. A second independent correctness lane passed 159 tests across 11
  files plus typecheck and diff check.
- Final Electron E2E passed all seven workflows. The committed-attempt Stop case
  waits for a persisted Fake Cloud attempt, records exactly one cancelled finish
  with conservative full-reservation settlement, starts no provider-failure
  decision or Local synthesis, and preserves zero actual external spend.
- The success workflow proves Fake Local inspection, a real egress pass, one
  simulated reservation and one deterministic Fake Cloud synthesis, accepted
  grounded result, durable route/cost trace, copy, restart replay, and zero
  redispatch. Denial proves zero Fake Cloud attempts/reservations followed by
  Local continuation. Provider failure proves a failed Fake Cloud synthesis
  with `provider_error` followed by one completed Fake Local fallback.
- `pnpm package:mac` built, ad-hoc signed, archived, extracted, and revalidated
  `dist/SOAR-mac-arm64.zip`; the app and extracted archive were valid on disk and
  satisfied their Designated Requirement.
- Static tracked-source scans found no known credential, private endpoint,
  machine-specific path, removed credential-reader command, or Keychain CLI
  invocation. Production source/bundle scans found no generic fake v2 runner
  import or symbol.
- Two independent final read-only reviews reported 0 P0 / 0 P1 across phase and
  route truthfulness, fail-closed UX, fake-only/no-network authority, consent and
  workspace binding, accounting, cancellation, recovery, replay, and legacy
  quarantine.

Failures or blockers:

- The first Electron check used a stale bundle and presented Hybrid as locked;
  rebuilding exposed the implemented route. This was a test-build error, not a
  runtime unlock defect.
- An early attempt to retire the generic fake runner broke 36 of 38 historical
  coordinator tests. It was reversed, then narrowed correctly to test-only use
  with no production import, bundle symbol, or actual/simulation ledger path.
- The first restricted full suite had 19 loopback `EPERM` failures and one real
  reducer assertion failure. The reducer was corrected; running the networked
  loopback fixtures with approved local permissions passed.
- Adversarial reviews found and prompted corrections for provenance rebinding,
  cancellation after workspace revalidation, same-path consent races, padded
  challenge burn, legacy migration recovery, stale cross-session UI, missing
  fail-closed markers, notification attribution, simulated overrun handling,
  route attribution, small-text contrast, failure/fallback phase truthfulness,
  denial causality, unknown settlement provenance, missing explicit `$0`, and
  terminal failure-reason display. None of those negative results was discarded.
- The first high-risk Electron expansion passed four of seven cases because the
  success, denial, and failure fixtures changed a low-risk path and correctly
  stayed Local. The fixtures now change a sensitive provider path.
- The next four-of-seven run exposed a hidden duplicate text locator, an exact
  denial-reason mismatch, and a safe-session projection that omitted the minimal
  reservation facts needed for renderer attribution. Locators/reason matching
  were corrected, and the safe projection now exposes only reservation identity
  and projected aggregate cost, not rates, token assumptions, budgets, endpoints,
  repository evidence, or credentials.
- A six-of-seven run found the completion toast intercepted Copy Markdown. The
  toast body now ignores pointer input while its dismiss button remains operable.
- The first cancellation E2E stopped during Local inspection and therefore did
  not prove committed Fake Cloud cancellation. It now waits for the persisted
  cloud-attempt start and asserts the full terminal event/accounting grammar.
- The first final failure-reason E2E rerun passed six of seven cases because its
  locator matched both the Fake Cloud candidate checkpoint and failed Fake Cloud
  synthesis. The locator was narrowed to the Failed row and the unchanged runtime
  then passed all seven workflows.
- Exact implementation commit SHA, push, and Linux/macOS CI remain pending at
  this log point. Manual accessibility and release-distribution gates also remain
  open.

Limitations and non-claims: PR6B0 proves a deterministic local simulation of
Hybrid control flow, not real Hybrid inference. No claim is made about real
credential safety, provider/model/pricing/limit/health truth, HTTP wire identity,
repository egress to a third party, model quality, routing quality, cost saving,
latency improvement, benchmark superiority, or production readiness. The
workspace admission lease revalidates the directory identity at the dispatch
boundary; it is not a lifetime inode lock, and a hostile same-account filesystem
attacker is outside this milestone's claim. Failed provider-reported or
host-priced simulated overruns remain visible in full; malformed or impossible
over-cap projections and invalid `reserved_unknown` settlements fail closed. The
macOS artifact uses the default Electron icon, an ad-hoc `identityName=-`
signature, and no notarization. Manual VoiceOver, keyboard-only traversal, true
200% zoom, complete light/dark contrast, and reduced-motion checks remain
unclosed. PR6B0 is not Verified or Released. PR6B1 credential authority, PR6B2
real provider validation, PR6B3 paid inference, and all production Hybrid work
remain separately unapproved.

Paid exposure: `$0`. Implementation and verification used in-process Fake Local
and Fake Cloud providers, temporary repositories/databases, synthetic loopback
fixtures, local Electron, packaging, and GitHub CI metadata. The app and tests
made no configured vLLM, OpenRouter, model-list, key-metadata, pricing, limit,
health, inference, retry, fallback, evaluator, or other external LLM-provider
request. No Keychain item or real credential was read, written, replaced, or
deleted; no repository evidence was sent off-device; no actual reservation or
external model spend was created.

Next gate: Validate this append-only entry, run the complete gate on the final
tree, commit and push one implementation revision, then require both exact-SHA
Linux/check and macOS Electron GitHub jobs to pass. Keep status at Implemented
until manual VoiceOver, keyboard-only, true 200% zoom, light/dark contrast, and
reduced-motion proof is durably recorded. Release additionally requires a real
product icon, Developer ID distribution signing, and notarization. Any PR6B1+
credential, real-provider, external-egress, or paid work requires a new committed
plan and explicit approval.

References: [approved PR6B0 plan](plans/PR6B0_HYBRID_SIMULATION_V1.md),
[architecture](ARCHITECTURE.md), [routing policy](ROUTING_POLICY.md), [MVP
readiness](MVP_READINESS.md), and [README](../README.md).

### BL-20260901-0401-pr6b0-retention-capacity-correction -- 2026-09-01 -- Exact-head retention failure corrected without weakening the proof

Status: `Implemented`

Scope or hypothesis: Treat the first clean exact-commit PR6B0 release failure as
authoritative. Determine why the Repository Investigator's real-revision symbol
retention proof passed before commit but failed on committed HEAD, then make the
smallest local `$0` correction that preserves the exact 18,432-token cap,
independent full-repository oracle, complete-match requirement, and 250-byte
objective-drift case.

Decisions:

- Classify the result as a deterministic committed-fixture capacity regression,
  not a flaky test. The proof archives committed `HEAD`; pre-commit checks still
  exercised the preceding approval revision and could not see uncommitted PR6B0
  test scaffolding.
- Preserve the full oracle, current-revision archive, exact global search,
  `maxMatches`, UTF-8 estimator, 18,432-token ceiling, 20% safety margin, and
  250-byte drift assertion. Do not exclude tests or new paths, accept a partial
  envelope, pin an older revision, split the symbol string, or raise capacity.
- Do not change the production context compiler in this correction. A compact
  atomic exact-search representation changes the provider packet contract,
  hashes, telemetry, and selection semantics; it remains a separately designed
  and approved future milestone as recorded by the earlier PR 5 capacity entry.
- Consolidate repeated PR6B0 test scaffolding naturally: use one renderer
  session-control mock factory, one IPC scenario-runner factory, and one plainly
  named Hybrid cancellation-action helper. Preserve every distinct test and all
  real production/API references.

Changes:

- Replaced ten repeated renderer `window.soar` cancellation stubs with one typed
  partial-API factory.
- Replaced repeated IPC `SessionRunner` object literals with one model-parameter
  factory while preserving each scenario's original descriptor value.
- Routed four distinct Hybrid cancellation test actions through one shared
  helper; the tests still cancel at pre-dispatch, in-flight, post-revalidation,
  and pre-fallback boundaries.
- Added this append-only correction entry. No runtime, context compiler,
  provider, session, routing, persistence, budget, IPC production code,
  renderer production code, endpoint, credential, or cost behavior changed.

Evidence:

- Clean commit `cc8598cb400c797c576c5b78567b30ec11ffb16e` failed
  `pnpm check:release-head` with one deterministic assertion: the accepted
  final packet retained 34 of 59 exact independent-oracle symbol occurrences.
  Seventy-nine test files and 1,006 tests passed around that failure; three
  files/five tests were skipped, and build did not run.
- The same isolated committed-HEAD test failed again with the exact 34/59
  result. The successful tool trace's exact/untruncated search and claim-evidence
  assertions passed before final-packet retention failed, isolating the defect
  to bounded packet capacity rather than search execution or oracle drift.
- Comparing the approval revision with PR6B0 showed the model-visible symbol
  schedule grew from 45 to 59 matching lines. The growth came primarily from
  repeated renderer API mocks, repeated IPC runner mocks, and four new Hybrid
  cancellation cases; PR6B0 did not modify the compiler or retention assertion.
- Two independent read-only diagnoses reproduced the failure and recommended
  structural test-fixture deduplication over an unapproved context-contract
  change.
- After refactoring, the three affected files passed all 65 tests, TypeScript
  validation passed, and `git diff --check` passed. The meaningful source lines
  now consist of one renderer factory, the existing IPC mock-reset plus one
  runner factory, and one Hybrid cancellation helper.

Failures or blockers: The exact-head gate remains failed on `cc8598c`; this
uncommitted structural correction cannot yet prove the real-revision test
because that test intentionally archives committed HEAD. The correction must be
committed before its capacity result can be observed. If the natural
deduplication does not make both the exact and 250-byte-drift cases fit, PR6B0
must stop and propose the compact atomic-search milestone rather than weaken the
gate.

Limitations and non-claims: Deduplicating incidental test scaffolding restores a
bounded repository-specific proof envelope; it does not solve arbitrary future
repository growth or create an unbounded context guarantee. It does not alter
production cancellation, improve model quality, prove real Hybrid routing, or
change PR6B0's Implemented-not-Verified status. Exact correction SHA, complete
release-head check, Electron E2E, package verification, push, and Linux/macOS CI
are still pending.

Paid exposure: `$0`. Diagnosis and correction used local Git archives, source
comparison, deterministic fixtures, TypeScript, and tests only. No configured
vLLM, OpenRouter, model list, inference, credential, Keychain, pricing, retry,
fallback, evaluator, or other external LLM-provider request occurred; no
repository evidence left the device and no actual reservation or spend was
created.

Next gate: Commit the structural correction and this entry, run the isolated
real-revision retention test against that exact HEAD, then require a clean
`pnpm check:release-head`, all seven Electron workflows, and macOS package
verification. Push only after local exact-head gates pass, then require both
exact-SHA Linux/check and macOS Electron GitHub jobs to pass.

References: [implementation entry](#bl-20260901-0340-pr6b0-hybrid-simulation-implemented----2026-09-01----pr6b0-hybrid-simulation-implemented-locally),
[earlier capacity decision](#bl-20260830-0237-pr5-remote-ci-capacity-correction----2026-08-30----remote-ci-invalidated-the-pre-commit-pr-5-verification),
[context handoff ADR](adr/0001-context-handoff-engine-v1.md), and [approved
PR6B0 plan](plans/PR6B0_HYBRID_SIMULATION_V1.md).

### BL-20260901-0406-pr6b0-local-exact-head-gates -- 2026-09-01 -- Corrected PR6B0 passed every automated local exact-head gate

Status: `Implemented`

Scope or hypothesis: Record the first complete automated local proof of the
corrected PR6B0 implementation on committed revision
`e6937929768b7c39dbee865af0722ac7e11c7dbb`, while retaining manual
accessibility, distribution, push, and remote CI as open gates.

Decisions:

- Bind this local evidence to exact clean HEAD `e6937929`; do not reuse the
  earlier dirty-tree success or failed `cc8598c` release run.
- Keep PR6B0 at Implemented. Automated unit/integration/Electron/package gates
  do not substitute for VoiceOver, keyboard-only, true 200% zoom, full
  light/dark contrast, reduced-motion, product icon, Developer ID, or
  notarization evidence.
- Preserve the context-capacity correction exactly as structural test-fixture
  deduplication. Do not introduce a post-hoc production compiler change after
  the exact current-revision oracle and drift case passed.

Changes: Appended this status-only evidence entry. No runtime, provider,
context, routing, persistence, budget, IPC, renderer, test assertion, endpoint,
credential, or cost behavior changed after `e6937929` passed its gates.

Evidence:

- The isolated real-revision retention test passed both the exact objective and
  its 250-byte UTF-8 drift at the unchanged 18,432-token input cap. The complete
  current independent-oracle symbol schedule survived in the unique accepted
  final packet; 16 unrelated cases in that file were skipped by the focused
  selector.
- `pnpm check:release-head` verified unchanged clean commit
  `e6937929768b7c39dbee865af0722ac7e11c7dbb`, validated 22 research and 20
  coding workloads plus 46 build-log entries, passed typecheck, passed 80 test
  files and 1,007 tests, skipped three files/five opt-in tests, and built all
  Electron main/preload/renderer bundles.
- All seven Electron workflows passed on the same committed source: Local
  restart, active Local Stop, stale-copy refusal, Hybrid success/copy/replay,
  egress denial with zero cloud attempt, provider failure with one Local
  fallback, and committed Fake Cloud cancellation with no fallback.
- `pnpm package:mac` rebuilt the app, ad-hoc signed it, created
  `dist/SOAR-mac-arm64.zip`, extracted it, and revalidated both the original and
  archived app as valid on disk and satisfying their Designated Requirement.
  Packaging explicitly reported the default Electron icon and skipped
  notarization.

Failures or blockers: No automated local blocker remains on `e6937929`. The
preceding 34/59 exact-head failure remains recorded in the correction entry and
was not erased by the passing rerun. This log-only entry creates a new final
revision, so that revision still requires one clean committed-head gate before
push. GitHub Linux/check and macOS Electron jobs have not run for the final
revision. Manual accessibility and distribution gates remain open.

Limitations and non-claims: This evidence verifies local deterministic fake
control flow and packaging mechanics only. It does not prove real provider
identity, credential authority, third-party repository egress, actual billing,
quality/cost/latency optimization, hostile same-account filesystem resistance,
notarized distribution, or release readiness. The app remains Implemented, not
Verified or Released.

Paid exposure: `$0`. The exact-head, Electron, and package gates used local
deterministic fixtures, in-process fake providers, temporary repositories and
databases, Electron tooling, and Git only. No configured vLLM, OpenRouter,
model-list, credential, Keychain, pricing, health, inference, retry, fallback,
evaluator, or other external LLM-provider request occurred; no actual
reservation or external model spend was created.

Next gate: Commit this status-only entry, run the clean committed-head gate on
that final revision, repeat Electron E2E and package verification, push, and
observe both exact-SHA Linux/check and macOS Electron workflows to completion.
Do not promote status beyond Implemented until the manual gates are durably
recorded.

References: [capacity correction](#bl-20260901-0401-pr6b0-retention-capacity-correction----2026-09-01----exact-head-retention-failure-corrected-without-weakening-the-proof),
[implementation entry](#bl-20260901-0340-pr6b0-hybrid-simulation-implemented----2026-09-01----pr6b0-hybrid-simulation-implemented-locally),
[approved plan](plans/PR6B0_HYBRID_SIMULATION_V1.md), and [MVP
readiness](MVP_READINESS.md).

### BL-20260901-0428-pr6b0-consent-convergence-correction -- 2026-09-01 -- macOS CI exposed and local proof corrected a Hybrid disclosure race

Status: `Implemented`

Scope or hypothesis: Treat the exact-SHA macOS Electron failure for
`7fb9bb9a06ade2c0d454abce0cc493fb6918051b` as a product-state failure until
disproved. Explain why the first Hybrid workflow could select its route and
render its simulation marker yet never receive a consent control, then correct
the transition without weakening consent invalidation or hiding the result with
a retry or longer timeout.

Decisions:

- Classify the failure as a real crossed async transition, not an Electron or CI
  flake. The workspace chooser and route-change callbacks each read their
  invocation-time React closure; when they completed in the opposite order,
  each could observe only half of the new state and both could skip challenge
  issuance.
- Keep workspace selection and route selection available as independent UI
  actions. Synchronize current workspace and route refs at every mutation site
  so the callback that settles second issues exactly one workspace-bound
  challenge. A route ref becomes Hybrid only after main consent invalidation
  succeeds and its request ordinal is still current.
- Do not add a convergence effect. It could issue while an existing Hybrid
  workspace change is still invalidating its old disclosure. Do not mask the
  race with Playwright retries or a timeout-only change.
- Make the Electron helper wait for the selected canonical repository
  projection before selecting Hybrid. After route selection, require either the
  consent row or an explicit consent error so IPC failures retain a useful
  diagnostic branch.

Changes:

- Added synchronized workspace and review-route refs in the renderer. Session
  loading, chooser completion, review reset, and route completion now update the
  corresponding ref with their state mutation.
- The chooser reads the current route after resolving, and route completion
  reads the current workspace after successful invalidation. JavaScript runs
  each synchronous ref-update-and-check section atomically, so only the second
  transition can observe both new values and issue the challenge.
- Added a deterministic renderer regression that holds the workspace chooser
  unresolved, selects Hybrid, then resolves the chooser and proves exactly one
  challenge request, an unchecked focused acknowledgement, and a disabled Start
  action.
- Hardened all four Hybrid Electron workflows to wait for the exact repository
  projection and to distinguish consent success from an explicit issuance
  error.

Evidence:

- GitHub Actions run `33434569025` on exact head `7fb9bb9` passed Linux
  `check` job `99627756647` and failed macOS `electron-e2e` job
  `99628129554`. The first three workflows passed. The Hybrid success workflow
  then waited 15 seconds for a focused consent checkbox that did not exist;
  three later Hybrid workflows passed. The failed screen had Hybrid selected
  without a consent row or consent error, matching the crossed-transition state.
- Two independent read-only reviews traced the same interleaving and rejected a
  timeout-only repair. A final review of the correction reported zero P0 and
  zero P1 findings and confirmed both completion orderings issue once only after
  successful invalidation.
- The focused renderer file passes 35 tests, including the new deferred-chooser
  regression. TypeScript validation and `git diff --check` pass.
- The first local Electron rerun after the product correction honestly failed
  four Hybrid cases because two newly added test diagnostics were defective:
  the non-exact `Change` accessible-name query also matched `Review Current
  Changes`, and reading text from an absent error locator waited 30 seconds.
  Making the button name exact and reading error text only when the error exists
  corrected the helper. The next complete Electron run passed all seven
  workflows in 20.5 seconds.

Failures or blockers: The correction and this entry are not yet committed, so
the exact-head release gate cannot yet archive and prove them. A new GitHub
Linux/check and macOS Electron run is pending. The negative result for run
`33434569025` remains authoritative for `7fb9bb9`; later local success does not
rewrite it. Manual accessibility and distribution gates remain open.

Limitations and non-claims: This correction proves deterministic renderer
convergence and fake-only Electron behavior. It does not prove real provider
identity, credential authority, external repository egress, billing, model
quality, quality/cost/latency optimization, hostile filesystem resistance,
notarized distribution, or release readiness. PR6B0 remains Implemented, not
Verified or Released.

Paid exposure: `$0`. Diagnosis and correction used public GitHub CI metadata,
local source, deterministic unit fixtures, in-process Fake Local and Fake Cloud
providers, temporary test repositories/databases, and local Electron. No
configured vLLM, OpenRouter, model-list, credential, Keychain, pricing, health,
inference, retry, fallback, evaluator, or other external LLM-provider request
occurred; no repository evidence left the device and no actual reservation or
external model spend was created.

Next gate: Validate this append-only entry, commit the correction, and run the
complete clean exact-head release gate, all seven Electron workflows, package
verification, and tracked secret/private-path scans. Push only after those local
gates pass, then require exact-SHA Linux/check and macOS Electron jobs to pass.
Keep status at Implemented until the documented manual accessibility and
distribution gates close.

References: [failed GitHub Actions run](https://github.com/Lotus2077/SOAR/actions/runs/33434569025),
[approved PR6B0 plan](plans/PR6B0_HYBRID_SIMULATION_V1.md), [implementation
entry](#bl-20260901-0340-pr6b0-hybrid-simulation-implemented----2026-09-01----pr6b0-hybrid-simulation-implemented-locally),
and [MVP readiness](MVP_READINESS.md).

### BL-20260901-0510-pr6b0-automated-closure -- 2026-09-01 -- PR6B0 corrective revision passed exact-SHA automated closure

Status: `Implemented`

Scope or hypothesis: Close the remaining automated post-commit gates for the
PR6B0 Hybrid simulation on exact corrective revision
`9495d6bcbaa8cef5d3342e0d53ab02efe28d0002` without promoting the milestone
past Implemented while its manual accessibility record remains open.

Decisions:

- Bind the closure only to exact revision `9495d6b` and GitHub Actions run
  `33436752206`.
- Treat the passing rerun as closure of automated source, Electron, package,
  independent-review, and Linux/macOS CI gates. Retain the preceding exact-SHA
  consent-race failure and its correction rather than relabeling it as a flake.
- Keep PR6B0 at Implemented, not Verified or Released. Automated checks do not
  substitute for VoiceOver, keyboard-only traversal, 200% zoom/reflow,
  light/dark contrast, or reduced-motion proof.
- Preserve every later real credential, provider, egress, budget, paid canary,
  and optimization claim as a separate milestone.

Changes: Updated current-truth and PR6B0 plan documentation to record automated
exact-SHA closure. No runtime, IPC, persistence, routing, provider, credential,
budget, tool, or evaluator behavior changed after the passing revision.

Evidence:

- GitHub Actions run `33436752206` completed successfully on exact head
  `9495d6bcbaa8cef5d3342e0d53ab02efe28d0002`.
- Linux `check` job `99634936125` passed in 1 minute 20 seconds. The exact-head
  pipeline validated 22 research and 20 coding workloads, the build log,
  TypeScript, all application bundles, 80 passing test files, and 1,008 passing
  tests; three files/five opt-in tests remained intentionally skipped.
- macOS `electron-e2e` job `99635348957` passed in 1 minute 48 seconds and ran
  all seven Local/Hybrid fake workflows.
- The already recorded local exact-head proof passed the same seven workflows,
  independent P0/P1 review, and macOS archive verification. The archive was
  ad-hoc signed, used the default Electron icon, and skipped notarization.

Failures or blockers: GitHub run `33434569025` on prior revision `7fb9bb9`
remains a real failed proof and led to the consent-convergence correction. The
manual accessibility matrix and distribution requirements remain open. No
Developer ID Application identity is installed on the current build host.

Limitations and non-claims: This closure proves deterministic fake-only Hybrid
control flow and packaging mechanics on one exact SHA. It does not prove a real
credential, real provider, third-party repository egress, actual billing,
dynamic routing quality, quality/cost/latency improvement, notarized
distribution, or release readiness.

Paid exposure: `$0`. The closure used deterministic fixtures, in-process Fake
Local/Fake Cloud providers, local packaging, and GitHub CI. No configured vLLM,
OpenRouter, model-list, validation, inference, retry, fallback, evaluator, or
other external LLM-provider request occurred and no actual reservation or spend
was created.

Next gate: Complete and durably record the manual PR6B0 accessibility matrix if
PR6B0 is to advance to Verified. Independently, propose PR6B1 with exact
credential, signing, proof, and activation boundaries before any new runtime
work.

References: [passing GitHub Actions run](https://github.com/Lotus2077/SOAR/actions/runs/33436752206),
[failed preceding run](https://github.com/Lotus2077/SOAR/actions/runs/33434569025),
[PR6B0 plan](plans/PR6B0_HYBRID_SIMULATION_V1.md), and [MVP
readiness](MVP_READINESS.md).

### BL-20260901-0514-pr6b1-signed-lease-proposed -- 2026-09-01 -- PR6B1 signed native credential lease proposed as four separately gated phases

Status: `Proposed`

Scope or hypothesis: Define the smallest safe step from PR6B0's fake-only
Hybrid simulation toward app-identity-bound credential custody without turning
the owner's forward direction or paid-model willingness into implicit authority
for credential mutation, provider contact, repository egress, or spend.

Decisions:

- Split PR6B1 into plan/prerequisite work (A), a fail-closed native substrate
  (B), signed A/B synthetic continuity proof (C), and real native re-entry plus
  production namespace activation (D). Exact approval of plan ID
  `pr6b1-signed-native-credential-lease-v1-plan-1` would authorize phase B only.
- Keep PR6B1-B at `$0` with zero provider requests and zero repository egress.
  PR6B1-C, PR6B1-D, PR6B2 validation, PR6B3 paid inference, and any campaign
  each require a later exact plan and durable approval.
- Remove all PR6A staged store/replace/delete actions in phase B. Retain only a
  noninteractive metadata status. Real legacy cleanup can return only after a
  confirmed protected write and a separately approved mutation-safety contract.
- Keep newly entered and retrieved credentials out of renderer, preload, IPC,
  and JavaScript memory. A later real-entry action must use a main-owned native
  secure sheet. Record honestly that AppKit/CoreFoundation copies, abrupt
  termination, and OS internals cannot be deterministically zeroized by SOAR.
- Make phase B structurally activation-locked: it has no production or
  synthetic Keychain locator, secure-entry sheet, lease consumer, or reachable
  SecItem mutation. Pure fixtures test identity policy; actual signed identity
  and hostile-host proof belongs to phase C.
- Require packaged-renderer hardening, top-level-frame/WebContents checks, a
  pre-initialization single-instance lock, immediate native host/self
  validation, a serialized native queue, atomic lease consumption, conservative
  crash ambiguity, and operation-scoped user copy.
- Treat the candidate `$0.25` PR6B3 canary mentioned in the PR6B0 sequence as
  unapproved. No exact PR6B3 plan or active budget exists.

Changes: Added the proposed PR6B1 plan and updated README, readiness,
architecture, routing-policy, and PR6B0 current-truth documentation. The plan
contains no runtime implementation. No credential field, IPC channel, native
addon, Keychain item, provider, route, egress, budget, or paid behavior changed
in this proposal checkpoint.

Evidence:

- Repository inspection confirmed the current renderer-to-IPC credential
  entry, setup-only CLI-created item, packaged `ELECTRON_RENDERER_URL` path,
  missing single-instance gate, ad-hoc packaging, disabled Hardened Runtime,
  and absence of a native credential addon or signed proof.
- `/usr/bin/security find-identity -v -p codesigning` reported zero valid
  signing identities on the current host.
- Independent architecture/security review rejected the first draft because it
  let the real key enter renderer/V8 memory and exposed nine additional proof
  gaps. The rewritten plan moved entry to a future native sheet, corrected
  identity/admission and zeroization claims, locked the production namespace,
  added native atomic consumption and synthetic generation, hardened renderer
  and multi-instance boundaries, and made crash outcomes conservative.
- Independent UX/governance review of the rewritten plan reported zero P0 and
  zero P1 findings after the production activation, app-copy, accessibility,
  and status semantics were corrected.
- A final independent architecture/security delta review reported zero
  remaining P0/P1 findings after the framework-owned-copy limitation, native
  synthetic generator, policy-fixture claim, status-only legacy namespace, and
  proposal-log corrections landed.
- `git diff --check`, `pnpm validate:build-log`, and
  `pnpm validate:readiness` passed in the proposal working tree. The full
  `pnpm check` then passed with 80 test files/1,008 tests, three files/five
  opt-in tests skipped, TypeScript validation, and all Electron bundles built.

Failures or blockers: PR6B1 is not Approved or Implemented. Phase B cannot
begin until this exact plan ID is approved and the approval checkpoint passes
exact-SHA Linux/macOS CI. Phase C additionally requires a locally installed
Developer ID Application identity/private key, explicit App ID, and matching
profile. None exists on the current build host. The initial draft's negative
security and UX findings are retained in this entry; rewriting the proposal
does not erase them. The first sandboxed `pnpm check` attempt also failed 19
loopback-backed provider tests with `listen EPERM 127.0.0.1`; 79 other test
files passed. Repeating the unchanged check with local loopback permission
passed completely, so this was a proof-environment restriction rather than a
product correction.

Limitations and non-claims: This proposal proves no native compilation, signed
identity, entitlement, Data Protection Keychain access, A/B continuity,
credential lease, real credential, provider validation, cloud inference,
repository egress, billing, optimization, notarization, or release readiness.
Even a future phase-B implementation would remain activation-locked and would
not prove phase C or D.

Paid exposure: `$0`. Planning, repository inspection, documentation, local
validators, and independent review caused no configured vLLM, OpenRouter,
model-list, credential, Keychain, price, health, inference, evaluator, retry,
fallback, or other external LLM-provider request. No reservation or actual
external spend was created.

Next gate: Validate and commit this proposal checkpoint, run exact-head local
gates, push it, and require exact-SHA Linux and macOS CI to pass. Then obtain
explicit owner approval of
`pr6b1-signed-native-credential-lease-v1-plan-1` before any phase-B runtime
change. Signing prerequisites can be installed separately without committing or
displaying private material.

References: [proposed PR6B1 plan](plans/PR6B1_SIGNED_NATIVE_CREDENTIAL_LEASE_V1.md),
[PR6B0 plan](plans/PR6B0_HYBRID_SIMULATION_V1.md), [architecture](ARCHITECTURE.md),
[routing policy](ROUTING_POLICY.md), and [MVP readiness](MVP_READINESS.md).

### BL-20260901-1647-pr6b1b-approved -- 2026-09-01 -- PR6B1-B approved for local zero-cost fail-closed implementation

Status: `Approved`

Scope or hypothesis: Record the project owner's approval of exact plan
`pr6b1-signed-native-credential-lease-v1-plan-1` for phase B only, after the
owner responded **go for the next milestone** directly to the exact approval
request presented with the green proposal checkpoint.

Decisions:

- Interpret the response in its immediate context as approval of local `$0`
  PR6B1-B implementation only: strict contracts, unavailable/fake authorities,
  status-only legacy recovery, mutation journal, locked native broker, package
  and renderer hardening, truthful locked UI, and deterministic proof.
- Make the approval effective only after the commit containing this entry and
  approval metadata passes exact-SHA Linux/check and macOS Electron CI. No
  phase-B runtime edit may begin before that gate closes.
- Preserve the exact plan's structural lock: phase B contains no production or
  synthetic Keychain locator, native secure-entry sheet, reachable SecItem
  mutation, lease consumer, real provider, real Hybrid route, external egress,
  budget reservation, or paid call.
- Do not treat the owner's earlier willingness to use paid models as approval
  for PR6B1-C signed proof, PR6B1-D real re-entry, PR6B2 provider validation,
  PR6B3 paid inference, a campaign budget, or repository egress.
- Keep phase B eligible to proceed without a Developer ID identity after its
  approval checkpoint is green. The missing signing identity remains a hard
  blocker for the later PR6B1-C proof, not for locked phase-B source work.

Changes: Updated plan and current-truth documentation with the scoped approval
and its still-pending exact-SHA activation gate. No runtime, renderer, preload,
IPC, database, native module, Keychain, provider, routing, egress, budget, tool,
or evaluator behavior changed in this approval checkpoint.

Evidence:

- The owner gave **go for the next milestone** directly after being asked to
  approve `pr6b1-signed-native-credential-lease-v1-plan-1` for local `$0`
  phase-B implementation only.
- Proposal revision `7e4b31d19f89087b2c5c7e7517bbfdffc137b2d1` is clean and
  pushed to `origin/main`.
- Local proposal proof passed `pnpm check:release-head` with 80 test files and
  1,008 tests, all seven Electron workflows, and ad-hoc macOS package/archive
  verification.
- GitHub Actions run `33440996797` passed Linux `check` job `99648889525` in 1
  minute 18 seconds and macOS `electron-e2e` job `99649284323` in 1 minute 46
  seconds on exact proposal revision `7e4b31d`.
- Independent architecture/security and UX/governance reviews reported zero
  remaining P0/P1 findings on the exact proposal.

Failures or blockers: The approval is recorded but cannot activate runtime work
until this approval entry is committed, pushed, and its exact SHA passes both CI
jobs. The current host still has zero valid Developer ID Application identities
and no matching profile, so signed phase C cannot run. Those prerequisites do
not block phase B.

Limitations and non-claims: Approved is not Implemented, Verified, Activated,
or Released. Approval does not prove native compilation, signed identity,
Keychain isolation, continuity, a real credential lease, provider validation,
cloud inference, billing, optimization, notarization, or user value.

Paid exposure: `$0`. Approval recording and proposal evidence used local tests,
in-process fake providers, ad-hoc packaging, and GitHub CI. No configured vLLM,
OpenRouter, model-list, credential, Keychain, price, health, inference,
evaluator, retry, fallback, external repository egress, reservation, or actual
spend occurred.

Next gate: Validate and commit this approval-only checkpoint, run the clean
exact-head local gate, push it, and require exact-SHA Linux/check and macOS
Electron CI to pass. Only then begin the phase-B implementation sequence in the
approved plan. Stop before any PR6B1-C, PR6B1-D, PR6B2, or PR6B3 work.

References: [approved PR6B1 plan](plans/PR6B1_SIGNED_NATIVE_CREDENTIAL_LEASE_V1.md),
[proposal entry](#bl-20260901-0514-pr6b1-signed-lease-proposed----2026-09-01----pr6b1-signed-native-credential-lease-proposed-as-four-separately-gated-phases),
[proposal CI](https://github.com/Lotus2077/SOAR/actions/runs/33440996797),
[architecture](ARCHITECTURE.md), and [MVP readiness](MVP_READINESS.md).

### BL-20260901-1916-pr6b1b-implementation-candidate -- 2026-09-01 -- PR6B1-B fail-closed native credential substrate integrated locally

Status: `In progress`

Scope or hypothesis: Implement only the approved local `$0` phase B of exact
plan `pr6b1-signed-native-credential-lease-v1-plan-1`: remove secret-capable web
setup, add a locked native authority and conservative non-secret operation
journal, harden bootstrap/IPC/package identity, and prove an ad-hoc contributor
archive without enabling a protected credential, provider, egress, or spend.
This entry records the implementation candidate before its first code commit;
phase B cannot become Implemented until a clean committed candidate passes
exact-SHA Linux and macOS CI.

Decisions:

- Activated phase-B authority only after approval revision
  `578424ad32e53c96bfa9a8e3901ee31535d1e17a` passed GitHub Actions run
  `33489646557` on both Linux and macOS. The approval remains phase-B-only and
  authorizes no PR6B1-C/D, PR6B2, PR6B3, provider, repository-egress, credential
  mutation, or paid work.
- Retired renderer/preload/IPC credential entry, store/replace, and delete
  operations and deleted the three setup-store implementations. The only web
  surface is strict status metadata. Main requires the current window's exact
  `WebContents`, top-level frame, and renderer URL before payload validation,
  then strict-parses both primary and unavailable status projections before
  returning them.
- Added the locked Objective-C++ Node-API broker. Every lease-shaped export
  returns `activation_locked`; no protected or synthetic locator, secure-entry
  sheet, value-data query, consumer, or mutation symbol exists. The sole
  Keychain exception is one exact generic-password legacy attribute query with
  match-one, attributes true, data false, authentication UI fail, bounded
  results, and native host/module/path/entitlement admission. Ad-hoc admission
  is structural rather than Developer-ID continuity and is acceptable only for
  this non-secret presence class.
- Added a checksummed SQLite v4 credential-operation journal. Operation and
  generation identities use distinct lowercase UUIDv4 brands in both Zod and
  SQL. Rows contain allow-listed non-secret state only. Startup marks abandoned
  pending work conservatively unknown before status IPC, retains unresolved
  exclusion across reopen/concurrent connections and wall-clock rollback, and
  never treats restart or metadata mismatch as definite failure.
- Moved mutable initialization behind Electron's single-instance lock and a
  dynamic bootstrap import. The initial window is created unloaded, exact IPC
  authority and navigation/window/webview denial are installed before the
  sealed renderer loads, and packaged builds ignore renderer URL overrides.
  The test-only pending/unknown UI projection additionally rejects every
  packaged runtime even if Fake/test environment values are supplied.
- Pinned and licensed `@electron/asar` 3.4.1, synchronized the exact reviewed
  native sources into pnpm's installed `file:` dependency before every build,
  ASAR-unpacked exactly one fixed addon, and excluded native source, build
  metadata, and alternate `bin` addons. Package inspection tokenizes exact
  undefined Mach-O symbols and rejects Keychain mutation, protected-item,
  secure-entry, access-group/access-control/accessibility/synchronizable/value-
  data imports and activation strings.
- Replaced electron-builder's broad fallback entitlements with a phase-B
  contributor policy: exactly seven reviewed Electron executables may carry
  only `com.apple.security.cs.allow-jit=true`; every other Mach-O, including the
  addon, must have no entitlement. In particular, disabled library validation
  and unsigned executable memory are forbidden. This is an Electron JIT
  exception for the locked ad-hoc contributor flavor, not Hardened Runtime,
  signed eligibility, or a future production signing policy.
- Made the Cloud Credential screen status-only and truthful. Exact copy covers
  unsigned/ineligible/unknown identity, legacy metadata, protected activation
  lock, provider check Not run, Cloud requests Locked, and operation ambiguity.
  Denied/unavailable refreshes retain qualified prior source-proven legacy
  state. One persistent atomic polite region reports read progress, bounded
  success, or operation progress; actionable unknown states are alerts. Focus
  returns to the exact origin or the visible compact sessions control, and dark
  small-text contrast has a computed WCAG AA ratchet.

Changes: Added the native module, native build/rebuild/core-proof scripts,
locked package policy and archive verifier, packaged canary, main bootstrap,
window-security policy, credential authority/fake/journal/status modules,
SQLite migration v4, strict shared contracts, and deterministic/unit/Electron
tests. Removed the retired secret-capable setup stores and tests. Updated
README, architecture, routing, readiness, contributor prerequisites, package
configuration, dependency lock, and third-party notices. Generated `out`,
native build output, databases, test output, and `dist` remain ignored and are
not part of the candidate commit.

Evidence:

- `pnpm test` passed the locked native C++ core proof plus 88 Vitest files and
  1,026 tests; two files/four opt-in tests were intentionally skipped. The
  focused phase-B integration matrix separately passed 18 files/128 tests, and
  the final IPC/prior-state delta passed four files/40 tests.
- `pnpm typecheck`, `pnpm build`, `pnpm validate:readiness`,
  `pnpm validate:build-log`, and `git diff --check` passed in the integrated
  working tree. Readiness still reports the frozen 22 research and 20 coding
  workload manifests and no high-confidence tracked-file secret match.
- The final unpackaged Electron suite passed 12/12 Local, cancellation,
  second-instance, credential pending/unknown, compact dark/reduced-motion/200%
  zoom, local review, and four Fake Hybrid workflows in 25.8 seconds; the
  separate packaged-only spec was intentionally skipped in that run.
- Final `pnpm package:mac` built, ad-hoc signed, recursively inspected,
  archived, re-extracted, and reverified `dist/SOAR-mac-arm64.zip`, SHA-256
  `ed9236cc5cdc3e6acc8b2a7f88e3915a92dde0a0c32987dde5d04de087db3f84`.
  The immediately following packaged Local-mode canary passed 1/1 in 4.1
  seconds. It loaded the Electron-ABI addon, ignored a hostile renderer URL
  override, showed the signed-setup-unavailable/Not run/Locked UI with no
  password or mutation action, made zero HTTP or upgrade requests to its
  configured loopback trap before and after shutdown, and cleaned its extracted
  temporary app.
- Independent native/security review ended at zero P0 and zero P1 after the
  startup recovery, nonce, host/path, entitlement, package, query-ratchet,
  fallback-projection, and packaged-fixture findings were corrected.
  Independent UI/IPC/navigation/open-source review also ended at zero P0 and
  zero P1 after copy, alerts, persistent success announcement, contrast,
  compact focus, prior-state, and final IPC parse findings were corrected.

Failures or blockers:

- Initial strict-contract focused tests contained three invalid fixture
  assumptions. Test fixtures were corrected without relaxing runtime policy.
- The first addon compilation failed because Xcode 26 deprecation warnings for
  the required noninteractive Keychain UI-fail constant were promoted by
  `-Werror`; a narrowly scoped diagnostic pragma was added around that approved
  constant. The first native-core runner also over-minimized its environment
  and prevented `xcrun` temporary-file creation; it now preserves the caller's
  environment.
- An offline dependency install lacked cached archives and left a partial
  `node_modules`; this caused an absent Electron license, missing Electron
  binary, and native rebuilds that initially found only `better-sqlite3`.
  A normal install/postinstall restored dependencies. No product result is
  inferred from those environment failures.
- Early Electron runs failed before launch, and stale/concurrent bundle runs
  later produced invalid 6/7 and 0/7 results. A clean run then exposed two real
  product defects in sequence: dynamic bootstrap's chunk-relative renderer
  path and preload path. Both now derive from `app.getAppPath()` and their
  negative results remain retained here.
- The first package attempt was blocked by sandbox DNS. Subsequent packaging
  exposed a stale pnpm `file:` dependency, a package with a second addon under
  `bin`, and a verifier that inspected forbidden activation markers only in
  strings. Exact source synchronization, one-addon admission, and exact
  `nm -u` symbol checks corrected those defects. Earlier structurally passing
  package claims were retracted.
- A suffix-only native module-path gate and a legacy-status path that evaluated
  but ignored identity were found and corrected to exact canonical bundle
  equality plus a distinct legacy admission policy. Broad default Electron
  entitlements then made the passive legacy path fail closed; the explicit
  allow-jit-only policy corrected the contributor package without weakening
  native admission.
- Nonfinal dirty-tree canaries passed archives
  `8a1edfb897ab0c7f487565215c32f8b1ffc48b3bd25cbf63718ed52aa5ed0fc2`
  and `8ccb62ccc44d0fbbf7b16d74f990d20bf564078e9bf3534c5ad08f93e06561b4`.
  They were invalidated by later source/security corrections and are not final
  evidence. The final sandboxed package attempt again failed with
  `ENOTFOUND github.com`; the unchanged approved-network rerun produced the
  final hash above.
- The first full Vitest run passed 87 files/998 tests but failed 19 tests in one
  loopback-backed file with sandbox `listen EPERM`. The unchanged file passed
  21/21 with loopback permission, and the final full permitted run passed. A
  restored untracked duplicate of the retired main entrypoint also caused one
  typecheck failure; its identity was inspected and it was moved out of the
  source tree rather than committed or silently used.
- The current host still has no valid Developer ID Application identity or
  matching profile. That blocks PR6B1-C and does not weaken or block the locked
  phase-B candidate.

Limitations and non-claims: This working-tree evidence is not exact committed-
SHA proof and phase B remains In progress. The ad-hoc archive uses the default
Electron icon, disables Hardened Runtime, is not notarized, and is not a release.
The passive legacy check exposes metadata only; the canary exercises the native
status path but does not instrument Security.framework to prove the exact OS
query or disclose any item result. Native signature/Keychain calls have no
service-level deadline, so a pathological OS stall can leave status pending.
The package canary traps its configured loopback HTTP/upgrade targets, not every
possible host-network channel, and it does not run a Local task. Packaged HTML
still permits loopback WebSocket connections for development compatibility;
current packaged renderer source has no such client, but a split packaged CSP
is later defense-in-depth work. Archive/source binding is procedural through an
immediate rebuild, recorded hash, and canary; the wrapper does not accept a
commit or expected-hash argument. Manual VoiceOver remains unrecorded.

No evidence here proves Developer-ID continuity, signed hostile-host denial,
Data Protection Keychain access, upgrade continuity, secure native entry, a
real credential or lease, credential validity, provider account/model/price/
limit/health, OpenRouter contact, repository egress, cloud inference, billing,
dynamic routing quality, cost saving, latency improvement, notarization,
release readiness, or user value. PR6B1-C/D, PR6B2, and PR6B3 remain separately
gated and unapproved.

Paid exposure: `$0`. Implementation, native compilation, deterministic fakes,
local loopback tests, Electron workflows, packaging, archive inspection, and
the packaged canary caused no configured vLLM, OpenRouter, model-list,
credential validation, inference, retry, fallback, evaluator, repository-
egress, or other external LLM-provider request. No credential was entered,
read, replaced, removed, or written; no external budget reservation or actual
spend was created.

Next gate: Commit this implementation candidate, run the clean committed-head
release gate plus Electron/package/canary proof, push the exact SHA, and require
Linux `check` and macOS `electron-e2e` CI to pass. Only a later append-only
closure entry may then mark phase B Implemented. Keep Verified, Activated, and
Released reserved, and stop before PR6B1-C or any paid/provider work.

References: [approved PR6B1 plan](plans/PR6B1_SIGNED_NATIVE_CREDENTIAL_LEASE_V1.md),
[architecture](ARCHITECTURE.md), [routing policy](ROUTING_POLICY.md),
[MVP readiness](MVP_READINESS.md), and
[approval CI](https://github.com/Lotus2077/SOAR/actions/runs/33489646557).

### BL-20260901-1934-pr6b1b-implemented -- 2026-09-01 -- PR6B1-B closed as implemented on exact SHA

Status: `Implemented`

Scope or hypothesis: Close only the approved local `$0` phase B of
`pr6b1-signed-native-credential-lease-v1-plan-1` after its committed
implementation, exact-head local proof, exact archive canary, independent
review, and exact-SHA Linux/macOS CI all pass. Preserve the boundary between an
implemented activation-locked substrate and later signed, credential, provider,
egress, budget, paid, activation, and release work.

Decisions:

- Mark only PR6B1-B **Implemented**. Reserve **Verified** for a separately
  approved passing PR6B1-C signed A/B synthetic continuity proof,
  **Activated** for separately approved PR6B1-D real native re-entry, and
  **Released** for later notarized distribution and release approval.
- Bind the implementation result to exact revision
  `ddd171c6092f695e64360d73e78a257ee3fb9159` and GitHub Actions run
  `33502709739`. Do not infer closure from a dirty working tree, a different
  revision, or the earlier invalidated archive candidates.
- Retain the structural lock: phase B has no production or synthetic protected-
  item locator, native secure-entry sheet, reachable Keychain mutation,
  protected credential resolution, lease consumer, real cloud provider,
  provider validation, repository egress, real Hybrid authority, actual budget
  reservation, or paid request.
- Keep PR6B1-C unproposed and unapproved while the required Developer ID
  Application identity, explicit App ID, matching profile, and private key are
  unavailable. The owner's general permission to use a paid model does not
  supersede the exact gates for PR6B1-C/D, PR6B2, PR6B3, or a paid campaign.
- Narrow the contributor Node contract from unbounded `>=22.22.2` to
  `^22.22.2`, the only fresh-install and CI-proven major line. The host's Node
  26.7.0 repeatedly left Vite/Vitest renderer dependency optimization asleep
  without test progress. Node 24.0.2 completed both the renderer slice and
  canonical full gate against the existing installed tree, but the locked
  `jsdom@30.0.1` dependency requires Node 24.15+ for a fresh install; that
  diagnostic run therefore does not authorize Node 24 support. Do not advertise
  another major until a later fresh frozen install and full proof exist.
- Align the compile-time Node API surface to exact `@types/node` 22.20.1, add an
  exact `22.22.2` `.nvmrc`, and enable pnpm `engine-strict`. The prior Node 26
  types could admit APIs absent from the supported runtime, while an advisory
  engine alone let contributors enter the known-stalling Node 26 path.

Changes: Updated the plan, README, architecture, routing policy, and readiness
documents from candidate/pending language to the exact phase-B closure state.
Also constrained package and contributor metadata to the proven Node 22 major
line, aligned Node type definitions, and added standard version-manager and
install-time enforcement files. No application runtime, renderer, preload, IPC, database, native
module, Keychain, provider, routing, egress, budget, tool, evaluator, or
credential behavior changed in this closure checkpoint.

Evidence:

- Clean committed-head `pnpm check:release-head` passed on
  `ddd171c6092f695e64360d73e78a257ee3fb9159`: the locked native core proof,
  readiness/build-log/type checks, 88 Vitest files and 1,026 tests passed, four
  opt-in tests were skipped, and the production build completed.
- The exact committed-head Electron suite passed 12/12 workflows in 30.5
  seconds: Local tool loop/restart, cancellation, second-instance denial, three
  credential-operation states, compact dark/reduced-motion/200% zoom, local
  review, and four Fake Hybrid cases. The separate packaged-only spec was
  intentionally excluded from that unpackaged run.
- The post-commit macOS archive
  `SOAR-mac-arm64.zip` has SHA-256
  `f259fea2c6e7531cfa9bd2a049d26184a1924a0f434a6e9ff8bf146456c4cfdb`.
  The build copied the reviewed native inputs into the pinned package; the
  package verifier then accepted exactly one addon, the sealed renderer and
  manifest, Mach-O symbol and entitlement policy, strict ad-hoc signature
  validity, the fixed bundle identifier, architecture, and legal resources
  before and after archive extraction. The
  immediately following canary ran that exact hashed archive and passed 1/1 in
  4.7 seconds. It ignored a hostile renderer override, showed native ad-hoc
  locked status plus **Not run** and **Locked**, exposed no password or mutation
  action, and made zero HTTP or upgrade requests to its configured loopback
  renderer/vLLM trap before and after shutdown.
  This archive and canary bind only implementation SHA `ddd171c`; the later
  contributor-engine metadata correction is an Electron packaging input and
  was not repackaged or canaried. Its own CI does not perform package/canary
  proof.
- Exact implementation revision GitHub Actions run `33502709739` passed Linux
  `check` job `99839503665` in 1 minute 42 seconds and macOS `electron-e2e` job
  `99839982854` in 2 minutes 43 seconds. Linux proves cross-platform import,
  build, and test safety but does not compile or run the Darwin addon. The macOS
  job builds the addon and runs unpackaged Electron workflows; it does not run
  the distributable archive or packaged canary, which are separate local
  evidence above.
- Independent native/security and UI/IPC/navigation/open-source final reviews
  each reported zero P0 and zero P1 findings after their findings were fixed.
  The final UI/IPC delta recheck passed four focused files and 38 tests plus
  `git diff --check`.
- `pnpm validate:readiness` still reports 22 research and 20 coding workload
  manifests and no high-confidence tracked-file secret match. The implementation
  commit and this closure record contain no credential, private endpoint,
  private path, raw private trace, evaluator gold, or generated database/archive.
- With coordinator and workers pinned to installed Node 24.0.2, all five
  renderer files passed 60/60 tests in 35.6 seconds, then canonical `pnpm check`
  passed the native proof, 88 Vitest files and 1,026 tests with the documented
  two-file/four-test skips, type checks, readiness/log validators, and the full
  Electron production bundle. Because that runtime is below the locked jsdom
  fresh-install floor, this is diagnostic evidence only. It is not Node 24
  contributor-support, fresh-install, package, or CI proof. Supported-runtime
  proof remains exact Node 22.22.2 CI.
- Under cached exact Node 22.22.2, `pnpm install --frozen-lockfile` synchronized
  `@types/node` 22.20.1, rebuilt the locked addon and `better-sqlite3` for
  Electron, and completed in 7 minutes 1.1 seconds. Canonical `pnpm check` then
  passed the native proof, 88 Vitest files and 1,026 tests with two files/four
  tests skipped, both type checks, both validators, and the production bundle;
  Vitest itself completed in 34.95 seconds. A Node 26.7.0 offline lockfile
  install was rejected before mutation with `ERR_PNPM_UNSUPPORTED_ENGINE`.

Failures or blockers: No phase-B closure blocker remains. The material negative
results, stale/concurrent Electron runs, invalidated archives, package-verifier
corrections, sandbox-only failures, and final fixes remain recorded in
`BL-20260901-1916-pr6b1b-implementation-candidate`; this closure does not erase
or reinterpret them. The first uncommitted closure draft used a compound Status
label and the build-log validator rejected it; the field now uses the exact
`Implemented` enum while the narrower non-claims remain in prose. The current
pre-commit `pnpm check` under the host-default Node 26.7.0 then hit timeout
ceilings in four tests across three unrelated Git-fixture files and stopped
making progress; it was interrupted after the failures were already conclusive.
The unchanged three files passed 27 tests with one opt-in skip in 8.0 seconds
when rerun together in isolation. A second default-Node full run and a verbose
diagnostic run later slept during renderer dependency import with no child work;
moving aside abandoned generated Vite optimizer caches did not correct it. An
initial Node 24 wrapper still let `pnpm exec` resolve Node 26 workers, and a
reduced PATH then omitted nested `pnpm`; both diagnostic attempts were rejected
before being treated as proof. Pinning both the coordinator and worker PATH to
Node 24.0.2 made the renderer slice and canonical full gate pass, but review
then found that runtime is below the locked jsdom Node 24.15 fresh-install
floor. The public contract was corrected to the proven Node 22 line only. This
is an unsupported-Node compatibility finding and contributor-metadata
correction, not an application-runtime correction. The current host still lacks
the signing prerequisites required to propose or execute PR6B1-C.

Limitations and non-claims: Phase-B closure does not prove Developer-ID identity
continuity, signed hostile-host denial, Data Protection Keychain access,
upgrade continuity, secure native entry, a real credential or usable lease,
credential validity, provider account/model/price/limit/health, repository
egress, cloud inference, billing, routing quality, cost saving, latency
improvement, notarization, release readiness, or user value. The ad-hoc archive
uses the default Electron icon, disables Hardened Runtime, and is not notarized.
The native status path has no service-level deadline for a pathological OS
stall; the passive legacy admission is structural rather than Developer-ID
continuity; packaged CSP still retains a loopback WebSocket allowance for
development compatibility although the current renderer has no such client;
archive/source binding remains procedural; and manual VoiceOver is unrecorded.
The packaged canary's loopback trap is not a global network monitor, it runs no
Local task, and it does not instrument Security.framework or disclose whether a
legacy item exists. `engine-strict` guards dependency installation, not every
arbitrary command against an already-installed tree; `.nvmrc` and the documented
contract remain necessary contributor guidance.

Paid exposure: `$0`. The implementation and closure used local compilation,
deterministic fakes, loopback test traps, Electron, ad-hoc packaging, archive
inspection, and GitHub CI. They made no configured vLLM, OpenRouter, model-list,
credential-validation, inference, retry, fallback, evaluator, repository-egress,
or other external LLM-provider request. No credential secret/value was entered,
retrieved, replaced, removed, or written; the sole Keychain exception was the
documented noninteractive metadata-only legacy attribute query. No actual
budget reservation or spend was created.

Next gate: Validate, commit, and push this closure and contributor-runtime
metadata correction, then
require its own Linux/macOS CI as a separate repository-health gate; run
`33502709739` proves the implementation SHA, not the later closure-doc SHA. Stop
before PR6B1-C. A later exact signed-proof plan may be proposed only after its
signing prerequisites exist, then must be committed, independently reviewed,
and explicitly approved before any synthetic Keychain proof. PR6B1-D, PR6B2,
PR6B3, real Hybrid, and every paid/provider operation remain separately gated.

References: [exact PR6B1 plan](plans/PR6B1_SIGNED_NATIVE_CREDENTIAL_LEASE_V1.md),
[implementation candidate and failure ledger](#bl-20260901-1916-pr6b1b-implementation-candidate----2026-09-01----pr6b1-b-fail-closed-native-credential-substrate-integrated-locally),
[implementation CI](https://github.com/Lotus2077/SOAR/actions/runs/33502709739),
[architecture](ARCHITECTURE.md), [routing policy](ROUTING_POLICY.md), and
[MVP readiness](MVP_READINESS.md).

### BL-20260902-0044-pr6b1b-closure-ci -- 2026-09-02 -- PR6B1-B closure and contributor contract passed exact-SHA CI

Status: `Implemented`

Scope or hypothesis: Record the final exact-SHA repository-health proof for the
PR6B1-B closure and Node-22 contributor-contract correction without changing or
expanding the implemented credential substrate. Keep implementation evidence,
closure metadata, package evidence, and later signed/provider gates bound to
their actual revisions.

Decisions:

- Retain `ddd171c6092f695e64360d73e78a257ee3fb9159` as the exact PR6B1-B
  application implementation revision and `571d953c69ea571203edaccee763df5737d1f941`
  as the later closure/current-truth and contributor-contract revision.
- Treat GitHub Actions run `33533178755` as repository-health proof for the
  latter exact revision. It does not replace the implementation archive or
  create signed, credential, provider, egress, budget, activation, or release
  evidence.
- Keep the previously hashed archive and packaged canary bound only to
  `ddd171c`; `571d953c` changes Electron packaging input metadata and was not
  repackaged or canaried. Do not imply that CI fills this package-proof gap.
- Stop before PR6B1-C. The signing prerequisites and separate exact approval
  required by the plan remain absent.

Changes: Appended this evidence-only ledger entry after the closure revision
passed its local exact-head and remote exact-SHA gates. No application runtime,
renderer, preload, IPC, database, native module, Keychain, provider, routing,
egress, budget, tool, evaluator, credential, dependency, package configuration,
or contributor contract changed in this entry.

Evidence:

- Clean committed-head `pnpm check:release-head` passed on
  `571d953c69ea571203edaccee763df5737d1f941` under exact Node 22.22.2: native
  core proof, readiness/build-log/type checks, 88 Vitest files and 1,026 tests
  passed, two files/four opt-in tests were skipped, and the production build
  completed. Vitest completed in 29.92 seconds.
- The exact closure-commit Electron run passed 12/12 unpackaged workflows in
  26.7 seconds; the separately invoked packaged-only spec was intentionally
  skipped because no archive was built for this metadata correction.
- GitHub Actions run `33533178755` passed Linux Node-22 `check` job
  `99941045899` in 1 minute 26 seconds and dependent macOS `electron-e2e` job
  `99941531123` in 2 minutes 44 seconds. The Linux job performed a fresh frozen
  install and the full gate; the macOS job installed, built the addon/app, and
  ran the unpackaged Electron suite.
- Both final independent delta reviews reported zero P0 and zero P1 findings.
  They confirmed current status wording, Node-engine/type/lock consistency,
  package-proof binding, strict-install limitations, and no security-authority
  regression.

Failures or blockers: No new closure failure occurred after commit. The Node-26
optimizer stalls, rejected diagnostic wrappers, Node-24/jsdom-floor correction,
strict-engine limitation, and exact Node-22 recovery remain preserved in
`BL-20260901-1934-pr6b1b-implemented`. PR6B1-C remains blocked from proposal by
the missing Developer ID Application identity, explicit App ID, matching
profile, and private key.

Limitations and non-claims: This evidence does not make PR6B1-B Verified,
Activated, or Released and proves no Developer-ID continuity, protected
credential, lease use, provider validity, cloud request, repository egress,
actual budget, billing, routing quality, cost saving, latency improvement,
notarization, or user value. Run `33533178755` did not package the app or run the
packaged canary. The final package proof therefore remains archive
`f259fea2c6e7531cfa9bd2a049d26184a1924a0f434a6e9ff8bf146456c4cfdb`
from exact implementation revision `ddd171c`, with all limitations recorded in
the preceding closure entry.

Paid exposure: `$0`. Local validation and GitHub CI made no configured vLLM,
OpenRouter, model-list, credential-validation, inference, retry, fallback,
evaluator, repository-egress, or other external LLM-provider request. No
credential secret/value was entered, retrieved, mutated, or written, and no
actual budget reservation or spend was created.

Next gate: Validate, commit, and push this evidence-only record. PR6B1-C may be
proposed only after its signing prerequisites exist; its plan must then be
committed, independently reviewed, and explicitly approved before any synthetic
Keychain proof. PR6B1-D, PR6B2, PR6B3, real Hybrid, and every paid/provider
operation remain separately gated.

References: [PR6B1 plan](plans/PR6B1_SIGNED_NATIVE_CREDENTIAL_LEASE_V1.md),
[closure entry](#bl-20260901-1934-pr6b1b-implemented----2026-09-01----pr6b1-b-closed-as-implemented-on-exact-sha),
[closure CI](https://github.com/Lotus2077/SOAR/actions/runs/33533178755),
[architecture](ARCHITECTURE.md), and [MVP readiness](MVP_READINESS.md).

### BL-20260902-0103-pr6r-real-provider-slice-proposed -- 2026-09-02 -- Development real-provider slice proposed after goal recalibration

Status: `Proposed`

Scope or hypothesis: Reconcile the live repository with SOAR's original
app-first objective: meet a task-quality floor, then minimize paid-model cost
and end-to-end latency across Local and Cloud providers. Propose the first `$0`
phase of a narrow unpackaged real-provider transport/accounting canary without
weakening the packaged production credential lock, collapsing external/paid
approval gates, or pretending unavailable signing and quality evidence exists.

Decisions:

- Record that the project has built a real Local app, canonical state/context,
  deterministic route and budget mechanics, fake Hybrid simulation, locked
  native credential substrate, and offline evaluator infrastructure, but has
  not produced a real Cloud trajectory or Local/Cloud/Hybrid outcome record.
  More unrelated fake, UI, credential, or evaluator substrate alone is not the
  next product-value proof.
- Keep PR6B1-C blocked and unproposed. A live host check on 2026-09-02 still
  found zero valid code-signing identities and zero profiles in both normal
  macOS provisioning-profile locations. The missing Developer ID Application
  identity/private key, explicit App ID, and matching profile remain hard
  prerequisites for the signed synthetic path.
- Propose `pr6r-development-real-provider-slice-v1-plan-1` as a roadmap-order
  recalibration, not a production-security rollback. Split it into separately
  approved R-A `$0` implementation, R-B credential/provider validation plus one
  configured-Local baseline, and R-C paid Cloud canary. PR6B1-C/D remain
  mandatory for packaged production custody.
- Bind every phase to existing public high-risk fixture
  `cal-007-flask-jinja-name`, its Flask repository/base/change revisions, nine
  exact documentation/runtime paths, 62 changed lines,
  snapshot/index/discovery hashes, and packet/token/output ceilings. Its
  curator label is review-attention only, not correctness gold; the canary
  cannot measure task quality or satisfy the original quality goal.
- Propose R-A only: exact-fixture contracts, common-checkpoint comparison,
  loopback Cloud-shaped serialization, route/accounting/authority/replay
  mechanics, app UI, hostile packaged denial, and deterministic proof at `$0`.
  R-A rejects every real credential, non-loopback URL, configured provider,
  off-device egress, actual-cost reservation, and paid request. Every R-A
  attempt/reservation remains simulation-scoped; the actual-paid operation is
  absent and deferred.
- Split R-A delivery into reviewable A1 contracts/build isolation, A2 sealed
  loopback request/accounting authority, and A3 coordinator/UI/package proof.
  The normal package must structurally omit the development runtime; runtime
  `app.isPackaged` checks remain defense in depth rather than the primary lock.
- Require a later R-B plan to define a main-only, read-only development Keychain
  resolver whose secret never enters Electron's launch or child-process
  environment; stable host-authored errors; compile-time package exclusion;
  dedicated-key zero opening exposure and non-resetting provider USD 100 hard
  limit; exact account/model/upstream/pricing validation; and one Local baseline
  that freezes the exact Cloud-bound packet. R-B performs no paid inference.
- Require a later R-C plan and approval to bind one exact selectable upstream
  provider slug plus separately verified unique endpoint/deployment metadata,
  disabled provider/model fallback, all supported parameters, fresh component
  pricing, exact request/packet hashes, two fixed possible paid slots, durable
  OS-user-local authority state, and a USD 0.25 aggregate ceiling. Sent,
  unknown, crash, publication failure, or corrupt/missing authority state can
  never be reset through app-database deletion.
- Preserve the existing simulation-only attempt-unit-of-work guard. A later
  actual paid operation must require unforgeable R-C authority and atomically
  bind its exact application-request body, fixed slot, reservation, and event
  state. It uses direct fetch without SDK reserialization, redirect, or retry;
  every possible billing component is represented or proved disabled, and
  unknown/divergent billing consumes the reservation and stops the campaign.
- Treat the public OpenRouter model page checked on 2026-09-02 as orientation
  only. The exact pinned slug exists and advertises tool calling and structured
  output, but it is not an immutable deployment identity. Official routing docs
  confirm default load balancing/fallback, so later R-C must select one exact
  upstream with `only`/`order`, disable fallbacks, require all parameters, and
  deny when it cannot bind a conservative exact charge ceiling.
- Do not infer approval from the owner's general willingness to use paid models
  or the instruction that initiated this recalibration. Only the exact R-A
  approval sentence may authorize the next build. R-B and R-C remain unproposed
  until their prerequisite evidence exists.

Changes: Added the exact proposed plan and linked its unapproved status from the
README. No application runtime, renderer, preload, IPC, database, native module,
Keychain, provider registry, transport, routing, egress, budget, tool, evaluator,
credential, package, or CI behavior changed.

Evidence:

- The clean baseline was `7e3a4488695d1e75e70f36509f45d6d89233c54e`
  and synchronized with `origin/main` before this proposal.
- Independent read-only product-gap, plan-gate, and implementation-opportunity
  audits agreed that normal runtime constructs exactly one Local provider,
  fake simulation is the only two-provider runtime, the generic 42-workload
  utilities execute no agent episode, write/test/browser/shell tools are absent,
  and no Approved-but-unimplemented runtime milestone exists.
- `/usr/bin/security find-identity -v -p codesigning` returned zero valid
  identities. Bounded counts found zero provisioning profiles in both standard
  user locations. No private signing path or account information was retained.
- The official OpenRouter model page resolved the exact proposed slug on
  2026-09-02 and described Chat Completions examples, tool calling, structured
  output, current providers, and current displayed pricing. Official provider-
  routing documentation separately confirms default load balancing/fallback
  and the available pin/fallback/parameter controls. Those read-only public
  checks are not account, credential, endpoint-health, pricing-admission, or
  inference evidence.
- Final exact Node 22.22.2 `pnpm check` passed both validators and typechecks,
  the locked native core proof, 88 Vitest files and 1,026 tests with two files/
  four opt-in tests skipped, and the Electron production build. Vitest completed
  in 30.55 seconds.
- After the first-draft findings below were corrected, three independent final
  product/experiment, governance/gate, and security/implementability reviews
  each reported zero P0, zero P1, and zero P2 findings. `git diff --check` also
  passed on the final proposal tree.

Failures or blockers: The critical signed-production path is blocked before
proposal by missing Developer ID prerequisites. There was no Approved-but-
unimplemented runtime milestone. Independent review rejected the first PR6R
draft because it collapsed implementation/validation/paid gates, left the
fixture and upstream provider unfrozen, treated output validity as quality,
allowed an Electron launch-environment secret, ambiguously compared shared
investigation latency, underspecified one-shot consumption, and used a non-ledger
status. The proposal now splits R-A/B/C, freezes the high-risk
`cal-007-flask-jinja-name` fixture, makes quality a non-goal, confines R-A to
loopback, moves real secret/provider work to R-B,
requires exact upstream/packet/authority facts before R-C, and uses only the
existing build-log status vocabulary. R-A remains blocked on exact approval.
The first canonical check attempt under the host-default unsupported Node 26.7.0
was rejected by `engine-strict`. The first exact-Node-22 full test inside the
restricted sandbox then passed 87 files/1,007 tests but failed all 19 tests in
the unchanged loopback-backed OpenAI-compatible file with `listen EPERM` on
`127.0.0.1`; typecheck and native proof had already passed. The unchanged final
full gate with test-only loopback permission passed all expected tests and the
build. These were validation-environment failures, not proposal-runtime
regressions, and their negative results are retained here.

Limitations and non-claims: This proposal is not Implemented, Verified,
Activated, Executed, or Released. It proves no credential availability,
provider account/model/price/limit/health, configured endpoint, cloud request,
repository egress, inference, budget reservation, billing, quality, cost saving,
latency improvement, routing benefit, signing continuity, notarization, release
readiness, or user value. Even a later passing one-fixture canary can prove only
bounded development transport/admission/accounting/replay integrity and one-
sample latency records, not correctness, optimality, or general performance.

Paid exposure: `$0`. This turn used repository inspection, local signing-
prerequisite checks, independent read-only audits, and public documentation
research. It made no configured vLLM, OpenRouter API, model-list, provider-
validation, inference, retry, fallback, evaluator, repository-egress, or other
LLM-provider request. No credential value was resolved, entered, retrieved,
mutated, displayed, or persisted, and no budget reservation or actual spend was
created.

Next gate: Validate and independently review the exact proposal, commit and push
it, and require Linux `check` plus macOS `electron-e2e` CI to pass. Then request
the exact phase R-A `$0` approval sentence in the plan. Stop before every
runtime edit, credential resolution, provider/API contact, configured-vLLM
request, repository egress, budget reservation, or paid operation until that
approval is durably recorded.

References: [proposed PR6R plan](plans/PR6R_DEVELOPMENT_REAL_PROVIDER_SLICE_V1.md),
[PR6B1 signed production plan](plans/PR6B1_SIGNED_NATIVE_CREDENTIAL_LEASE_V1.md),
[routing policy](ROUTING_POLICY.md), [MVP readiness](MVP_READINESS.md),
[benchmark protocol](../benchmarks/README.md), and
[OpenRouter model page](https://openrouter.ai/deepseek/deepseek-v4-flash-0731),
and [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

### BL-20260902-0146-pr6r-proposal-ci-passed -- 2026-09-02 -- Exact proposal revision passed required CI

Status: `Proposed`

Scope or hypothesis: Durably bind the PR6R development real-provider proposal
to its first pushed exact revision and record whether the proposal-only change
passes the required Linux validation and macOS Electron gates. This is evidence
for reviewing the proposal; it is not implementation approval or runtime proof.

Decisions:

- Bind the reviewed proposal to exact revision
  `6f06d8c97d36ce24b2231b3e88710c8aeafaaa73` and CI run `33539267786`.
- Retain PR6R-A as `Proposed`. Passing proposal CI does not authorize or elevate
  R-A, R-B, or R-C, and it does not change any credential, egress, provider,
  reservation, or paid-work boundary.
- Require the exact R-A approval sentence in the committed plan before any
  runtime edit. R-B credential/provider validation and R-C paid inference remain
  separate future plans and approval gates.

Changes: Appended this evidence-only record after the proposal commit passed
both required CI jobs. No application, renderer, preload, IPC, database, native
module, Keychain, provider, transport, routing, egress, budget, tool, evaluator,
fixture, package, or workflow behavior changed.

Evidence:

- GitHub Actions run `33539267786` passed for exact proposal revision
  `6f06d8c97d36ce24b2231b3e88710c8aeafaaa73`.
- Linux job `99961155368` passed append-only verification plus the canonical
  validate, type-check, test, and build gate in 1 minute 32 seconds.
- macOS job `99961687592` built the application and passed Electron end-to-end
  tests in 2 minutes 21 seconds.
- The proposal revision was synchronized with `origin/main` before this record
  was appended.

Failures or blockers: The CI run recorded no failed job. PR6R-A remains blocked
on exact informed approval. PR6R-B and PR6R-C remain unproposed, and the signed
production path remains blocked by the missing Developer ID prerequisites
recorded in the preceding proposal entry.

Limitations and non-claims: Proposal CI proves only that the committed plan,
README link, and build-log entry preserve the existing repository gates. It
proves no runtime implementation, configured provider, credential, endpoint
health, repository egress, inference, accounting, billing, task quality, cost
saving, latency improvement, routing benefit, signing continuity, release
readiness, or user value.

Paid exposure: `$0`. CI and this evidence-only update made no configured vLLM,
OpenRouter API, model-list, validation, inference, retry, fallback, evaluator,
repository-egress, or other external LLM-provider request. No credential value
was resolved or handled, and no reservation or actual spend was created.

Next gate: Validate, commit, and push this evidence-only record and require its
CI to pass. Then request the exact PR6R-A approval sentence from the committed
plan. Stop before all runtime edits and every credential, provider, egress,
reservation, or paid action until that approval is durably recorded.

References: [PR6R proposal](plans/PR6R_DEVELOPMENT_REAL_PROVIDER_SLICE_V1.md),
[proposal CI](https://github.com/Lotus2077/SOAR/actions/runs/33539267786), and
[preceding proposal entry](#bl-20260902-0103-pr6r-real-provider-slice-proposed----2026-09-02----development-real-provider-slice-proposed-after-goal-recalibration).

### BL-20260902-0445-pr6ra-approved -- 2026-09-02 -- PR6R-A approved for zero-cost loopback implementation

Status: `Approved`

Scope or hypothesis: Record the owner's informed response to the exact PR6R-A
approval request and authorize only the committed `$0`, loopback-only R-A1
through R-A3 implementation. Preserve the separately gated R-B credential and
provider-validation phase and R-C actual-paid phase.

Decisions:

- Treat the owner's direct reply, "approved, and actual-paid authority is
  granted; go for the next milestone", immediately following the exact R-A
  approval sentence, as contextual acceptance of that exact R-A sentence.
- Apply only the R-A authority that can presently be admitted: local `$0`
  implementation and loopback proof with no real credential resolution,
  configured-vLLM or OpenRouter request, off-device repository egress,
  actual-cost reservation, or spend. Every R-A attempt and reservation remains
  `costScope=simulation`; the actual-paid operation remains absent.
- Record the owner's additional actual-paid statement as future intent, not
  operative R-B or R-C authority. The committed plan forbids collapsing phases,
  and no R-B evidence or exact R-C provider, packet, price, credential-metadata,
  reservation, or authority facts yet exist for informed paid admission.
- Implement R-A in the committed A1, A2, then A3 order. Each checkpoint requires
  focused tests and review before the next begins; full exact-head, package,
  Electron, independent review, and Linux/macOS CI evidence remain required for
  `Implemented` closure.

Changes: Updated the PR6R plan and README current-state wording from `Proposed`
to `Approved` for phase R-A only and appended this authority record. No runtime,
renderer, preload, IPC, database, native module, Keychain, provider, transport,
routing, egress, budget, tool, evaluator, fixture, package, or workflow behavior
changed.

Evidence:

- The exact R-A approval sentence was presented from the committed plan after
  proposal revision `6f06d8c97d36ce24b2231b3e88710c8aeafaaa73` passed Linux
  and macOS CI in run `33539267786`.
- The owner responded directly and unambiguously approved proceeding to the
  next milestone while also expressing broader paid intent.
- Approval-record baseline `5c6f826b82879b5b73c66c5a2111b7b37ee50f3e`
  was clean, synchronized with `origin/main`, and green in CI run `33539797481`
  before this entry.

Failures or blockers: No R-A implementation failure exists yet because runtime
work has not begun. R-B and R-C remain unproposed and cannot consume the broader
paid statement. The signed packaged-production path remains blocked by the
missing Developer ID prerequisites recorded earlier.

Limitations and non-claims: `Approved` is authority for scoped work, not proof
of implementation. This entry proves no runtime contract, loopback request,
fixture materialization, provider validity, credential availability, configured
endpoint, repository egress, actual reservation, inference, billing, quality,
cost saving, latency improvement, routing benefit, packaging, release readiness,
or user value.

Paid exposure: `$0`. Recording approval made no configured vLLM, OpenRouter API,
model-list, validation, inference, retry, fallback, evaluator, repository-egress,
or other external LLM-provider request. It resolved no credential and created no
simulation or actual-cost reservation.

Next gate: Validate, independently review, commit, push, and pass Linux/macOS CI
for this approval record before the first R-A runtime edit. Then implement and
review R-A1, R-A2, and R-A3 without crossing any credential, configured-provider,
off-device-egress, actual-budget, or paid boundary.

References: [PR6R plan](plans/PR6R_DEVELOPMENT_REAL_PROVIDER_SLICE_V1.md),
[proposal CI](https://github.com/Lotus2077/SOAR/actions/runs/33539267786),
[approval-record baseline CI](https://github.com/Lotus2077/SOAR/actions/runs/33539797481),
and [proposal entry](#bl-20260902-0103-pr6r-real-provider-slice-proposed----2026-09-02----development-real-provider-slice-proposed-after-goal-recalibration).

### BL-20260902-0357-pr6ra-utc-reset -- 2026-09-02 -- Correction: resume UTC build-log IDs after the PR6R-A approval

Status: `Implemented`

Scope or hypothesis: Correct the immutable PR6R-A approval entry's use of an
Asia/Shanghai wall-clock-like minute in an ID governed by the ledger's UTC
rule. Preserve that committed approval byte-for-byte while returning subsequent
entries to observed UTC chronology.

Decisions:

Timestamp sequence reset after: `BL-20260902-0445-pr6ra-approved`.

- Preserve the committed approval entry and every earlier ID exactly as merged.
  This correction changes only the validator's timestamp watermark; it does not
  change or expand the approval, provider, credential, egress, cost, or paid
  authority recorded there.
- Replace the generic lifetime/date reset exception with an explicit immutable
  allowlist containing only the two known correction-to-predecessor pairs:
  `BL-20260830-1454-build-log-utc-reset` after
  `BL-20260830-2050-heldout-readiness-approved`, and this correction after
  `BL-20260902-0445-pr6ra-approved`. A listed reset must still be an
  `Implemented` `Correction`, move backward, carry exactly one well-formed
  marker naming the immediately preceding entry, and cite only an earlier
  entry. An unknown future reset is invalid even on a new UTC date.
- Reject an unnecessary reset, a second reset on the same UTC date, a malformed
  or non-immediate marker, and any later uncorrected backward timestamp.
- Use the observed `2026-09-02T03:57Z` minute for this correction and a later
  observed UTC minute for the still-uncommitted R-A1 entry.

Changes: Updated `scripts/validate-build-log.ts` to admit only the two exact
known reset pairs, added acceptance coverage for both pairs and adversarial
unknown/malformed/repeated reset coverage, appended this correction, and left
the committed approval entry unchanged.

Evidence:

- The exact marker names the immediately preceding
  `BL-20260902-0445-pr6ra-approved` entry and this ID moves backward to an
  observed UTC minute on the same date.
- The focused validator suite covers a valid later-date correction, a rejected
  second same-date correction, unnecessary and malformed markers, incorrect
  status/title/target cases, and continued monotonic enforcement after reset.
- The focused build-log validator suite passed 16 of 16 tests, including both
  exact known pairs plus unknown, malformed, unnecessary, repeated, and later
  uncorrected rewind rejection.
- `pnpm validate:build-log` accepted the repository ledger with 59 entries.
  These focused results prove only the chronology contract described here.

Failures or blockers: The approval ID was already committed with the wrong time
basis and cannot honestly be renamed. The earlier global one-reset policy would
reject this otherwise valid new correction, while a generic date-scoped escape
would authorize unknown future rewinds. The exact two-pair allowlist must land
with this correction. No product-runtime blocker or authority expansion follows
from this chronology correction.

Limitations and non-claims: This is governance-metadata repair only. It proves
no R-A1 runtime correctness, final review closure, loopback request, configured
provider contact, credential availability, repository egress, accounting,
quality, cost saving, latency improvement, routing benefit, packaging, release
readiness, or user value.

Paid exposure: `$0`. The correction and deterministic validator tests make no
provider, model-list, inference, evaluator, retry, fallback, repository-egress,
credential, reservation, or paid request.

Next gate: With the focused validator and repository-ledger checks complete,
finish the open R-A1 hardening, independent review, exact checks, commit, push,
and Linux/macOS CI before beginning R-A2.

References: [PR6R-A approval](#bl-20260902-0445-pr6ra-approved),
[prior UTC reset](#bl-20260830-1454-build-log-utc-reset),
[PR6R plan](plans/PR6R_DEVELOPMENT_REAL_PROVIDER_SLICE_V1.md), and
[build-log rules](#log-rules).

### BL-20260902-0358-pr6ra1-in-progress -- 2026-09-02 -- PR6R-A1 contracts and structural isolation under final review

Status: `In progress`

Scope or hypothesis: Implement and independently review only checkpoint R-A1
of the approved PR6R-A development slice: exact frozen-fixture materialization,
strict canonical and persisted contracts, durable simulation-only authority,
append-only canary storage, and a compile-time development build graph whose
marker is rejected by the normal package policy. Keep R-A overall in progress
and stop before R-A2 loopback dispatch/accounting and R-A3 coordinator/UI work.

Decisions:

- Use a structurally separate Electron config, main entry, preload, and static
  renderer. The special entry checks `app.isPackaged` before dynamically
  importing any PR6R runtime module and never imports normal bootstrap, config,
  runtime catalog, provider, credential, session IPC, or OpenAI SDK code. Exact
  source allowlists and generated graph proofs identify all three special
  graphs; the normal graph rejects every PR6R development source transitively.
  Every genuine development runtime authority retains the forbidden marker.
  Build-proof v5 rejects non-literal or external dynamic imports, common
  runtime-loader/global-network syntax in allowlisted special sources, unsafe
  emitted filenames, and local output imports that do not resolve to an
  emitted chunk. It also binds the exact imported members of broad externals,
  such as Electron, rather than approving the whole module surface. This keeps
  the observed special graph statically enumerable rather than trusting only
  Rollup's concrete module-specifier lists.
  A pinned TypeScript-capable Babel parser distinguishes executable AST nodes
  from comments, strings, template raw text, and regular-expression literals
  while preserving executable template expressions. The denylist remains
  deliberately non-semantic and does not resolve aliases or reflection.
  The canonical dual-flavor gate builds the special graph, requires normal
  policy rejection, rebuilds the normal graph, and scans every bounded output
  artifact. Filesystem and ASAR metadata are size-preflighted before file reads
  or archive extraction, with post-read bounds retained. Its unsigned JSON
  graph files are build-time declarations rather than standalone artifact
  provenance.
- Materialize `cal-007-flask-jinja-name` only from explicit local Git objects.
  The app never fetches the repository. The temporary detached workspace packs
  the exact base commit/tree/blob objects, declares that base as its shallow
  boundary, removes all refs, reflogs, remotes, and alternates, and verifies the
  frozen repository, revisions, subject, materialization protocol, nine paths,
  62 lines, snapshot, index, discovery, and risk facts. Failed materialization
  cleans its temporary root; success returns a cleanup handle, and the exact
  fixture proof calls it in `finally` and verifies removal. A3 must prove the
  same cleanup ownership across success, failure, and cancellation.
- Define canonical checkpoint and application-request preimages from the actual
  canonical packet and semantic messages. Structural hashes, byte counts,
  provider shape, terminal state, accounting, latency, fallback, and
  safe-projection facts are recomputed or cross-bound. R-A1 does not accept a
  caller-asserted output-validity pass: completed records keep validity
  `deferred` until R-A3 can recompute it from admitted evidence.
  Every Cloud-shaped synthesis request must use a child session distinct from
  the campaign parent before an authority binding can be constructed.
- Persist bounded evidence for the implementation revision, OS authority claim,
  synthetic loopback provider validation/pricing, common investigation,
  per-route measurement, reported/unreported tokens, exact host arithmetic,
  simulation reservation/settlement, output validity, fallback, and terminal
  reason. Renderer-safe text rejects URIs, absolute/traversal paths, host/port
  endpoints, authorization/envelope/header material, and raw diagnostics.
- Carry campaign/guard and full sealed application-request/slot/terminal hashes
  through strict persisted schemas. A1 checks canonical construction and
  structural equality, but a public store caller can still submit fabricated
  structurally valid opaque hashes; live OS-ledger and EventStore/BudgetLedger
  reconciliation remains an explicit A2 gate.
  Cloud and Hybrid sessions, application requests, authority records, and
  reservations must be distinct while origin, canonical request body, and
  common checkpoint remain exactly shared. A Local fallback can be claimed
  only against the matching failed Cloud-shaped terminal; `not_used` is
  terminal only after all three synthesis slots are decided.
- Use a separate development-canary SQLite schema rather than changing the
  production app database. Reopen verifies exact migration-owned tables,
  indexes, triggers, an explicit payload-contract version/fingerprint, embedded
  evidence chronology, integrity, and foreign keys. Payload-contract v6 also
  requires the host-pricing snapshot timestamp not to predate the exact
  provider validation hash it references and replaces the full fallback state
  in renderer output with a lossy safe shape that omits its internal Local
  child-session ID. It also binds both Cloud-shaped records to one canonical
  request body. The reducer rejects no-op snapshots and enforces a 17-record
  ceiling; schema and pre-replay checks bound each raw payload to 1 MiB before
  JavaScript materialization. That bound is four times the ReviewResultV1
  serialized ceiling so three maximum-size outputs and one result-sized
  projection-envelope allowance remain representable. It otherwise enforces
  one campaign, parent, and checkpoint, deterministic record order, monotonic
  terminal transitions, and atomic comparison plus safe-projection equality. Unshipped
  pre-A1 development databases are intentionally incompatible and must be
  recreated or explicitly migrated.
  Opening the store requires an explicit absolute on-disk path; no default or
  `:memory:` production path exists, and the raw SQLite handle is private.
  White-box corruption tests use a test-local unsafe accessor. The first
  post-A1 persisted-contract revision must add a real ordered migration and an
  old-database compatibility test rather than only changing the fingerprint.
- Store global campaign and slot authority outside app user data under the OS
  user state boundary. Publish 0700/0600 no-follow records atomically through a
  temporary file plus hard link. Bind each one-shot slot to revision, loopback
  origin, full application-request hash, body/checkpoint hashes, request, child
  session, attempt, and reservation. Terminal records bind the exact claim
  hash; recovery-only handles can write only fixed failed/unknown recovery
  semantics; a failed terminal can recover the one campaign-wide Local
  fallback without restoring dispatch authority. Per-record sibling sentinels
  make one-sided deletion of a claim, terminal, or fallback fail closed. The
  arbitrary-root claim helper no longer exists in production exports; tests
  exercise the fixed OS layout through a mocked home boundary.
- Keep Local and loopback terminal vocabularies route-scoped and reconcile each
  loopback failure/cancellation reason with its request disposition and response
  evidence. Only the post-claim `loopback.budget_denied` failure may terminalize
  a claimed slot as definitely not sent; authority/request/binding/slot-consumed
  failures remain admission errors outside the claimed-slot terminal contract.
- Make the one campaign-wide fallback an explicit reuse of the already-completed
  Local synthesis result, bound to that Local child session and result hash,
  rather than an evidence-free second synthesis operation.
- Reserve one parent/common Local investigation and separate synthesis child
  sessions for the two Cloud-shaped slots in later checkpoints because the
  existing budget ledger permits one reservation per session. Do not weaken the
  existing fake-Hybrid or simulation-only paid-start guard.

Changes: Added the PR6R development contracts, frozen-fixture wrapper, separate
canary store and payload-contract-v6 migration fingerprint, OS-user authority
ledger, nominal runtime authority, standalone development-canary Electron
graph, build marker and module-graph-v5 verifier, stable path-redacting fixture boundary, explicit
fixture-proof command, and focused unit/integration tests.
Generalized the existing local-review fixture materializer while retaining its
exact `cal-001` compatibility wrapper. Updated contributor, architecture,
readiness, README, and plan text to keep R-A1 explicitly in progress until the
exact implementation revision is reviewed, pushed, and green on Linux/macOS CI.

Evidence:

- Approval revision `67833f5fb711ddbb82f956ee4aa530516b78c2c7` passed
  Linux and macOS CI in run `33557490659` before runtime work began.
- An earlier post-hardening focused A1 matrix passed 126 tests across ten files,
  including contracts, canary-store reducer/schema tampering, authority
  concurrency/recovery/transplant cases, runtime/build isolation, locked
  package policy, build-log governance, legacy `cal-001`, and exact `cal-007`
  integration.
- The explicit `cal-007` proof command passed from prepared local public Flask
  objects. The same command without the required local object source failed
  closed instead of silently skipping the milestone proof.
- On an earlier payload-contract-v6 review snapshot, ten focused contract, store,
  authority, build-isolation, navigation, fixture-boundary, package-policy,
  build-log, and legacy-fixture files passed 156 tests. Both TypeScript graphs,
  readiness, the 59-entry ledger, and `git diff --check` passed. The exact
  `cal-007` proof passed again from prepared local public objects and verified
  successful cleanup, while the same command with no source configured failed
  closed.
- Node and renderer TypeScript graphs passed. The marked development-canary
  build passed exact main/preload/renderer artifact identities and generated
  source-graph proofs. The normal verifier rejected that special output by its
  forbidden marker. A normal rebuild and verifier then passed and restored
  normal output; the development verifier rejected that normal output because
  the exact special graph proof was absent.
- Earlier targeted contract/store/build and authority reviews drove the
  corrections recorded below. On the latest parser-backed tree, independent
  truth-log, security, and open-source-maintainability re-reviews reported no
  remaining actionable P0/P1/P2. The final build/release refresh remains open;
  these reviews do not replace exact-HEAD or CI proof.
- An earlier post-hardening full `pnpm check` passed with readiness and the 59-entry
  ledger valid, both TypeScript graphs clean, the locked native core proof,
  94 test files and 1,131 tests passed, three files and five opt-in tests
  skipped, and a successful normal production build plus isolation scan. Later
  route, authority, chronology, payload-contract, and build-flavor hardening
  makes those results historical rather than final closure evidence.
- A later pre-maintainability-fix payload-contract-v6 working snapshot passed
  `pnpm check` with
  readiness and the 59-entry ledger valid, both TypeScript graphs clean, the
  locked native core proof, 95 test files and 1,162 tests passed, three files
  and five opt-in tests skipped, and the complete special-build rejection plus
  restored normal production build. Subsequent store API and build-parser
  corrections make this historical rather than final closure evidence.
- On the parser-backed v5 build-policy snapshot, ten focused A1 files passed
  160 tests; both TypeScript graphs, readiness, the 59-entry ledger, and diff
  hygiene passed. The exact `cal-007` proof passed and removed its successful
  temporary workspace. Build/package policy tests passed 23 tests, including
  literal/regular-expression false-positive cases and the two demonstrated
  executable regex/template bypasses.
- The parser-backed working snapshot passed `pnpm check`: 95 test files and
  1,166 tests passed, three files and five opt-in tests skipped, both type
  graphs and the locked native core passed, and the v5 special build was
  rejected by normal policy before a verified normal output rebuild. Final
  review then required exact renderer-CSP/case-insensitive no-script assertions
  and static computed-member/TypeScript-wrapper coverage; its focused 17-test
  file passed after those later changes. Exact-HEAD rerun, commit, push,
  and Linux/macOS CI remain open, so none of this is release or milestone-
  closure proof.

Failures or blockers: Early store tests failed because a fixture retained an
obsolete response-schema hash. Early authority tests exposed macOS temporary
path canonicalization and a partially visible concurrent claim; typecheck also
caught test narrowing errors. Those were corrected with realpath-normalized
test roots, atomic publication, and typed fixtures. The first exact Flask
materialization failed because its shallow local source had no branch ref
visible to the shared clone; the prepared source gained a local ref and the
exact proof then passed. A broad alternate-object repack later hung, and the
first bounded pack failed `git fsck` because cloned refs/reflogs and the root
tree still referenced uncopied objects; the materializer now deletes those
refs/reflogs, includes the root tree, and uses an explicit shallow boundary.

Independent review rejected the first A1 draft for unbound request hashes,
cross-record checkpoint drift, incomplete schema fingerprinting, skipped exact
fixture proof, retained Git alternates, loose terminal states, a special entry
that imported the normal app, incomplete proof/accounting fields, claimless
fallback, orphan terminal handling, unrestricted recovery semantics, lost
restart fallback, and transplantable terminal records. Later adversarial review
also found unsafe timestamp refinement, unbound host pricing, contradictory
validity/reason states, and punctuation-adjacent URI/path/endpoint/envelope text
bypasses. A subsequent whole-diff/security review found fallback-transition,
output-validity, authority-reset/order, terminal-consistency, and numeric-host
leakage gaps; those findings remained explicit hardening work rather than being
prematurely reported as clean. Their fixes include genuine sealed-
request bindings, campaign/guard and slot/terminal cross-hashes, strict terminal
code/disposition combinations, Cloud-before-Hybrid chronology, one-use fallback
trigger identity, completed-validity deferral, and broader safe-field screening.
A build-isolation review then demonstrated that the first marker-only checks
could accept a normal bundle with an injected marker, miss a transitive normal
import, pull broad session/routing contracts into the special graph, and leak a
fixture-source path on failure. Exact graph allowlists/proofs, three artifact
identities, normal-runtime signature scans, and a stable fixture error replaced
that design. Final review subsequently found that emitted relative imports
could escape the output bundle, oversized filesystem/ASAR members were checked
only after reading, and computed ESM or CommonJS runtime loaders could evade the
enumerated external graph. Output-target validation, pre-read/pre-extract size
bounds, build-proof v4, exact external-member bindings, and explicit
computed-loader denials now cover the tested cases. The same review found that
a Cloud-shaped request could reuse the parent
session and that host pricing could claim a timestamp earlier than the
hash-bound provider validation; the child-session refinement and persisted
payload-contract-v6 chronology ratchet now rejects both before authority/store
admission. Review also found a raw internal fallback session ID in the safe
projection, cross-slot authority that required only different attempt IDs but
not shared evidence, duplicated cancellation vocabulary, and a loopback
renderer redirect gap. A lossy safe fallback projection, exact cross-slot
origin/body/checkpoint bindings, shared cancellation arrays, and redirect/frame
navigation policy now reject those cases. These corrections have focused
adversarial proof. At that checkpoint the final whole-diff reviews and full
gate remained open; the later evidence above supersedes that interim state.
The same store review demonstrated that identical snapshots could be appended
without bound and that replay selected raw payload text before enforcing any
byte ceiling. No-op rejection, a fixed record cap, a SQL byte constraint, and a
pre-materialization count/size query now fail closed under focused duplicate,
flood, and oversized-database tests.
The first finite-store correction reused the 256 KiB single-review-result bound
as the entire record bound. Review demonstrated that this rejected a legal safe
projection containing multiple bounded outputs. Payload-contract v6 derives a
1 MiB record ceiling from three result slots plus one result-sized envelope
allowance, and a regression persists and replays a valid three-output
projection larger than the old ceiling.
The final contributor review found three P2 maintainability gaps: an implicit
in-memory store default with a public raw database handle, raw-source lexical
matching that rejected comments and literals, and migration guidance that
could be read as promising compatibility from a fingerprint bump alone. The
store now requires an explicit absolute durable path and hides its connection;
the first build-guard correction attempted to mask comments and literal text
while retaining template expressions; contributor guidance requires a real
ordered migration plus an old-database compatibility test for the first
post-A1 persisted change.
Adversarial follow-up then proved the handwritten masker could mistake regular
expression characters for comment, quote, or template delimiters and hide a
later executable `fetch`, `require`, or `process.binding`. Build-proof v5
replaces that scanner with the pinned Babel parser and AST-node traversal;
regressions cover harmless literal/regex text plus executable syntax after a
slash regex and inside a template expression.
Build review subsequently found that zero-expression template-literal member
names and type-erased TypeScript wrappers around `process` or a computed
property were executable but not normalized by the first AST traversal. The v5
policy now resolves static string/template property names and unwraps the
transparent TypeScript/parenthesized expression forms before testing direct
globals and `process` binding access; dedicated regressions reject each
demonstrated form. A final adjacent case reached `process.binding` through the
static `globalThis.process`/`global.process` member path; v5 now recognizes
those direct global process references as well. These AST changes postdate the
1,166-test full run recorded above, so that run remains working-snapshot rather
than exact-final-tree evidence.
The first AST-loader-guard attempt imported a TypeScript 7 package root that
exposes no compiler API and broke every special transform; the benign focused
case caught it before commit. A later first attempt to add the pinned Babel
parser offline failed before changing dependencies because pnpm selected a
different store than the existing install; retrying against the already-linked
store reused local packages with zero downloads. The parser-backed v5 build
policy replaces both failed approaches.
The first parser-backed dual-flavor build then rejected the renderer HTML as if
it were JavaScript. The transform now reserves AST parsing for JavaScript and
TypeScript modules while the exact static-HTML source/CSP/no-script checks retain
the renderer boundary; the rerun passed and restored normal output.
Before these later store/API/parser corrections, the first post-hardening full
gate failed at readiness because a
synthetic private-key sentinel was written as one scan-visible test literal; the
test now assembles the sentinel without resembling a tracked credential, and
readiness plus that historical full-gate rerun passed. A later historical
full-gate run inside the managed sandbox failed 19 OpenAI-compatible tests
solely because loopback `listen` returned `EPERM`; its approved rerun with
loopback test-server permission passed before the final store/API/parser
changes. A fresh complete gate on the final parser-backed tree, R-A2, R-A3, and
exact-SHA CI remain blockers to overall R-A `Implemented` status.

Limitations and non-claims: The current A1 snapshot is intended to prove strict
local contracts, fixture identity, bounded storage/authority ratchets, and
build-graph isolation only after its final gates pass. It has no
loopback HTTP dispatch, runtime simulation reservation/settlement episode,
three-route coordinator, cancellation flow, renderer interaction, Electron
workflow, packaged archive canary, configured vLLM/OpenRouter contact,
credential resolution, off-device repository egress, actual-cost reservation,
or paid inference. The special renderer is only a structural stub. A sibling
guard fails closed if only the ledger root is deleted, but a hostile same-user
actor can delete both copies or the guard and ledger; A1 does not claim tamper
resistance against the OS-account owner. A1 persists opaque structural binding
hashes, but it does not yet prove they came from the live OS ledger or reconcile
them with EventStore/BudgetLedger terminal accounting; R-A2 must complete that
ordering before dispatch. The explicit payload-contract fingerprint is a
versioned contributor ratchet, not an automatic digest of Zod internals.
Build-proof v5's dynamic-loader/global-network AST-node denylist is deliberately
conservative and is not semantic/data-flow analysis or a host sandbox. It may
reject harmless executable identifiers; aliases, obfuscation, reflection, or
APIs reachable through an admitted external still require exact-source review
and runtime evidence. The graph JSON alone does not prove no egress.
Completed output validity is explicitly deferred until R-A3 recomputes
evidence-backed checks. Renderer-safe evidence paths are also fixture-static
and limited to the nine changed `cal-007` paths; unchanged tests, helpers, or
other repository context cannot be cited unless A3 introduces a
snapshot/evidence-set-bound allowlist and versions the persisted contract.
One public fixture has no correctness gold, so this proves no review quality,
best-result regret, cost saving, latency improvement, routing benefit,
production readiness, verification, release, or user value.

Paid exposure: `$0`. A bounded public Flask Git acquisition prepared local
objects for the exact fixture proof, but the application made no repository
fetch and no configured vLLM, OpenRouter, model-list, validation, inference,
retry, fallback, evaluator, or other LLM-provider request. No credential value
was resolved, no off-device repository packet was sent, every encoded authority
fact remains simulation-only with actual-paid authority false, and actual
external provider spend remains zero.

Next gate: Independently review, commit, push, and require Linux/macOS CI for
this exact R-A1 checkpoint. Only after that evidence is durable may R-A2 add the
sealed one-use loopback transport and existing simulation accounting unit of
work. Stop before R-A3 and every R-B/R-C credential, configured-provider,
off-device-egress, actual-budget, or paid boundary until their preceding gates
are satisfied.

References: [PR6R plan](plans/PR6R_DEVELOPMENT_REAL_PROVIDER_SLICE_V1.md),
[approval record](#bl-20260902-0445-pr6ra-approved),
[routing policy](ROUTING_POLICY.md), [architecture](ARCHITECTURE.md), and
[benchmark protocol](../benchmarks/README.md).

### BL-20260902-0730-pr6ra1-implemented -- 2026-09-02 -- PR6R-A1 closed as implemented on exact SHA

Status: `Implemented`

Scope or hypothesis: Close only checkpoint R-A1 of the approved `$0` PR6R-A
development slice after its implementation, exact committed-head and fixture
proof, independent review, push, and exact-SHA Linux/macOS CI pass. Keep R-A
overall in progress and preserve all later transport, coordinator, credential,
provider, egress, actual-budget, paid, verification, and release gates.

Decisions:

- Mark only R-A1 **Implemented**. This status covers the frozen public fixture,
  strict canonical/persisted contracts, bounded development canary store,
  cooperative OS-user authority ratchet, and structurally isolated special
  build graph. It does not mark R-A2, R-A3, R-B, R-C, PR6R overall, or the app
  Verified, Activated, Released, or production-ready.
- Bind A1 closure to exact revision
  `4cab8a7d61ef648fdfed6b03653c5bfbe367e28d` and GitHub Actions run
  `33603435199`. Retain every failed test, rejected design, reviewer finding,
  store-contract correction, parser bypass, and non-proof in the preceding
  append-only implementation entry.
- Preserve the authority boundary recorded at approval: R-A2 and R-A3 remain
  simulation-only and `$0`; R-B credential/configured-provider validation and
  R-C actual-paid inference remain separately unproposed and unapproved. The
  owner's broader paid intent does not supply the missing exact R-B/R-C facts.
- Make R-A2 the next milestone. It may add only the sealed one-use loopback
  transport plus existing simulation attempt/budget/event reconciliation
  required by the committed plan, with focused proof and review before R-A3.

Changes: Updated README, architecture, readiness, and the PR6R plan from A1
candidate language to exact-SHA `Implemented` closure and appended this durable
status record. No runtime, renderer, preload, IPC, SQLite schema, authority,
provider, credential, routing, repository-egress, budget, tool, evaluator,
package, or network behavior changed in this closure checkpoint.

Evidence:

- Clean committed-head `pnpm check:release-head` passed on
  `4cab8a7d61ef648fdfed6b03653c5bfbe367e28d`: readiness and the 59-entry ledger
  were valid, both TypeScript graphs and the locked native core passed, 95 test
  files and 1,166 tests passed, three files and five opt-in tests skipped, the
  module-graph-v5 development flavor passed, normal policy rejected it, and a
  verified normal production build was restored.
- The explicit exact-HEAD `cal-007-flask-jinja-name` proof passed 1/1 from
  already-present local public Git objects, reproduced the frozen nine-path,
  62-line snapshot, and verified successful temporary-workspace cleanup. The
  same exact-HEAD command without the required local object source failed closed
  instead of silently skipping.
- Independent build/release, truth-log, security, and open-source-
  maintainability reviews reported no remaining actionable P0/P1/P2 after the
  final payload-contract-v6, explicit durable-store, parser-backed graph-v5,
  computed-member/TypeScript-wrapper, CSP, and no-script corrections.
- GitHub Actions run `33603435199` passed on the exact revision. Linux job
  `100162005942` passed frozen install, append-only log proof, and the canonical
  full check in 1 minute 36 seconds. macOS job `100162436067` passed frozen
  install, the dual-flavor build gate, and Electron E2E in 2 minutes 31 seconds.

Failures or blockers: CI recorded no failed job, and no A1 P0/P1/P2 remains.
R-A2 transport/accounting, R-A3 coordinator/UI/package proof, and exact-SHA CI
for their future revisions remain blockers to R-A completion. R-B/R-C remain
blocked on their separately required proposals, facts, and approvals.

Limitations and non-claims: A1 proves bounded local contracts, structural
authority/storage behavior, fixture identity, and canonical build isolation.
It has no loopback HTTP episode, live EventStore/BudgetLedger reconciliation,
three-route coordinator, cancellation workflow, interactive canary UI,
configured vLLM/OpenRouter request, credential resolution, off-device packet,
actual-cost reservation, paid inference, or correctness gold. Its unsigned
graph proof is not artifact attestation; its parser policy is not semantic,
data-flow, or runtime no-egress proof; its authority files do not resist a
hostile same-user deleting both copies; completed output validity remains
deferred; renderer citations remain limited to the nine changed fixture paths.
This closure proves no review quality, best-result regret, cost saving, latency
improvement, routing benefit, production readiness, verification, release, or
user value.

Paid exposure: `$0`. The exact fixture proof, local checks, builds, reviews,
push, and CI made no configured vLLM, OpenRouter, model-list, validation,
inference, retry, fallback, evaluator, repository-egress, credential,
reservation, or other external LLM-provider request. No credential value was
resolved, no application/provider-bound review packet left the host,
actual-paid authority remained false in every A1 contract, and actual external
provider spend remained zero.

Next gate: Commit and push this closure-only record, require its own Linux/macOS
repository-health CI to pass, and bind that exact result in a later append-only
evidence entry. Only then may R-A2 planning and implementation begin. R-A2 is
limited to the sealed one-use loopback transport and simulation
accounting/reconciliation unit of work, with focused tests, independent review,
an exact implementation commit, committed-head proof, push, and Linux/macOS CI
required before R-A3. Stop before every R-B/R-C credential,
configured-provider, off-device-egress, actual-budget, or paid operation.

References: [PR6R plan](plans/PR6R_DEVELOPMENT_REAL_PROVIDER_SLICE_V1.md),
[implementation entry](#bl-20260902-0358-pr6ra1-in-progress),
[approval record](#bl-20260902-0445-pr6ra-approved),
[CI run](https://github.com/Lotus2077/SOAR/actions/runs/33603435199),
[MVP readiness](MVP_READINESS.md), and [architecture](ARCHITECTURE.md).

### BL-20260902-1554-pr6ra1-closure-ci-evidence -- 2026-09-02 -- A1 closure record passed exact-SHA repository CI

Status: `Implemented`

Scope or hypothesis: Bind the status-only A1 closure record to its own exact
commit and required Linux/macOS repository-health CI before beginning any A2
runtime change.

Decisions:

- Treat `6a8bc0db27dce7d5eab4b72a456e424a92c55d6a` as the durable A1
  closure-record revision. It changes documentation and the append-only ledger
  only; A1 runtime remains bound to implementation revision `4cab8a7`.
- Preserve A1 as Implemented, not Verified or Released. This evidence does not
  change R-A2/R-A3 status and grants no R-B/R-C credential, configured-provider,
  repository-egress, actual-budget, or paid authority.
- Require the A2 design record committed with this evidence to pass its own
  Linux/macOS repository-health CI before runtime implementation starts.

Changes: Appended this evidence-only record after the closure commit passed its
exact-SHA remote gates. No runtime, renderer, preload, IPC, SQLite schema,
provider, credential, egress, budget, routing, tool, evaluator, dependency,
package, or network behavior changed.

Evidence:

- GitHub Actions run `33604950171` completed successfully on exact SHA
  `6a8bc0db27dce7d5eab4b72a456e424a92c55d6a`.
- Linux `check` job `100166710575` passed frozen install, append-only comparison
  against the pushed parent, readiness, typecheck, deterministic tests, and the
  dual-flavor build gate in 1 minute 37 seconds.
- macOS `electron-e2e` job `100167150221` passed frozen install, development
  and normal build-flavor verification, and Electron E2E in 2 minutes 11
  seconds.
- The preceding independent closure review found no remaining actionable
  P0/P1/P2 and verified the exact implementation SHA, run/job identities,
  durations, five-file documentation diff, 60-entry ledger, append-only status,
  and status/authority boundaries.

Failures or blockers: No closure CI job failed. A review caught two candidate-
record defects before commit: the next gate initially skipped closure-record CI,
and an unqualified host-egress sentence ignored the GitHub push. The record now
requires this exact evidence gate and scopes the no-egress claim to application/
provider-bound review packets. The reviewer also questioned fixture-enabled
test arithmetic; a direct full-suite rerun with the exact public fixture enabled
proved 96 passed/two skipped files and 1,167 passed/four skipped tests, confirming
that the separately recorded non-fixture release-head totals remain 95/three and
1,166/five. Those corrections remain part of the audit trail.

Limitations and non-claims: Repository CI re-proves deterministic repository
health and Electron/build isolation for the closure revision. It does not add
or prove a loopback attempt, transport bytes, accounting reconciliation,
configured provider, credential, off-device application packet, actual spend,
review quality, routing benefit, production readiness, verification, or
release.

Paid exposure: `$0`. This evidence used GitHub repository CI and local
deterministic fixture/tests only. No configured vLLM, OpenRouter, model-list,
validation, inference, retry, fallback, evaluator, credential resolution,
repository-egress request, actual reservation, or external model spend
occurred.

Next gate: Land the adjacent frozen R-A2 design and require its exact-SHA
Linux/macOS repository-health CI. Only then may R-A2 runtime implementation
begin.

References: [closure record](#bl-20260902-0730-pr6ra1-implemented),
[closure CI](https://github.com/Lotus2077/SOAR/actions/runs/33604950171), and
[PR6R plan](plans/PR6R_DEVELOPMENT_REAL_PROVIDER_SLICE_V1.md).

### BL-20260902-1555-pr6ra2-implementation-plan -- 2026-09-02 -- Frozen A2 sealed loopback and accounting design

Status: `Approved`

Scope or hypothesis: Refine checkpoint R-A2 within the already approved exact
PR6R-A `$0` grant before code changes. Add only sealed loopback bytes, a one-use
nominal transport capability, strict synthetic response parsing, hash-bound
child checkpoint import, existing simulation accounting/replay, and fail-closed
recovery. Preserve the A3 UI/coordinator/package boundary and every R-B/R-C
gate.

Decisions:

- Use a canonical synthetic Chat Completions envelope: exact request/model/
  upstream identities, creation zero, exactly one non-streamed assistant-string
  choice, no extra field/tool/refusal, `finish_reason=stop`, exact status/framing/
  JSON headers, a derived 524,807-byte envelope bound, coherent integer usage,
  zero cache writes, and the existing ReviewResultV1 shape parser. Full evidence
  acceptance remains A3 work.
- Freeze the strict internal response schema as
  `pr6r-loopback-chat-completion-response-v1`: exact request ID, object,
  creation value, model, synthetic `provider`, one choice/message/finish reason,
  and nested prompt/completion/cache/reasoning/total usage fields, with every
  extra field forbidden and exact `canonicalPr6rJsonV1` byte equality. Normalize
  visible output as completion minus reasoning. Derive the wire cap from a
  519-byte maximum-value empty-content envelope plus twice the 262,144-byte raw
  result ceiling, exactly 524,807 bytes.
- Omit the generic attempt/context `structuredOutputContract` in A2 because its
  current completion grammar requires immediate host evidence acceptance. Keep
  the exact schema hash in the checkpoint import/sealed request, persist only
  normalized attempt/accounting and hashes, return the parsed result main-only,
  and leave A3 to persist host-accepted output/projection. Never forge an
  `accepted` parse status.
- Add optional bounded `responseBodySha256` and `reviewResultSha256` fields to
  `inference.attempt.finished`, because no existing allowed A2 event can carry
  those hashes without raw assistant content or a false accepted review. A
  response hash requires complete bounded bytes and `sent`; a result hash also
  requires a successful strictly parsed result and equals
  `canonicalPr6rReviewResultSha256(parsedResult)`. Old events omit both and
  replay unchanged. This does not change the PR6R canary payload contract.
- Supersede the R-A wording `direct-fetch` with one byte-preserving direct
  `node:http.request`. Node HTTP does not follow redirects; the transport also
  has no retry, SDK, proxy/DNS, keepalive, speculation, or background path. It
  sends the exact sealed buffer only to literal IPv4/IPv6 loopback with a fixed
  path and no Authorization header. Real authorization remains deferred to
  separately gated R-B/R-C.
- Require a nominal endpoint capability minted only by the dedicated bounded
  fixture server and bound to its actual listening origin. No environment,
  renderer, IPC, argument, database, deep link, or general factory can select an
  arbitrary loopback service. This prevents local SSRF but does not authenticate
  a hostile same-user loopback process.
- Mint an opaque WeakMap-backed dispatch grant only from genuine special-build
  runtime authority, live OS slot authority, the exact sealed request, and a
  matching admitted simulation reservation/open attempt. Consume it
  synchronously before socket construction. Structural, recovered, cloned,
  mismatched, stale, concurrent, or reused objects cannot dispatch.
- Mint a pre-reservation cancellation receipt only inside BudgetLedger
  `runImmediate`, after `assertEventReconciled` and nested EventStore replay
  revalidate the imported child, prove no reservation/attempt start, and append
  `session.cancelled` in the same `BEGIN IMMEDIATE`. Publish the OS cancelled/
  not-sent terminal only from that receipt; a crash between the two terminals
  remains reconciliation-only and cannot redispatch.
- Advance build graph proof to v6 only when the retained transport lands. Record
  exact importer/specifier/binding edges. A2 stays backend/test-only and leaves
  shipped special-build graph v5 unchanged; A3 retention must create v6 by re-
  enumerating every existing v5 edge plus only named
  `node:http.createServer` in the bounded fixture-server source, named
  `node:http.request` in the transport source, and named
  `node:crypto.createHash` in its exact new hashing source if needed. Reject
  every other new/re-exported/broad/alternate binding and every HTTPS/net/TLS/
  DNS/SDK/Electron-net/global-network/dynamic-loader alternative.
- Add a schema-compatible hash-only synthesis-checkpoint import so a distinct
  child session can reuse the parent's completed investigation without copying
  or fabricating tool calls. A nominal capability is minted only after exact
  parent replay and consumed atomically/idempotently before OS claim. It binds
  parent sequence, checkpoint, packet, semantic-message, response-schema, and
  provenance identities and creates an inherited Local lease with zero child
  investigation attempts. Forged/stale/transplanted/reused imports fail; existing
  sessions replay unchanged and the normal app gains no transport constructor.
- Freeze that append-only carrier as event `synthesis.checkpoint.imported` with
  payload schema `synthesis-checkpoint-import-v1` and bounded import/parent/
  sequence/hash/review/tool/lease/timestamp fields. Keep generic
  `RouterStateViewV0`, `CheckpointProposalInputV0`, and
  `checkpoint-router-input-v0` unchanged. A development-only PR6R adapter may
  emit an ordinary bounded v0 router snapshot plus canonical imported-evidence
  trigger facts only after nominal import replay; reducer validation accepts
  only that exact fact/import/admission binding with a true count of zero child
  investigations. Normal routing is not weakened and no attempt is fabricated.
- Reuse the existing EventStore, BudgetLedger, and atomic AttemptUnitOfWork. Do
  not weaken `commitBudgetedStart`: every reservation remains simulation-scoped
  and its non-simulation guard remains exact. Host pricing uses integer
  micro-USD rates, zero cache assumption/fee, actual estimated input, and the
  fixed maximum output allowance.
- Freeze the saga order as atomic child checkpoint import, OS claim, atomic
  SQLite reserve/start, one-use grant, single request, atomic finish/settlement,
  then OS terminal, after all pure validation. Budget denial and cancellation
  rechecked after OS claim but before synchronous reservation produce zero
  requests and no reservation. Once start is admitted, grant mint/consumption
  has no await gap; later ambiguity is unknown/full-reservation.
- Do not invent cross-store atomicity. An OS claim without exactly matching
  SQLite evidence permanently blocks this fixed campaign: no redispatch, second
  slot, fallback, terminal comparison, or safe projection. Trusted replay may
  mint a reconciliation-only capability for an exact SQLite budget denial,
  pre-reservation `session.cancelled` terminal with no attempt/reservation, or
  terminal attempt; it may publish only the matching OS terminal and cannot
  dispatch. An admitted open attempt may recover through existing unknown/full-
  reservation accounting plus `loopback.recovery_required`. Matching terminal
  pairs replay idempotently; missing/corrupt/conflicting evidence blocks.
- Harden the downstream authority APIs themselves so an OS-only terminal,
  including one made by the A1 raw recovery helper, cannot unlock the second
  slot, fallback, comparison, or projection. Require a nominal cross-store-
  reconciled terminal capability privately bound to matching SQLite accounting
  and OS evidence; remove or de-authorize the raw recovery path rather than
  relying on a wrapper convention.
- Keep canary payload contract v6, its store schema, and authority ledger record
  format unchanged in A2. The blocked incomplete state is not misrepresented as
  a persisted terminal. The first future persisted campaign/comparison/
  projection change still requires a real ordered migration and old-database
  compatibility proof.
- On budget denial, retain the explicit Local attempt created by the existing
  UoW for later A3 coordination; do not pretend Local fallback executed. A2
  returns typed main-only evidence and hashes but persists no raw response,
  header, Authorization marker, endpoint, socket error, exception, or body.

Changes: Refined the committed PR6R plan with the exact A2 architecture,
cross-store saga, no-migration/blocking decision, direct-HTTP correction,
response bounds, child checkpoint handoff, accounting rules, and focused proof
matrix. No runtime code changed in this plan checkpoint.

Evidence: Independent read-only contract, existing-primitive, and transport
threat-model reviews inspected the A1 request/authority/store/build boundaries,
generic EventStore/BudgetLedger/AttemptUnitOfWork, reducer evidence rules,
recovery paths, and existing test fixtures. They identified the reusable
simulation guard and atomic ledger/event transaction, plus three gaps now made
explicit: reusable slot handles need a one-use transport grant; OS files and
SQLite need a conservative saga; and distinct synthesis children need a real
checkpoint import instead of duplicated evidence. A final adversarial review
found two more recovery gaps before code: cancellation needed a durable SQLite
terminal before its OS terminal, and an OS-only A1 recovery record could still
unlock downstream slots. Both are now explicit implementation requirements. A
last persisted-contract review also found that no allowed generic A2 event could
carry the promised response/result hashes; the optional strictly coupled finish-
event fields now close that gap without changing the canary payload contract. A
scope review then caught that silently widening checkpoint-router v0 would have
weakened normal evidence semantics; the explicit PR6R-only adapter and versioned
import event replace that approach.

Failures or blockers: The first design assumption—that A1's slot handle plus a
structural UoW return was sufficient—failed review because both can be replayed
or forged at the transport boundary. Another assumption—that the generic
`evidence_complete` UoW could run directly in a child—failed source inspection:
the reducer requires successful investigation evidence in that same session.
The checkpoint-import contract and persistence-revalidated one-use grant replace
those assumptions. Cross-store terminal recovery remains intentionally
availability-losing in ambiguous windows rather than falsely claiming atomic
success. The initial cancellation design also lacked its SQLite terminal, and
the initial downstream rule trusted any OS terminal; atomic cancellation and a
nominal cross-store reconciliation capability supersede those assumptions. This
plan/evidence revision also replaces the assumption that finish events already
had hash carriers and the assumption that generic router v0 could directly
represent imported evidence. It still needs commit, push, and exact-SHA Linux/
macOS CI before implementation.

Limitations and non-claims: R-A2 will prove only bounded synthetic loopback
transport, simulation admission/accounting, replay, cancellation, and
conservative recovery over deterministic fixtures. It will not provide the A3
coordinator/app UI/package canary, real credential or provider validation,
configured vLLM/OpenRouter contact, off-device application egress, actual-cost
reservation, paid inference, correctness gold, best-result regret, cost saving,
latency advantage, production readiness, verification, or release.

Paid exposure: `$0`. Planning and reviews used repository source and the
already-local public fixture only. No configured vLLM, OpenRouter, model-list,
validation, inference, retry, fallback, evaluator, credential resolution,
repository-egress request, actual reservation, or external model spend
occurred.

Next gate: Commit and push this exact evidence/design revision and require both
Linux `check` and macOS `electron-e2e` CI to pass. Then implement only the frozen
R-A2 scope, run its focused adversarial/accounting/recovery proof, obtain
independent reviews, and stop before R-A3 and all R-B/R-C operations.

References: [PR6R plan](plans/PR6R_DEVELOPMENT_REAL_PROVIDER_SLICE_V1.md),
[A1 closure evidence](#bl-20260902-1554-pr6ra1-closure-ci-evidence),
[A1 closure record](#bl-20260902-0730-pr6ra1-implemented),
[attempt unit of work](../src/main/attempt-unit-of-work.ts), and
[architecture](ARCHITECTURE.md).

### BL-20260902-1610-pr6r-future-paid-authority -- 2026-09-02 -- Future actual-paid authority recorded without activating a provider gate

Status: `Approved`

Scope or hypothesis: Approval class `future_cost_authority_only`. Record the
user's explicit statement that actual-paid work is authorized after the current
milestone, while preserving the already approved PR6R sequencing and exact per-
checkpoint safety contracts. This entry is not an R-B/R-C plan approval or a
paid-dispatch capability.

Decisions:

- Treat the user's authorization as sufficient high-level cost authority for a
  later real-provider milestone; do not ask again merely whether any paid spend
  is permitted.
- Do not reinterpret that broad authority as implementation proof or as a
  waiver of the committed R-B/R-C prerequisites. Before the first configured
  provider request, the exact provider, credential lease, repository-egress
  packet, actual budget/reservation, request count, stop conditions, and
  recovery behavior must still be frozen and durably approved under the PR6R
  gates.
- Continue R-A2 as the already approved `$0` loopback milestone. It has no
  reason to contact a configured provider or consume actual spend.

Changes: Appended this authorization record only. No runtime, provider,
credential, endpoint, egress, budget, routing, IPC, renderer, package, or
network behavior changed.

Evidence: The user explicitly wrote, "approved, and actual-paid authority is
granted; go for the next milestone" after being told that the next active
checkpoint was the `$0` PR6R-A2 slice and that later real-provider gates remain
separate.

Failures or blockers: None for R-A2. The exact R-B and R-C operating plans are
not yet approved or Implemented, so no paid/configured-provider operation may
start from this record alone.

Limitations and non-claims: This is an authorization fact, not evidence of a
credential, working provider endpoint, valid model, safe repository egress,
actual reservation, successful paid response, quality improvement, cost
saving, latency improvement, production readiness, verification, or release.

Paid exposure: `$0` in this record. No provider request or model inference was
made while recording it.

Next gate: Complete the exact-SHA plan CI, implement and prove R-A2 at `$0`, and
stop at R-A3. A later move into R-B/R-C must bind this broad authority to the
exact committed provider and cost/egress plan before any actual-paid dispatch.

References: [PR6R plan](plans/PR6R_DEVELOPMENT_REAL_PROVIDER_SLICE_V1.md) and
[A2 implementation plan](#bl-20260902-1555-pr6ra2-implementation-plan).
