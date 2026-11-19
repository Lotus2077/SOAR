### BL-20261119-1702-e2-card-amendment-2 -- 2026-11-19 -- E2 card Amendment 2: a second batch at the fixed writer's commit, seeded from the first batch's packets and read on exposed tasks

Status: `Implemented`

Scope or hypothesis: E2's first batch ended by case 1 (BL-20261119-1454-e2-result). Lane S-pipe's read-only diagnosis found two faults in the writer's code, with counts as BL-20261119-1701-correction-owner-fix-writer-bugs-first-counts corrects them. The owner chose to fix them first, and the owner's decision 4 in BL-20261119-1555-owner-fix-writer-bugs-first orders a second E2 batch at the fixed commit. The fix is #195 (BL-20261119-1620-writer-ledger-feedback-and-length-nudge). This amendment registers that batch, `e2-2026-11-19-b2`, before any of its runs. `Implemented` covers the text only.

Decisions:
1. **Its standing.** Case 1 allows "an amendment or a new card"; the session uses an amendment, as the owner's order names. The card's two clauses against later changes, the stop rule's and Amendment 1's point 8, are quoted. The session reads them as binding batch e2-2026-11-19, which nothing here changes, and as binding this batch from its first run. The owner may require a new card instead. This batch's reading supersedes the first batch's for the E3 and E4 writer and for the beta's gate reading, with the first batch's counts reported beside it.
2. **The hypothesis, read as counts of 4.** None of writer-2's graded runs ends at its bound with a failed host ledger check, and every one of Heavy's is `submitted`. The card's caveat on small counts is carried. No bound, clock, allowance or cap changes.
3. **The values.** The commit and the freeze change; the rest of Amendment 1 stands. The commit is #195's merge, and the freeze is 86732c63…. Both research protocol hashes, 4bb74c03… and 99bbc0e6…, are unchanged.
4. **Seeds without packet runs.** The writers seed from batch e2-2026-11-19's packets, which the protocol hash binds across the commit. s1's seed is the packet the session kept from an `infra_invalid` attempt, a reading the owner may replace. A refused seed pauses the batch.
5. **Exposure, a departure.** s1 and s2 read `exposed`. Grading their runs "on exposed tasks" departs from review rule 3 as worded. The owner may choose calibration only, or new tasks, before the first writer run. Whether such a reading opens the beta stays the owner's decision.
6. **Grading, the runbook and the window.** Fresh graders and a fresh decoy. Rows carry ids `e2-<task>-<run>-b2`. The runbook is lane S-pipe's a9 (sha256 789057c9…), and the operator sets its seed, freeze and entry variables and checks HEAD. The batch gets its own 3 days, and E6 follows at the same commit.

Changes: docs/experiments/e2-card-2026-11-17.md gains "Amendment 2 (2026-11-19)"; this file. No code changes.

Evidence:
- The runbook's test passes 34 of 34 and fails against a8 and against 8 mutants.
- One read-only review of this amendment recomputed the freeze at #195's head and matched the three packet snapshots to their packet.json files. It found 3 major and 7 minor points, all applied.

Failures or blockers: None.

Limitations and non-claims: The tasks are exposed, so accept counts may be optimistic for fresh tasks; E3's fresh tasks stay the fresh test. Reusing the packets means the batch shows nothing new about the reading stage.

Paid exposure: None. The runs are zero-fee on the owned endpoint, and the graders run on the owner's Claude subscription.

Next gate: #196, then #195, then the commit filled and the freeze re-checked at #195's merge, then this pull request with green CI. After that, the main checkout moves to #195's merge and the window is announced.

References: docs/experiments/e2-card-2026-11-17.md; docs/experiments/e2-grading-brief.md; BL-20261117-0944-e2-card-approved; BL-20261118-1605-e2-card-amendment-1; BL-20261119-1454-e2-result; BL-20261119-1555-owner-fix-writer-bugs-first; BL-20261119-1701-correction-owner-fix-writer-bugs-first-counts; BL-20261119-1620-writer-ledger-feedback-and-length-nudge; BL-20261117-0940-owner-direction-decisions-delegated.
