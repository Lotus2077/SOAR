# API-only artifact pilot retry v1

Status: **Proposed. Replacement approval, implementation, verification and live
release are pending.** This document grants no runtime authority.

The sixteen-case API-only qualification is accepted. The subsequent artifact
pilot failed after **four settled model requests, four tool actions and 37.182
seconds**, with no substantive report artifact. On turn three, its parser looked
for an `evidence` property, fell back to the top-level object and indexed it as an
array, producing `KeyError: 0`. Turn four correctly used `quotes`, but wrote only
a temporary quote extract. The unchanged four-turn first-draft gate then stopped
the pilot. These observations identify an artifact-workflow failure; they do not
establish a throughput failure or a successful artifact result.

The [approved API-only continuation](PHASE4_API_ONLY_ENDPOINT_CONTINUATION_V1.md)
allows no replacement pilot. **One named owner amendment is required** to permit
the bounded new attempt below. If approved, that decision authorizes its later
reviewed implementation and single gated run, followed by the already-authorized
H4/H5 sequence only if all actual gates pass. It does not require another routine
approval for that implementation or release.

## The single proposed change

Add a short, pinned private pilot instruction that makes the existing evidence
schema and direct artifact-first workflow explicit. Preserve the same exposed
task, brief, frozen research packet and seed lineage. The evidence JSON is an
object with `version`, `quotes`, `conflicts` and `counts`; its quote array is
`quotes`, not the top-level object. Quote records contain `id`, `questionId`,
`sourceId`, `locator`, `quote` and `note`. Preserve the existing E-number quote IDs
and exact quote/source associations.

Direct the writer to use the existing argument and human-readable evidence files
to write a supported `output/report.md` before optional parsing, extraction or
reformatting. Keep the original requirements for claims, citations, limitations
and complete final artifacts. The instruction supplies field/type guidance and
workflow order only: no task answers, prewritten report, selected conclusions,
new evidence, reduced deliverable, quality waiver or extra research/critic/judge
calls. All source-derived text remains untrusted evidence, not instructions.

Limit implementation changes to private pilot guidance and its admission,
accounting and downstream acceptance controls. Also correct diagnostics to
distinguish an attempted model-start event from a committed request and retain
the actual first-draft gate refusal cause. This diagnostic correction must not
change when the gate stops execution.

The production runtime and research protocol remain frozen. Preserve the API
target, observed serving identity, native tokenization contract, tool sandbox,
all eight role settings including judge, Heavy thinking, sampling, per-call
output limits and retry behavior. No service change or qualification rerun is
authorized. Record this as a new pilot guidance attempt; do not relabel the
accepted qualification as evidence for a changed runtime or research protocol.

## Bounds and preserved accounting

| Allocation | Slots |
| --- | ---: |
| Preserved historical allocation | 4 |
| Accepted API-only qualification | 16 |
| Failed first artifact pilot | 4 |
| Proposed new pilot, maximum | 8 |
| Aggregate maximum | **32** |

Exactly **24 slots are consumed and eight remain**. Retain the historical
pre-dispatch failure, every settled or unresolved receipt, the failed pilot
report and its consumed claim. No refund, reset, baseline replay, replacement
qualification or borrowing from H4/H5 is permitted. The two pilot attempts
together may consume at most twelve model requests and twelve tool actions.

Authorize only one new named pilot attempt, with a distinct additive claim and
source/release records. Append its records to the same aggregate accounting;
do not reset or overwrite the prior pilot claim, rows, clock or outcome.
Reconciliation and downstream acceptance must retain both pilot attempts and
show separately which attempt, if any, passed. Existing validators must not be
satisfied by hiding the failed attempt or relabelling its rows as a clean run.

The new attempt is bounded by **eight model requests, eight tool actions,
twenty minutes and USD 0**. Refuse a ninth request or tool action before dispatch.
Keep the first substantive report deadline at the earlier of **four completed
model turns or five minutes**. Preserve its actual bytes, hash and timestamp for
root content review. Temporary extracts, empty files, headings and placeholders
do not pass. Final success retains all artifact/claims checks and root review of
supported findings, citations and limitations, with **at most 20,000 completed
output tokens** as a success criterion. No subsequent editing or extra model
calls may repair a failed final review. The pilot still provides no H4 credit.

## Required validation and release

After this amendment is approved, prepare additive controls without modifying
the frozen failed-attempt evidence. Before release:

1. Pin the exact private guidance delta and verify that task, research packet,
   production runtime, protocol, model settings and quality checks are unchanged.
2. Test the actual evidence schema with synthetic fixtures; verify that the
   original four-turn/five-minute artifact gate still rejects temporary extracts
   and missing or non-substantive reports. Test accurate refusal diagnostics.
3. Test append-only reconciliation of the 24 consumed slots, the eight-slot/eight-
   tool limits, distinct once-only claim, both pilot outcomes, and refusal of a
   further attempt. Preserve F15's declared UNKNOWN without settling it by idle.
4. Independently review the new source, source closure and downstream acceptance
   changes; verify current CI where applicable and fresh pinned API readiness.
   Release only the exact approved amendment and reviewed sources.

Stop on the next failed gate or unresolved outcome; this amendment grants no
further pilot, automatic retry, quality exception or fallback. Accepted
qualification remains historical evidence even if this new pilot fails.

Only an accepted new pilot can admit the three full H4 loops, in local research
→ deck → split order, under the existing **USD 0.60 all-history split cap**.
H5 still requires accepted H4 and usable split semantics, with the same eighteen
rows, USD 21.60 total, USD 3 cloud-row and USD 0.60 split-row caps. Preserve global
H4/H5 claims, historical unresolved receipts and independent blind scoring; no
fresh H5 inputs, candidates or evaluator gold enter this preparation.

The fixed new-admission cutoff remains **November 5, 2026, 10:00 UTC / 18:00
Asia/Shanghai**. No window extension or monetary/aggregate-slot increase is
requested. The owner decision is solely whether to approve this named pilot
replacement within the eight remaining slots and the existing window.
