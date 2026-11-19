### BL-20261118-1605-e2-card-amendment-1 -- 2026-11-18 -- E2 card Amendment 1: the runs read the adopted serving card of 2026-11-18, are made at the commit it names, and add a 3-of-4 reading for the desktop beta's gate

Status: `Implemented`

Scope or hypothesis: E2's card (docs/experiments/e2-card-2026-11-17.md; BL-20261117-0944-e2-card-approved) was approved before the serving cards of 2026-11-17 and 2026-11-18 were adopted and before pull requests #137, #140, #142, #144, #151, #172, #176 and #184 merged. This amendment brings the card to that state before its first packet run. `Implemented` covers the amendment's text only. No E2 run has started.

Decisions:
1. **Eight points, all the session's,** under the card's own clause that a value changes by an amendment committed before the first synthetic packet run. The owner may replace each. None changes a rule the owner approved: point 1 follows the owner's adoption of the card and item 18's own condition, "though no serving card gives the bounds", which no longer holds; point 3 names the commit, as the card's status line asks; the card's 3 days stand.
2. **The card and the settings (points 1 and 2).** Every packet and writer run reads docs/experiments/serving-card-2026-11-18.json (sha256 9cd65c4e…; BL-20261118-1232-serving-card-2026-11-18-adopted), with the pair in the run's environment (BL-20261118-0419-correction-e0-card-amendment-6-card-pair-from-environment). Item 17's values are the card's P10 request settings, and the reader refuses any other. The card has no writer row, so both writers' bounds stay the code's constants.
3. **The commit and the hashes (point 3).** Every run is made at `main` 2996218, the adoption's merge, where E0's r3 runs were made; the source freeze there is 0b896d92…. The default protocol hash is 4bb74c03…; a packet run binds 99bbc0e6…, and a writer run records the same value from its packet's pipeline block.
4. **Packet attempts, the bound and the dry run (points 4 and 5).** Up to 5 attempts a task. An attempt passes admission, keeps a repair reserve and may send a second repair (decisions 1 and 2 of BL-20261117-1130-lane-decisions-second-repair-before-reprobe), may reach its packet through the one disclosed gap (#172), and keeps a synthesis whose only fault is a mis-tagged evidence id (#176). Writer-2 runs under `--write-bound twelve-call`, and each run follows its own `--dry-run true` (BL-20261117-1051-e2-write-bound-and-dry-run-implemented).
5. **The tasks (point 6)** are those of docs/experiments/e2-tasks-v1.json (BL-20261117-1158-e2-synthetic-tasks-frozen). Lane S-e1 holds the gold and scores.
6. **The beta's gate and the timing (points 7 and 8).** Beside the decision rule, the writer in force after the rule is read needs at least 3 of its 4 graded runs accepted, or local research does not go into an owner build on E2's evidence (decision 2 of BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout). The runs follow E0's r3 runs under the card (BL-20261118-1604-e0-amendment-8-remeasurement-result), one at a time, when the owner is not using the endpoint.

Changes: docs/experiments/e2-card-2026-11-17.md gains "Amendment 1 (2026-11-18)"; this file. No code changes.

Evidence:
- **Read at `main` 7a620cc,** read-only, by the session and by one reviewer: the reader's settings check in src/main/private-agent/serving-card.ts, the default of `SOAR_STREAMING` in src/main/config.ts, the seed's checks in src/main/private-agent/research-seed.ts, the driver's freeze, and the adopted card's P10 request settings. 7a620cc's code equals 2996218's.
- **The values,** recomputed by the reviewer through the repository's own reader: the card's sha256, the default hash 4bb74c03… and 99bbc0e6… under the card's roles with admission; the manifest's sha256 c540401a… and its `tasksSha256`.
- **The review** found two majors and six minors, all applied: the commit is named (2996218) instead of superseding the rule that an amendment names it; the change to the 3 days is dropped; and the gap, the dry run's entry, the writer-1 pin and this entry's wording are corrected.

Failures or blockers: None. The amendment lists five statements of the card that today's changes make untrue and that it does not resolve.

Limitations and non-claims:
- **Nothing of E2 ran.** No request or E2 run was made for this amendment, and no dry run has printed these values for an E2 command.
- **The 3-of-4 reading** is a threshold on 4 runs, not a rate, and it rests on provisional proxy grades.

Paid exposure: None. E2 stays at USD 0 for every run.

Next gate: The doctor and the first packet run's dry run, on r3, from the main checkout at 2996218 with the pair in their environment.

References: docs/experiments/e2-card-2026-11-17.md; docs/experiments/e2-tasks-v1.json; docs/experiments/serving-card-2026-11-18.json; docs/experiments/e0-card-2026-11-13.md (Amendments 6 and 8); BL-20261117-0944-e2-card-approved; BL-20261117-1051-e2-write-bound-and-dry-run-implemented; BL-20261117-1130-lane-decisions-second-repair-before-reprobe; BL-20261117-1158-e2-synthetic-tasks-frozen; BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout; BL-20261118-0419-correction-e0-card-amendment-6-card-pair-from-environment; BL-20261118-1114-e0-card-amendment-8; BL-20261118-1206-e0-amendment-8-reprobe-result; BL-20261118-1232-serving-card-2026-11-18-adopted; BL-20261118-1604-e0-amendment-8-remeasurement-result; pull requests #137, #140, #142, #144, #151, #172, #176 and #184.
