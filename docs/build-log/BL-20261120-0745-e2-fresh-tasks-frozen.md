### BL-20261120-0745-e2-fresh-tasks-frozen -- 2026-11-20 -- E2's two fresh tasks for the fresh-task check are written and frozen by hash in docs/experiments/e2-fresh-tasks-v1.json; lane S-e1 holds their gold

Status: `Implemented`

Scope or hypothesis: The owner opened the research beta with a zero-fee check of the writer on two fresh tasks (BL-20261120-0657-owner-opens-beta-with-fresh-check-and-starts-e5, decision 1), which E2 Amendment 3 (#206) registers. As for E2's first tasks (BL-20261117-1158-e2-synthetic-tasks-frozen), a separate session, lane S-e1, wrote them and holds their gold, so the session running the check never sees it. This entry freezes them by hash. It holds ids, counts and hashes only.

Decisions:
- **The tasks.** Both have exposure `fresh`: no writer run, grade, diagnosis, writer fix or its reviewers has seen them, and their topics are unlike r3's, s1's and s2's.
  - `s3-museum-collection-store` (job `e2-s3-museum-collection-store`): a museums trust choosing a site for a shared collection store. 11 sources, 15,807 bytes.
  - `s4-school-meals-service` (job `e2-s4-school-meals-service`): a council choosing how to provide school meals. 11 sources, 12,154 bytes.
- **E2's first tasks' design, unchanged.** Item 5's shape: invented Markdown sources, each under 64 KiB (the largest is 2,454 bytes); 7 critical checks each, 14 in all; one planted conflict between two sources. The briefs name no figure and ask for one recommendation line, "Recommended site: <site name>" (s3) and "Recommended model: Model <letter>" (s4).
- **The scorer** is E2's version 1, unchanged. The manifest keeps `e2-tasks-v1.json`'s shape, and its scorer block equals that file's, as lane S-pipe's runbook a10 requires. The new tasks' own 27 tests on fake runs are a private file, sha256 `6c57df9f…`.
- **The light review** found one major finding (seven s4 schools without a kitchen in the first weeks of term) and minor ones. All were fixed before this freeze. A skeptic confirmed the fixes and found five further minor points, which were fixed too. The detail is in the PR description.

Changes: docs/experiments/e2-fresh-tasks-v1.json (sha256 `fa3a0969…`, tasksSha256 `e63bf3a3…`); docs/experiments/README.md (one bullet); this file.

Evidence: Both task directories load through the driver's loader (prepared, no execution). Admission gives each the 1,500-word limit, 4 index batches and 11 chunks, within the pipeline's budget. The host's claims check passes on both reference outputs (37 and 30 claims, every quote found). The scorer gives each reference output 7 of 7, and the 27 tests pass.

Failures or blockers: None.

Limitations and non-claims: No model has run on these tasks. s3's decision follows s1's pattern (a capped grant share, ceilings on the local contribution and on running costs, a completion deadline), so a writer tuned on s1 may find its form familiar; its topic and figures are new. In s4, the conflict's 2026 side counts only when the writer cites the 2026 condition survey, its one source.

Paid exposure: None.

Next gate: The coordinating session's review and merge; #206's placeholders filled; the inputs copied under `taskRoot` and checked against this manifest before the first packet run; S-e1 scores the check's runs after grading.

References: docs/experiments/e2-card-2026-11-17.md (items 4 and 5; Amendment 3, #206); BL-20261117-1158-e2-synthetic-tasks-frozen; BL-20261120-0657-owner-opens-beta-with-fresh-check-and-starts-e5.
