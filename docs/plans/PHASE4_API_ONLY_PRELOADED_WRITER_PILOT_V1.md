# Final API-only pilot with preloaded writer evidence

Status: **Proposed; no implementation, payload construction or runtime authority.**
The previous named replacement is consumed. Four unused slots do not authorize
another attempt. This proposal requires a separate named owner decision.

## Evidence and hypothesis

Service qualification remains accepted. Both artifact pilots spent four model
requests and four tool actions without producing a report. The first encountered
an evidence-schema mistake, then created only a temporary quote extract. The
replacement used the correct `quotes` array, but all four commands remained
inspection or extraction: directory/summary inspection; argument, plan and
evidence reading; full quote extraction; then another quote subset. All four
replacement commands exited successfully. No report-write command was attempted.

The replacement's second and third commands produced **25,616 and 12,751 stdout
bytes**, respectively, presented through bounded tool-observation projection.
This offers a concrete explanation worth testing for repeated reading, but does
not prove projection caused the failure. The replacement stopped correctly at
the four-turn first-draft gate after 51.899 seconds and 3,607 native output tokens.
Those tokens are not report length. Five model-entry events corresponded to four
committed requests; the fifth entry was refused before dispatch.

The hypothesis is that presenting the complete existing writer evidence in the
initial context can avoid discovery and repeated extraction turns, leaving the
four remaining calls for artifact creation and completion. It is not evidence
that the model can already complete the deliverable in four calls.

## Exact proposed input change

Use the **same complete frozen `argument.md` and `evidence.md`**, copied verbatim
from the existing research seed into clearly delimited, untrusted source-evidence
blocks in the initial writer context. Their retained source bytes are 1,839 and
18,961, respectively: **20,800 raw bytes total**. Keep all six original seed files,
the full task and brief, source corpus, quote IDs, source associations, conflicts,
limitations and evidence gaps available unchanged in the workspace.

Include only the exact existing evidence-schema explanation alongside the
unchanged artifact-first requirement. Do not select, shorten, summarize, reorder
or supplement the two files; add no task answer, selected conclusion, prewritten
report, new research or evaluator information. The argument is existing
unverified model text, and verified quotes establish source occurrence, not
truth. Source-document instructions remain data and acquire no authority.

This is a **new private input-presentation variant**, not merely clearer wording
and not an identical writer prompt or request body. The existing private writer
adapter can decorate messages before calling the unchanged model interface, so
the change can remain outside production runtime and research protocol. Pin the
new private adapter, instruction, source-file hashes and exact request provenance.
Preserve the production runtime/protocol hashes, API identity, native tokenizer
contract, all eight roles, Heavy thinking, sampling, per-call limits and sandbox.
No model, service or qualification change is proposed.

The full evidence block must remain present **exactly once in each request's
retained initial context**. An initial-call-only decoration that disappears from
later runner history is insufficient; repeatedly appending duplicate blocks is
also incorrect. Preserve normal tool-output projection and history rules. This
proposal changes how those two existing source files reach the writer, not the
global projection policy. If the private adapter cannot do this without changing
production behavior or omitting evidence, stop and report the incompatibility.

## Feasibility and unchanged success criteria

The source text's raw size is below the existing request-byte ceiling, but full
serialized-body size and native prompt-token admission remain unverified for
this variant. Approval would permit reviewed implementation and ordinary exact-
body pre-dispatch tokenization, not extra model probes or a qualification rerun.
Oversized or ambiguous input fails admission; do not trim the source to make it
fit.

Four calls are structurally possible: the existing runner can perform full host
validation after normal allowance exhaustion following an eligible fourth
action. It does not require a fifth model call to finish. That path still requires
all artifacts/checks, settled dispatches and no abort; preserve cleanup and the
post-run draft capture/root review. This remains a demanding, unproven workload.
The writer may still over-inspect, produce unsupported claims or need more
repairs. All required report, claims ledger and other artifacts must be completed
and accepted within the same four calls. A late draft earns no extra calls.

Retain the earlier-of-four-completed-turns-or-five-minutes substantive first-draft
gate, frozen-byte capture and root content review. Retain full final artifact,
claim, citation and limitation checks, twenty minutes maximum, USD 0 and at most
20,000 completed output tokens as the success criterion. No empty file,
placeholder, temporary extract, partial deliverable or model assertion passes.
No quality waiver, post-review edit, extra research/critic/judge call or paid
calibration is permitted. Pilot success provides no H4 credit.

## One final attempt and additive accounting

| Preserved or proposed allocation | Slots |
| --- | ---: |
| Original historical allocation | 4 |
| Accepted API-only qualification | 16 |
| Failed first pilot | 4 |
| Failed replacement pilot | 4 |
| Proposed final pilot, maximum | 4 |
| Aggregate maximum | **32** |

Preserve all **28 consumed rows and five existing phase claims**, including the
historical pre-dispatch failure and the unresolved F15 cancellation. Add one
distinct, once-only third pilot claim and at most four new rows. Never reset,
refund, relabel or overwrite either failed pilot. All three pilots together may
consume at most **twelve model requests and twelve tool actions**. The proposed
final attempt has at most **four model requests and four tool actions**; refuse
a fifth before execution. No allowance is borrowed from H4/H5.

## Approval, validation and stopping rule

The requested named decision is **“Approve final four-slot preloaded-writer pilot
amendment.”** Until that decision is durably recorded, do not implement the
adapter, construct the actual prompt payload or launch any request. Approval
would authorize later independently reviewed implementation and this single
bounded run without another routine implementation/release approval.

Before release, verify byte-for-byte full-file inclusion, UTF-8 roundtrip and
hashes, one-copy persistence across all four requests, absence of projection or
truncation of the preloaded block, unchanged task/seed/model settings and normal
native admission. Test the four-call/four-tool ceiling, the eligible fourth-action
host-validation path, unchanged artifact gates and append-only 28-plus-at-most-
four ledger behavior. Missing artifacts after ordinary fourth-call exhaustion
must receive truthful terminal diagnostics even if no fifth model entry throws;
do not fabricate another attempted request or an observed exception.
Independently review the exact sources and updated three-attempt acceptance
graph; require current applicable CI and fresh pinned API readiness.

Stop on the next failed live gate or unresolved outcome. No further attempt,
automatic retry, evidence reduction, service repair or fallback is granted.
Only actual final-pilot acceptance can admit the existing three full H4 loops
in research → deck → split order, retaining USD 0.60 all-history split spending.
H5 remains conditional on accepted H4 and usable split semantics, with the same
eighteen rows, USD 21.60 total, USD 3 cloud-row and USD 0.60 split-row caps,
original global claims and independent blind scoring. No fresh H5 inputs,
candidates or evaluator gold enter this work.

Every new admission still precedes **November 5, 2026, 10:00 UTC / 18:00
Asia/Shanghai**. This proposal requests no window, monetary or aggregate-slot
increase. See the preserved [API-only continuation](PHASE4_API_ONLY_ENDPOINT_CONTINUATION_V1.md)
and [consumed eight-slot amendment](PHASE4_API_ONLY_ARTIFACT_PILOT_RETRY_V1.md).
