### BL-20261118-0659-desktop-research-e2e-and-beta-cut-plan -- 2026-11-18 -- 13a.1, part 4b: one gated end-to-end local research task through the built app, and the plan for cutting the beta build once its gate is met

Status: `Verified`

Scope or hypothesis: Part 4b of 13a.1 (decision 8 of BL-20261118-0438-desktop-local-research-13a-design), on part 3 (#168, merged). It adds the gated Playwright case the design named and, at the coordinating session's request, the checklist for cutting the beta build. No build is cut: E2's graded runs and the adopted card revision come first. The pull request's description holds the checklist.

Decisions:
1. **The case.** tests/e2e/general-task-local-research.spec.ts runs only with SOAR_RUN_LOCAL_RESEARCH_E2E=true and an installed image id. It launches the built app with the beta flag (its own folder, part 4a), a synthetic card adopted with default roles, and one loopback endpoint that answers the reading stage with the research-v4 fixture replies and the writer with two scripted actions (a report citing one verbatim quote and its claims ledger, then finish); the writer runs in the installed offline image. The run must submit, show "packet ready" and the stage's counts, record the owner's verdict, export its receipt with arm `local-heavy-research` and row it through registry-row.py, and the default folder must stay empty.
2. **The helpers.** The loopback endpoint can now answer with one tool call. tests/helpers/serving-card-fixture.ts reads `import.meta.dirname`, so Playwright can load it as an ES module.
3. **The beta cut.** The pull request carries a checklist: the tag, a worktree under the owner's Developer folder, install and `pnpm check`, the beta checkout's settings (a `.env` link to the owner's settings file, never opened, and a `.env.local` with the beta's own lines, which the loader reads first), the doctor, the plain start, a research job, and its verdict receipt rowed with arm `local-heavy-research` in batch `research-beta-1`.

Changes: tests/e2e/general-task-local-research.spec.ts (new); tests/helpers/desktop-research-server.ts and serving-card-fixture.ts; this entry.

Evidence: Typecheck passes, the spec loads and lists, and the tests around the two helpers pass (368 at 5527ff3, which carries #168's fixes). The coordinating session ran both gated cases once each at 5527ff3, in the owner's Terminal panel. It used a fresh detached worktree under the owner's Developer folder, with no environment file. `pnpm install --frozen-lockfile` and `pnpm build` exited 0, on Node v22.22.2, with the installed image named by its sha256 id. The owner was told before the window opened. This case ran from 07:40:08 to 07:40:25 UTC, exit 0: "1 passed (15.0s)", the case itself 13.8 s. #72's general-task progress case, its first run since #150's fix, ran from 07:40:25 to 07:40:41 UTC, exit 0: "2 passed (15.6s)" (10.2 s and 4.8 s). The containers labelled `soar.private-job-id` were the same before and after, the worktree was clean after, and no dialog appeared. On that machine the built app submitted one local research task end to end. That covered the beta folder, the per-task option, the stage on the card, the writer in the installed offline image, the badge and the stage's counts, the verdict and its receipt, and the row with arm `local-heavy-research`. The second run moves #72's e2e assertion from `Implemented` to verified on that machine, outside CI. Merging `main` after the run brought only #171's E0 fixture changes; in registry-row.py those touch the fixture path and a help text. The verdict-receipt tests pass again (189).

Failures or blockers: None.

Limitations and non-claims: Each case ran once, on one machine, outside CI, where both cases skip. The model is scripted: the stage's replies are fixture text and the writer's two actions are fixed. So the run shows the app's path, not research quality, the card's speeds or a real model's behaviour. It did not exercise a stopped stage, a pause or a quit mid-stage in a window, or the gap state, which is not wired yet. No beta build exists: the checklist is a plan, and nothing was cut, tagged, installed or configured.

Paid exposure: None. Zero SOAR model requests and zero envelope spend; both runs answered from a loopback endpoint.

Next gate: Green CI, then the coordinating session merges. No beta build is cut until it says so, after E2's graded runs and the adopted card revision.

References: BL-20261118-0438-desktop-local-research-13a-design; BL-20261118-0652-desktop-research-task-view; BL-20261118-0530-desktop-research-beta-user-data-folder.
