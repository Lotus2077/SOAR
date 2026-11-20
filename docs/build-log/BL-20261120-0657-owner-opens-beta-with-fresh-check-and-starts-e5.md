### BL-20261120-0657-owner-opens-beta-with-fresh-check-and-starts-e5 -- 2026-11-20 -- The owner opens the desktop research beta now with a fresh-task check beside it, can run 8 or more real jobs a week, starts E5 today, and has `owner-v0.2.1` pushed

Status: `Approved`

Scope or hypothesis: The day's restated handoff (#204) asks the owner the items of its §4, item 1, by name, the beta first, and records each answer, quoted, before acting on it. The session asked four of them in one dialog on 2026-11-20 at about 07:00 UTC. `Approved` covers the owner's four choices. The steps that follow from them are the session's.

Decisions:
1. **The beta.** Asked: "E2's second batch met the desktop research beta's bar (Heavy 4 of 4 graded runs accepted), but only on the two tasks the writer fix was tuned on. Should that open the beta?" The owner chose "Cut now + fresh check (Recommended)": "Cut the beta with you now by #170's checklist (needs your hands), and in parallel run a zero-fee batch on two fresh tasks (about a day) to confirm the writer outside the tuned tasks." This answers Amendment 2, point 6, for the beta.
   - **The cut:** the tag `owner-v0.3.0-research-beta.1` on `main` at 9812bd8. Its source equals 734e702's, where E2's second batch ran, since every merge after it is docs only.
   - **The fresh check:** an E2 amendment registers it before any run, with two fresh tasks from lane S-e1 and Heavy's runs at zero fee, read by the beta's 3-of-4 rule. If it misses, the session reports that, and the owner decides whether the beta stays.
2. **Real jobs a week.** Asked: "The MVP bar is at least 6 of 8 real jobs accepted in each of two consecutive weeks, in the desktop build. How many real jobs a week can you run?" The owner chose "8 or more". This answers decision 6 of BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout.
3. **E5.** Asked: "E5 (your real jobs in the owner build) is waiting on its rehearsal and day 1, which need your hands. When can you start?" The owner chose "Today". Before the rehearsal, `pnpm check` runs again in the build's worktree on a quiet machine, then the doctor (BL-20261117-1157-e5-owner-build-cut, decisions 2 and 4).
4. **The tag.** Asked: "The owner build's tag owner-v0.2.1 exists only on this Mac. Push it to GitHub?" The owner chose "Yes, push it". It points to c02366a, already on `main`.

Changes: this file.

Evidence: The owner's choices in the session's chat on 2026-11-20 at about 07:00 UTC, in one dialog of four questions, quoted as asked and as chosen.

Failures or blockers: None.

Limitations and non-claims: The beta opens on a reading on exposed tasks; until the fresh check reports, its writer evidence is E2's second batch alone. Nothing here measures the beta or E5.

Paid exposure: None.

Next gate: The tag's push; the beta's cut by #170's checklist, with the owner's hands to start it and run the first job; E5's `pnpm check` and doctor, then the owner's rehearsal; the fresh check's amendment.

References: docs/experiments/e2-card-2026-11-17.md (Amendments 1 and 2); BL-20261119-2128-e2-batch-2-result; BL-20261117-1157-e5-owner-build-cut; BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout; BL-20261118-0659-desktop-research-e2e-and-beta-cut-plan.
