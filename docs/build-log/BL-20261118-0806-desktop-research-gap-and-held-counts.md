### BL-20261118-0806-desktop-research-gap-and-held-counts -- 2026-11-18 -- 13a.1: the research view shows a packet's disclosed gap from the coverage the writer received, and the held passages, worded "not resolved"

Status: `Implemented`

Scope or hypothesis: The desktop's research view reads the three fields lane S-pipe's #172 added (BL-20261118-0712-research-one-declared-gap): the extract row's `declaredGaps`, `heldChunks` and `heldKeptUnrepaired`. Its badge's reserved gap state (BL-20261118-0652-desktop-research-task-view) is now set from the transferred coverage.json's `gaps`, as the coordinating session asked. The pull request's description holds the detail.

Decisions:
1. **The badge's gap.** A transferred packet's gap is read from the packet's own coverage.json: one checkpoint file, loaded with its size and digest checked. It names the source and the number of questions; the writer is told to state those as an unresolved limitation. If that file cannot be read, the extraction row's `declaredGaps` count stands in, without a source. A coverage that lists no gap means none.
2. **The wording matches the writer's instruction**: "not resolved", never "no evidence". The badge reads "packet ready, with a disclosed gap (1 passage not resolved)". The extraction line adds "1 passage not resolved after its repairs, disclosed with the packet". The section names the source and the number of questions. The reserved wording "not read" is gone: that passage was read.
3. **The held line** says how many held passages kept their first reading, and names the budget only when one did. Without any, it says each held passage got its optional repair.

Changes: src/main/general-tasks/research-route.ts and controller.ts; src/shared/general-task-contracts.ts; src/renderer/src/GeneralTaskWorkspace.tsx; tests/unit/desktop-research-route.test.ts, app-general-task.test.tsx and general-task-controller.test.ts; this entry.

Evidence: On main e808fc1 plus this change, typecheck passes, and the route, view and controller test files pass (261 tests). On the real stage, every reply for one source's passage, its repair's included, declares the plan's question needs_followup. The task then submits, the packet transfers with the gap {1 passage, that source, 1 question}, the extract row records `declaredGaps: 1`, and the coverage the writer received lists the same gap. All 20 mutants of the read, the gap's rules, the controller's wiring and the wording are killed. No window, Docker, model endpoint or network was used.

Failures or blockers: None.

Limitations and non-claims: Nothing was seen in a window; the view's tests render it in jsdom. The held counts come from synthetic rows only, because the test card has no admission rates, under which alone the stage records them. The gap test's replies are fixture text. Lane S-pipe's Reported-issues sentence for a gap, "the packet holds no evidence from it", is left as merged and raised with the coordinating session. No request reached a model endpoint.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: One light review, then the coordinating session merges on green CI.

References: BL-20261118-0712-research-one-declared-gap; BL-20261118-0652-desktop-research-task-view; BL-20261118-0619-desktop-research-stage-wiring.
