### BL-20261120-0646-desktop-document-review-13b-design -- 2026-11-20 -- 13b proposed: the staged document review (review-1, the single sample E6 kept) in the desktop as an opt-in beta route for one .docx, its six deliverables exported and its host flags shown, never sent

Status: `Proposed`

Scope or hypothesis: This designs backlog item 13b (decision 2 of BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout). E6 showed no difference between one sample and two samples with critique and repair (BL-20261120-0233-e6-result), so by E6's card the route stays review-1, the single sample the headless driver applies today. Only the driver calls `withDocumentReview`; the desktop reviews documents through the plain agent loop. There is no code. The pull request's description holds the detail, the file references and the open questions.

Decisions: Each is this lane's recommendation, not yet approved.
1. **Route.** It follows 13a's pattern (BL-20261118-0438-desktop-local-research-13a-design).
   - A settings flag, off by default, makes the review beta available; a checkbox on each task turns it on.
   - The task's phase is the driver's `withDocumentReview(phase)` unchanged: the pinned applier, its instructions, the six required outputs and the `document_review_fidelity` check.
   - The task is heavy, local only, with exactly one .docx; URLs, research and consultation are refused.
   - No serving card is needed. The record stores the route. A badge names it.
   - The review beta shares 13a's beta build and user-data folder, so E5's build and database stay as they are.
2. **What the owner sees and exports.** The six deliverables are the task's artifacts and its bundle, by an allowlist that adds `review/edits.json`. `output/review-flags.json` never leaves, by single export, bundle or receipt, as the blind bundles left it out. Its counts show under Reported issues, and a review task that has no host-flags event says so. The receipt's arm is E6's `local-heavy-review1`.
3. **Pause and resume.** A review run is one writer phase with no stage of its own, so it pauses and resumes as a plain task does: at an action boundary, from the last checkpoint. #192's journal does not apply. #195's fail-closed rule does: the runner's identity binds the instructions, the check and its applier, so a resume after any of them changes is refused. As for a research task, a paused review resumes only while the beta is on.
4. **Tests and `Verified`.**
   - Unit tests without Docker, a window or an endpoint.
   - One gated Playwright case, announced, with a scripted writer and the real applier in the installed image.
   - Before an owner build: those, then one announced review-1 run through the desktop on the owned model, on a synthetic document with no gold.
5. **Open owner questions** are listed in the pull request; none is decided here.

Changes: this entry. No code.

Evidence: Lane S-desk and two read-only agents read `main` c570f0c and E6's result branch. Each fact the design rests on was checked against the code. The figures are E6's rows: 20 to 32 calls and 371 to 1,347 s per review-1 run, on the heavy profile. Nothing was run.

Failures or blockers: None.

Limitations and non-claims: This is `Proposed` only. Nothing is built or measured. The size (about 3.5 days) is this lane's estimate.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: One light review, then the owner's answers and the coordinating session's approval, before 13b.1's code.

References: BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout; BL-20261118-0438-desktop-local-research-13a-design; BL-20261120-0233-e6-result; BL-20261119-0612-research-stage-resume-design; BL-20261119-1620-writer-ledger-feedback-and-length-nudge; docs/experiments/e6-card-2026-11-17.md.
