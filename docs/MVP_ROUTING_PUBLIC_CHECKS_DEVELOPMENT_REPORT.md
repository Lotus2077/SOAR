# Paired public-checks development comparison

Date: 2026-09-10. **Failed; all twelve approved episodes are closed.** The
cloud-plan/local policy produced no patches. Prepared cloud produced four
acceptable patches from the same six public development tasks. Quality-preserving
savings are not established, and the untouched confirmation gate remains closed.

## Live result

| Measure | Prepared cloud (C) | Cloud plan/checks then local (P) |
| --- | ---: | ---: |
| Assigned and terminal episodes | 6 | 6 |
| Submitted patches | 6 | 0 |
| Passed independent checks | 4 | 0 |
| Acceptable patches after source review and checks | 4 | 0 |
| Settled cloud requests | 39 | 6 |
| Local requests | 0 | 0 |
| Accounted API cost | USD 1.509352 | USD 0.517848 |
| Median terminal duration, including failures | 80.0595 seconds | 52.7945 seconds |

Total accounted cost is **USD 2.027200**, below the approved USD 36 ceiling.
All 45 requests settled, with zero new unknown requests or remaining reservations;
all twelve cleanup receipts are confirmed. The same owned process ran each
assignment once and closed six balanced blocks at 2026-09-10T04:55:38.234Z.
Fees use actual recorded token usage and frozen USD 4 input / USD 20 output per
million-token rates. They are usage-ledger estimates, not invoice reconciliation.

Every P attempt failed with `Worker stopped: PlannerChecksError`, before an
admitted plan, generated-check artifact or execution, local call, recovery or
patch. Its cost per accepted patch is undefined. Its lower raw fee and shorter
failure duration cannot count as savings or useful speedup. This study did not
exercise the local model's coding capability.

## Independent review and diagnosis

Two reviewers independently examined neutral public source/patch packages without
routing, cost or test outcomes. Both initially accepted five patches and rejected
Retry-After. Their separate source findings identified malformed date acceptance
and failure on a valid very long decimal delay. The cache patch also failed the
frozen independent checks. Both reviewers subsequently rejected it in separately
recorded, root-guided adjudications: copied function metadata can overwrite the
new `cache_discard` operation. This follow-up was guided, not blind; all original
responses remain unchanged. The suggested keyword-`self` issue was not established
as a new compatibility regression. The other four patches passed both independent
checks and source review. Source review is not exhaustive correctness proof.

All twelve assignment rows and six pair rows are retained. P has no artifact,
so its source reviews remain incomplete and paired regression judgments remain
unknown. The unavailable evidence cannot be treated as a clean comparison.

The planner's outer envelope passed the response checks; rejection occurred inside
the JSON/unittest contract parser. The worker discarded the parser's detailed
fixed code and retained only its exception class. Raw responses were not saved,
so the particular failed field or AST rule cannot be recovered. The evidence does
not establish that the parser rejection was justified, an infrastructure cause,
or a local-model failure. The report's conservative `runtimeInfrastructureFailure`
flag is an eligibility guard, not causal diagnosis.

## Evidence closure and history

The explicitly approved replacement freeze is
41344542c9b816f5cdd63da1ee4c0cab347b662c1876b521b35c811594dc5781.
Approval is recorded in BL-20260910-0310-paired-owner-approval. The earlier
pre-process approval rejection remains preserved and produced no model call.
Replacement preparation passed 128 scoped tests, the Node typecheck and independent
source review; private launch and packaging helpers passed 23 and 15 synthetic
tests respectively. These results establish mechanics, not live model quality.

Final source/configuration/history admission passed under receipt SHA-256
2763d111b7a1beef1571ac848e4b2edc3c749f1dec88e0c2ebe31ada6aadac3f.
The original automatic report is retained under SHA-256
47896d109eb58b6bade54654f7844497a6c8bbd77e7f8c56c1a7967ef04d30a0.
An independent accounting audit replayed all twelve snapshots, recomputed all
45 fees, verified frozen source bindings and found all historical rows unchanged.
Its receipt SHA-256 is
ed15bbfa05fc94e564c0429a1c6f115e9a4a329fb9847ae92c40f65e0032ac7d.
The trusted review join then closed successfully: final report SHA-256 is
0baf4faa88cf67086613e998a813f513e5c3a194016b22731ec9ca0c6cf0a3ab;
join closure SHA-256 is
419edf52148ec0632d4e5be1acc2332de23783d6a2de931b5d1023428bd9f3a7.
It preserves six incomplete P source reviews and six unknown paired judgments.
C cost per acceptable patch is USD 0.377338; P and savings remain undefined.
Thirty-eight source/test/launch files were archived before follow-up code changes.

The stage maximum exposure is now USD 15.618024, including the historical unknown
exposure and old block hold. Earlier failures, fees and reservations remain intact;
this is not an all-time project spending figure.

## Follow-up diagnostic verification

