### BL-20261120-1012-e5-rehearsed-and-research-beta-cut -- 2026-11-20 -- E5's build passes `pnpm check` and its rehearsal, so day 1 is open; the research beta is cut as `owner-v0.3.0-research-beta.1`, and its doctor is ready

Status: `Implemented`

Scope or hypothesis: This records the steps that follow the owner's answers of 2026-11-20 (BL-20261120-0657-owner-opens-beta-with-fresh-check-and-starts-e5): E5's checks and rehearsal before day 1 (BL-20261117-1157-e5-owner-build-cut; E5's card, O10), and the beta's cut by #170's checklist. `Implemented` covers the builds as they stand on the owner's Mac. No E5 job or beta job has run.

Decisions:
1. **E5's build** (`owner-v0.2.1`, c02366a) meets the condition left open on 2026-11-17. `pnpm check` exited 0 in its worktree on a quiet machine. The doctor, read-only, said ready with the identity E5's card names: alias RM-01 VLM, root Qwen3.8-Flash-Next-NVFP4, engine 0.33.0rc1.dev617+g821038729 and 262,144 tokens. No card is configured, as the card expects.
2. **E5's rehearsal is done.** The owner ran one synthetic throwaway job in that build, which submitted, recorded a verdict and exported its receipt. The session printed its row with `registry-row.py --verdict-file` and appended nothing. The owner confirmed that the build opened the app's existing tasks. Day 1 is the UTC date of the owner's first real job from now.
3. **The tag `owner-v0.2.1` is pushed,** on the owner's "Yes, push it".
4. **The beta is cut.** The tag `owner-v0.3.0-research-beta.1` was made at 9812bd8 and pushed. The build is a detached worktree beside E5's.
   - `pnpm install --frozen-lockfile` and `pnpm check` exited 0.
   - Its settings follow #170's step 5: a link to the owner's settings file, which was never opened, and the five beta lines.
   - The doctor said ready, with the adopted card matching (9cd65c4e…) and the image configured as qualified.
   - The owner starts it and runs its first research job.

Changes: this file. Nothing tracked changes: the tags are refs, and the worktrees, the link, the settings lines and the receipts are outside Git or ignored.

Evidence:
- **E5's check:** `pnpm check` ran from 06:58:55 to 07:00:24 UTC at a load near 3; 193 test files and 3,868 tests passed. The doctor ran at 07:01 UTC.
- **The rehearsal's receipt:** submitted in 209 s with 38 model calls at USD 0, accepted with 4 minutes and 0 interventions, exported through the app. Its printed row's writer exited 0.
- **The beta's check:** `pnpm check` ran from 07:01:44 to 07:03:47 UTC; 207 test files and 4,123 tests passed. The doctor ran at 10:10 UTC.

Failures or blockers: One slip, fixed before any start. The beta's first settings link was empty, because E5's build links the owner's file as `.env.local`, not `.env`; it was removed and made again.

Limitations and non-claims: No E5 or beta job has run, and the rehearsal job counts for nothing. The doctors' settings path is copied nowhere. The beta's writer evidence is E2's second batch until the fresh check (#206) reports.

Paid exposure: None. The doctors' completions and the rehearsal ran at zero fee on the owner's endpoint.

Next gate: E5's day 1, the owner's first real job; the beta's first research job; E2's fresh check, one job at a time on an idle endpoint.

References: BL-20261120-0657-owner-opens-beta-with-fresh-check-and-starts-e5; BL-20261117-1157-e5-owner-build-cut; docs/experiments/e5-card-2026-11-17.md; BL-20261118-0659-desktop-research-e2e-and-beta-cut-plan.
