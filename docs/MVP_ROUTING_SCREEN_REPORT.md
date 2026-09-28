# Routing MVP: interrupted comparison, 2026-09-09

Later correction: the compact-critic/local-repair development ends with four
accepted candidates out of six assigned and fails advancement. Identical new
counterexample probes also expose defects in two previously accepted cloud controls,
so the six-of-six cloud assessment below is historical, not current ground truth.
See the [repair result and control correction](MVP_ROUTING_REPAIR_REPORT.md).

The coding MVP and experimental routing mechanisms are implemented. The current
policies have not demonstrated lower cost while preserving cloud quality.

The frozen comparison assigns 12 tasks to each of four policies. Only the first
six task blocks reached terminal dispositions: 24 runs, including failures. The
remaining 24 assignments are unrun. The local-first run on the sixth task stopped
after the local provider returned HTTP 500. One zero-reservation local request
remains unknown; worker cleanup is confirmed. Three subsequent metadata checks
failed for the local server. No failed request was retried or excluded. After a
fourth failed metadata check, both providers responded successfully to metadata
at 08:57 UTC. This proves metadata recovery only; no new generation was requested.

| Policy | Independent checks passed, among 6 attempted | Accepted after checks and blind review, among 6 attempted | Known API fees for all attempts | Fees per accepted patch so far |
| --- | --- | --- | --- | --- |
| Prepared cloud control | 6 | 6 | $1.418164 | $0.236361 |
| Local only | 3 | 2 | $0.000000 | $0.000000 |
| Local first, bounded cloud escalation | 5 | 3 | $0.704548 | $0.234849 |
| Cloud plan, local execution, bounded cloud recovery | 6 | 4 | $0.472680 | $0.118170 |

The complete assigned denominator remains 12 per policy: accepted counts currently
stand at 6/12, 2/12, 3/12 and 4/12, with six unrun assignments per policy. The table
describes only the interrupted prefix and is not a completed success-rate estimate.
The local-first provider error is included among its six attempts and is not a
scorable success. All known failed-attempt fees are included.

Two independent full-patch reviews cover all 24 candidate artifacts. They agreed
on 23; an independent adjudication resolved the remaining disagreement. Original
responses, reviewer blindness clarifications and a citation-only adjudication
correction are preserved separately. The final offline join validates exact
candidate, evaluation, event, review and fee bindings. Its result is explicitly
incomplete for every alternative, with no advancement.

Cloud-plan/local has roughly half the API cost per acceptable patch in this prefix,
but accepts four patches where cloud accepts six. Local-first accepts three and
has nearly the same fee per acceptable patch as cloud. These are quality failures
against the observed cloud control, not evidence that the original product claim
has been met. Unrun assignments cannot erase an already observed paired failure.
The interrupted screen also cannot pass its original no-unknown gate. Latency
comparison remains unavailable under the required complete-sample rule.

Repository mechanics verification passed 1,470 tests with 12 skipped, 78 Python
runtime tests, and five Electron workflows. These cover execution, admission,
accounting, cancellation, cleanup, recovery and app patch handling; they do not
prove model quality. Twenty synthetic offline-join tests and six continuation-driver
tests also pass. No release or owner Keep/Reject acceptance is inferred.

Four fresh confirmation fixtures are prepared. Eight baseline/reference Docker
proofs completed; all references pass 110 independent methods and all four visible
commands, with cleanup confirmed. The original cache baseline timeout and subsequent
bounded-wait correction remain recorded. No model has attempted confirmation tasks.

The next experiment, `cloud_plan_local_review`, is now implemented: cloud planning,
local coding, then a required cloud review and optional repair before submission.
It keeps the original policies distinct. The previously approved untouched suffix
has been retired without dispatch; its unrun assignments and the original failure
remain preserved. This follows diagnosis of keyword-forwarding and fractional-delay
regressions that passed narrow checks and therefore never triggered recovery.

For this new implementation, 89 Python runtime tests, the full 1,485-test repository
gate (12 existing skips), six Electron workflows and 13 private driver tests pass.
Typechecks, native checks and both build flavors pass. Independent source review
found no blocking issue in the runtime and driver. Cloud repair now invalidates the
earlier local check; an Electron case verifies changed patch/source hashes, fresh
final checks, exact export and restart persistence. Earlier startup, ambiguous UI
query and Git-fixture timeout failures remain recorded. Passing runs retain the
original limits. The earlier 1,470-test and five-Electron-workflow results above
belong to the prior policy implementation.

The new policy's development batch also failed its cost gate. Its first three
completed tasks passed visible and independent checks but cost USD 1.199436, already
more than 80 percent of the full six-task cloud control's USD 1.418164. Even if every
task were accepted and the rest were free, it could not achieve the required savings.
Root stopped the batch: three completed, one cancelled, two unrun. Known new fees
are USD 1.288388; the cancelled in-flight cloud request retains USD 0.301480 unknown
exposure. All task containers were removed.

Independent blind review is now complete: two reviewers agreed on all four available
artifacts. Only one of the three completed runs is accepted. The extrema patch
introduced comparisons unsupported by valid strict-comparison-only custom keys;
the Retry-After patch could raise an uncaught exception on a long valid numeric
header. Both passed the visible and independent tests, illustrating their limited
coverage. The cancelled fourth patch was source-review acceptable but remains an
unsuccessful run because its request and evaluation are unresolved. The complete
denominator is **one accepted out of six assigned**, with three completed, one
cancelled and two unrun. This is not a six-task completed success-rate estimate.

The final join retains `incomplete_evidence`; the separate cost-futility proof is
conclusive. This policy cannot advance. Its cloud review phase repeated inspection,
tests and repairs over multiple requests; one phase was not one paid call. No fresh
confirmation has run. The next proposed diagnostic is one compact cloud critique
per original cloud-plan/local candidate, with at most one bounded local repair
attempt. It must include all six development candidates, retain all fees and failed
attempts, and pass independent review before a fresh paired confirmation is justified.
Frozen runtime and evidence bytes are archived so further changes cannot replace
the failed experiment.

The compact-critique diagnostic has now completed its first stage: six requests,
six valid responses, USD 0.491912 in API fees and no new unknown exposure. It marked
the two previously rejected original P candidates for repair and accepted the other
four. That binary agreement does not prove it found every defect: the Retry-After
critique explicitly identifies fractional-delay truncation, while the cache critique
raises other issues and does not explicitly identify the prior keyword-forwarding
defect. No repaired patch has been produced or independently accepted in this stage.

Original P generation plus these critiques costs USD 0.964592. If all six final
candidates become acceptable without further paid calls, that would be 31.98 percent
below the historical cloud control. This is conditional accounting on exposed
artifacts, not demonstrated full-session savings or latency. The next gate is one
native local repair attempt per flagged candidate, at most eight requests including
two finishing calls, using only the public task and critic guidance. Final candidates
still require independent checks and blind review before fresh confirmation. See the
[compact-critique plan](plans/MVP_ROUTING_CRITIC_V1.md).

Amounts above are API fees. The original stage fees including calibration were
$2.691900; the original fresh comparison accounts for $2.595392. Including the
failed review development batch and completed critiques, known stage fees are
$4.472200, with $0.301480 unknown
reserved exposure and the original zero-reservation unknown. The owned $3,500 device, electricity,
utilization and depreciation are excluded. Device payback remains unproven.

See the [routing plan](plans/MVP_ROUTING_V1.md), [research](ROUTING_POLICY_RESEARCH.md),
[earlier negative hybrid result](MVP_HYBRID_SCREEN_REPORT.md), and
[build log](BUILD_LOG.md).
