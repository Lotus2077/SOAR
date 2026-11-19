### BL-20261119-0602-criterion-6-restated -- 2026-11-19 -- Criterion 6 of the depth bar restated from Manus's current writing rules: the brief sets the form and length, and a summary or a table only where it asks

Status: `Proposed`

Scope or hypothesis: Criterion 6 of the bar (docs/PROJECT_REVIEW_2026-11-05.md §2.2) asked for 2,500-6,000 words with sections, a summary, at least one table and a URL reference list. Its only Manus anchor was "several thousand words", from an unofficial 2025 copy of Manus's agent prompt that §7 rates Low. A capture of 2026-11-19 holds the deep-research skill that one Manus task loaded. It sets no word target unless the user gives one, answers in chat when about 400 English words suffice, and allows no executive summary, method section or table unless the user asks. E3 and E4 were approved as §5.6 defined them at f472c65, and E4's rule reads the per-run criteria, so this restatement is the owner's call. The pull request's description holds the detail.

Decisions:
1. **Criterion 6, restated.** Continuous prose with sections and a URL reference list, in the form and at the length the brief states. A summary or a table is required only where the brief asks for one. `claims.json` and the CSV rule are unchanged. A brief that states no length is judged on completeness (criterion 4 and the blind verdict), not on a word count.
2. **E3 reads it as before.** Its rule already lets the word band yield to each brief's word limit.
3. **E4's fresh briefs state a form and a length,** and so do the E4 option's briefs if it is funded. Manus's own rules and SOAR's arms then answer the same request, and neither misses the criterion by instruction alone.
4. **No code changes.** When a brief states no length, the synthesis cap stays 6,000 words. The protocol hash binds that default, so it can move only in a later protocol revision.
5. **The capture stays outside the repository,** because it is a third party's internal text. §7 describes it, and the pull request paraphrases it.

Changes: docs/PROJECT_REVIEW_2026-11-05.md (§2.2, criterion 6's row; §7, a note under the heading, one new source row and the 2025 row's confidence); this file.

Evidence: The three captured files were read in full on 2026-11-19. On `main` 5ab1b47, criterion 6 is cited only in the review and in research-admission.ts's comment on the 6,000-word default. No experiment card cites it.

Failures or blockers: None.

Limitations and non-claims: The capture holds one task's instructions on one day. It holds no Manus outputs or measurements, so it is no product baseline, and owner decision 10 stays open. Nothing is measured or run, and no threshold of E4 is set here.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: The owner's answer. On a yes, this entry becomes `Approved` with the owner's words quoted, before the merge.

References: docs/PROJECT_REVIEW_2026-11-05.md §2.2, §5.6 and §7; BL-20261107-0650-owner-decisions-review-items-2-5; BL-20261107-0718-correction-owner-decisions-record.
