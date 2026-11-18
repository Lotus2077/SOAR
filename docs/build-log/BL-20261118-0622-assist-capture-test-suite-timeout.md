### BL-20261118-0622-assist-capture-test-suite-timeout -- 2026-11-18 -- The assist capture's main test suite gets a 60 s timeout, after its refusals test passed the default 5 s under a full suite's load

Status: `Implemented`

Scope or hypothesis: In lane S-desk's full-suite run, tests/unit/assist-capture.test.ts > "refuses a second capture, …" failed the default 5 s timeout. The test passes alone. It builds nine fixture runs, each with its own git repository and a seed-source pipeline run. At `main` 468fdca it took 0.95 s alone, at a load average near 7.

Decisions:
- The suite that holds the test, "10.c: the assist capture", takes `{ timeout: 60_000 }`, as the e6-score suite has since #161.
- The file's other suites keep the default. Their tests take about 0.1 s each alone, and the command-line test already has its own 120 s limit.
- Nothing else changes.

Changes: tests/unit/assist-capture.test.ts (the suite's options and a comment); this entry.

Evidence:
- The file's 11 tests pass in 3.6 s, at a load average of 6.
- `pnpm validate:build-log -- --base-ref origin/main` and `pnpm typecheck` exit 0.

Failures or blockers: None.

Limitations and non-claims: The capture (scripts/assist-capture.ts) is unchanged. A longer limit lets a slow test finish; it does not make it faster.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: Merge on green CI.

References: BL-20261117-1258-assist-capture-implemented; BL-20261118-0510-e6-score-test-suite-timeout.
