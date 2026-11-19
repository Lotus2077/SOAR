### BL-20261119-1701-correction-owner-fix-writer-bugs-first-counts -- 2026-11-19 -- Correction to BL-20261119-1555-owner-fix-writer-bugs-first: its evidence mixed two counts of report rewrites, and three in four of its cut-offs, not all, came while reasoning with no tool call

Status: `Implemented`

Scope or hypothesis: Two figures in the Evidence of BL-20261119-1555-owner-fix-writer-bugs-first are wrong. Both came from lane S-pipe's read-only diagnosis of E2's first batch. S-pipe found them while applying the review of the writer fix (#195) and recounted from the runs' records. The owner's decision, "Fix first", and what it approves do not change.

Decisions:
1. **The report rewrites.** The entry says the two clock-bound Heavy runs "rewrote report.md with write_file 21 and 36 times". Those figures mix two measures. From the runs' tool calls on output/report.md:
   - s1 writer-1-1 made 28 write_file calls, 21 of which began at the report's title;
   - s2 writer-1-1 made 38 write_file calls, 36 of which began with a section or body piece.
   So the runs made 28 and 38 write_file calls. The original's point, that the report was replaced rather than extended, stands.
2. **The cut-offs.** The entry says "All 22 length cut-offs in the batch came while reasoning". Each of the 22 replies reached the 16,384-token limit with reasoning taking most of its tokens, about 89% or more. But only 18 carried no tool call. The other 4 each carried one dropped tool call of 1 to 7 KB. The earlier count read message text only and missed calls stored apart as unexecuted.
3. **What follows.** The fix in #195 classifies a cut-off as "while reasoning" only when the reply has no tool call and under 1 KiB of text. E2's Amendment 2 states both counts as this entry gives them.

Changes: this file.

Evidence: Lane S-pipe recounted from the model_finished events of E2 batch e2-2026-11-19's run directories, read-only, and recorded the correction in its diagnosis note outside Git. #195's review raised the mismatch between 21 and 36 and the PR's 28 and 38.

Failures or blockers: None.

Limitations and non-claims: The recount covers the 12 writer runs of one batch. It shows nothing about why the model rewrote the file.

Paid exposure: None.

Next gate: None; E2's Amendment 2 uses the corrected figures.

References: BL-20261119-1555-owner-fix-writer-bugs-first; BL-20261119-1454-e2-result; pull request #195.
