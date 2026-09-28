# Website repair with bounded execution evidence

Status: The fresh local trial failed to deliver an artifact. Execution and failure
evidence are independently verified; no candidate evaluation was run.

This development iteration tests the new bounded execution observations against
the same website repair task that previously failed. The model receives the
original four inputs and generic goal, including the original rejected HTML.
It receives no evaluator, expected answer or manually repaired implementation.

The task uses the existing owned local model and offline execution environment,
with twenty model attempts, thirty tools and a fifteen-minute task deadline.
Observation retrieval consumes that allowance. The final request cap remains
192 KiB; no cloud consultation or public fetch is allowed in this task.

The current runtime passed the focused and desktop checks in the
[observation report](MVP_BOUNDED_TOOL_OBSERVATIONS_REPORT.md). The original
website and previous repair draft each passed fifteen of thirty independent
checks; neither was accepted. Those closed jobs and failures remain unchanged.

## Actual outcome

The task stopped incomplete after **245.777 seconds**, with twenty model
attempts, twenty settled requests and twenty tool actions. All requests are
accounted for, with zero unknown requests, public fetches, consultant calls or
API fees. Inputs and runtime sources remained unchanged; app and container
cleanup were confirmed. Owned-device operating costs remain unmeasured.

There was **no HTML candidate**. None of the 22 checkpoints contains a file under
`output/`; the saved work consists of the original inputs and three diagnostic
Python scripts. The host correctly refused structural submission, and the task
cannot resume. The prepared independent evaluator was not run because there is
nothing to evaluate. This is an absent deliverable, not a zero-out-of-thirty
quality score.

## What the trace demonstrates

The local model used the new `read_observation` tool successfully twice to read
omitted sections of the original HTML. All seventeen returned execution results
were retained and verified. Projected observation content peaked at 37,154 bytes,
below the 48 KiB limit. No request-size stop or invalid tool arguments occurred.
This establishes real-provider compatibility for the new reader on this task.

The remaining eighteen actions were seventeen executions and one saved plan.
Seven commands failed: the first assumed an incorrect input path; actions 12–17
encountered the same Python `Decimal` plus `float` type error. Actions 13–16
repeated an identical command and result. Later commands exited successfully but
printed large numbers of mismatches. No command wrote the required HTML file.
The model spent the entire allowance investigating and rewriting check scripts.

Root independently opened the final SQLite database, matched actual records to
the retained ledger, verified every checkpoint and execution blob, matched both
read ranges to their original output, checked repeated command hashes and
observation byte limits, and queried Docker for owned-container absence. A
separate reviewer independently rebuilt all twenty projection hashes and
confirmed the same failure, exact readbacks and accounting.
The operator's `ledgerVerified:false` means its completed-delivery predicate did
not pass; the twenty requests themselves are present and settled.

Root failure audit SHA-256:
`f02029784aae6e4815e64d0ef0c79b9f7212085b6ae273e1b6ca5ac33f73994a`.

## Decision for the next iteration

Bounding output solved the observed request-growth mechanism; it did not make
the model deliver. The next small routing intervention should react to execution
evidence: detect repeated identical failed commands, require a changed approach
or an explicitly permitted consultation, and stop clearly when progress stalls.
An early deliverable checkpoint should keep repeated analysis from consuming the
whole task. Available execution tools must also be explicit so checks use the
actual artifact runtime rather than an inaccurate simulation.

These changes are proposed, not implemented by this trial. Do not increase the
allowance or rerun the closed job automatically. Keep the no-candidate result and
use another fresh bounded trial after the next intervention is verified.

This is an exposed development trial. One outcome cannot establish held-out
reliability, causal improvement, privacy readiness, savings or a complete MVP.

References: [original repair result](MVP_LOCAL_WEBSITE_REPAIR_REPORT.md),
[completion audit](MVP_COMPLETION_AUDIT.md),
BL-20260913-2130-local-website-repair-v2-approved.
