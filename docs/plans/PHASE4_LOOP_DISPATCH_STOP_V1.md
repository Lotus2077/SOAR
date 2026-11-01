# Stop unresolved loops and report the shared time budget accurately

Status: **Implemented; focused CPU verification passed, integrated checks required before live admission; no new live allocation.**

The interrupted completion-v2 attempt exposed two host defects. Sample a had
an UNKNOWN writer receipt, but the loop admitted sample b because a research
packet existed. Separately, the model-visible writer budget reported 90 minutes even
though research had already consumed about 20 minutes of the shared 90-minute
session. The original shared abort timer still applied. Its last turn advertised about 33 minutes while about 12 remained.
See BL-20261101-0428-h4-completion-v2-interrupted.

The focused correction has two parts:

1. Preserve each candidate summary and its accounting, then stop before any
   later stage when a dispatch is UNKNOWN, committed/unresolved, or failed.
   Apply the same rule to reused stages. All-settled evaluated quality failures
   retain the existing selection and repair behavior.
2. Clamp the model's advertised remaining time to the actual shared session
   deadline, including time consumed by research or a public phase. Preserve
   the existing per-run allowance, session deadline and request limits. Apply
   that same earlier deadline to timers, sandbox lifetime and synchronous late
   action/validation/completion checks; never grant additional time.

These are reversible CPU bug fixes under the ongoing instruction to resolve
issues and complete H4/H5. They are outside the consumed unchanged-runtime
execution allocation. No new model call, service change, standalone diagnostic,
prompt tuning, token-limit increase or telemetry project is included.

Verification must exercise actual receipt-to-summary classification and stage
transitions for a, b and repair, including reused stages; an all-settled incomplete
candidate remains eligible for normal evaluation. Time-budget tests must cover
research/public time already spent, an earlier per-run limit, expiry and restart.
The exact reviewed patch is adopted. All 127 focused cases and strict Node
typecheck pass, independently repeated; required integrated checks and CI gate live admission.

The time correction changes model-visible budget values. Both corrections change
the runtime identity. An unchanged research-protocol hash would not make the old
H4 results evidence for the new runtime. Preserve the previous source pins,
qualification, deck pass, two quality rejections and interrupted attempt exactly.
Recompute actual source and role pins, and disclose any unchanged identities
separately from the changed budget behavior.

Neither correction proves that the model will finish. The observed writer made
37 settled tool-call replies, including 35 successful executions, but all 38
captured workspace inventories were unchanged and contained no output artifacts.
There is no demonstrated failing shell command to repair, and a longer deadline
alone has no success evidence.

The proposed next live allocation is exactly three fresh H4 loops under common
new pins: local research first, then deck, then split, stopping at the first failed
gate with no replacement. All four earlier attempts remain historical, including
the two unresolved receipts; successful completion would mean seven attempts and
three fresh accepted loops. The shared all-history H4 split ceiling remains
USD 0.60. No standalone diagnostic, repeat of paid Claude steps 0/1, or new
24-request service qualification is proposed.

Reuse the existing runner, mechanical/split gates and supervisor. An explicit
reviewed comparability record must bind the old service qualification, exact old
and new source/role identities, two-fix diff and CPU proofs. It may carry forward
unchanged provider/serving evidence; it must disclose the new dynamic budget
behavior. Historical source bytes must be checked against their immutable Git
snapshot, not the now-updated checkout. All three accepted loop references must
use the new common runtime. This bridge is a proposed acceptance decision, not a
claim that the new runtime has already passed live qualification.

The proposed decision also extends the new-start cutoff from **2026-11-01 18:00
Asia/Shanghai to 2026-11-02 18:00 Asia/Shanghai**. The current authorization still
ends at the earlier time. The extension requires an explicit owner amendment
bound into the held package; elapsed time or CPU preparation cannot supply it.
Only about five hours remained when preparation began, so completion of H4 plus
all eighteen H5 row starts cannot be promised within the current window. This
proposal does not introduce a worst-case-duration admission rule.

H5 retains its existing conditional eighteen-row scope, USD 21.60 total ceiling,
USD 3 cloud-row and USD 0.60 split-row caps, zero failed-row replacements, common
local judge and independent blind scoring. The proposed amendment changes its
eligible start window only. H5 stays ineligible until actual H4 mechanics and
usable split semantics pass under compatible new pins. Fresh H5 tasks, candidates
and gold remain unread. No actual authority, claim or dispatch is created by the
held preparation; the concrete live allocation/window decision remains pending.

References: [interrupted completion](PHASE4_FLASH_NEXT_H4_COMPLETION_V2.md),
[migration controls](PHASE4_FLASH_NEXT_MIGRATION_V1.md).

Adopted runtime SHA-256: `fec462c399e00e2fe1fdead1be552d32933cb1f9ef5a307492bbebbf430f4082`.
Research protocol remains `658aa22c5127d59afdfdaa550043ff397cf2e7152345b69941529784e243ab6d`.
Static writer layouts are unchanged; dynamic budget values and affected request
bodies change. These identities are CPU evidence, not new live qualification.
