### BL-20261119-0552-e2-grading-brief -- 2026-11-19 -- E2's grading brief: Phase 2's procedure written out for E2's three bundles, with headless graders confined to a copy of their bundle

Status: `Approved`

Scope or hypothesis: E2's card fixes its grading as Phase 2's procedure (item 10). It does not fix the graders' instructions, how a grader is started or the arm guess's wording, and it fixes only part of the decoy's handling. This entry records docs/experiments/e2-grading-brief.md, the session's procedural choice under the owner's delegation (BL-20261117-0940-owner-direction-decisions-delegated), before any E2 bundle exists. `Approved` covers the brief's text. Nothing has been graded.

Decisions:
1. **When.** r3's bundle is built and graded after its four writer runs and before s1's first packet attempt, so that the stop rule's "a refused bundle or a grading that could not be done" is read before the synthetic tasks. s1's and s2's follow the batch's last run.
2. **The graders.** One fresh grader for each of the three bundles. Each is a headless Claude Code process started in a copy of its bundle outside the repository, from a clean environment. It has no project or user instructions, memory, skill, installed plugin, user hook or MCP server, and no tool that runs a command or reaches the network. Its file tools are confined to the copy, and it may write only `verdicts.csv`. No other way of grading is used. If the process cannot start or its check fails, grading waits: for r3, that is the stop rule's pause.
3. **The sheet** follows E6's Part B, worded for research reports: Accept within 10 minutes of edits, a one-line reason, and an arm guess of `long`, `short` or `unsure` for the write budget. A sheet of the wrong shape goes back once to the same grader, resumed by its session id.
4. **The decoy.** `secrets` chooses one synthetic task, then one of its submitted writer runs. Its original stays in the same bundle, as in Phase 2.
5. **The scorer** for all three tasks is lane S-e1, working from the run directories: Phase 2's scorer for r3, and its own for s1 and s2.

Changes: docs/experiments/e2-grading-brief.md; this file. No code changes.

Evidence:
- **The sources.** The brief was checked against E2's card, E6's grading brief and Phase 2's entries. scripts/phase2-blind.py was read for what it copies and what it refuses.
- **The sign-in.** At about 05:50 UTC the command-line tool reported no signed-in account. The owner signed it in with a claude.ai account by 05:59 UTC, after r3's first packet attempt had started and before any bundle existed.
- **The grader's check passed on dummy files at 06:03 UTC.** Its tools were exactly Edit, Glob, Grep, Read and Write, and it had no instructions, memory or skills. Both reads outside the folder were denied, and so were a new file and a change to another file. `verdicts.csv` was written. A resume by session id reached the same grader with the same 5 tools.
- **No subagent fallback.** A subagent of the session reported this repository's instructions and the session's memory index in its context.

Failures or blockers: None.

Limitations and non-claims: The confinement was shown on dummy files only. The grader's context holds the signed-in account's email address. Because the decoy's original sits in the same bundle, its grader can compare the two. The original's verdict still counts for its arm.

Paid exposure: None by fee. The tool is signed in with the owner's claude.ai subscription, not a metered API key. E2's runs stay at USD 0.

Next gate: r3's bundle after its four writer runs.

References: docs/experiments/e2-card-2026-11-17.md (item 10, "Grading", "Stop rule", Amendment 1); docs/experiments/e2-grading-brief.md; docs/experiments/e6-grading-brief.md; BL-20261013-1627-phase2-scoring-protocol; BL-20261013-1630-phase2-blind-bundles; BL-20261013-1650-phase2-grading-package; BL-20261019-0410-blind-bundle-omissions; BL-20261117-0940-owner-direction-decisions-delegated; BL-20261117-0944-e2-card-approved; BL-20261118-0923-e6-grading-brief; BL-20261118-1605-e2-card-amendment-1.
