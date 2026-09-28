# Compact critique and bounded local repair: failed development gate

The exposed six-candidate policy finishes with **four accepted candidates out of
six assigned**. It does not advance to fresh confirmation. Both repair attempts
are retained, including the unsubmitted cache artifact. No new cloud calls occurred
during repair, independent checks or the follow-up counterexample probes.

| Task | Final disposition | Independent checks | Final source review |
| --- | --- | --- | --- |
| Cache discard API | Repair failed, unsubmitted | Not scorable | Rejected |
| Last extremum | Original patch retained | Passed | Accepted |
| Retry-After | Repaired and submitted | Passed | Rejected after adjudication |
| Ordered build rules | Original patch retained | Passed | Accepted |
| Option default | Original patch retained | Passed | Accepted |
| Log redaction | Original patch retained | Passed | Accepted |

The two repair episodes made thirteen settled local requests: seven for cache and
six for Retry-After. Both confirmed container cleanup and neither introduced unknown
exposure. Retry's full patch was reconstructed against its original baseline and
matched the source bound to its successful runtime checks. Cache's recovered source
was reconstructed for diagnosis and review only; it cannot count as a submitted run.

Two independent reviewers received fresh neutral packages containing public tasks,
exact patches and complete baseline/candidate sources. They agreed on five of six
verdicts. A separate adjudication rejected Retry-After after resolving its invalid-date
disagreement. All patch/source mappings and review hashes are preserved privately.

## What failed

Cache stopped when response seven requested an action forbidden by the current
checkpoint. Its request still advertised all four tools. The router narrowed the
permitted actions, but the model received this restriction only as text. The stored
evidence cannot identify which forbidden action was selected. Its recovered patch
also retains keyword collisions and metadata-shadowing defects.

Retry-After fixed fractional delay and long decimal input handling, and passed the
independent tests. It still raises an uncaught OverflowError on an invalid large-year
date and treats an explicit unknown timezone as an omitted timezone. The public task
requires invalid strings to return None. The date-arithmetic range restriction does
not exempt a malformed string that fails during parsing, before subtraction.

Network-disabled Docker probes reproduced the source-review counterexamples. These
diagnostics were performed after model output was fixed. Their findings were not
inserted into repair prompts or used to request another attempt.

## Correction to the cloud comparison

The same programs were run against the exact original cloud-control outputs for
these two tasks. Cloud handled the oversized year and cache keyword names correctly,
but shared the unknown-timezone and metadata-shadowing defects. Therefore the earlier
**six-of-six cloud acceptance assessment was too optimistic**. The historical
reports remain intact; they are not current ground truth after this audit.

Two previously accepted cloud controls now have concrete contract failures. This was
a targeted identical-counterexample audit, not a new full-control review cohort or
a rerun of the interrupted 48-assignment comparison. Shared defects and additional
candidate defects must be reported separately. Equal coarse task counts cannot
establish preserved behavior when the candidate has extra failures cloud avoids.

## Accounting and decision

Original generation cost USD 0.472680; six compact critiques cost USD 0.491912;
bounded local repairs added zero API fees. The policy total is **USD 0.964592**.
Its previously stated 31.98 percent potential saving was conditional on acceptance;
it is not evidence that this failed policy preserves quality. Full-session latency
was not measured because generation and critique were reused across development.

Known stage fees remain USD 4.472200, plus the prior USD 0.301480 unknown reservation
and the original zero-fee unknown request. The owned USD 3,500 device, power and
utilization remain outside API accounting. No device payback claim is established.

The predeclared six-of-six gate failed. The original request-tool mismatch is now
fixed under a separate offline plan: advertise exactly the router's permitted
tools and independently enforce that subset in main admission. Focused verification
passes 100 Python tests including 27 Docker cases, 213 TypeScript unit assertions,
and seven main/runtime integration cases across focused runs. Independent review
found no runtime blocker. A broader unit invocation retained a UI worker startup
error, so this is not a clean full-suite claim. The change addresses one
avoidable execution failure. It cannot establish semantic correctness or rescue the
closed result. Any subsequent live study needs a separately frozen policy and must
retain all prior failures, costs and the corrected control evidence.

References: [repair plan](plans/MVP_ROUTING_CRITIC_REPAIR_V1.md),
[tool-filtering plan](plans/MVP_ROUTING_TOOL_MASK_V1.md),
[historical routing screen](MVP_ROUTING_SCREEN_REPORT.md), [build log](BUILD_LOG.md).
