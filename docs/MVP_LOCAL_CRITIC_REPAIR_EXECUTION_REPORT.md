# One complete local draft and cloud critique episode

Date: 2026-09-11. **Verified: one independently accepted patch on one exposed
development task.** The production `local_critic_repair` route generated a fresh
ordered-build-rules patch, obtained one acceptable cloud critique and submitted
without repair. Both independent suites and neutral source review accepted the
exact final artifact. This closes the single-episode experiment; it does not
establish general routing quality or preserved-quality savings.

| Measure | Result |
| --- | ---: |
| Assigned / completed / independently accepted | 1 / 1 / 1 |
| Local draft requests | 7 |
| Cloud critique requests | 1 |
| Local repair requests | 0 |
| Accounted API fee | USD 0.039000 |
| Remaining reservation / unknown requests | USD 0 / 0 |
| Complete runtime episode | 55.552 seconds |
| Current final visible checks | 2 / 2 |
| Original independent checks | 5 / 5 |
| Qualified interaction checks | 12 / 12 |

The local requests produced the accepted source changes. The cloud reviewed the
actual draft and returned `acceptable`; no planner, scout, full cloud solver or
recovery ran. Because repair was not requested, this is not evidence that a real
model can successfully repair a criticized draft. The earlier synthetic repair
case remains mechanics evidence only.

The local requests recorded 21,990 input and 1,712 output tokens, including 4,800
cached input tokens, at the frozen zero local API rates. The critique recorded
7,185 input and 513 output tokens; its 427 reasoning tokens are already included
in output. Applying the frozen USD 4/20 per million input/output rates gives
USD 0.039000. This is usage-ledger accounting, not provider-invoice reconciliation.
It excludes the owned device's approximately USD 3,500 purchase, electricity and
other operating costs.

The original five-test suite passed in 997 ms and the qualified twelve-method
interaction suite passed in 706 ms. Both ran once in isolated Docker after the
runtime was terminal, with no failures, errors or skips and with verified harness,
scope, source identities and cleanup. These evaluation times are separate from
the 55.552-second runtime measurement. The neutral reviewer received only the
public requirement, before/after source and exact patch, without policy, costs,
critic verdict, evaluator results or old findings. It independently verified
the patch and both source identities, found no material semantic defect and
accepted the candidate. Static review is not exhaustive correctness proof.

The final patch identity is
9c722d620a970600a1df87c26f2acb3fa98b9b75b8c4b7ca5e2666538a29657c;
the checked final source identity is
392eb7ac535560dabdc8daf2f497b1a1f3f851444e5ed310bc08057a21ce1df6.
Root acceptance receipt
8ab4a46d9419eb635176a7ea03125c18b46b38693b9c703f16333ec604a66267
joins runtime audit
a40d49b72aa2bfade0bb3efdd29835c0406f1e83bcf58bac7cb40b11a7df89ba,
independent checks
b2ec08b46fb5db17fdd0192572782c951813a1a95ed43f5ded5138afe65577f7
and neutral source review
2a871c5eb4add2683f3cced349a10dde70b82d4da640f5e0a96369a661e4fbf9.

The one-use launcher exited zero, automatic retry was disabled, and accounting
and cleanup are closed. All 116 frozen files and ten approval-evidence bindings
were independently verified. An archive preserves those files, three additional
authority files and the exact approval entry; all original and archived hashes
match. The 60 prior runs and 570 requests are unchanged. The stage ledger now
contains 61 runs and 578 requests, with maximum exposure USD 15.938360 including
historical unknowns. This is the experiment-stage total, not all project spending.

The first read-only audit inventory query referenced a nonexistent column and
failed; the corrected inventory used request identities and event chronology.
It made no database write, model call or retry. No runtime or evaluation failure
occurred in this new episode. Earlier rejected local-first source, planner
contract failures, unsuccessful routing comparisons and unresolved historical
charges remain recorded with their original meanings.

The next step is the [fresh six-task paired comparison](plans/MVP_LOCAL_CRITIC_REPAIR_COMPARISON_V1.md).
It is a proposed execution design, with preparation allowed and exact paid
authority still to be frozen. Reuse existing machinery and compare fresh cloud
and local-plus-critic runs on all six exposed tasks. Include failures, unknown
charges and unrun assignments; require no additional material regression, at
least as many accepted tasks, at least 20 percent lower API cost per accepted
task and no more than 25 percent higher median runtime latency. Historical cloud
measurements and this single episode are excluded from the matched totals.

Four untouched tasks remain reserved for confirmation after a passing development
result. The prior UI test initialization gap is still unresolved. No current
full-suite, packaged application, release, hardware-payback or owner-acceptance
gate has passed. The continuing routing goal remains active.

References: [approved episode plan](plans/MVP_LOCAL_CRITIC_REPAIR_EXECUTION_V1.md),
[runtime mechanics](MVP_LOCAL_CRITIC_REPAIR_IMPLEMENTATION_REPORT.md),
[qualified interaction coverage](MVP_ROUTING_INTERACTION_QUALIFICATION_REPORT.md),
[build log](BUILD_LOG.md).
