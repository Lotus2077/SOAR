# App-integrated routing calibration

2026-09-09 — Six exposed calibration episodes completed. Execution and accounting
are verified; fresh routing quality and savings remain unproven. Not Released.

The new native policies ran through the application's real controller, request
admission, worker, Docker execution, trusted checks and persistent artifacts.
The tasks reuse the previously exposed incremental UTF-8-lines and cachetools
peek specifications. This calibration tests the new execution path and known
finishing problems. It is not a held-out comparison or a model accuracy estimate.

| Task | Policy | Local / planner / recovery requests | Visible check | Independent acceptance | Solver time | Accounted API fee |
| --- | --- | ---: | --- | --- | ---: | ---: |
| UTF-8 lines | Local only | 24 / 0 / 0 | Pass | Fail, 3/4 methods | 177.614 s | $0 |
| UTF-8 lines | Local first | 23 / 0 / 0 | Not run | Unsubmitted; not scored | 221.723 s | $0 |
| UTF-8 lines | Cloud plan + Local | 4 / 1 / 0 | Pass | Pass, 4/4 methods | 39.992 s | $0.016512 |
| Cache peek | Local only | 17 / 0 / 0 | Pass | Pass, 5/5 methods | 144.354 s | $0 |
| Cache peek | Local first | 15 / 0 / 0 | Pass | Pass, 5/5 methods | 120.993 s | $0 |
| Cache peek | Cloud plan + Local | 12 / 1 / 0 | Pass | Pass, 5/5 methods | 169.676 s | $0.079996 |

All 97 requests settled: 95 local and two cloud planning requests. Total accounted
API cost is $0.096508, with zero unknown exposure. The owner attests no local token
fee; the approximately $3500 device, electricity and utilization remain separate.
No cloud recovery phase occurred. All six task containers were cleaned up, all
original sources remained unchanged, and the runtime still matches all 21 frozen
file hashes. Root independently validated each terminal result, run, claim,
patch, scope and evaluator identity against the live ledger. No run or evaluator
was repeated by that audit.

## Failures retained

The local-only UTF-8 patch passes its visible check but buffers an invalid byte
instead of immediately raising the required UnicodeDecodeError. Independent
acceptance catches this; source review confirms a candidate logic defect. A
passing visible check did not establish correctness.

The local-first UTF-8 run makes a disallowed tool request at local call 23, when
only the trusted check or help action is permitted. Review confirms that its
preceding tool result contains the current remaining budget and allowed actions;
no stale-state or counter defect was found. The saved diagnostic does not identify
which rejected tool was requested. An earlier progress update described it too
specifically as another editing command; the durable evidence supports only the
disallowed-action finding. The runtime stops without paid fallback and preserves
the unfinished patch. The frozen tool schema still advertises all four tools;
that mismatch with the final-call allowance is a potential future interface
improvement, not a reason to relabel this failure or silently retry it.

The cloud-plan UTF-8 patch uses the standard library's strict incremental decoder
and passes full-contract source review. Bounded review of all three cache patches
finds no material defect: they preserve access ordering and expired-entry behavior
while adding the requested non-mutating peek operation. These reviews concern
exposed tasks and are distinct from the upcoming blinded fresh-candidate reviews.
No owner Keep decision has been inferred.

## Decision

Proceed with the unchanged, already frozen four-policy fresh comparison. This
calibration reveals model/policy limitations but no execution, evaluator or
accounting defect that blocks the comparison. Preserve every failure. Cloud-plan
local's two accepted tasks justify testing it; there is no contemporaneous
cloud-only arm here from which to claim savings or quality parity.

The next screen has twelve fresh tasks and 48 assignments, with prepared cloud as
the shared baseline. Apply independent acceptance and blinded full-patch review
before comparing cost per acceptable patch and latency. Advance only under the
[predeclared thresholds](plans/MVP_ROUTING_V1.md); twelve tasks can reject a policy
but cannot prove deployment-wide equivalence.

Configuration SHA-256:
`08412d03295ab8fe1dd93e8cee8638dbc400bb3421042f077269fbe62b75b86b`.
Calibration plan SHA-256:
`1da37a7dd40303e6ba7c3defcba704faf3a72bb7c6a4eab7e5ce10b041c2b952`.
Original [hybrid failure](MVP_HYBRID_SCREEN_REPORT.md) and
[isolated native calibration](NATIVE_LOCAL_CALIBRATION.md) remain unchanged.
