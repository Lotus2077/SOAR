### BL-20261118-0654-vitest-default-timeout -- 2026-11-18 -- Tests get a 30 s default timeout, so a full suite on the owner's loaded machine stops failing tests that pass on CI

Status: `Implemented`

Scope or hypothesis: On 2026-11-18, full-suite runs on the owner's shared machine, with several lanes' suites at once, failed tests at vitest's 5 s default that pass on CI. #161 and #165 each gave one suite a 60 s timeout. One default for every test replaces that suite-by-suite repair.

Decisions:
- vitest.config.ts sets `testTimeout: 30_000`. A test's, suite's or command line's own timeout still wins, so the 60 s suites of #161 and #165 and the live suites' `--testTimeout` are unchanged.
- Hooks keep vitest's 10 s default. Nothing else changes.

Changes: vitest.config.ts (the timeout and a comment); this entry.

Evidence:
- With the new default, the full suite passed at `main` 7873a35 (4,012 tests, 100.5 s) and at ce27bfc (4,027 tests, 83.4 s), with 88 skipped and none failed, at load averages between 5 and 28.
- In those runs 9 and then 10 tests took over 5 s. All but one each time have their own limit. The one on the default would have failed at 5 s: build-log-entry-files' "fails each broken rule, naming it" (5.1 s), then sandbox-capture's "keeps the first 1,024 regular files in sorted order" (6.1 s).
- No quiet local machine was available. On CI's runner, in `main`'s check jobs at 7873a35, 78b8765 and 468fdca, 1, 1 and 3 tests took over 5 s, each with its own 15 s or 180 s limit. Those jobs took 164, 188 and 222 s.
- `pnpm validate:build-log -- --base-ref origin/main`, `pnpm typecheck` and `pnpm validate:readiness` exit 0.

Failures or blockers: None.

Limitations and non-claims: A longer limit lets a slow test finish; it makes nothing faster, and a test that slows down now passes unnoticed up to 30 s. A hung test fails after 30 s instead of 5. Neither file is in the source freeze, so the digest does not move.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: Merge on green CI, with the check job inside `main`'s recent 164 to 224 s.

References: BL-20261118-0510-e6-score-test-suite-timeout; BL-20261118-0622-assist-capture-test-suite-timeout.
