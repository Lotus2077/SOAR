### BL-20261119-1620-writer-ledger-feedback-and-length-nudge -- 2026-11-19 -- The writer learns why its claims ledger fails, a twelve-call writer's ledger is checked when it first appears, and the length nudge says a reply was cut while reasoning

Status: `Implemented`

Scope or hypothesis: E2's batch e2-2026-11-19 ended 5 of 12 writer runs at a bound (BL-20261119-1454-e2-result). Lane S-pipe's read-only diagnosis of those runs found two causes the host can fix. First, the model never learned why its claims ledger failed: check_claims refused all 41 of its calls as invalid arguments, finish said only which check failed, and a twelve-call writer wrote its ledger in its last calls. Second, after a length cut-off the nudge's pieces of about 1,500 characters led to write_file calls that replaced the report instead of growing it; all 22 cut-offs were reasoning, with at most 126 visible bytes. The owner chose to fix both first (BL-20261119-1555-owner-fix-writer-bugs-first). Hypothesis: the three ledger failures become one-edit repairs and the two clock-outs stop overwriting their reports; E2's second batch tests it.

Decisions:
1. **check_claims ignores its arguments.** It takes none, and the host no longer validates what a reply carries. Its advertised schema, and so every request body, is unchanged.
2. **A failing ledger check says what failed.** finish's output and a bounded run's `host_validation_finished` carry `claimsLedger`: failing claim ids and codes, the entry a stopping code stopped at, citations without a claim, claims never cited, missing sections, and each code's fixed rule. Never a sentence, a quote, a source window or a locator.
3. **A twelve-call writer's ledger is checked once, when it first appears.** After the action whose captured snapshot first holds output/claims.json, the host runs the check on the live workspace and records it on that `tool_finished` (`claimsLedgerCheck`). A host notice derived from that field follows the tool result, live and on every replay. No model call or tool action is spent. Only the driver's `--write-bound twelve-call` and the desktop's twelve-call research bound set it; only their phase identity changes.
4. **The length nudge has two forms.** A cut reply with fewer visible bytes than the limit has tokens was cut while still reasoning, and the nudge asks for one complete tool call; otherwise it says the tool call was incomplete. Both say write_file replaces the whole file, so later pieces use append_file. The 1,500-character size is gone.
5. **Unchanged:** the research protocol hash (default `4bb74c03…`; under the adopted card `99bbc0e6…`, now pinned in a test), COORDINATOR_PROFILES.heavy and every limit, the claims check's script and its judge, and the research stage. Not done, as the owner approved neither: thinking off after a cut-off, and any change to Heavy's clock, allowance or per-reply cap.

Changes: src/main/private-agent/claims-feedback.ts (new), runner.ts and session.ts; src/main/general-tasks/controller.ts; scripts/private-agent-local-screen.ts; tests, with the writer's prompt-protocol pins re-pinned; this file.

Evidence:
- **Tests:** check_claims runs with five argument shapes; finish and the allowance validation return the codes and no claim text; the first-ledger check runs once, right after the write, spends no call or action, replays the same notice after a pause, and says so when it cannot run; the feedback reader on the real check's output (an over-long sentence at entry 11, a [C40] without a claim, an unverified quote, an uncited claim, a missing section, a missing ledger); both nudge forms and their threshold; the flag in both drivers and no other phase; the research protocol under the adopted card.
- **Mutants:** 22 of 22 fail a test. **Full suite:** 207 files and 4,117 tests passed (14 files and 88 tests skipped), none failed; typecheck, readiness and the build-log validator pass.
- **What moves:** the source freeze (`0b896d92…` → `64f5c6c56d898c7f2705fb0cf232a768ea30e12d65ca23e70c027d60af09c3ae`, recomputed on a clean tree), and the session prompt protocol, whose nudge texts change: the writer's layout-1 pins and golden identity are re-pinned, so a writer task paused before this change fails closed rather than resume under the new nudge. The research protocol does not move.

Failures or blockers: None.

Limitations and non-claims: No run has used these fixes yet. Whether the model repairs a ledger from the feedback, or stops overwriting after the new nudge, is the question for E2's second batch. The reasoning threshold rests on 22 cut-offs from one batch.

Paid exposure: None.

Next gate: One review and CI, then the merge; then E2's Amendment 2 registers a second batch at the merge commit.

References: BL-20261119-1454-e2-result; BL-20261119-1555-owner-fix-writer-bugs-first (#194); #140 (the twelve-call bound).
