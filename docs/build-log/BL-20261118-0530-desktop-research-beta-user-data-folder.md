### BL-20261118-0530-desktop-research-beta-user-data-folder -- 2026-11-18 -- 13a.1, part 4a: a build with the local research beta on keeps its own user-data folder, chosen before the single-instance lock, and the beta is refused anywhere else

Status: `Implemented`

Scope or hypothesis: This is requirement A of BL-20261118-0438-desktop-local-research-13a-design: separation fails closed, so a beta build started the plain way never opens, migrates or writes the default folder's database, settings or lock. It is part 4's mechanism and tests, taken ahead of part 2 on the coordinating session's word. Part 4's gated research case comes after part 2. It is stacked on part 1 (#160), and the pull request's description holds the detail.

Decisions:
1. **The folder.** Electron keeps the single-instance lock in the user-data folder, so the folder is chosen before the lock. The main process reads the flag only from settings it can read without that folder: the environment, SOAR_ENV_FILE and the checkout's own .env.local and .env. "true" moves userData and sessionData to the default folder's sibling, "<default> Research Beta"; absent or "false" keeps the default folder. Any other value, a beta folder that resolves to, into or around the default folder (links included), unreadable settings or a move that does not hold refuses to start, with no lock taken.
2. **After the settings.** Bootstrap refuses to start, before the database opens, in two cases: the flag is on outside the beta folder (set only in the default folder's .env.local), or the beta's SOAR_DB_PATH leaves its folder. At run time the flag reads off outside the beta folder.
3. **setup:general.** From a checkout with the flag on, it writes the beta folder's .env.local. It refuses what the app refuses, before any probe.
4. **Order.** Part 4 must be on `main` before any build with this flag is cut for the owner (the review of part 1, minor 1). Until then, one research record in the default folder hides every saved task in owner-v0.2.1.

Changes: src/main/user-data-folder.ts (new), src/main/index.ts, src/main/bootstrap.ts, scripts/setup-general.ts; tests/unit/user-data-folder.test.ts and main-user-data-folder.test.ts (new), main-startup-order.test.ts and setup-general.test.ts; tests/e2e/research-beta-folder.spec.ts (new, gated); this entry.

Evidence: On part 1's head cc610ae plus this change, typecheck passes, the four new or changed unit test files pass (28 tests) and all 19 mutants are killed. The gated e2e passed against the built app in 4.9 s, and a copy with the flag off failed, as it should. The full `pnpm test` passed 4,009 tests, with 88 skipped and one failure: a workspace-lister test that timed out at 5 s at a load average near 19. That test passes alone in 0.7 s and touches nothing this change does. No Docker, model endpoint or network was used.

Failures or blockers: None.

Limitations and non-claims: The flag chooses the folder, so a beta checkout with the flag turned off is a plain checkout and uses the default folder, as any checkout of `main` does. The refusal box is not exercised in a window. Data the app keeps outside the user-data folder, such as Keychain credentials, does not move. No request reached a model endpoint.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: One light review. The merge comes after part 1, once the coordinating session says the last r3 run has ended.

References: BL-20261118-0438-desktop-local-research-13a-design; BL-20261118-0505-desktop-local-research-13a1-contract.
