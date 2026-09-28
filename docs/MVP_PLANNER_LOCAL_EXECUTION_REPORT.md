# Cloud-plan/local execution result

Date: 2026-09-10. The current production cloud-plan/local route produced **one
independently accepted patch on one exposed development task**, with no cloud
recovery. It passed the runtime's public and generated checks, all five frozen
independent tests, and a neutral source review. Accounted API cost was
**USD 0.077284**; total runtime was **159.149 seconds**.

This establishes an end-to-end completion for the clarified planner interface.
It does not establish preserved-quality savings across tasks. The earlier failed
comparisons and both closed planner calibrations remain unchanged.

| Measure | Result |
| --- | --- |
| Assigned / attempted / accepted | 1 / 1 / 1 |
| Planner / local / cloud-solver requests | 1 / 9 / 0 |
| Settled / new unknown requests | 10 / 0 |
| Cloud recoveries | 0 |
| Final generated tests | 9 passed |
| Frozen independent tests | 5 passed; no failures, errors or skips |
| Independent source review | No material defect found |
| Submitted files | 4, all within allowed scope |
| Accounted API fee | USD 0.077284 |
| New reserved exposure | USD 0 |
| Runtime | 159.149 seconds |
| Runtime and evaluator cleanup | Confirmed |

The run used a fresh cloud plan and the normal production worker. It did not
inject the previously admitted plan. Public task/source preparation and model
settings remained frozen; the planner, local agent and normal recovery path kept
their existing limits. Local actions changed the source and produced the submitted
patch, with no cloud solver request. That is accepted local contribution in this
episode, not proof that the planner was necessary or that every action was useful.

The independent evaluator and its original qualified controls were bound before
generation. Its five tests executed only after the final candidate was fixed.
A fresh reviewer received a neutral package containing the public objective,
original source and candidate, without route, cost or runtime verdict. Both results
join to the exact submitted patch; generated checks never became the acceptance
standard. The four untouched confirmation tasks remain reserved.

## Cost and latency

The cloud planner used 1,341 input and 3,596 output tokens. Its 2,339 reasoning
tokens are included in output, not charged again. The frozen USD 4/20 per million
token rates account USD 0.077284. The local endpoint reported 45,921 input and
2,816 output tokens across nine requests, including 17,600 cache-read tokens;
its API fee is zero under the existing owned-device accounting. This does not
measure electricity, utilization, depreciation or the USD 3,500 device's payback.

The earlier cloud run on this same public task cost USD 0.144580 and took 73.812
seconds. The new run's charge was 46.5 percent lower, but its duration was 115.6
percent higher. **These are historical observations, not a fresh paired savings
estimate.** Neither the complete development comparison nor its latency gate has
passed. Lower API cost on one accepted task does not resolve the routing goal.

Host request timestamps break the current duration into 74.684 seconds for the
planner round trip, 72.182 seconds across local round trips, and 12.283 seconds
outside those intervals. These timings include network/server effects and do not
isolate inference speed. The planner alone took about as long as the entire older
cloud episode.

The first host checkpoint passed after local call four. The source digest stayed
unchanged through five further local requests and submission. Three subsequent
tool commands combined unittest runs with status/listing operations; all exited
zero. The later five request round trips totaled 15.446 seconds. This identifies
repeated checking to examine, but removing it alone would not close the observed
latency gap. The native instruction that only run_visible_checks establishes
success also needs alignment with the host's automatic check schedule; the trace
does not prove that wording caused the additional actions.

## Verification and boundaries

Preparation passed eight driver tests, five launcher tests, two existing full
production integration cases and the private driver typecheck. Three other
integration cases were excluded. The evaluator runner passed twelve synthetic
guards and strict typechecking before its single Docker evaluation. No full-suite
or release gate was run.

Independent runtime audit verified exact replay, all 64 frozen file bindings,
67 archived files plus approval, request accounting, final patch/check freshness,
and preservation of all 56 prior runs and 551 requests plus seven comparison
tables. The ledger now contains 57 runs and 561 requests. Stage maximum exposure
is USD 15.825576, including historical unknown exposure and the old block hold;
it is not all-time project spending or a provider invoice.

Preparation failures remain recorded: a copied expected request count was wrong;
a cleanup probe correctly stopped while integration fixtures owned containers;
and an initial timing query assumed timestamps were in request rows rather than
events. All were corrected without model retries or historical database changes.
The evaluation runner was finalized after the runtime freeze and separately
reviewed by exact source hash; it executed the evaluator and arguments already
frozen before generation. The runtime freeze was never rewritten.

Patch SHA-256: 6e9238abb52beb7767be6a8915c26e7bc37d3fa1044c958e64e0accedb619129.
Runtime audit SHA-256: 8d9a4a483252b95241d24615a0f3e647eb74c5cee937827e58e90c882e208228.
Independent evaluation receipt SHA-256: 54d52c330f7db6859c1435b8d14541076c5b0a7a07af2fc23dd88107df4b0585.
Acceptance join SHA-256: 149e13dfa827ee259d1c2f15c78ac207447eb2de33d85d1c6373b862c713b2a6.
Independent acceptance-evidence audit SHA-256: b5c6bda91abfc63ddc4fc3b3d9e481fef5096b84fb79600950b3f378fbbf3f55.

## Next decision

Test whether a small task needs the up-front cloud planner at all, using the
existing local_first policy, fresh generation and the same independent evaluator.
Keep this a separately bounded policy experiment, with cloud recovery counted if
used. Also clarify that a fresh automatic host check satisfies the check requirement,
without removing source review or relaxing submission guards. Do not assume either
change improves quality or latency until measured.

The following economics gate still needs a fresh, complete comparison with every
failed request and task included. Preserve the quality and latency requirements;
an accepted single example is sufficient to continue development, not to claim
that the routing MVP already saves money at preserved quality.

References: [frozen execution plan](plans/MVP_PLANNER_LOCAL_EXECUTION_V1.md),
[planner calibration results](MVP_PLANNER_CONTRACT_CALIBRATION_REPORT.md),
[previous failed comparison](MVP_ROUTING_PUBLIC_CHECKS_DEVELOPMENT_REPORT.md),
[build log](BUILD_LOG.md).
