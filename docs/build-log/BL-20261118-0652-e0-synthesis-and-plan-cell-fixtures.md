### BL-20261118-0652-e0-synthesis-and-plan-cell-fixtures -- 2026-11-18 -- A synthesis fixture and three planner cells, registered as the E0 card's Amendment 7, measure the next card revision before any call

Status: `Implemented`

Scope or hypothesis: Two of the next-lever candidates after E0's r3 re-measurement (BL-20261118-0606-e0-r3-remeasurement-result) are card edits: synthesis caps of 16,384, and plan thinking off on attempt 2. The coordinating session asked for fixtures that measure both on the runs' own records before one card revision, with the reading fixed in an amendment first.

Decisions:
1. **A synthesis fixture** (scripts/synthesis-fixture.ts, manifest e0-synthesis-fixture-v1.json) replays the stage's two-attempt sequence on runs 2 and 3's packets. Its unit is a trial, and the outcome is what the owner would get: a model synthesis or the skeleton. It runs three cells: 8,192 (the card's row), 16,384, and 8,192 with thinking off on the repair only.
2. **Planner cells B and C** join cell A in scripts/planner-fixture.ts, on run 2's index (manifest v3): B is A streamed, as the stage sends it, and C is B with thinking off.
3. **Both fixtures are checked against the stage's own receipts before any call.** Each dry run rebuilds the stage's bodies from the packet or index and compares them with result.json's sizes and packet digests.
4. **Amendment 7** registers the six invocations, their dry runs and the reading rules. Nothing is adopted by the fixtures alone.

Changes: scripts/synthesis-fixture.ts; scripts/planner-fixture.ts; scripts/registry-row.py (the planner's two cells and a synthesis kind); package.json; docs/experiments/e0-synthesis-fixture-v1.json and e0-planner-fixture-v3.json; Amendment 7 of docs/experiments/e0-card-2026-11-13.md; their tests; this file.

Evidence:
- The stage itself is the reference. The pipeline runs with a scripted synthesiser, and the fixture rebuilds its synthesis bodies byte for byte in all three cells. On 13 replies its judge returns the stage's verdict and reasons; 2 are accepted.
- On the real records, read-only, the rebuilt bodies match all four synthesis receipts' sizes and run 2's first plan receipt (69,073 bytes). Only the dry run can check the digests, because they bind the endpoint.
- Mutants that drop a judge check, break the repair context or pick the wrong plan receipt each fail a test.

Failures or blockers: None.

Limitations and non-claims: No call has run. The stage's checks are not a semantic verdict. Two packets and one index from one task. Admission under a 16,384 synthesis cap is not measured.

Paid exposure: None. Every call the amendment registers goes to the owned endpoint at USD 0.

Next gate: CI and the coordinating session's merge, then the six invocations in Amendment 7's order.

References: BL-20261118-0606-e0-r3-remeasurement-result; the E0 card's Amendment 7.
