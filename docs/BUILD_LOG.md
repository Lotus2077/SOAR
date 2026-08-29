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
