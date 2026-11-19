### BL-20261118-1626-controller-test-wait-timeouts -- 2026-11-18 -- The desktop controller tests' waits allow 15 s, so a loaded CI runner no longer fails the research stage test that waits for the writer

Status: `Implemented`

Scope or hypothesis: CI run 44345993652 (the `check` job, on the coordinating session's docs-only #186) failed tests/unit/general-task-controller.test.ts, "pauses in the writer and resumes from the transferred packet, with no second stage request". Its `vi.waitFor(() => expect(f.executions).toHaveLength(1))` gave up at 1.7 s with no execution. vi.waitFor's default limit is 1 s, and that wait spans the whole loopback research stage, which runs before the writer starts. Tests only; the pull request's description holds the detail.

Decisions:
1. **One named limit for every wait in the file.** `const WAIT = { timeout: 15_000 }` applies to all 21 `vi.waitFor` calls. Three are in the research stage tests: the failed one waits for the writer, and two wait for the stage's first request. The other 18 wait for the scripted runner to start, or for a cleanup, and have the same shape and the same 1 s limit. 15 s stays inside the 30 s default test timeout. A passing wait returns as soon as its condition holds, so passing runs take no longer.
2. **No other kind of wait** is in the file: no `vi.waitUntil`, `expect.poll` or timed sleep.

Changes: tests/unit/general-task-controller.test.ts; this entry.

Evidence: Before the fix, every stage reply was delayed by 400 ms in a local experiment that was not committed and is now restored byte for byte. The failed test then failed exactly as on CI ("expected [] to have a length of 1 but got +0" at line 1776, after about 1 s). With the fix, it and the two other stage tests pass on the same delayed stage. Without the delay, typecheck passes and the whole file passes (183 tests). No window, Docker, model endpoint or network was used.

Failures or blockers: None.

Limitations and non-claims: The delay stands in for a loaded runner; it does not reproduce CI's load. A stage slower than 15 s would still fail its wait. Only this one test file changed, so the rest of the suite was not rerun. The file is not in the headless driver's source freeze.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: The coordinating session's look, then its merge on green CI.

References: BL-20261118-0619-desktop-research-stage-wiring; BL-20261118-0654-vitest-default-timeout.
