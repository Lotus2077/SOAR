### BL-20261121-1723-review-form-limits-and-required-document -- 2026-11-21 -- Desktop review shows the required document and the limits that apply

Status: `Implemented`

Scope or hypothesis: A desktop document review runs with the Heavy profile. The form previously displayed the default profile's limits even when Standard was configured and told the user a goal alone could start a review.

Decisions:
1. The review form shows the limits supplied by the host when it identifies Heavy as the default. Otherwise it states that Heavy limits apply. The renderer uses the existing availability contract.
2. The review form labels its required document, asks for one .docx in its empty state and prompts for a review goal. Other tasks keep their existing labels.

Changes: The general task form and its renderer regression test.

Evidence: Under a Standard default the renderer regression checks the heading, placeholder, file requirement and limits in review and plain modes. The updated regression, typecheck, branch-aware build-log validator and `pnpm check` passed, with 4,157 tests passing and 89 skipped in the full suite. One light review identified the heading and placeholder, both corrected and tested.

Failures or blockers: Two repeat runs timed out in separate suites outside the renderer, once during temporary-file cleanup and once in a Python subprocess. Both suites and the renderer suite then passed together with one worker (100 passed, one skipped).

Limitations and non-claims: The renderer test uses jsdom. The built form was also inspected in headless Chrome with synthetic availability data. A real desktop review and the owner build remain later steps in 13b.

Paid exposure: None.

Next gate: CI for this follow-up to the merged #216.

References: BL-20261121-1714-desktop-review-view; BL-20261121-0640-desktop-review-record-and-route; pull request #216.
