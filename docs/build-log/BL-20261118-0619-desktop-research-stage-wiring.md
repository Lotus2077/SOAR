### BL-20261118-0619-desktop-research-stage-wiring -- 2026-11-18 -- 13a.1, part 2: a desktop research task runs the local reading stage on its card before the writer, with the writer's bound as one named setting and the stage shown from its own records

Status: `Implemented`

Scope or hypothesis: Part 2 of 13a.1 (decision 8 of BL-20261118-0438-desktop-local-research-13a-design). It follows the r3 re-measurement, which met the first half of 13a's gate: 2 of 3 runs reached the packet. Part 1 (BL-20261118-0505-desktop-local-research-13a1-contract) refused a research task's start; this part wires the stage. The pull request's description holds the detail.

Decisions:
1. **The stage.** A version-4 task's session gets the driver's research option, built from the card the task was created on: the reader, planner and synthesiser on the task's own local model (salted, heavy profile), the card's role policy, its admission rates under a `serving_card` basis only, and its K. It never gets a diagnostics sink, a budget override or an assist. The card and the protocol identity stay the only binding.
2. **The writer's bound (requirement B).** It is one named setting, `DESKTOP_RESEARCH_WRITE_BOUND` in src/main/general-tasks/research-route.ts, shipped as "profile": the heavy profile's 80 model calls, 120 tool calls and 90 minutes. E2's "twelve-call" (12, 12 and 1,200,000 ms, the driver's values, pinned by a test) is a change of that one line. The session keeps the profile's request pool and elapsed limit.
3. **What the snapshot shows.** A research task's snapshot carries its route, card and stage, read only from the stage's own records: whether the stage has not started, is running, transferred or stopped; for each stage, its latest calls, the replies cut at the output limit, any host fallback (the host's plan, or the synthesis skeleton) and the extraction's chunks; and the stage's own model requests, which the writer's model calls leave out. The sentences and the badge are part 3's.
4. **A fix.** A research stage that stops before the write phase leaves the writer's context unmade. Reading the snapshot of such a task threw `private_agent_context_missing`; it now reads the task as having no writer context yet.

Changes: src/main/general-tasks/controller.ts and research-route.ts; src/shared/general-task-contracts.ts (`GeneralTaskResearch`); .env.example; tests/helpers/desktop-research-server.ts (new); tests/unit/general-task-controller.test.ts and desktop-research-route.test.ts; this entry.

Evidence: On `main` 468fdca plus this change, typecheck passes, and the controller, route, user-data-folder, startup-order, card-reader and registry-row test files pass (279 tests). All 22 mutants of the new wiring, write bound and stage view are killed. The full `pnpm test` before merging #162 passed 4,008 tests, with 88 skipped and one failure: an assist-capture test that timed out at 5 s under load, which passes alone. The stage ran end to end in the controller against a loopback endpoint answering with the research-v4 fixture replies, covering the three facts the r3 runs showed. No Docker, model endpoint or network was used.

Failures or blockers: None.

Limitations and non-claims: The stage ran against a loopback endpoint with invented replies, never a model, so nothing here measures a real run. The view still shows a research stop with the generic sentence and no badge, and the quit and pause offers do not yet warn that a stage in progress cannot resume (part 3). Part 4b's gated research case is still to come. S-pipe's protocol revision may change how the stage ends; the snapshot reads that from the records, so it needs no change for it.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: One light review. Then part 3, the task view.

References: BL-20261118-0438-desktop-local-research-13a-design; BL-20261118-0505-desktop-local-research-13a1-contract; BL-20261118-0530-desktop-research-beta-user-data-folder.
