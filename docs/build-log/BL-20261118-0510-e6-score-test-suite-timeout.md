### BL-20261118-0510-e6-score-test-suite-timeout -- 2026-11-18 -- The E6 scorer's unit tests get a 60 s suite timeout, after one test passed its assertions but took 5.9 s under the r3 runs' load

Status: `Implemented`

Scope or hypothesis: Lane S-harn found that tests/unit/e6-score.test.ts > "refuses a gold file that does not fit the format or its source" fails the default 5 s timeout at `main` 5140f5d. Run alone, it took 5.9 s twice at a load average near 13. Its assertions pass. Each test in the file spawns python3 many times.

Decisions: The suite takes `{ timeout: 60_000 }`, as the registry-row suites do. Nothing else changes.

Changes: tests/unit/e6-score.test.ts (the suite's options and a comment); this entry.

Evidence: The file's 15 tests pass in 6.9 s at a load average of 7. `pnpm validate:build-log -- --base-ref origin/main` exits 0.

Failures or blockers: None.

Limitations and non-claims: The scorer (scripts/e6-score.py), its version and the E6 card are unchanged. A longer limit lets a slow test finish; it does not make it faster.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: Merge on green CI.

References: BL-20261117-1107-e6-planted-defect-scorer-implemented.
