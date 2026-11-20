### BL-20261120-1317-e2-fresh-check-result -- 2026-11-20 -- E2's fresh check: Heavy had 3 of 4 graded runs accepted on two fresh tasks, which meets the beta's 3-of-4 reading there, after a second grader the owner named replaced one that had accepted the decoy

Status: `Implemented`

Scope or hypothesis: Amendment 3's batch `e2-2026-11-20-fresh` (BL-20261120-0707-e2-card-amendment-3): two packet runs and four Heavy writer runs at zero fee on the fresh tasks s3 and s4 (BL-20261120-0745-e2-fresh-tasks-frozen). They ran from the main checkout held at 69ee783, whose source equals 734e702's. They were graded blind by the E2 grading brief with Amendment 3's overrides, scored by lane S-e1, and read by Amendment 3's point 5. It checks the writer the owner's beta carries (BL-20261120-0657-owner-opens-beta-with-fresh-check-and-starts-e5) outside the tasks its fix was tuned on. The pull request's description holds each run's reading.

Decisions:
1. **The reading is met.** Heavy had 3 of 4 graded runs accepted: s3's run 2 and s4's runs 1 and 2. s3's run 1 ended incomplete and is rejected. That meets the beta's 3-of-4 reading on these two fresh tasks, so the beta stays as the owner opened it. No rate is claimed.
2. **The decoy and the second grader.** s4's first grader accepted the decoy, a copy of s4's run 1 with one figure changed, calling the change a one-number fix. By the brief and Amendment 3 its grades were set aside, and the owner chose "Another blind grader". A fresh grader on a new copy of the same bundle rejected the decoy, naming the figure, and accepted both s4 runs (3 and 10 minutes). The first grader had accepted all three.
3. **The gold** (lane S-e1, counts only). s3's run 2 and s4's run 1 scored 7 of 7, s4's run 2 6 of 7, and s3's run 1 0 of 7. Grader and gold agree on 3 of 4 runs; on s4's run 2 the grader accepted a report the scorer failed on one check.
4. **A failure mode remains.** s3's run 1 ended after three replies in a row were cut at the 16,384-token cap, despite two length nudges. s3's packet run's own write phase ended the same way.
5. **Disclosed.** The first run started at 10:18:33 UTC, 12 minutes before #206 merged; the amendment had been committed and reviewed. s4's first grader reported a filled sheet without editing it, so its sheet went back to it once.

Changes: this file; docs/experiments/registry.jsonl gains 6 rows in batch `e2-2026-11-20-fresh`, ids `e2-<task>-<run>-fresh`.

Evidence:
- **The runs** went one at a time from 10:18:33 to 11:51:07 UTC by runbook a10 (bcf50687…), each after its pre-run checks. Both packets came on their first attempt: s3 with 11 of 11 chunks and no gap, s4 with 10 of 11 and one disclosed gap. Three of four writer runs submitted. All 346 dispatches went to the owned endpoint and settled, at USD 0 with 0 disclosed bytes; no stop rule fired, and nothing was re-run.
- **The grading.** The gate passed first. Graders read for 46 to 48 s. Sheets were sealed before any key was opened: s3 62768781…, s4's first e9c78271… (set aside), s4's second d0393679…. Keys: s3 1b997ece…, s4 dc523158….
- **The scores:** E2's scorer v1, outputs 76245842…, 6a12d4b7…, 33060b0c… and a8a4150c…; S-e1's own reading disagreed with none.

Failures or blockers: None stopped the batch.

Limitations and non-claims: These are counts on 4 runs on two synthetic tasks by one author. s3 is like s1 in form (BL-20261120-0745-e2-fresh-tasks-frozen). The proxy grades are provisional, the first grader passed a wrong figure as a quick fix, and s4's run 2 was accepted at the 10-minute edge with the gold failing one check.

Paid exposure: None. The graders ran on the owner's Claude subscription.

Next gate: None for the beta, which stays. The length runaway may ground a later writer change, as a lever under its own entry.

References: docs/experiments/e2-card-2026-11-17.md; docs/experiments/e2-grading-brief.md; docs/experiments/e2-fresh-tasks-v1.json; docs/experiments/registry.jsonl; BL-20261120-0707-e2-card-amendment-3; BL-20261120-0745-e2-fresh-tasks-frozen; BL-20261120-0657-owner-opens-beta-with-fresh-check-and-starts-e5; BL-20261119-2128-e2-batch-2-result.
