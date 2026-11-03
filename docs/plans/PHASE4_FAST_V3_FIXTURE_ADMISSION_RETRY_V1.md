# Fast-v3 fixture-admission correction and one bounded retry

Status: **Proposed; live retry, serving changes and a new window are not yet
approved.** Preparation and offline tests do not activate this plan. The previous
qualification remains failed, and its November 2 admission window has expired.
This amendment requests one new attempt with the full qualification and pilot
requirements below, followed conditionally by H4 and H5.

## Problem and retained evidence

The previous candidate passed all 24 numerical cases, startup and the first
qualification fixture, F1. F1 alone measured 56.08 decode and 44.30 full-request
tokens/s. That single probe is not the required paired performance result.

F2 failed `exact_admission_binding` before model dispatch. Offline reconstruction
and source review isolate its 16,384-token fixture prompt ceiling: the request
included the preceding actual tool call and retained tool-result history, while
the wrapper applied the same prompt ceiling as the initial short fixture. The
exact rejected token count was not persisted. This is a control-flow diagnosis,
not a recovered token measurement or a demonstrated model-generation failure.

The exact qualified fallback was restored and verified healthy on November 2 at
08:55:55 UTC. That observation is historical and cannot authorize stopping a
service without fresh ownership and readiness checks. Qualification, the artifact
pilot, H4 and H5 remain unaccepted.

Preserve the original plans, all failed attempts and reports, original owner and
phase claims, baselines, conversion and recovery evidence. In particular, preserve
the consumed F2 slot despite its zero wire attempts. No prior result is relabeled
as a successful new run.

## Narrow fixture correction

Change only the prompt envelope for the two history-dependent native fixtures,
F2 and F3. Their effective ceiling is the pinned native context minus the actual
reserved output and policy safety margin:

`maximum prompt tokens = 262144 - reserved output tokens - safety margin tokens`

Both retain the existing 16,384 output-token ceiling. With the currently pinned
zero safety margin, their maximum prompt ceiling is 245,760 tokens. Native
admission still renders and counts the exact serialized request and revalidates
its identity and context fit at commit. The wrapper must apply the tighter
effective native limit if a safety margin is present; it must not erase the
margin or count body bytes as tokens.

All other fixture prompt ceilings remain unchanged, including F1 at 16,384 and
F14 at 128,000. Preserve the actual history projector, tool-result bytes, native
tool schemas, output ceilings, role settings, sampling, request-body ceiling of
655,360 bytes and all response checks. Do not shorten the workload, substitute
synthetic results for actual preceding responses, or remove required history to
make admission pass. This is an explicit prompt-envelope amendment, not a waiver
of native context or request-identity checks.

With zero safety margin, the amended 16-case candidate prompt-envelope sum is
832,512 tokens. Including the two historical baseline row envelopes gives
976,896, versus the original 518,144. These are admission maxima, not measured
token use. Output ceilings are unchanged: the fresh candidate reserves 119,296
output tokens and the pilot at most 196,608.

Persist a bounded diagnostic record before a wrapper rejection can discard its
evidence. It must distinguish identity failures, fixture-envelope overflow and
native context overflow; retain the exact observed prompt count when available,
output reservation, safety margin, applicable ceilings and request/policy hashes.
Rejected evidence is explicitly unaccepted and must never set successful
admission or commit flags. If native admission fails before returning evidence,
record that count as unavailable rather than inventing or retrospectively
recomputing it. A diagnostic write failure must fail closed before dispatch.
Keep raw request content and private operational records outside Git.

## One fresh attempt and an honest allocation

Authorize one new serving attempt from the existing candidate image and completed
conversion, followed by **all 16 candidate cases F1–F16 in their original order**.
Do not resume the consumed failed phase or reuse the previous F1 as a new-run
pass. A new F1 supplies the actual tool call/history for the new F2 and F3 and the
fresh short performance measurement. Reuse only the two accepted original
baseline results; no baseline generation is authorized.

