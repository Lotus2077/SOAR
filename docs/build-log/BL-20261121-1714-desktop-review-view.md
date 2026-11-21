### BL-20261121-1714-desktop-review-view -- 2026-11-21 -- 13b.3: the desktop shows the document review: an option the host offers, a form with a review's rules and no public-or-synthetic wording, a badge, the six deliverables and host flags expected

Status: `Implemented`

Scope or hypothesis: Part 3 of 13b (BL-20261120-0646-desktop-document-review-13b-design, decisions 1 and 3), with the owner's answers (BL-20261121-0611-owner-e5-proxy-jobs-and-13b-answers, decision 2: the UI says the review runs only on the owner's own model endpoint and never claims privacy). It also fixes what the coordinating session's review of 13b.1 found: the availability payload and the file picker still said public or synthetic for a review. The folder on either flag, the .docx text scan, the adapters and the e2e are later parts. The pull request's description holds the detail.

Decisions:
1. **The option.** "Review one document (beta)" shows only while the host offers it, with the host's words on where the document goes, which now name the endpoint's host and port, never its path or any user name or key. Ticked, the form takes a review's rules: no public-or-synthetic declaration, the summary's name fixed to review-summary.md, heavy and local only, no URLs, and exactly one .docx among the files. It is never offered beside local research. Unticked, or withdrawn by a later availability check, the form is a plain task's again.
2. **No public-or-synthetic wording on a review.** The picker asks for "the .docx to review, and any context files": a new optional picker payload, `{ review: true }`, changes its title only, and any other payload is refused as before. While a review is offered, the readiness line says a plain task takes declared public or synthetic inputs and a review takes the owner's own document by the waiver, and the availability payload's `publicOrSyntheticOnly` is false. The notice above the form says the same for a review, ticked or shown. A plain task's words are unchanged.
3. **The task.** A badge reads "Document review (beta) · single sample · {state}": not started, reviewing, paused, deliverables ready or stopped. A list names the six deliverables and which are saved, and says the flags file stays in the task's record. The ZIP's words name the six, and the history marks a review.
4. **Host flags expected.** A submitted review without a `host_flags` event says its flags were not recorded, as a research task with public sources does.
5. **One list.** The six deliverables move to the shared contract with the view's words. The exports take the same list, and a test pins it to the driver's own outputs less the flags file.

Changes: src/shared/general-task-contracts.ts; src/main/general-tasks/controller.ts and review-route.ts; src/main/general-tasks-ipc.ts; src/preload/index.ts; src/renderer/src/GeneralTaskWorkspace.tsx; tests/unit/app-general-task.test.tsx, desktop-review-route.test.ts, general-task-controller.test.ts, general-task-ipc.test.ts and preload-general-task-api.test.ts; this entry.

Evidence: On main ac7c5fb plus this change, typecheck passes and the full `pnpm test` passes (4,157 tests, 88 skipped, none failed). 41 mutants, all killed, cover the readiness line and its flag, host flags expected, the endpoint named, the shared list, the picker and its preload, and the form's and the task view's review rules. No persisted contract changes: the record, the receipt and the bundle are as they were. The IPC contract changes twice: the picker takes the optional payload, and `publicOrSyntheticOnly` becomes a boolean. The source freeze stays 139d012c…, as no frozen file changes.

Failures or blockers: None.

Limitations and non-claims: Nothing ran in a window: the view is tested in jsdom, not in the built app, which part 6's gated case does. The owner's model endpoint was not used. The badge's state comes from the task's status alone, and a review's flags show only once it is submitted. The single export's save dialog still proposes `edits.json` for the edit plan.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: The coordinating session's light review and its merge on green CI. Then part 4, once the beta-folder choice is settled with the coordinating session.

References: BL-20261120-0646-desktop-document-review-13b-design; BL-20261121-0611-owner-e5-proxy-jobs-and-13b-answers; BL-20261121-0640-desktop-review-record-and-route; BL-20261121-1517-desktop-review-exports.