After live/report closure and source archival, the initial planner parse now maps
seven exact rejection codes into fixed terminal diagnostics. Unknown or non-string
codes map to a fixed unknown value and stop. The comparison classifier recognizes
only the seven exact new strings with one settled planner request and no admitted
plan, while preserving historical class-only errors. The parser, prompt, budgets,
acceptance rules and later exception handling are unchanged. No raw model response
is added to persisted records and no old error is rewritten.

Independent code review found no blocker. Focused verification passed 79 TypeScript
routing/report tests, 37 host-only Python methods and one actual main/HTTP/Python/
Docker scenario, plus the Node application typecheck. Fourteen existing Python
Docker methods and four existing integration scenarios were not rerun. The new
integration proves settlement before failure, exact diagnostic persistence, no
local call/plan/patch/check, cleanup, replay and raw-response sentinel absence.
Its USD 0.0001 synthetic ledger amount is fixture data, not a real API charge.

The initial Python later-artifact fixture used an incompatible check schedule and
failed before its intended assertion. That failure is preserved; correcting the
fixture to the required host-repair schedule made the targeted invocation pass.
Runtime code was not changed to accommodate that fixture. Verification receipt
SHA-256 is bb95fa3aeeeb4a31592c3149429974e0a209292aa79d2468a3330e347bba65a9.
This is an observability fix, not planner acceptance or routing-quality evidence.

## Next gate

Propose a small, separately bounded real planner-contract calibration to learn the
actual rejection category before another paired run. The completed twelve-episode
approval authorizes no additional model requests. No failed assignment is retried.

The four untouched tasks remain reserved. UI worker startup remains unresolved;
there is no current full-repository or release gate. Device payback, operating
costs, generalization and owner acceptance remain unmeasured.

## Retained initial preparation record

The following describes the first, undispatched freeze. It was retired after
review found a missing stop on worker infrastructure failure, then superseded by
the corrected replacement above. Its old test counts and hashes do not identify
the executed replacement.

## What is ready

Version 2 compares prepared cloud with cloud-plan/local using host checkpoints and
planner-generated public checks. Each arm has its own controller configuration;
the prepared-cloud comparator retains its original behavior. Version 1 retains
its twelve-task/four-arm contracts and serialized configuration behavior.

The report retains all six assignments per arm, all fees and unresolved exposure,
and all terminal latency observations. Independent acceptance requires exact
patch review and separate paired regression judgments. Failed runtime submissions
can receive diagnostic evaluation but cannot become accepted completions.

Historical admission uses the existing stage database. Its receipt binds every
prior run, request, event, comparison row and reservation across eleven tables.
The 42 prior runs retain USD 4.472200 in settled fees and USD 0.301480 in unknown
exposure. Including the old open block hold, prior campaign exposure is
USD 13.590824; these figures are not all-time project spending. No old outcomes,
cleanup fields or reservations were rewritten. The accounting-only critic
exception requires its exact recorded event sequence and a fresh empty-container
observation. New unrelated or unknown work still stops admission.

Final source/configuration/history revalidation occurs after controller closure.
A later report cannot clear advancement when the saved final closure is missing,
failed or inconsistent with its bound ledger. A freeze-only report correctly
remains incomplete.

## Verification and retained failures

Root's combined invocation passed all 118 assertions across five runner, legacy
comparison, reporting, CLI and historical-admission suites. The Node application
typecheck passed. Independent reviews found no remaining material blocker in the
scoped implementation. The test providers are synthetic; these results establish
mechanics, not model quality or actual savings.

All six original public task inputs remain unchanged. Independently executed
reference patches pass 42 methods, while unchanged baselines fail and retain six
passing compatibility methods. The pinned sources, file scope, evaluation
artifacts and receipt identities also passed shared schema/source validation.

Preparation found and retained three negatives: the first wrapper aborted its
baseline class setup before all methods ran; a Retry-After reference failed on a
valid long decimal; and independent review found that copied function metadata
could overwrite the cache reference's new callable API. Separately versioned
wrapper/reference corrections passed their affected Docker suites and visible
checks. Older passing results remain evidence of their narrower checks. Corrected
references and added probes never enter model inputs.

The final freeze binds 24 runtime/evaluation files. Its SHA-256 is
cec085a3cef4a73ac4da53ac8b43f1f39b6ef0350466f42c4c7d83e7ae4b4976.
The offline verification receipt SHA-256 is
9e45832540331991427d277891759e22c3d6fdf7e0b954a2ea9d1ffe8ec7e05d.
Post-freeze inspection confirmed twelve assignments, zero claimed or linked runs,
and unchanged historical rows/exposure.


References: [development plan](plans/MVP_ROUTING_PUBLIC_CHECKS_DEVELOPMENT_V2.md),
[runtime verification](MVP_ROUTING_PUBLIC_CHECKS_REPORT.md), [build log](BUILD_LOG.md).
