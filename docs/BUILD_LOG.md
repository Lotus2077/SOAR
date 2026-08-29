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
