### BL-20261121-0636-review-verdict-receipt -- 2026-11-21 -- The registry reads the single-sample desktop review receipt

Status: `Implemented`

Scope or hypothesis: Part 5 of the desktop document-review design in #203 gives review-1 receipts their own registry arm.

Decisions:
1. A version 1 desktop verdict receipt may name `local-heavy-review1` on the Heavy profile. The receipt determines the row's arm.

Changes: scripts/registry-row.py and tests/unit/registry-row-verdict.test.ts.

Evidence: The five verdict tests passed. A synthetic receipt goes through the CLI and produces a row with the recorded arm and owner verdict. The tests exercise conflicting arm overrides, the wrong profile, unsupported review arms and a flags field in the receipt. One light review found no issues. The full pnpm check passed with 4,124 tests passing and 88 skipped.

Failures or blockers: None in the receipt reader.

Limitations and non-claims: The test reads a synthetic receipt. The desktop route, six-file export and owned-model run have separate gates.

Paid exposure: USD 0. No model calls.

Next gate: Exercise a receipt exported by the desktop once the review route is integrated.

References: BL-20261120-0646-desktop-document-review-13b-design; BL-20261121-0611-owner-e5-proxy-jobs-and-13b-answers; pull requests #203 and #210.
