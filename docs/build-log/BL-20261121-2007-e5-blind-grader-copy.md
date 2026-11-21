### BL-20261121-2007-e5-blind-grader-copy -- 2026-11-21 -- Prepare an E5 blind copy of the pinned need, criteria and export

Status: `Verified`

Scope or hypothesis: E5 Amendment 1 point 5 gives a fresh grader the need, pre-dispatch acceptance notes and exported deliverables.

Decisions:
1. Supply each file with its previously recorded SHA-256. Read only the operator-selected files inside the private material roots.
2. Publish scanned bytes under neutral names in a fresh grader folder. The operator keeps the source log, proxy verdict, minutes and receipt outside the selected inputs.

Changes: A host-side blind-copy command, synthetic regression tests and its invocation in the experiment runbook.

Evidence: The rehearsal's pinned need, original acceptance notes and actual exported website produced a three-file packet. All three byte digests matched the archived evidence. The destination contained just the packet. The seven wrapper regressions and 40 staging regressions passed, including pin mismatches, link and root refusals, source directory preservation and privacy refusals.

Failures or blockers: Review found temporary staging under the criteria's source root. The implementation now stages under the separate destination parent after all selected files pass the scan.

Limitations and non-claims: The command prepares standalone deliverables. A fresh grader has yet to grade a sampled job or decoy.

Paid exposure: Zero additional requests or fees.

Next gate: Exercise dispatch-time sampling and the weekly decoy with a fresh grader.

References: BL-20261121-1705-e5-card-amendment-1-proxy-jobs, BL-20261121-1953-e5-proxy-scan-and-desktop-rehearsal, E5 card Amendment 1 point 5.
