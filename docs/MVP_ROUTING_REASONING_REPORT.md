# Native reasoning comparison: stopped development result

Date: 2026-09-09. Generation and accounting are reconciled. The profile
advancement gate failed: zero submitted candidates from four assigned episodes.
This is an exposed development comparison, not untouched confirmation.

The [frozen plan](plans/MVP_ROUTING_REASONING_V1.md) compared disabled and medium
reasoning on the same two original repair seeds. Tool availability, native history,
eight-call limit, 120-second request deadline and 600-second episode deadline were
held fixed. The output limit was 8192 tokens per request, including reasoning.

| Assignment | Observed outcome | Requests | Eligible submission |
|---|---|---:|---|
| Cache, disabled | Stopped after a fresh visible checkpoint test failed | 7 settled | No |
| Cache, medium | Sixth request timed out; provider outcome remains unknown | 5 settled, 1 unknown | No |
| Retry-After, medium | Unrun after batch stop | 0 | No |
| Retry-After, disabled | Unrun after batch stop | 0 | No |

The disabled candidate's checkpoint test raised an AttributeError in the bound
cache-discard method. Its final submission checks are recorded as `not_run`, but
that must not be confused with never executing a check: the separate checkpoint
receipt binds one failed check to the recovered source. Recovered work is not a
submitted or accepted patch.

The first five medium responses reported 4517 reasoning tokens within 4859 total
output tokens. This verifies an observable effect from the requested profile;
it does not demonstrate quality improvement. The sixth request exceeded the
120-second limit. Both attempted runs have confirmed container cleanup. Client
timeout and cleanup do not prove the provider stopped computing.

The read-only ledger audit reconciles all four assignments, both terminal runs,
thirteen requests, twelve settled receipts and one unknown outcome. There were
zero new cloud requests and zero new API fees under the configured local tariff.
The unknown local outcome remains explicit even though its fee reservation is zero.
Hardware, electricity, server utilization and historical study costs are not erased.

Post-generation evaluation also stopped before its first assignment produced a
receipt. Its durable closure preserves zero evaluation results and four unrun
evaluations. This is a separate evaluation-harness failure, not four completed
independent evaluations or four semantic rejections. No eligible submitted artifact
exists to support a positive quality claim; no independent probe or blind review
was run for this batch. The frozen evaluator and failed claim are retained.

Read-only diagnosis found the exact attribution defect: the evaluator compared the
raw objective-file hash with the admitted snapshot objective, while run creation
trims surrounding whitespace. The seed's final newline was removed at admission.
The mocked evaluator fixture bypassed that normalization and missed the mismatch.
A future evaluator must compare against the schema-normalized admitted objective
while retaining the separate raw-file binding. This diagnosis changes no outcome
and does not authorize rerunning the claimed evaluation.

Evidence bindings: generation freeze SHA-256
`014b96aee8753899c12b629be20e571e8c23d8fac74cd76f8b6e9348f6e15f5f`;
generation audit SHA-256
`5c1a594cdaf21d69c9d6daf76bfa1b00c2c4aae2b36259312e061867f69deaff`;
evaluation stop SHA-256
`b0cd6a265bd6643a6660de8bba1b636aa7e83ad22855fee2ab0404aab1e9e0af`.
Private raw evidence remains outside version control.

The medium profile does not qualify for promotion under the declared rule. The
interruption prevents a complete paired comparison and says nothing about the
model's maximum capability with different settings. Four untouched confirmation
tasks remain unused. This batch is closed to inference and automatic retry.

The next useful work is to diagnose completion and timeout behavior from existing
evidence, then test a narrower policy: route a predeclared class of reliable bounded
edits locally and send other work directly to cloud. Selection must use public task
information and development evidence, never hidden evaluation outcomes. A new policy
must clear development quality and complete-session cost checks before untouched
confirmation. The proposed threshold remains at least 20% lower API cost per accepted
patch, no additional material regression, and at most 25% median latency increase.
This proposal is not a new dispatch gate or a savings claim.
