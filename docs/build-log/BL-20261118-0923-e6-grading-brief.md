### BL-20261118-0923-e6-grading-brief -- 2026-11-18 -- E6's grading brief is fixed before any E6 run: the grading session's procedure and the graders' GRADING.md, as docs/experiments/e6-grading-brief.md

Status: `Approved`

Scope or hypothesis: Item 6 of "What the card needs that does not exist yet" in docs/experiments/e6-card-2026-11-17.md asks for a grading brief for E6's blind proxy graders, with Phase 2's package as the model. It is written from the owner's items 4 (the acceptance rule) and 5 (the grading procedure), "Inputs and exposure" and Amendment 1, before any bundle exists. The pull request gives the detail.

Decisions: The brief is the coordinating session's procedural choice under the owner's items 4, 5 and 16 (BL-20261117-0940-owner-direction-decisions-delegated). The owner may replace it.
- **Bundles and copies.** Two bundles a file, built with scripts/phase2-blind.py under neutral roots, are checked against BRIEF.md before release. Each of six graders gets a key-free copy of one bundle outside the repository, started with no project instructions, memory or network.
- **The decoy.** One decoy is a submitted review-1 run, copied into the same file's repairs' bundle with one figure changed in its summary.
- **Sheets and unblinding.** The sheets are hashed before any key is opened and before scoring. Unblinding reads each loop's `loop.json`.
- **Not chosen yet:** how a grader is started is left to the coordinating session.

Changes: docs/experiments/e6-grading-brief.md; this entry.

Evidence: One review found a blocker, two majors and five minors, all taken. The coordinating session's second look at the blocker and the majors found all three fixed. Lane S-harn's check of the bundle tool on a simulated review-2 loop gave three notes, which are folded in.

Failures or blockers: None.

Limitations and non-claims: Nothing has run under the brief: no bundle exists, and no grader has been started. The decoy's figure and the grader-start mechanism are chosen at grading time.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: Merge on green CI. E6's runs follow once the card's other preconditions are met.

References: BL-20261117-0940-owner-direction-decisions-delegated; BL-20261117-1311-e6-card-amendment-1; BL-20261013-1650-phase2-grading-package; BL-20261013-1630-phase2-blind-bundles; BL-20261019-0410-blind-bundle-omissions.