| Standalone allocation | Consumed or maximum slots |
| --- | ---: |
| Historical B1, B2, passed F1 and failed uncommitted F2 | 4 retained |
| One fresh complete candidate qualification | 16 |
| One conditional artifact pilot | At most 12 |
| Revised aggregate ceiling for this fast-v3 trial | **32** |

This requests **two additional zero-fee slots**, increasing the previous ceiling
from 30 to 32. The new attempt may consume at most 28 slots; every reservation,
including an uncommitted failure, remains consumed. There is no refund, borrowing
from H4/H5, reassignment, hidden warmup, replacement or retry within this attempt.
Reducing the pilot to ten calls or skipping cases is not the proposed remedy.
At full successful use, aggregate reserved slots are 32 while committed requests
are at most 31 because the historical F2 never committed. Actual receipts remain
the authority for settlement and fees.

Use a versioned additive ledger route and a fresh exclusive attempt claim. Bind
the complete original ledger, its four consumed slots, immutable original phase
claim values and terminal reconciliation before adding the new namespace. Keep
the original rows and claims unchanged. Count historical plus new reservations
atomically against 32, and reject another claim for this named amendment. A new
phase clock belongs only to the explicitly approved new attempt; never reset the
old clock or reopen its failed claim. New reports must distinguish historical
attempts, the single approved retry and the prohibition on further retries.

## Serving and release prerequisites

Retain exact candidate image
`sha256:9c0182182d93192a0f68225580bbe5bba6833474f979a9291f9dc1039e00f8dc`
and completed conversion
`76da52fa609c3ad3ab3520e0f3e9cb34a79201838a69a2e39899764f4492071c`.
Keep the model/checkpoint, MTP3, restricted draft vocabulary, FP8 side weights,
CUDA GDN, BF16 recurrent state, three scheduler slots, fixed 12 GiB KV, 262,144
context, native tool/reasoning support, Heavy settings and all eight role
contracts unchanged. No rebuild, reconversion, profile substitution, context
reduction, MTP-off fallback, cache purge, VM/swap change or q4t switch is included.

Before any service mutation, require current exact qualified-profile ownership,
healthy idle API, captured unit/container identities, shared-lease evidence and
verified retained candidate assets. Loss of SSH access, an absent service,
unexplained drift or uncertain ownership leaves this gate closed; this amendment
does not authorize unrelated repair or stopping an unidentified service.

Use fresh source-bound serving, recovery and phase namespaces. Preserve the
reviewed stop/lease order: confirm only the captured qualified service stopped,
acquire and verify the original shared lease, then check GPU quiescence and
resource floors. Retain the ten-minute asset verification, fifteen-minute
numerical and sixty-minute startup bounds, existing disk/RAM floors and
enforceable resource limits. Run the same 24 numerical cases and top-k reference
without skips. Start the exact candidate once and prove capacity for one full
context plus the pinned speculative lookahead, without claiming three full
contexts.

After startup, obtain new actual physical/readiness proofs, all-eight-role pins,
serving/token-helper policy bindings and the reviewed native-token preflight.
Permit at most one fresh F1 tokenizer-only preflight, plus the normal exact native
tokenization needed for each admitted dispatch. No additional diagnostic helper,
tokenizer or generation request is included. Fresh state-database namespaces must
preserve the logical job/cache identities used by the paired wire-body hashes.
Historical physical identities or healthy observations cannot substitute for
these. Preserve the original paired B1/F1 and B2/F14 wire-body hashes and prove
equivalent cold-cache behavior on the fresh owned candidate deployment. Both new
paired probes must explicitly report `cached_tokens = 0`; a cache hit fails the
pair without replacement. Do not combine the old F1 speed with new F2 history,
regenerate the baselines or alter paired bodies to obtain a better measurement.

On failure, preserve bounded evidence and stop. Permit one exact qualified-profile
fallback only after confirmed cleanup of captured owned resources and verified
listener/GPU/lease clearance. Unknown cleanup holds recovery for reconciliation.
Recovery supplies no new candidate or downstream launch authority.

## Unchanged qualification, artifact and evaluation requirements

