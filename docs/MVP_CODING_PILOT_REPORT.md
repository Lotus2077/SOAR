# Coding MVP pilot results

Later evidence: the [completed 36-episode C/D/H screen](MVP_HYBRID_SCREEN_REPORT.md)
supersedes the task-acceptance status below while preserving these nine earlier
development episodes and their costs. The screen establishes working cloud
patches, but no local contribution or hybrid saving. Its post-screen handoff
repair is a separately tested, uncalibrated policy.

Current status: **Recovery implemented and verified; a fresh Sol submission
passed checks but failed compatibility review. No fully accepted live submission
yet. Not Released.** The first iteration below is preserved; continuation results
follow it.

## First iteration

First-iteration status: **Implemented and exercised through the app; no fully accepted live
submission yet. Not Released.** Recorded 2026-09-08 Asia/Shanghai.

The MVP can select a committed public repository, run a cloud coding loop in an
isolated container, show the frozen patch and host-run visible checks, export
it, and retain a Keep/Reject decision. Direct OpenAI authentication and real
generation work. The app does not yet reliably finish the selected coding task.

## What was tested

The first synthetic calculator request exposed an OpenRouter transport failure.
The substantive development task then used public
[dbader/schedule](https://github.com/dbader/schedule) at
`82a43db1b938d8fdf60103bd41f329e06c8d3651`: reject nonpositive intervals while
preserving positive and fractional intervals, randomization and rescheduling,
and add regression tests. This is a development task, not a held-out benchmark.

Seven independent functional tests were frozen before any model ran. Their
baseline detects the bug. The evaluator, separate from solver source and prompts,
applies only a frozen submission in another clean, network-disabled container.
Solver-generated tests and selected legacy tests are separate visible evidence.

Every episode had a USD 1 ceiling inside the existing USD 70 smoke budget.
Provider destinations and changes were durably recorded before dispatch.
Keys remained in trusted process memory, outside the renderer, source, database
and task containers. No provider privacy settings were weakened.

## Results, including failures

| Episode | Result | Accounted USD | Unresolved maximum USD |
| --- | --- | ---: | ---: |
| OpenRouter synthetic smoke | Transport failed before usable diagnostics | 0 | 0.005789 |
| OpenRouter / DeepSeek | HTTP 404 | 0 | 0.005948 |
| OpenRouter / BaseTen | HTTP 429 | 0 | 0.005949 |
| OpenRouter / DeepInfra | One successful generation, then HTTP 429 | 0.000042 | 0.005986 |
| GPT-4.1 mini | Submission-marker/no-op loop; cancelled | 0.022054 | 0.012432 |
| GPT-4.1 mini, corrected protocol | Repeated failed syntax repairs; cancelled | 0.064701 | 0.033336 |
| GPT-4.1 | Three-file patch in 36.860 seconds; functional tests pass, visible check fails | 0.123802 | 0 |
| GPT-4.1, exact visible command supplied | Command timeout at 113.307 seconds, before submission | 0.174202 | 0 |
| **Total** | **Eight live episodes** | **0.384801** | **0.069440** |

Accounted cost includes conservative usage estimates when the provider supplies
no billed amount. It is not an invoice. Unknown sent requests retain their
entire reservation; combined recorded exposure is at most USD 0.454241.
Local infrastructure and development time are not included in these API figures.
These changed development configurations are not a controlled model comparison.

The submitted GPT-4.1 patch passed **7/7 independent functional tests** and three
selected legacy tests. The configured visible command failed because the model
put its new regression module inside the package instead of the repository root.
The patch also contained a full backup file and placed guards before existing
docstrings. It therefore remains **not fully accepted**. Functional test success
does not establish complete task compliance or reviewer approval.

That immutable patch has SHA-256
`da7eea2508d082ba983aca7c9ecc6deae5c98e59fe7d9feb0dcea3d617822863`.
It was exported through the app and the exported bytes match the stored artifact.
The owner has not selected Keep or Reject. No generated change was applied to
the source checkout. Final checks confirmed no worker/evaluator containers remain.
Raw local evidence and evaluator cases are excluded from version control.

## What the failures changed

1. Provider failures now expose fixed safe diagnostics without retaining HTTP
   bodies, headers or secrets. Unresolved exposure remains charged; no transport
   retry is automatic.
2. Direct OpenAI uses its own fixed endpoint and explicit model/prices, with no
   inherited OpenRouter routing fields. Model labels remain readable in the app.
3. The submission marker accepts surrounding comments but never discards an
   additional substantive command. No-op observations explain how to submit.
4. The exact user-selected visible command reaches the solver in every policy.
   Previously it was withheld until host verification. The prompt also asks for
   final diff inspection and scratch-file cleanup. Independent evaluator results
   were not sent to the solver.
5. The immutable patch is persisted before final checks. Cancellation, check
   timeout and failed-check tests verify preservation through durable replay.

The final live failure occurred before submission, so it produced no retained
patch. Unsubmitted-edit recovery remains incomplete. The experimental hybrid
view also lacks its local-investigation summary, and no dedicated local-model
or C/D/H comparison was run. A green mechanics suite would not close these gaps.

## Next iteration

Keep this as an internal developer MVP. Stop paid trials for this run. First
make timed-out solver commands preserve recoverable work and actionable output;
do not let a command hang erase the whole candidate. Then calibrate a current
strong cloud configuration on fresh bounded tasks before spending on routing.
Require a clean submission with visible checks, independent acceptance and owner
review before starting the comparison screen. One functional pass after failed
attempts supports further diagnosis, not a quality rate or savings claim.

The final full check passed: both TypeScript checks, native proof, 1,341 tests
(seven intentional skips), and both build flavors. The real-Docker Python suite
passed eighteen tests, with the additional cancellation regression passing
separately. Two earlier full checks hit one existing filesystem-test timeout;
its per-case timeout was adjusted after isolated verification, without changing
assertions or app deadlines.

Validation details and each approval/failure are retained in
[BUILD_LOG.md](BUILD_LOG.md). Launch instructions are in the
[coding quickstart](MVP_CODING_QUICKSTART.md).

## Continuation: recovery and a fresh cloud task

Following the owner's instruction to continue, the worker now recovers from at
most two generated-command timeouts. It stops and independently checks the whole
container, preserves bounded output and regular source files, then rebuilds from
the pinned image and original snapshot. A model follow-up still needs normal
budget admission. The timed-out command is not automatically repeated.

Graceful cancellation, deadline and step-limit failure have a separate bounded
artifact-only recovery path. Recovered work is explicitly unsubmitted and
unchecked in the database, UI and export notice. It cannot complete a run or
replace an already submitted patch. Tests cover retained edits and partial output,
termination of detached descendants, clean container replacement, cancellation
during replacement, export and restart. Immediate hard process/host death or
Docker loss can still prevent capture of the latest edits.

One new Cloud episode used public
[boltons at the pinned revision](https://github.com/mahmoud/boltons/tree/78ec69cac4465c57bb7debafcf3181d7d1ceaa76).
The requested feature adds signed integer/range parsing while preserving valid
positive inputs, literal delimiters, sorting, duplicates and formatter behavior.
Its separate nine-method evaluator was frozen before dispatch. The original
source passed three methods, failed one and errored on five; existing strutils
doctests passed. This was a fresh development task, not a known upstream defect
or a held-out comparison.

Direct OpenAI `gpt-5.6-sol` used medium reasoning, an 8,192-token total output
limit, a 256,000-byte input limit, standard service and explicit caching without
breakpoints. The seven successful requests reported the same undated model ID
and zero cache reads/writes. Reasoning is included in output-token accounting.
This was one USD 1 episode, limited to thirty steps and five minutes.

| Observation | Result |
| --- | --- |
| App-triggered episode | Submitted in 100.592 seconds |
| Artifact | Two files; 6,182 bytes |
| App visible checks | Passed: existing strutils doctests and six generated tests |
| Frozen independent suite | 9/9 methods passed; evaluated once |
| Compatibility review | Rejected: Unicode decimal input regression |
| Accounted API cost | USD 0.267624; zero unresolved reserve for this episode |
| Source and cleanup | Original source clean; run/evaluator containers absent |
| Owner decision | Keep/Reject remains unset |

Patch SHA-256:
`371b8bc78d3b161e0666f2d0bbb3dac1092735e4860ef6c0d74b11267326ef65`.
The app exported exactly those bytes. The independent suite and its passing
receipt remain unchanged after review; neither was used for a paid retry.

The reviewer caught a real test-coverage gap: the new `[0-9]` grammar rejects
Unicode decimal digits that the previous `int()` parser accepted. For example,
`parse_int_list('١-٣')` previously returned `[1, 2, 3]`. The task required
preserving valid positive-input behavior and did not restrict it to ASCII.
The intended two-file scope, visible checks and nine functional passes therefore
do not constitute full acceptance. No hidden post-review edit was added to the
submitted patch. This episode also did not exercise live timeout recovery;
recovery proof comes from the separate real-container tests.

Across all **nine** live episodes, the ledger now records **USD 0.652425 accounted
plus USD 0.069440 unresolved**, or USD 0.721865 combined recorded exposure.
These are token-price estimates where billed amounts are unavailable, not a
reconciled invoice, and exclude infrastructure and development time. Prior
failures and unknown exposure remain visible.

The next iteration should include compatibility cases derived from the original
implementation before freezing acceptance, and retain independent patch review
even when all tests pass. The known Unicode case is now a development regression;
any later repair must be labelled assisted or a separate episode. Establish full
task acceptance on fresh work before the planned C/D/H comparison. There is no
evidence yet for hybrid savings, repeat reliability or release readiness.

Current-source validation passed: `pnpm check` completed both TypeScript checks,
the native proof, 1,372 tests (seven intentional skips), and both build flavors.
The separate Python suite passed 33 tests, including real-container recovery and
isolated provider fixtures; all three Electron/Docker flows passed. Two initial
full-gate invocations stopped at new build-log heading/status formatting errors;
the uncommitted entries were corrected and the full rerun passed. Final document
validators were rerun after recording these results.
