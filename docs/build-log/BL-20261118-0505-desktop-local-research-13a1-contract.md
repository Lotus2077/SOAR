### BL-20261118-0505-desktop-local-research-13a1-contract -- 2026-11-18 -- 13a.1, part 1: what a desktop research task is and when one may be created, with its start refused until the stage is wired

Status: `Implemented`

Scope or hypothesis: This is the first of 13a.1's four pull requests (decision 8 of BL-20261118-0438-desktop-local-research-13a-design). It adds the contract, record version 4, the create checks, the card read, the availability and guard test R10. It runs nothing: a research task's start checks its identity and then ends `general_task_research_unwired`. Part 2 replaces that one line with the stage. The pull request's description holds the detail.

Decisions:
1. **The record.** Creating with `research: "local_beta"` stores a version-4 record on the heavy profile. It carries the route and the accepted card's sha256 and date, and never consultation or typed URLs. Its phase has the claims ledger from creation, made as the driver's `withClaimsLedger` makes it, with retrieval off. Its model is always salted. Its identity binds the flag and the exact card bytes it was created on.
2. **Create checks.** A research task is refused without the flag or an accepted card, with consultation or typed URLs, on the standard profile, for a non-document deliverable, without inputs, with any input the stage cannot read in full (requirement C), or when the mandatory work exceeds the pipeline's budget. The input checks call the pipeline's own functions. The card's clock admission stays the stage's decision at start.
3. **The card.** One function reads the pair, with the driver's pinned reader and expectation and with cache salt on. Guard test R10 admits this function beside the driver's builder, and requires both to hand the pair straight to the pinned load. Only while the flag is on, the availability shows the beta, with either the card's date and hash or the reader's code.
4. **Rows.** The receipt's arm is `local-heavy-research`. registry-row.py accepts it on the heavy profile only (lane S-harn's pattern).

Changes: src/main/general-tasks/research-route.ts (new) and controller.ts; src/main/config.ts and .env.example (`SOAR_ENABLE_LOCAL_RESEARCH_BETA`, off by default, and the card's two readers); src/shared/general-task-contracts.ts; scripts/registry-row.py; tests/unit/desktop-research-route.test.ts (new), general-task-controller.test.ts, registry-row-verdict.test.ts and serving-card-reader.test.ts; this entry.

Evidence: At `main` 4ec4928 plus this change, `pnpm typecheck`, `validate:readiness` and `validate:build-log` pass, and the four changed or new test files pass (256 tests). The full `pnpm test` passed 3,984 tests, with 88 skipped and one failure: a document-review flags test whose python3 spawn hit its 60 s limit at a load average near 15 during the r3 runs. That test passes alone in 0.9 s and touches nothing this change does. All 33 mutants of the new checks were killed. No Docker, window or model endpoint was used.

Failures or blockers: None.

Limitations and non-claims: No research task runs, and the task view shows nothing new; parts 2 to 4 add those. Requirement A, the beta's own user-data folder, comes in part 4. Until then the flag works in any build, so no beta build is made before part 4. No request reached a model endpoint.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: One light review. The merge waits until the coordinating session says the last r3 run has ended. Part 2 then wires the stage.

References: BL-20261118-0438-desktop-local-research-13a-design; BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout.
