# Stop unresolved loops and report the shared time budget accurately

Status: **Implemented and CPU verified; live stage-stop behavior verified on the first fresh local attempt; that attempt failed at its deadline and consumed the allocation. H4 unaccepted; split and H5 unstarted.**

The approved fresh allocation ran on `4773857` after both CI jobs passed
(run 41293282886). Sample a ended incomplete at its 90-minute boundary with
84 settled receipts and one UNKNOWN/cancelled receipt. The loop preserved its
result/accounting and stopped with `loop_stage_unresolved_dispatch`; sample b,
critic, repair, deck and split never started. The supervisor exited one without
interruption or forced kill, with its group and inhibitor quiescent. This verifies
the live stop correction, not H4 acceptance or timely model completion. The
allocation is consumed; no unused row or remaining fee cap grants a replacement.
All five attempts and three unresolved receipts remain recorded. See
BL-20261101-1106-h4-runner-fixes-stopped.
The [draft-first writer policy](PHASE4_WRITER_COMPLETION_V1.md) is a separate
approved experiment, with exact wording and one conditional owner decision
(BL-20261101-1838-writer-completion-approved). Implementation review and execution
gates remain; approval is not evidence that model completion will improve.

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
typecheck pass, independently repeated. Both required CI jobs pass on commit
`76f8dbceb1cf2e0f04ba3a66748b3b478f802b6b` in run 41274243154: 2260 tests,
81 explicit skips, both typechecks, native credential proof, builds and macOS E2E.
The earlier failed local renderer-worker startup and interrupted retry/build remain
recorded; they are not claimed as passing full local checks.

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

The consumed owner-approved allocation was exactly three fresh H4 loops under common
new pins: local research first, then deck, then split, stopping at the first failed
gate with no replacement. All four earlier attempts remain historical, including
the two unresolved receipts; successful completion would mean seven attempts and
three fresh accepted loops. The shared all-history H4 split ceiling remains
USD 0.60. No standalone diagnostic, repeat of paid Claude steps 0/1, or new
24-request service qualification is authorized.

Reuse the existing runner, mechanical/split gates and supervisor. An explicit
reviewed comparability record must bind the old service qualification, exact old
and new source/role identities, two-fix diff and CPU proofs. It may carry forward
unchanged provider/serving evidence; it must disclose the new dynamic budget
behavior. Historical source bytes must be checked against their immutable Git
snapshot, not the now-updated checkout. All three accepted loop references must
use the new common runtime. The owner approved this bridge, and root accepted its CPU carryover record
`14fbdd321425f3ad1ad4b43657a1bfc6ab8968f2759d52a3849f2c027bfb3f2b`.
It does not claim that the new runtime has passed live qualification.

The owner explicitly extended the H4 and conditional H5 new-start cutoff from
**2026-11-01 18:00 Asia/Shanghai to 2026-11-02 18:00 Asia/Shanghai**.
BL-20261101-0922-runner-fixes-approved records the exact "approve" decision.
The immutable owner record is
`a6c2422c787fffd91cf994b95f230825c765b39fbafaadec5e2338d240d9ab8f`,
binding reviewed held proposal
`279d3c5f9457d0d1dec67a774aef7e47fb303de43218020573c487a51f274940`
and the exact reviewed plan at commit `76f8dbc`. Each row must start before the
cutoff; an admitted row retains its unchanged limits and may close afterward.
The extension adds no requests, replacements, fees or completion guarantee.

H5 retains its existing conditional eighteen-row scope, USD 21.60 total ceiling,
USD 3 cloud-row and USD 0.60 split-row caps, zero failed-row replacements, common
local judge and independent blind scoring. The approved amendment changes its
eligible start window only. H5 stays ineligible until actual H4 mechanics and
usable split semantics pass under compatible new pins. Fresh H5 tasks, candidates
and gold remain unread. No actual authority, claim or dispatch is created by the
held preparation. The allocation/window decision was approved and its H4 execution has now stopped
on failure. No further H4 replay is authorized by that consumed allocation.
The separate conditional H5 scope still requires accepted H4 and split evidence;
no further generic H5 permission is needed after all its conditions pass.

References: [interrupted completion](PHASE4_FLASH_NEXT_H4_COMPLETION_V2.md),
[migration controls](PHASE4_FLASH_NEXT_MIGRATION_V1.md).

Adopted runtime SHA-256: `fec462c399e00e2fe1fdead1be552d32933cb1f9ef5a307492bbebbf430f4082`.
Research protocol remains `658aa22c5127d59afdfdaa550043ff397cf2e7152345b69941529784e243ab6d`.
Static writer layouts are unchanged; dynamic budget values and affected request
bodies change. These identities are CPU evidence, not new live qualification.
