# Recovery and first report milestone

Date: 2026-09-13. Status: Verified development milestone; not Released.

The local model produced a complete synthetic invoice audit in six requests and
45.866 seconds of execution. A separate reviewer recomputed the arithmetic from
the task inputs and found no material defect. The frozen independent checker
passed three of five gates. After a separately reviewed correction of its
formatting false negatives, V2 passed all 28 controls and all five report gates
in the offline container. The unchanged report is accepted for this exposed
development task. The raw submission and failed V1 checker records remain immutable.

| Observation | Result | What it establishes |
| --- | --- | --- |
| Invoice report | Accepted with neutral review and V2 checker 5/5; V1 remains 3/5 | One correct small report under a corrected development evaluator |
| Public web response | Passed, two model calls, one GET and one DNS metadata exchange | SOAR retrieved public content and the model used its exact returned UUID |
| Recovery from the previous append error | Corrected file passed four independent byte/preservation checks | Correct file repair; the original four-call execution still ended incomplete |
| Host finalization and network changes | 100 focused tests and Node TypeScript passed | Scoped runtime mechanics, not a full application or release gate |

## The delivered report

The model inspected sixteen synthetic invoices, applied fixed conversion rates
and per-invoice half-up rounding, and wrote a Markdown audit. It identified three
discrepancies: one cent overcharged, fifty cents overcharged and one cent
undercharged. Billed total was USD 142.18; the correct total was USD 141.68, giving
a net USD 0.50 overcharge. It also correctly explained a legitimate half-cent
rounding case that should not be flagged.

This was one execution attempt. All six model requests settled; the model called
finish explicitly, structural checks passed, and execution cleanup was confirmed.
Inputs were preserved. The independent review read the submitted report and task
inputs without evaluator gold or checker results and recomputed the arithmetic
using Decimal. It made no model call and executed no candidate program.

The report SHA-256 is
`6aaa76752e6c6d9de1aa431c18370b1f986f44c46c8874f44cd357d661fed8d5`.
The complete candidate snapshot is
`7151d6d5e79ee5bd4a5419c5041b5ba07a87be2e73cb67c5fb6b803cc7533ece`.
Generated outputs, evaluator gold and raw traces stay in ignored local evidence.

## Independent acceptance

The frozen V1 checker ran once in the pinned offline container and passed input
preservation, report readability and exact mismatch rows. It rejected the totals
because the net-difference line includes an explanatory parenthesis after the
correct amount. It also treated a section heading and the one labelled rounding
example as two examples. A separate reviewer confirmed that neither construction
violates the task brief. The rejection is retained as a failed V1 evaluation.

A separate V2 evaluator handles those valid Markdown forms, with controls for
wrong, missing, duplicate and conflicting values. Independent source review found
and closed a further duplicate-label gap involving headings and numbered lists.
The final 28 controls passed both locally and in the pinned offline container;
the unchanged report then passed all five gates in that same container. Execution
and cleanup took 1.923 seconds. V1 task, checker and gold, all candidate files,
the execution ledger and all eighteen runtime files remained unchanged.

V2 is development on an exposed candidate. It does not become a held-out evaluation
by passing its controls. No further model request or candidate edit occurred, and
the model received no evaluator feedback. The original local control failures
from sentence-period handling and the review's duplicate-label counterexamples
are retained as evaluator-development failures.

The final independent checker receipt is
`d362c8a1ee97d7f0c58d601b7896ddc086536977b444b1a6bf6e588d63caaf80`.
The acceptance join, which binds neutral review, both evaluator outcomes, the
immutable candidate, runtime preservation and cleanup, is
`bc2a299ae80a7f6d737f7f83403ee94d9c38c068d8007b0c17826354c917abe4`.

The evaluator setup also retained two permission-service timeouts before process
creation and one adapter admission failure before container creation. The adapter
used a canonical JSON hash where the driver binds exact file bytes; fixing that
comparison allowed the still-unrun V1 checker to execute. These startup failures
are distinct from V1's observed formatting defects.

## What changed in the runtime

The previous append recovery revealed a completion-protocol gap: the model fixed
the file and verified it, then exhausted its allowance before calling finish.
The original run remains incomplete. A separate read-only audit confirms the
exact corrected bytes and preserved inputs; it does not reclassify that run.

Protocol five now permits host validation after ordinary model or tool allowance
exhaustion following a valid completed action. The host freezes the workspace,
closes execution, runs existing trusted checks in a fresh offline verifier and
records durable validation events. It adds no model request or fabricated finish
call. Invalid actions, unknown dispatches, cancellation and deadline stops cannot
promote existing files. Failed or interrupted validation cannot silently replay.
Thirty-two focused tests and the Node typecheck passed. The new branch was not
used by the invoice trial, which finished explicitly on request six.

Public retrieval now has an optional host-selected `cloudflare_v1` DNS profile.
It is restricted to wholly public contexts and included in the destination
identity. It validates a bounded DNS-over-HTTPS response, rejects non-public
addresses, pins the selected destination address and verifies TLS against the
original hostname. It makes no OS/VPN change, automatic retry or redirect. The
provider-specific profile currently supports IPv4 only; it reveals the admitted
public hostname to the resolver. Resolver exchanges have their own durable
started/finished events within the public-fetch operation.

The live proof completed in 4.807 seconds: two model requests, one public-content
GET and one explicit resolver metadata exchange. The fetched response contained
a live UUID, and the model returned that exact value. All requests settled. This
proves host-mediated retrieval and response consumption; GPU-server operating
system connectivity and autonomous model-server browsing remain unknown.

The final network suite passed 68 tests, including 27 resolver cases and 41
existing broker cases. Its initial sandbox run failed 24 cases at loopback listen
with EPERM; the identical permission-corrected suite passed. That setup failure
remains in evidence. The live web driver initially stopped before any request
because explicit local session declarations were missing; restoring those
declarations allowed its still-unspent single proof to run.

## Boundaries and next step

This is a narrow development milestone under the
[approved plan](plans/MVP_RECOVERY_AND_FIRST_REPORT_V1.md). It does not establish
general task quality, success across the four priority families, private-input
readiness, routing savings or an MVP release. Earlier failed and incomplete runs
retain their original outcomes. The original four-assignment ledger remains
zero accepted, one failed and three unrun; this smaller report is a separate task.

All twelve new model calls settled: four recovery, six report and two web-proof
requests. Declared API fees were zero for the owned-model calls. Hardware, electricity and
operating costs are separate; zero API fees are not a total-cost saving result.
No cloud fallback or real private inputs were used.

The next product milestone is to expose one complete general-job flow in the app:
select permitted inputs, run the local agent, see progress and recoverable errors,
and open its verified artifact. Use one fresh synthetic or public owner-shaped
task to test that flow before expanding benchmarks or task families. Real private
inputs still require the outstanding privacy qualification. This is a proposed
next step, not a claim that the app flow or privacy gate is already complete.

The existing session, runner and checkpoint code can support that flow. The app
still needs a host controller to own input copies, limits and session recovery;
typed general-task IPC and preload calls; and a renderer workspace for progress
and artifact preview/export. Keep runtime submission distinct from independent
acceptance in the UI. The first app test should include restart/resume and opening
the exact submitted artifact. A new agent loop or routing architecture is not
needed for that product step.

The final execution runtime identity is
`98f3c7052115c727476ad225af9265c19d890cae714014de1d4df7ed2ffdf0d2`,
covering eighteen frozen files. See the [build log](BUILD_LOG.md) for approvals,
test evidence, preserved failures and final acceptance status.
