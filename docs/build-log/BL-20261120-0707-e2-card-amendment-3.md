### BL-20261120-0707-e2-card-amendment-3 -- 2026-11-20 -- E2 card Amendment 3: a zero-fee fresh check of Heavy on two fresh tasks, read only against the beta's 3-of-4 gate

Status: `Implemented`

Scope or hypothesis: E2's second batch met the desktop research beta's reading on exposed tasks (BL-20261119-2128-e2-batch-2-result). The owner opened the beta now, with a zero-fee check on two fresh tasks beside it (BL-20261120-0657-owner-opens-beta-with-fresh-check-and-starts-e5). This amendment registers that check before any of its runs: Heavy, at the fixed writer's source, on two tasks nothing has shaped.

Decisions:
1. **Its standing.** It reads the beta's gate (Amendment 1, point 7) for the writer in force, not the card's decision rule, which needs both arms. Heavy stays the E3 and E4 writer by Amendment 2's result. The two clauses against later changes are read as Amendment 2 reads them: each binds a batch from its first run.
2. **The hypothesis, as a count of 4.** Heavy has at least 3 of its 4 graded runs accepted. No rate is claimed.
3. **The values.** One commit on `main` that includes lane S-e1's manifest and whose source freeze is `86732c63…`, so its source equals 734e702's. Both research protocol hashes are unchanged. Amendment 1's card, settings, packet attempts, limits and dry run stand.
4. **The tasks.** `s3-museum-collection-store` and `s4-school-meals-service`, lane S-e1's, frozen in docs/experiments/e2-fresh-tasks-v1.json (sha256 ⟨MANIFEST⟩), exposure `fresh`.
5. **The runs.** For each task, one packet run (up to 5 attempts, the first packet kept) and two Heavy writer runs seeded from it. There are no writer-2 runs.
6. **The reading.** 3 or 4 accepted confirms the beta's gate on fresh tasks. Fewer goes to the owner, who decides whether the beta stays.
7. **Grading, stops and order.** The grading brief, with two bundles, fresh graders and one decoy; lane S-e1 scores; rows are `e2-<task>-<run>-fresh`. The card's stop rules and re-runs apply. s3 then s4, one run at a time on an idle endpoint (E5's card, O10), so likely overnight; 3 days from the first packet run.
8. **The runbook.** Lane S-pipe's a10: a9 without seeding (sha256 ⟨A10⟩ once the manifest is pinned in it).

Changes: docs/experiments/e2-card-2026-11-17.md gains "Amendment 3 (2026-11-20)"; this file. No code changes.

Evidence: The runbook's test passes 41 of 41 on a synthetic manifest. It fails against the a8 runbook and against 6 mutants: writer-2 allowed, an earlier task allowed, no guard for the unpinned manifest, the manifest unchecked, and Amendment 1 or the scope dropped from the authority record.

Failures or blockers: None. The manifest's sha256 and the runbook's final sha256 wait on lane S-e1's pull request.

Limitations and non-claims: Four runs on two small synthetic tasks give no rate, and a miss is reported, not read as the writer failing in general. The fresh tasks are synthetic, like s1 and s2, and E3's tasks stay the test on real work.

Paid exposure: None. The runs are zero-fee on the owned endpoint, and the graders run on the owner's Claude subscription.

Next gate: Lane S-e1's manifest pull request; then the two sha256s filled in here, the coordinating session's review and the merge; then the window, on an idle endpoint.

References: docs/experiments/e2-card-2026-11-17.md; docs/experiments/e2-grading-brief.md; docs/experiments/e5-card-2026-11-17.md (O10); BL-20261118-1605-e2-card-amendment-1; BL-20261119-1702-e2-card-amendment-2; BL-20261119-2128-e2-batch-2-result; BL-20261120-0657-owner-opens-beta-with-fresh-check-and-starts-e5.
