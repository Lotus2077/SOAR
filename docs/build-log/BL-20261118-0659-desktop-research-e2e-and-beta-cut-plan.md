### BL-20261118-0659-desktop-research-e2e-and-beta-cut-plan -- 2026-11-18 -- 13a.1, part 4b: one gated end-to-end local research task through the built app, and the plan for cutting the beta build once its gate is met

Status: `Implemented`

Scope or hypothesis: Part 4b of 13a.1 (decision 8 of BL-20261118-0438-desktop-local-research-13a-design), stacked on part 3 (#168). It adds the gated Playwright case the design named and, at the coordinating session's request, the checklist for cutting the beta build. No build is cut: E2's graded runs and the adopted card revision come first. The pull request's description holds the checklist.

Decisions:
1. **The case.** tests/e2e/general-task-local-research.spec.ts runs only with SOAR_RUN_LOCAL_RESEARCH_E2E=true and an installed image id. It launches the built app with the beta flag (its own folder, part 4a), a synthetic card adopted with default roles, and one loopback endpoint that answers the reading stage with the research-v4 fixture replies and the writer with two scripted actions (a report citing one verbatim quote and its claims ledger, then finish); the writer runs in the installed offline image. The run must submit, show "packet ready" and the stage's counts, record the owner's verdict, export its receipt with arm `local-heavy-research` and row it through registry-row.py, and the default folder must stay empty.
2. **The helpers.** The loopback endpoint can now answer with one tool call. tests/helpers/serving-card-fixture.ts reads `import.meta.dirname`, so Playwright can load it as an ES module.
3. **The beta cut.** The pull request carries a checklist: the tag, a worktree under the owner's Developer folder, install and `pnpm check`, the beta checkout's own .env.local (flag, card pair, image id, model settings), the doctor, the plain start, a research job, and its verdict receipt rowed with arm `local-heavy-research`.

Changes: tests/e2e/general-task-local-research.spec.ts (new); tests/helpers/desktop-research-server.ts and serving-card-fixture.ts; this entry.

Evidence: Typecheck passes, the spec loads, lists and skips without its gate, and the tests that use the two helpers pass (108 for the card and route helpers, 22 research controller tests). No window, Docker, model endpoint or network was used.

Failures or blockers: None.

Limitations and non-claims: The gated case has not run: it opens a window and needs Docker, so it waits for the coordinating session's go. Its model is a loopback fixture, so it shows the app's path, not research quality. The checklist is a plan: nothing was cut, installed or configured.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: The coordinating session's go for the gated run, which needs a window and Docker; then one light review.

References: BL-20261118-0438-desktop-local-research-13a-design; BL-20261118-0652-desktop-research-task-view; BL-20261118-0530-desktop-research-beta-user-data-folder.
