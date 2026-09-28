# Earlier check feedback for bounded local repair

Date: 2026-09-09. Status: Approved for offline implementation and verification.
This document does not authorize new inference. The overall objective remains
lower complete-session cost with preserved coding quality across the task mix.

## Evidence and hypothesis

The closed reasoning comparison's disabled cache repair used six work calls,
then failed its first visible check on call seven. One call remained and the
router stopped, so the model never had an opportunity to act on that failure.
Medium reasoning timed out and supplied no completion evidence. Raising reasoning
or time limits is not supported by that result.

Hypothesis: enforce a visible check while one edit/check/submit sequence still
fits the existing envelope. This may convert a late, unrecoverable visible failure
into actionable feedback. It cannot catch defects outside the visible checks or
prove semantic acceptance. Test the same development work; do not select only easy
successes or remove harder tasks from the eventual session comparison.

## Implementation boundary

Add an explicit programmatic `localCodingCheckSchedule: repair_window` profile for
local-only runs. Omission retains the current `final_only` schedule and existing
historical checkpoint semantics. The experimental schedule requires at least five
local calls and does not change call limits, output allowance, timeouts, thinking,
tool implementations, source checks, unknown-outcome handling or paid authority.

When four calls remain, no current passing source-bound check exists, and no check
has failed earlier in the local phase, advertise and admit only `run_visible_checks`
or `request_help`. With eight calls this checks on call five, leaving edit six,
check seven and submission eight. If a failed check already supplied feedback,
do not force an immediate duplicate check. A current passing check retains normal
submission eligibility. Only a fresh passing host check permits submission.

Main and Python independently enforce the same mask against the admitted schedule.
Record the schedule in the initial checkpoint evidence and execution limits so
the run's behavior can be reconstructed. Reject unsupported profiles, incompatible
policies, undersized envelopes and attempts to change the admitted schedule.

Separately fix future evaluation attribution: bind raw objective bytes to their
frozen hash, then compare the stored objective with the actual create schema's
normalized value. Exercise real controller/store creation in the regression test.
Do not change the closed reasoning study's frozen evaluator or rerun its claims.

## Verification and next live gate

Verify default behavior, forced early check, failed-check feedback followed by
edit/check/submission, earlier failed-check handling, fresh passing checks, request
mask rejection, cross-policy rejection and historical replay. An actual
controller/Python/HTTP/Docker case must observe the eight-call sequence and prove
source-bound checks, exact history, zero unresolved requests and container cleanup.
Use independent source review and appropriate focused regressions before live use.

Archive original generation bindings before changing shared runtime. A distinct
live development gate must freeze schedule, assignments, source, evaluation inputs,
calls, time and fee limits. Preserve all assigned outcomes and stop unknown
inference without retry. The four untouched confirmation tasks remain gated.

If development repair improves, rejoin the entire six-task policy outcome with
all planner/critic/repair/fallback costs and independent semantic review. Fresh
confirmation must compare complete sessions against the same corrected cloud
control, including difficult tasks and failures. Advancement requires no additional
material regression, at least 20% lower API cost per accepted patch, and at most
25% median latency increase. Four tasks are only an initial falsification screen,
not broad statistical proof. If earlier feedback does not help, retain that negative
result and revisit the agent/handoff policy rather than extending this batch.

References: [reasoning result](../MVP_ROUTING_REASONING_REPORT.md),
[repair result](../MVP_ROUTING_REPAIR_REPORT.md), [build log](../BUILD_LOG.md).
