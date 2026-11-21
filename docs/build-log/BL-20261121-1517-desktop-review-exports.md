### BL-20261121-1517-desktop-review-exports -- 2026-11-21 -- 13b.2: a document review exports its six deliverables, by an allowlist, as one bundle or one at a time; its host flags file stays in the task's own record

Status: `Implemented`

Scope or hypothesis: Part 2 of 13b (BL-20261120-0646-desktop-document-review-13b-design, decision 3), with the owner's answer on the bundle (BL-20261121-0611-owner-e5-proxy-jobs-and-13b-answers, decision 3). The view, the folder on either flag, the adapters and the e2e are later parts. The pull request's description holds the detail.

Decisions:
1. **An allowlist.** A review's artifacts are exactly the six deliverables E6 graded: `output/review-summary.md`, `review/edits.json`, `output/redline.docx`, `output/clean.docx`, `output/issues.xlsx` and `output/hygiene.json`. The list is the summary plus the driver's own artifact list less the flags file, so it follows what the review phase requires. Any other file a review writes is not offered for export.
2. **The host flags file stays in the task's record.** `output/review-flags.json` is never listed, read out, zipped or put in the receipt, as in E6's blind bundles. It stays in the task's checkpoints, for part 5's scoring adapter.
3. **The edit plan's path.** The artifact reference admits one path outside output/, `review/edits.json`, and the controller lists it for a review alone. In the ZIP it keeps its folder; the other five lose `output/`, as before. Every other task's exports are unchanged: every file under output/, and never `review/edits.json`.
4. **All six or no bundle.** While any deliverable is missing, a review offers no bundle and says so ("The bundle holds the review's six deliverables, and not all of them are saved. Export the files individually."). Each saved deliverable still exports on its own.

Changes: src/shared/general-task-contracts.ts; src/main/general-tasks/artifact-bundle.ts, controller.ts and review-route.ts; tests/unit/desktop-review-route.test.ts, general-task-bundle.test.ts and general-task-controller.test.ts; docs/MVP_ARTIFACT_BUNDLE_REPORT.md (a dated note); this entry.

Evidence: On main 8df08d5 plus this change, typecheck passes and the full `pnpm test` passes (4,145 tests, 88 skipped, none failed). 15 mutants, all killed, cover the reference schema, the ZIP's names, the allowlist, the all-or-nothing bundle rule and the unchanged rule for other tasks. Python's zipfile reads a review's bundle: the six names, the edit plan under review/, and none of the flags file's or a scratch file's bytes. The deliverables equal the grading brief's list and phase2-blind.py's tuple plus the summary. No persisted contract changes: the record, the receipt and the bundle manifest's form are as they were. The source freeze stays 139d012c…, as no frozen file changes.

Failures or blockers: None.

Limitations and non-claims: Nothing ran in a window or against a real model; the review tests' model requests reached a loopback endpoint only. A review's other files, such as a scratch note under output/, can no longer be exported from the app, though they stay in the task's checkpoints. The single export's save dialog proposes `edits.json` for the edit plan, without its folder. The view does not yet label the deliverables or show the flags (part 3), and the E6 scripts cannot yet read a desktop review (part 5).

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: The coordinating session's light review and its merge on green CI. Then part 3, the view.

References: BL-20261120-0646-desktop-document-review-13b-design; BL-20261121-0611-owner-e5-proxy-jobs-and-13b-answers; BL-20261121-0640-desktop-review-record-and-route; BL-20261120-0233-e6-result.
