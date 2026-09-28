# Public executable checks with host-owned checkpoints

Status: Approved for offline implementation and verification only. No new live or
paid batch is authorized here. The preceding two-attempt study is closed and its
307 input/evidence files have been archived without changing its failed result.

## Product hypothesis

One existing cloud planning call can produce an implementation plan and bounded
executable checks from the public task and public source. Local execution receives
feedback from those checks before its finishing budget is exhausted. This may catch
behavioral mistakes that a short visible command and prose critic miss, without
paying for a full cloud repair loop on every task. Both quality and complete-session
economics must be measured; generated tests can be incomplete or wrong.

Keep the full coding-task mix. Do not derive an easy-task filter from exposed
failures or supply hidden evaluation cases, corrected references or post-hoc
counterexamples to the planner. Final independent evaluation stays separate.

## Implementation boundaries

Add an opt-in host_repair_window schedule. The host executes its admitted check
directly after the initial bounded local work, without requesting a model tool call
or incrementing model usage. The first checkpoint becomes due after
min(4, local-call-cap minus 4) settled local calls, with at least five local calls
configured, no request in flight, and neither a fresh passing check nor prior failed
check. Run at most one automatic checkpoint per local phase. Explicit later checks,
source freshness, finishing reserves, cancellation and unknown-outcome rules remain.
Existing final_only and repair_window semantics and defaults remain unchanged.

Add an opt-in plan_and_checks mode to the existing cloud-plan/local workflow. Reuse
its planner transport, admission, request count and cost ledger. The planner returns
one bounded JSON plan and Python unittest artifact, with explicit source identity
and expected nonempty test count. Parse and inspect syntax on the host; never execute
generated Python there. Execute generated checks only in the existing isolated
Docker boundary. Persist their origin and receipts separately from trusted public
checks. A generated check pass does not establish independent patch acceptance.

The host checkpoint and explicit check action must deliver actual output and retain
the exact checked source. Later edits invalidate previous results. Missing, skipped,
malformed, incomplete or timed-out generated checks cannot become passing evidence.
The planner source is retained outside candidate-controlled test files. Model-authored
checks remain fallible even with valid syntax and execution; their false positives,
missed defects and complete generation/execution costs must be reported.

## Verification and next live gate

Verify Python/main agreement, no synthetic provider usage for host actions, pending
request exclusion, source freshness, output feedback, timeout/cleanup, replay and
legacy compatibility. Exercise the actual controller/HTTP/Python/Docker path using
deterministic provider fixtures before inference. Independently review integration.

Then freeze one distinct bounded development experiment through the shared runner,
including every planner, local and fallback cost. No automatic retry of earlier
studies. Development quality and complete-policy economics must clear before the
four untouched confirmation tasks are used. Confirmation retains the target of at
least 20% lower API cost per accepted patch, no additional material regression and
at most 25% median latency increase. Device payback and owner acceptance remain
separate requirements.

References: [last failed result](../MVP_ROUTING_EARLY_CHECK_REPORT.md),
[routing research](../ROUTING_POLICY_RESEARCH.md), [build log](../BUILD_LOG.md).
