### BL-20261121-1953-e5-proxy-scan-and-desktop-rehearsal -- 2026-11-21 -- Scan proxy handoffs and rehearse through the tagged E5 desktop

Status: `Implemented`

Scope or hypothesis: E5 Amendment 1 points 3, 4, 6, 8 and 10 require public or synthetic proxy inputs, pre-dispatch and return scans, and a synthetic rehearsal on the tagged build.

Decisions:
1. Scan bytes and names under the trusted operator's private policy and publish each successful handoff to a fresh private folder.
2. Use the stock desktop controls and a separate database. The same proxy sets its acceptance notes before dispatch and judges the scanned export.

Changes: The proxy staging CLI, the desktop rehearsal driver, focused regression tests and the experiment runbook.

Evidence: The 28 scanner tests and five driver tests passed. The full local gate passed with 4,196 tests passing, 89 skipped and a successful production build. The live doctor matched O10 and the stock app started one isolated task with the pinned input.

Failures or blockers: The first scanner test run caught a valid Office package being refused. The parser and the regression were corrected.

Limitations and non-claims: Only inspectable formats are admitted. Source provenance and the completeness of the private scan policy remain the operator's responsibility.

Paid exposure: The metered proxy uses the limits in BL-20261121-1948-e5-proxy-codex-metering.

Next gate: Rehearse, inspect the export, print its receipt row and preserve the registry.

References: BL-20261121-1705-e5-card-amendment-1-proxy-jobs, BL-20261121-1725-e5-proxy-verdict-attribution, E5 card Amendment 1.
