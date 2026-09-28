# Post-draft critic calibration result

Date: 2026-09-10. Status: **Verified — fixed-pair signal passed**.

A compact cloud critique identified the exact material parser defect in the
rejected local-first patch and accepted the valid planned-local control without
inventing a defect. Independent source review supports both decisions. This
qualifies the signal on these two existing artifacts; no patch was repaired or
new coding task accepted.

| Fixed artifact | Critic result | Independent finding | Accounted API fee | Request round trip |
| --- | --- | --- | ---: | ---: |
| Rejected local-first patch | Repair required | Correctly identifies exclusion/escape precedence defect | USD 0.038136 | 20.497 s |
| Accepted planned-local patch | Acceptable | No unsupported defect asserted | USD 0.035648 | 11.141 s |
| Total | Two valid responses | Fixed-pair criterion met | **USD 0.073784** | 31.638 s |

The first critique points to candidate parser lines 15–27: the parser removes an
exclusion marker, then incorrectly treats the remaining backslash as a leading
escape and resets the rule to inclusion. Its suggested ordering addresses the
cause. The valid control uses mutually exclusive classification and preserves
ordered matching, one-shot input handling and stable unique output. The stronger
public interaction suite independently gives the rejected artifact 8/12 passing
methods and the valid control 12/12. Reference and historical cloud controls also
pass 12/12. These results retain the previous acceptance decisions.

Both requests used complete public objective, original visible command, exact
patch and complete baseline/candidate source. They had separate contexts and
neutral identities. New interaction checks, known counterexamples, route labels,
prior judgments, costs, evaluator gold and reference patches were excluded.
The prompt and two prepared bodies were frozen before dispatch. There were no
tools, follow-up critiques, repairs or retries.

The existing cloud profile used medium reasoning and an 8,192-token output cap.
The defective-artifact critique reported 4,774 input and 952 output tokens,
including 693 reasoning tokens. The valid-control critique reported 7,017 input
and 379 output tokens, including 289 reasoning tokens. No cached tokens were
reported. Fees use the frozen USD 4/20 per million input/output rates; reasoning
is already included in output. The USD 0.518396 reservation ceiling was a maximum
admission envelope, not actual spending. All two requests settled with zero new
unknown or reserved exposure.

The batch took 32.411 seconds from dispatch claim to driver closure, including
31.638 seconds of sequential request time. This excludes credential entry and
initial model metadata preparation. Metadata was fresh before each request;
neither assignment expired or remained unrun. The owned launcher and both
transport processes exited successfully.

Preparation passed seven tests and a strict typecheck. The new bounded driver
passed eight tests and a strict typecheck; the launcher passed four orchestration
tests and one separate argument-binding test. Independent input/runtime review
preceded the exact approval and freeze. The final accounting audit joined request
bodies, usage, fees, events, replay, claims and terminal receipts. All 132 frozen
plan bindings and all 58 prior runs/568 prior requests were preserved. The stage
ledger now contains 60 runs/570 requests; the two new rows are explicitly
accounting-only carriers and make no patch, check or container-cleanup claim.
An archive audit verified 136 original and archived files plus the exact approval.
Stage maximum exposure is USD 15.899360, including retained historical unknowns.

This is one exposed task with two selected historical artifacts. It does not
estimate a critic's general error rate, prove repair quality, establish a fresh
paired routing advantage or prove device payback. In particular, the rejected
local-first patch remains rejected. Its critique cost is below the descriptive
USD 0.115664 complete-episode hurdle derived from the historical cloud baseline,
but repair and final acceptance have not happened; this is no savings claim.
The earlier six-candidate critique/repair experiment remains at four accepted
patches out of six and failed its advancement gate.

The next implementation should make one provisional local draft reviewable,
bind the critique to that exact source, and permit a bounded local repair only
from the actual feedback. Source changes invalidate the earlier verdict; final
source/check freshness and independent acceptance remain required. Then run a
fresh complete comparison, charging failures and escalation, before using the
four untouched tasks. The existing gates remain no additional material quality
regression, at least 20% lower API cost per accepted task, and at most 25% higher
median latency. No production policy changed during this calibration.

Accounting audit digest:
`ee48c2f5481811806de36623f2adb99a69096cf5eaa3bb95b2d755d080887c16`.
Closure digest:
`f1e5ac5d952c02d3a8d913d5e75677561f9aa1eb0948153bed8b6be53d9672bf`.
Independent semantic review digest:
`7fafb0bd6620cadc66d1987c3769254fae34ade121cd28674b52f95f0a9c031d`.

See the [approved calibration plan](plans/MVP_POST_DRAFT_CRITIC_CALIBRATION_V1.md),
[interaction qualification](MVP_ROUTING_INTERACTION_QUALIFICATION_REPORT.md),
[local-first rejection](MVP_LOCAL_FIRST_EXECUTION_REPORT.md), and
[previous critique/repair failure](MVP_ROUTING_REPAIR_REPORT.md).
