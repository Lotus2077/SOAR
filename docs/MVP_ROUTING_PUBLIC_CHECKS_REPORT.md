# Public executable checks: offline implementation result

Date: 2026-09-10. The experimental cloud-plan/local workflow now supports
host-owned checkpoints and a bounded planner-generated unittest suite. Runtime
mechanics are verified in the scoped tests below. No real model has run this
profile, and no quality, savings, owner-acceptance or release result exists.

## Implemented behavior

The internal plan_and_checks setting requires a live-compatible provider transport,
a planning policy and host_repair_window. It reuses the existing single cloud
planning request and its admission and usage ledger. The scripted demo and policy
defaults do not activate it. The existing 24-local/40-total-call and 600-second
limits remain; each check suite retains its own 60-second command timeout, and
transport/handoff reserves account for both suites.

The planner returns a bounded implementation plan and one Python unittest artifact
derived from public task/source inputs. The host parses syntax and counts without
executing generated Python. It binds the artifact source hash, explicit test IDs
and nonzero expected count to the settled planner request. Local execution sees the
fixed source and receives actual check feedback.

The host checkpoint runs after the fourth settled local action in this profile
when no fresh passing check or earlier failure exists. It consumes no model call.
Explicit later checks follow the same execution path. Visible checks and generated
checks run in separate, credential-free, network-disabled Docker verifiers against
the same candidate source. Generated filesystem mutations are measured and never
retained as candidate edits. Their artifact and receipts are separate from the
trusted visible-check receipt, including in the app display and replayed snapshot.

Both suites must pass on unchanged source before local submission. Later source
changes invalidate that eligibility. A malformed, empty, skipped, incomplete,
truncated or timed-out generated result cannot become passing evidence. The final
exported patch is checked again, including after a cloud fallback/review. A final
generated failure keeps the run failed even if its visible checks pass.

These checks are fallible model output. Valid syntax and execution do not establish
meaningful assertions, complete coverage, absence of defects or independent
acceptance. The Python wrapper is not a sandbox for hostile code; Docker remains
the isolation boundary.

## Verification

The first actual controller/HTTP/Python/Docker run passed fifteen of sixteen cases.
The final-cloud-regression case exposed a stale local passing-check claim on a
terminal stop. The fix clears planner-bound submission eligibility on stop while
preserving the final receipt's independently bound source. Its focused regressions
and all four affected integration cases then passed. The original failing result
is retained, not overwritten.

| New full-path fixture | Verified outcome |
| --- | --- |
| Visible tests pass, generated test fails, local repairs | Host feedback arrives without a model call; fresh checks and final submission pass |
| Generated failure followed by explicit help | One patch-preserving cloud fallback; planner, local and cloud usage reconcile |
| Generated process exits zero without wrapper result | Result remains invalid; no local submission or cloud continuation |
| Cloud review introduces a defect missed by visible tests | Final generated check fails; exact terminal failure is retained |

The fixtures verify original-workspace cleanliness, replay equality, source and
artifact identities, per-phase request/token/fee totals and empty container lists
after cleanup. Providers are deterministic loopback fixtures, not live models;
their synthetic fee receipts establish accounting mechanics only.

Other verification: 312 TypeScript assertions across seventeen scoped suites pass.
The Python invocation passed 152 methods including 27 Docker cases. After the
terminal-stop correction, all 53 router methods passed, including three added
regressions. The twelve other runtime integration cases passed in the first run.
Both application typechecks pass. These are scoped invocations across the changes,
not a clean full-repository or release gate.

The UI test invocation timed out starting its test worker and executed zero
assertions. Its earlier limitations remain; the new display has passed typechecking
but its component assertion is not yet verified. Source review found and resolved
transport reserve, timeout evidence, interruption eligibility and final-receipt
freshness defects. No further material blocker was found in the scoped review.

## Next decision

Use a separately versioned, frozen development comparison through the shared
controller and evaluation machinery. Compare the prepared-cloud control against
cloud-plan/local with these checks on the complete exposed task mix. Include all
planner, local, check and fallback costs and elapsed time. Independently assess
generated-test validity and patch quality; never use hidden evaluation as runtime
feedback. Keep the four untouched confirmation tasks reserved until development
quality and economics clear. Earlier failed studies remain failed.

References: [implementation plan](plans/MVP_ROUTING_PUBLIC_CHECKS_V1.md),
[readiness](MVP_READINESS.md), [last real-model result](MVP_ROUTING_EARLY_CHECK_REPORT.md),
[build log](BUILD_LOG.md).
