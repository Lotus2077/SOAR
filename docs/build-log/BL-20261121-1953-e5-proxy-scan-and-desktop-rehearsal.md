### BL-20261121-1953-e5-proxy-scan-and-desktop-rehearsal -- 2026-11-21 -- Scan proxy handoffs and rehearse through the tagged E5 desktop

Status: `Verified`

Scope or hypothesis: E5 Amendment 1 points 3, 4, 6, 8 and 10 require public or synthetic proxy inputs, pre-dispatch and return scans, and a synthetic rehearsal on the tagged build.

Decisions:
1. Scan bytes and names under the trusted operator's private policy and publish each successful handoff to a fresh private folder.
2. Use the stock desktop controls and a separate database. The same proxy sets its acceptance notes before dispatch and judges the scanned export.

Changes: The proxy staging CLI, the desktop rehearsal driver, focused regression tests and the experiment runbook.

Evidence: The O10 doctor matched the stock build. Both three-sample idle checks passed. One synthetic website task submitted in 109.6 seconds using 11 model calls and 11 tool calls. The app exported the file, the scanner published matching bytes and the sourcing proxy accepted it with 7 estimated review/edit minutes and zero interventions. The app exported its receipt. The current writer printed its row and the registry's 176 lines and SHA-256 digest matched before and after.

Failures or blockers: A regression caught ordinary Office XML being refused. A full gate during development also caught fixtures using the old policy shape. Both were corrected. The local gate then passed with 4,196 tests passing and 89 skipped.

Limitations and non-claims: Verification covers this synthetic website on the tagged desktop with automated file-dialog selections. The proxy estimated 18 minutes saved, below the Heavy floor alongside 11 tool calls. It contributes zero trial jobs. Later CSS comment and accessibility-attribute support passed offline tests after the run.

Paid exposure: The two Codex turns reported 17,890 input and 404 output tokens, zero cached. At the owner's rate this accounts for 0.9955 credits, USD 0.03982. The local desktop receipt recorded USD 0.

Next gate: Prepare the blind grader's copy, then exercise the sampling and decoy checks before using them for weekly evidence.

References: BL-20261121-1705-e5-card-amendment-1-proxy-jobs, BL-20261121-1725-e5-proxy-verdict-attribution, E5 card Amendment 1.
