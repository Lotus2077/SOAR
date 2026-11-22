### BL-20261122-0801-e5-static-css-checklist-square -- 2026-11-22 -- Screen a static CSS checklist square and preserve the exported bytes

Status: `Implemented`

Scope or hypothesis: The second weekly E5 handoff fault occurred when a passive website used a CSS character escape for a white square.

Decisions:
1. Recognize only the complete quoted U+25A1 escape as the value of a CSS content declaration. Scan its character interpretation, retain the privacy checks on the rest of the document and deliver the original bytes.
2. Retain the adviser job as a tool void. A fresh rehearsal and incident-specific release are required before the next real job.

Changes: The E5 staging scanner recognizes this one static representation. Regression tests cover standalone CSS, HTML, byte preservation and the continued refusal of other escapes and placements.

Evidence: The original refusal was reproduced locally on the pinned stock export. A local scratch run of the focused staging suite passed 51 tests. The original stayed quarantined throughout the diagnostic.

Failures or blockers: Other unsupported formats or opaque content can still stop a handoff. Two weekly tool faults are recorded at the fourth chronological start.

Limitations and non-claims: This is a repair to the operator handoff. The existing stock desktop, model, frozen acceptance criteria and previous trial rows remain in force.

Paid exposure: Zero model calls for the repair and offline tests.

Next gate: Independently rehearse the production handoff with new synthetic material, bind the original export and scanner digests, and record a prospective release before another proxy start.

References: BL-20261122-0759-e5-ranked-starts-three-and-four, E5 Amendment 1 points 8 and 10.
