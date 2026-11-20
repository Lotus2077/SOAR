### BL-20261120-0646-desktop-document-review-13b-design -- 2026-11-20 -- 13b proposed: the staged document review (review-1, the single sample E6 kept) in the desktop as an opt-in beta route for one .docx, its six deliverables exported and its host flags shown, never sent

Status: `Proposed`

Scope or hypothesis: This designs backlog item 13b (decision 2 of BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout). E6 showed no difference between one sample and two (BL-20261120-0233-e6-result), so the route is review-1: the single sample the headless driver applies with `withDocumentReview`, which only the driver calls today. There is no code. The pull request's description holds the detail, the file references and how each point of the review was met.

Decisions: Each is this lane's recommendation, not yet approved.
1. **Route and record.** 13a's pattern: a flag that is off by default, and an option on each task. The phase is the driver's `withDocumentReview` unchanged: heavy, local only, exactly one .docx, a fixed `output/review-summary.md`, and the owner's goal as the brief. There are no URLs, research, consultation or card. A new record version 5 carries the route; the loader, the configuration identity (which needs the flag) and the receipt's arm `local-heavy-review1` all read it.
2. **Beta build and folder.** The review shares 13a's beta build and user-data folder, which is chosen when either flag is on (the owner may replace this).
3. **Exports.** The six deliverables, by an allowlist. For review tasks only, the artifact ref, the bundle's file names and its count of output files change, to admit `review/edits.json` and to keep `output/review-flags.json` out of every export, the bundle and the receipt. Host flags show once the task is submitted, and a missing record of them is reported.
4. **Inputs.** A real .docx passes today's credential scan, but the scan cannot see inside one. A review task also scans the document's text.
5. **Pause and resume** work as for a plain task. #192's journal does not apply. #195's identity guard binds the instructions, the check and the applier. A paused review resumes only while the flag is on.
6. **Tests and `Verified`.** Unit tests, and one gated Playwright case, announced, with a document the test builds. Before an owner build, one announced desktop review-1 run on the owned model, on a synthetic document.
7. **For the owner:** real documents (the build is unusable on private ones while the public-or-synthetic rule stands), the bundle's contents, and whether one synthetic desktop run is enough.

Changes: this entry. No code.

Evidence: Lane S-desk checked each point against `main` 9812bd8. The run figures are the six `local-heavy-review1` rows on `main`: 20 to 32 calls and 6 to 22 minutes a run. The scan was checked locally with the repository's own document builders and secret patterns. Nothing else was run.

Failures or blockers: None.

Limitations and non-claims: This is `Proposed`, and nothing is built or measured. E6's quality figures came from prepared briefs and do not carry over to an owner's free goal. The size, 5 to 7 days, is this lane's estimate.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: The coordinating session's re-check, then the owner's three answers before any 13b code.

References: BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout; BL-20261118-0438-desktop-local-research-13a-design; BL-20261120-0233-e6-result; BL-20261119-0612-research-stage-resume-design; BL-20261119-1620-writer-ledger-feedback-and-length-nudge; docs/experiments/e6-card-2026-11-17.md.
