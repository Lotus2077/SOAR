### BL-20261118-0800-git-command-deadline-15s -- 2026-11-18 -- Each git command the desktop runs gets a 15 s deadline instead of 5 s, still below the inspection's 20 s deadline, after the first diagnosed Git-review e2e failure showed one of an inspection's first commands running past 5 s

Status: `Implemented`

Scope or hypothesis: The e2e case "reviews current Git changes locally and refuses a stale Markdown copy" fails in about 1 in 30 CI runs on macOS, always about 5 s after the review starts. With BL-20261118-0648-e2e-review-failure-diagnostics in place, run 44260413394 printed the review's events. `inspect_git_changes` failed after 5,609 ms: the 5,000 ms deadline, plus the 500 ms kill grace, plus about 110 ms. So one of the inspection's first commands ran past the deadline: a trivial `git rev-parse` that reads no input.

Decisions: DEFAULT_GIT_TIMEOUT_MS goes from 5_000 to 15_000. It stays a per-command hang guard below the whole inspection's existing 20 s deadline (MAX_INSPECT_DURATION_MS), and a unit test now checks that order.
- A first draft at 30 s was dropped at review: under the 20 s inspection deadline it could never fire.
- That 20 s deadline is the whole-inspection alternative, and it already exists.
- The e2e review waits allow 40 s (two inspections), and the view waits 25 s. The Fake Cloud failure case's wait gets the event summary too.

Changes: src/main/tools/git-command-policy.ts; docs/ARCHITECTURE.md; tests/unit/git-process.test.ts; tests/e2e/electron.spec.ts; this entry.

Evidence:
- **The failure.** Run 44260413394's event summary (Scope).
- **The tests.** The full unit suite passes 4,064 tests, with none failed. The six test files on the git runner and the reviews pass 111 tests.
- **The checks.** `pnpm typecheck` exits 0, and `pnpm validate:build-log -- --base-ref 527d3d6` (the branch point) exits 0.
- **The review.** One light review. Its major, its minors and its nits are all taken.

Failures or blockers: None.

Limitations and non-claims:
- The logs do not show why the command stalled.
- A stall over 15 s still fails a review closed, and the e2e summary would show it.
- The e2e cannot run on this machine, so the flake fix is not verified until its CI runs stay green. A handful of green runs cannot show it either, against a base rate near 3%.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: Merge on green CI. The next red electron-e2e is read before anyone re-runs it.

References: BL-20261118-0648-e2e-review-failure-diagnostics.
