### BL-20261121-1723-desktop-review-folder-and-docx-scan -- 2026-11-21 -- 13b.4: either beta flag chooses the one beta folder, the 13b build supersedes owner-v0.3.0-research-beta.1, and a review scans its document's own text for credentials

Status: `Implemented`

Scope or hypothesis: Part 4 of 13b (BL-20261120-0646-desktop-document-review-13b-design, decisions 2 and 4). The coordinating session chose option A for the folder on 2026-11-21. The adapters and the e2e are later parts. The pull request's description holds the detail.

Decisions:
1. **One beta folder on either flag (option A).** `decideUserDataFolder({ research, review }, defaultPath)` chooses "<default> Research Beta" when either flag is "true", and the suffix is kept, so the owner's research-beta tasks stay where they are. An invalid value of either flag refuses to start, naming that flag. The review flag set only in a user-data folder's own settings refuses to start, as the research flag does. Settings that cannot be read refuse to start (`userDataFolderFromSettings`), and the setup doctor chooses its folder the same way. The shared refusal texts now say "the beta" rather than "the local research beta".
2. **The 13b build supersedes owner-v0.3.0-research-beta.1.** Once a review exists in the beta folder, that build's task list fails on the version-5 record ("Saved tasks could not be loaded"). Checked against its tag, not run: its only startup write marks a running task interrupted, as the new build does, and nothing else is rewritten. The owner is told to stop opening it. E5 does not depend on it: E5 runs in owner-v0.2.1 in the default folder. .env.example says so.
3. **Part 6's synthetic run uses a throwaway folder,** launched with a temporary `--user-data-dir`, as research-beta-folder.spec.ts does, never the owner's.
4. **The .docx text scan.** The selection's credential scan reads a file's bytes, which cannot see inside a deflated .docx. A review now also reads the document's ZIP and inflates every XML part within 32 MiB in total and 4,096 entries. Those parts are the body, headers, footers, comments, notes and properties. It applies the same patterns to each part's markup and to its text with tags removed and character references decoded, so a credential split across runs is found. A credential refuses with `general_task_credential_input_denied`. A document it cannot read whole refuses with `general_task_review_document_unreadable`: not a ZIP, cut, encrypted, ZIP64 or an unsupported method, or over the budget. In each case nothing is saved.

Changes: src/main/user-data-folder.ts; src/main/index.ts; src/main/bootstrap.ts; scripts/setup-general.ts; src/main/general-tasks/docx-text-scan.ts (new) and controller.ts; .env.example; tests/unit/user-data-folder.test.ts, main-user-data-folder.test.ts, setup-general.test.ts, docx-text-scan.test.ts (new) and general-task-controller.test.ts; this entry.

Evidence: On main 4946cd9 (with #216) merged into this branch, typecheck passes and the full `pnpm test` passes (4,167 tests, 88 skipped, none failed). One earlier full run on that tree failed two tests in private-agent-sandbox-capture.test.ts after 16 and 41 s under load; the file passed alone in 2 s and in the next full run, and this change does not touch it. 18 mutants: 16 killed. The 2 that survived are equivalent: each removes one of three overlapping size guards (the declared size, the inflation cap, the inflated length), and the other two still refuse with the same answer. A test with an understated size header shows the cap and the length check holding. The real src/main/index.ts, under a fake Electron app, moves to the beta folder for the review flag alone and refuses a malformed one. No persisted contract changes. The source freeze stays 139d012c…, as no frozen file changes.

Failures or blockers: None.

Limitations and non-claims: Nothing ran in a window or against a model; the old build was read at its tag, not run. A plain task's .docx inputs are still not text-scanned: its public-or-synthetic declaration covers them. The scan finds only what the repository's credential patterns find, and an image or embedded object inside the document is not read. A beta folder that already holds a review stays unreadable to owner-v0.3.0-research-beta.1.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: The coordinating session's merge on green CI. Then part 5, the grading and scoring adapters.

References: BL-20261120-0646-desktop-document-review-13b-design; BL-20261121-0611-owner-e5-proxy-jobs-and-13b-answers; BL-20261121-0640-desktop-review-record-and-route; BL-20261118-0530-desktop-research-beta-user-data-folder.
