### BL-20261118-0652-desktop-research-task-view -- 2026-11-18 -- 13a.1, part 3: the task view offers local research per task and shows what the stage did from its own counts, with research stops worded and the pause and quit offers truthful mid-stage

Status: `Implemented`

Scope or hypothesis: Part 3 of 13a.1 (decision 8 of BL-20261118-0438-desktop-local-research-13a-design). It adds the per-task option, the badge, the sentences, and the pause and quit warnings, on part 2's snapshot (BL-20261118-0619-desktop-research-stage-wiring), and it is stacked on part 2 (#164). The pull request's description holds the detail.

Decisions:
1. **The form.** A "Local research first (beta)" checkbox appears only when the host reports the beta, and is disabled, with the reason, when the card is refused. When checked, it fixes the heavy profile and local-only routing, and clears and disables the typed URLs. Like create, it then needs an input file and a document deliverable.
2. **The badge and the section.** The task shows "Local research (beta) · serving card of <date> · <stage>": not started, reading the sources, packet ready or stopped before the writer, with "packet ready, with a disclosed gap" kept unwired for the protocol revision now before the owner. A "Research stage" section lists each stage's own counts and no fixed sentence: calls and replies cut at the output limit; the host's plan or the synthesis skeleton when used; passages read and repairs; the packet's trim; held passages kept at a first reading, once the stage records that count (proposed by lane S-pipe); and the stage's requests, counted apart from the model attempts.
3. **The stops.** These research stops each get their own sentence: extraction incomplete, mandatory budget, clock, unreadable source, no evidence, and a request refused once the allowance is spent. Any other research code is named, with "this task cannot resume". The writer's refusal sentence now also names a spent request allowance. The judge's unjudged claims stay in Claim judgements.
4. **Pause and quit.** While a stage runs, the task warns that a pause ends it. The quit offer says the task will end and cannot resume, instead of promising a resume. The controller tells the quit offer whether a stage is in progress.

Changes: src/renderer/src/GeneralTaskWorkspace.tsx and general-task.css; src/main/general-tasks/controller.ts and research-route.ts; src/shared/general-task-contracts.ts; src/main/liveness.ts, index.ts and bootstrap.ts; tests/unit/app-general-task.test.tsx, general-task-controller.test.ts, desktop-research-route.test.ts, liveness.test.ts and main-startup-order.test.ts; this entry.

Evidence: On part 2's head f94a313 plus this change, typecheck passes, the view, controller, route, liveness and startup-order test files pass, and all 37 mutants of the view, sentences, quit words and wiring are killed. The full `pnpm test` passed 4,035 tests, with 88 skipped and two failures: the build-log validator test and a document-review test, both timing out under load (a load average near 15). Both pass alone. No window, Docker, model endpoint or network was used.

Failures or blockers: None.

Limitations and non-claims: Nothing here was seen in a window; the view's tests render it in jsdom. The gap state and the held-passage line read fields nothing sets yet. The research request count is the stage's dispatch rows, retries included. No request reached a model endpoint.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: One light review, after part 2 merges. Then part 4b, the gated research case.

References: BL-20261118-0438-desktop-local-research-13a-design; BL-20261118-0619-desktop-research-stage-wiring; BL-20261118-0530-desktop-research-beta-user-data-folder.
