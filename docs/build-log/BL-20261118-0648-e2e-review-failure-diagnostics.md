### BL-20261118-0648-e2e-review-failure-diagnostics -- 2026-11-18 -- The Electron end-to-end review cases print the review's event summary when their wait for a finished review fails, and CI keeps a failed test's Playwright results for seven days

Status: `Implemented`

Scope or hypothesis:
- **The failure.** tests/e2e/electron.spec.ts:510 failed nine times since 2026-11-14, always at its wait for a completed review, about 5 s after the review started.
- **The only 5 s limit on that path** is the per-command git deadline: DEFAULT_GIT_TIMEOUT_MS in src/main/tools/git-command-policy.ts.
- **The CI logs cannot show** which command ran past it. The pull request has the detail.

Decisions:
- **A diagnostic, not a fix.** The review waits in the 510, 680 and 797 cases append the review-safe event summary to a failed wait: each tool call's name, outcome and duration, and error and reason codes.
- **CI keeps the results.** The electron-e2e job uploads .soar/test-results on failure, kept for 7 days.
- **No product change** until a failure confirms the command.

Changes: tests/e2e/electron.spec.ts; .github/workflows/ci.yml; this entry.

Evidence: @@PROBE@@

Failures or blockers: None.

Limitations and non-claims: This does not fix the flake. The summary gives the inspection tool call's total duration, not which git command inside it ran long.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: Merge on green CI. The next red electron-e2e is read before anyone re-runs it.

References: BL-20261114-1656-registry-row-git-racy-checkout.
