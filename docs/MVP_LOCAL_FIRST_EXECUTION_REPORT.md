# Local-first execution result

Date: 2026-09-10. The single local-first episode **failed independent acceptance**.
It submitted in **44.184 seconds** using **seven local calls and zero API fees**,
but the patch changes some exclusions into inclusions. A fresh blind source reviewer
found the defect, and a separate isolated Docker diagnostic reproduced it. Zero
accepted patches means the low fee cannot count as preserved-quality savings.

| Measure | Result |
| --- | --- |
| Assigned / attempted / accepted | 1 / 1 / 0 |
| Local / planner / cloud requests | 7 / 0 / 0 |
| Settled / new unknown requests | 7 / 0 |
| Cloud recoveries | 0 |
| Final visible checks | 2 passed |
| Original frozen independent checks | 5 passed |
| Blind source review | One material parser defect |
| Separate post-generation diagnostic | Both semantic cases failed |
| Submitted files | 3 implementation files, all within scope |
| Accounted API fee / new reserved exposure | USD 0 / USD 0 |
| Runtime | 44.184 seconds |
| Runtime, evaluator and diagnostic cleanup | Confirmed |

The production local_first policy started from the original public source and
objective. It received no earlier plan, candidate or critique. Production code,
providers, model settings, image, visible command and independent evaluator matched
the preceding planned-local episode. Removing the planner also removed its
generated-test feedback; this tests the whole policy, not either component alone.
No production code changed during the experiment and this allowance is closed.

## Why acceptance failed

The public requirement makes a leading `!` an exclusion. Only a backslash at the
start of the trimmed rule can escape a leading marker into a positive pattern.
The candidate removes `!`, then applies the escape rule to the remaining pattern
and sets the inclusion flag back to true. For example:

```python
parse_rules([r"!\#secret"])
# Required: [(False, r"\#secret")]
# Candidate: [(True, "#secret")]
```

With `*` followed by that exclusion, a literal backslash path that should be
excluded remains selected. The same defect occurs with `!` after the backslash.
The root recorded its source finding before receiving the neutral review; the
fresh reviewer independently found the same defect. The isolated Docker diagnostic
confirmed both cases against the exact submitted candidate with no model call or
database mutation. Its process exited zero because it reported the observations;
both semantic outcomes were false. Cleanup and unchanged package hashes were
verified.

The original two visible tests and five frozen independent tests all passed. Their
results remain intact; the latter are insufficient to cover this interaction. The
additional diagnostic was created after generation from the public requirement
and is explicitly separate from the original acceptance suite. No gold or new
diagnostic was supplied to the solver. No candidate repair or retry occurred.

This also exposes the routing limit: current recovery responds to observed tool,
check and progress signals. With passing checks and a valid submission, this run
had no detected reason to escalate, despite a semantic defect. Local completion
and a functioning recovery mechanism do not establish a reliable quality signal.

## Cost, time and scope

The local endpoint reported 20,487 input and 1,578 output tokens, including 3,200
cache-read tokens. Its API fee is zero under the owned-device convention; this
does not measure electricity, utilization or the owner's USD 3,500 device cost.
Request round trips consumed 36.114 seconds; 8.070 seconds were outside those
intervals. Three local calls followed the first passing host checkpoint without
further source changes. No new tests were added, but the public task did not
explicitly require a new test file and the visible command executed two real tests.

| Historical development observation | API fee | Runtime | Acceptance |
| --- | ---: | ---: | --- |
| Earlier prepared cloud | USD 0.144580 | 73.812 s | Accepted in its recorded review |
| Preceding cloud-plan/local | USD 0.077284 | 159.149 s | Accepted in its recorded review |
| This local-first episode | USD 0 | 44.184 s | Rejected |

These sequential exposed examples are not a fresh paired comparison. The
local-first result is faster and cheaper but loses quality. It cannot establish
that planning is generally necessary, that a broader local-first policy is
ineffective, or that a learned selector would solve the problem. Preserve the
existing quality, cost-per-accepted-task and latency gates before scaling.

## Verification and next decision

Preparation passed nine driver tests, five launcher tests, thirteen evaluator
synthetic checks, two actual production HTTP/Python/Docker integration cases and
scoped strict typechecks. The integration covered local completion and one normal
cloud recovery. Two earlier fixture failures remain recorded: an incompatible
copied planner setting and an order-sensitive JSON assertion. Only private fixture
code was corrected. Independent review cleared the driver, session and evaluator.
No full-suite or release gate ran.

Final audit verifies exact replay, settled accounting, final check freshness, all
70 frozen file bindings, 73 archive files plus approval, and preservation of the
57 prior runs and 561 requests. Current totals are 58 runs and 568 requests. Stage
maximum exposure remains USD 15.825576, including prior unknown exposure and block
hold; it is not an invoice or all-time project cost. The four untouched tasks
remain reserved. All previous failed and unfinished studies remain unchanged.
An independent evidence join confirmed that the runtime, evaluator, blind review,
diagnostic and rejection receipt all bind the same submitted patch. Original
runtime and evaluator receipts retain their semantic-acceptance placeholder; the
separate final judgment is false.

Patch SHA-256: 5db8a25e637f5f241f33960bb246a44975918e3e15315a00321c187df1a7ab44.
Rejection receipt SHA-256: 6700504d46b86dd5671c187fadb2ff7e55f16e43b3942e1e5c405633ed3fdcc9.
Independent evidence join SHA-256: a05a72f047a0755c884b93a273344a8b9e2ac91fedeb545d19978b0650085315.

The next useful step is to qualify a separately versioned set of public-requirement
interaction checks against the existing candidates and controls, preserving this
failure. Use that evidence to design a bounded local repair or selective review
experiment. Do not promote test passage to a quality guarantee, add paid planning
to every task based on this one example, or run a large comparison before the
feedback policy can detect and respond to this class of defect. Any changed
feedback becomes development input and requires fresh confirmation elsewhere.

References: [frozen local-first plan](plans/MVP_LOCAL_FIRST_EXECUTION_V1.md),
[preceding planned-local result](MVP_PLANNER_LOCAL_EXECUTION_REPORT.md),
[planner calibration](MVP_PLANNER_CONTRACT_CALIBRATION_REPORT.md),
[build log](BUILD_LOG.md).