The new candidate phase is at most 60 minutes, with every request clamped to its
remaining phase time and the new admission cutoff. Preserve all 16 contracts:
native SSE/JSON/tool history, separated reasoning, role schemas, judge supported
and contradicted cases, cache cold/repeat/isolation and cancellation/recovery.
All ordinary cases must settle with token-admission/usage parity. F15 alone may
remain the predeclared UNKNOWN cancellation; preserve it as unresolved. Require
the existing six healthy/idle GET observations at twenty-second start intervals
before the sole F16 recovery. Any other failed or unresolved case stops.

Require the unchanged two-pair performance gate: at least 512 completed output
tokens per sample, candidate combined full-request TPS at least 1.5 times the
historical baseline, combined decode TPS at least 30, and neither pair slower.
The old F1 is retained only as historical evidence. No performance result alone
proves artifact quality or earns H4 credit.

Only after full qualification and performance acceptance, run the original
artifact pilot from the existing completed research packet. Preserve **12 model
requests, 12 tool actions, 20 minutes, USD 0, one attempt and no replacements**.
Require substantive `output/report.md` bytes, hash and timestamp by four completed
turns or five minutes, whichever comes first, with root substance review.
Final success requires existing artifact/claims checks and content review, and
**at most 20,000 completed output tokens**. This is a success threshold, not an
enforced cumulative token cap. No new research/critic/judge calls are added.

Only accepted qualification and pilot evidence can admit exactly three fresh H4
loops in **local research → deck → split** order. Retain all normal Heavy
research/critic/repair/selection/entailment checks, stop on the first failure and
allow zero replacements. Preserve all six historical H4 attempts and four
unresolved receipts. The all-history H4 split cap remains **USD 0.60**.

H5 remains conditional on all three accepted H4 loops, usable Claude split
semantics, compatible current deployment/role/runtime bindings and independent
blind scoring. Keep **18 rows, USD 21.60 total, USD 3 per cloud row and USD 0.60
per split row**, with no replacement rows or repeated Claude calibration. Preserve
the original global H5 claim identity and historical accounting; a new owner or
source version must not create a second H5 allowance. Fresh H5 inputs, candidates
and evaluator gold remain isolated from implementers.

## Requested new window and final activation gate

Request a new fixed admission cutoff of **November 4, 2026, 10:00 UTC / 18:00
Asia/Shanghai**. Every new qualification/pilot dispatch and new H4-loop/H5-row
admission must precede it. Preserve the existing per-phase/per-row time limits
and permitted late closure of already admitted work. Approval after this cutoff
cannot activate the plan. No automatic extension is included.

Offline fixture-policy and reporting changes are separate from live release
readiness. Before asking for the final named runtime decision, freeze and review
the complete versioned serving/local-allocation/H4/H5 integration, including the
new owner binding, cutoff checks, additive accounting, report provenance and
downstream acceptance route. Require tests for exact boundary acceptance and
overflow, diagnostic persistence without commit, failed-slot retention, duplicate
claims, aggregate cap enforcement, cutoff refusal and rejection of stale source
or physical evidence. Run required repository CI and preserve the evidence.

Then durably record the owner's approval of this exact amendment, its reviewed
source bindings, **32-slot aggregate ceiling**, single serving/qualification
retry, conditional pilot/H4/H5 and **November 4 cutoff**. Require fresh current
readiness and a separate root release before each gated phase. Prepared code,
passing offline tests, green CI and the instruction to keep making progress do
not on their own grant the changed cap, elapsed-window replacement or another
serving attempt. If approval or any gate fails, retain the current qualified
service and the terminal evidence; do not automatically retry.

References: [original artifact trial](PHASE4_FAST_V3_ARTIFACT_TRIAL_V1.md),
[consumed postconversion continuation](PHASE4_FAST_V3_POSTCONVERSION_CONTINUATION_V1.md),
and BUILD_LOG entries `BL-20261102-0847-qualification-f2-precommit-failed-recovery-pending`,
`BL-20261102-0853-f2-admission-offline-forensics-and-source-check-clarification`
and `BL-20261102-0857-qualified-fallback-current-recovery-verified`.
