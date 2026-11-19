### BL-20261119-0602-criterion-6-restated -- 2026-11-19 -- Criterion 6 of the depth bar restated from Manus's current writing rules: the brief sets the form and length, and a summary or a table is required only where it asks

Status: `Proposed`

Scope or hypothesis: Criterion 6 of the bar (docs/PROJECT_REVIEW_2026-11-05.md §2.2) asked for 2,500-6,000 words with sections, a summary, at least one table and a URL reference list. Its only Manus anchor was "several thousand words", from an unofficial 2025 copy of Manus's agent prompt that §7 rates Low. A capture of 2026-11-19 holds three files that one Manus Deep Research task loaded: its deep-research skill, its workflow-composer skill and its workflow tool's definition. The deep-research skill sets no word target unless the user gives one, answers in chat when about 400 English words suffice, and allows no executive summary, method section or table unless the user asks. The bar stays proposed except where E3's and E4's approved rules use it (§2), and a change to an approved rule waits for the owner (topic 1 of BL-20261117-0940-owner-direction-decisions-delegated), so this restatement is the owner's call. The pull request's description holds the detail.

Decisions:
1. **Criterion 6, restated.** Continuous prose with sections and a URL reference list, in the form the brief states and within any length limit it states. A summary or a table is required only where the brief explicitly asks for one, and one it did not ask for does not fail the criterion. `claims.json` and the CSV rule are unchanged. A brief that states no length is judged on completeness (criterion 4 where it applies, and the blind verdict), not on a word count.
2. **E3 changes too.** Its rule lets only the word band yield to each brief's word limit, so until now the summary and the table applied in E3. Under the restatement, a frozen brief that asks for neither no longer requires them. The owner's answer therefore covers E3 as well. What each frozen brief asks for is read when E3's card is written; this change states no brief's content.
3. **E4's two fresh briefs state a form and a word range** that leaves room for criterion 3's 30 citations. Manus's rules and SOAR's arms would then answer the same request on form, length, summary and table, if the E4 option were ever funded. The four pinned benchmark items keep their own text.
4. **No code changes.** When a brief states no length, the synthesis default stays 6,000 words, clamped to the role's ceiling as before (1,200 words while the synthesiser thinks). The protocol hash binds that default, so it can move only in a later protocol revision.
5. **The capture stays outside the repository,** because it is a third party's internal text. §7 describes it, and the pull request paraphrases it.

Changes: docs/PROJECT_REVIEW_2026-11-05.md (§2.2, criterion 6's row; finding D13, a note on the old band; §7, a note under the heading, one new source row and the 2025 row's confidence); this file.

Evidence: The three captured files were read in full on 2026-11-19. On `main` 5ab1b47, criterion 6 is cited only in the review and in research-admission.ts's comment on the 6,000-word default. No experiment card cites it. One light review found two majors and ten minors. All are applied except two: the code comment, which decision 4 and the limitations leave to the protocol revision, and the room for 30 citations, which decision 3 records instead of §5.6's approved E4 row.

Failures or blockers: None.

Limitations and non-claims: The capture holds one task's instructions on one day, not Manus outputs or measurements. It is no product baseline, and the Manus baseline stays declined for now (decision 8 of BL-20261117-0941-group-a-decided-under-delegation). The workflow-composer skill's template for a cross-item report asks for a comparison table, so a Manus fan-out report may carry a table no brief asked for; the restatement does not fail one. research-admission.ts's comment still calls 6,000 criterion 6's upper band; it changes with the revision that moves the default. Nothing is measured or run, and no E4 threshold is set here.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: The owner's answer. On a yes, this entry becomes `Approved` with the owner's words quoted, before the merge.

References: docs/PROJECT_REVIEW_2026-11-05.md §2, §2.2, §5.6 and §7; BL-20261107-0650-owner-decisions-review-items-2-5; BL-20261107-0718-correction-owner-decisions-record; BL-20261117-0940-owner-direction-decisions-delegated; BL-20261117-0941-group-a-decided-under-delegation.
