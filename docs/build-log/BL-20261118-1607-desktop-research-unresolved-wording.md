### BL-20261118-1607-desktop-research-unresolved-wording -- 2026-11-18 -- 13a.1: the research view says passages were not resolved, never unread, when the stage read them and left them unresolved

Status: `Implemented`

Scope or hypothesis: The coordinating session asked for this after r3's third run under the adopted card, which ended with two passages unresolved. Since #172 (BL-20261118-0712-research-one-declared-gap), `research_extraction_incomplete` ends any stage with an incomplete passage other than the one disclosed gap, and that includes a passage read and declared unresolved (needs_followup). The desktop said the stage "could not read every source passage", and the research section counted passages "read". The owner would have read both as unreadable files. The pull request's description holds the detail.

Decisions:
1. **The stop sentence** reads: "The research stage could not resolve every source passage, even after its repairs, so nothing was handed to the writer. This task cannot resume; its research section shows how many passages were resolved." The proposal's middle clause, about more passages than the one a packet may disclose, was left out. It would be false for a single passage whose reply was invalid, and for a single unresolved passage whose repairs the budget cut.
2. **The extraction line** counts passages resolved: "Extraction: 0 of 2 source passages resolved; 2 repairs." It matches the gap clause's "not resolved".
3. **The badge and the held line** were checked and need no change. No badge state ("not started", "reading the sources", "packet ready", the gap state, "stopped before the writer") and neither held sentence ("kept their first reading", "got its optional repair") says a passage went unread. A test now pins that.

Changes: src/main/general-tasks/controller.ts; src/renderer/src/GeneralTaskWorkspace.tsx; tests/unit/general-task-controller.test.ts and app-general-task.test.tsx; tests/e2e/general-task-local-research.spec.ts (its expected line); this entry.

Evidence: On main 7a620cc plus this change, typecheck and readiness pass, and the full `pnpm test` passes (4,104 tests, 88 skipped, none failed). On the real stage, both passages' replies, their repairs' included, declare the plan's question unresolved. The stage records its extraction row (0 of 2 resolved, 2 repairs) and ends `research_extraction_incomplete`, and the task shows the new sentence. All 3 mutants of the two wordings are killed. No changed file is in the driver's source freeze, whose digest stays 0b896d92…. No window, Docker, model endpoint or network was used.

Failures or blockers: None.

Limitations and non-claims: Nothing was seen in a window. The gated e2e case's changed line was not run; it skips in CI. The fixture's replies are synthetic text. Earlier entries keep the old wording as they recorded it.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: One light review by the coordinating session, then its merge on green CI. No changed file is in the driver's source freeze, so it may merge during E2's and E6's pinned runs.

References: BL-20261118-0712-research-one-declared-gap; BL-20261118-0806-desktop-research-gap-and-held-counts; BL-20261118-0652-desktop-research-task-view.
