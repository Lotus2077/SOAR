### BL-20261118-0905-synthesis-evidence-id-tolerance -- 2026-11-18 -- The synthesis judge drops an evidence id not tagged for its question instead of refusing the reply, and the packet discloses it

Status: `Implemented`

Scope or hypothesis: The E0 card's Amendment 7 synthesis cells gave 0, 2 and 3 model syntheses of 10. Lane S-pipe's counts-only script (sha256 `df7bd5c8…`, read by the coordinating session before it ran) showed that every `unknown_evidence_id` refusal in the 30 trials listed a packet quote under a question the quote is not tagged for, never an id outside the packet, and that dropping those placements leaves no question without evidence. Judged again that way, post hoc, the three cells give 7, 10 and 10 of 10.

Decisions:
1. **The rule (candidate 4, variant (i); RESEARCH_TOLERANCE_POLICY version 2).** The synthesis judge drops from a question's list an id that is not citable or whose quote is not tagged for that question, instead of refusing the reply. A findings or conflict question left with none becomes unresolved. A duplicate id, a findings or conflict question the reply itself left empty, an unknown inline citation and every other check refuse as before, and the argument is not changed. Stage and assist replies share the rule; an assist's citable ids are its own packet's.
2. **The disclosure.** Coverage version 6 records `synthesis.corrections`: each question's dropped ids, and each downgraded question with its former disposition. The synthesise row counts `evidenceIdsDropped` and `questionsDowngraded`, only when an id was dropped. The writer's instructions gain a sentence on corrections.
3. **The packet validator.** Its tag check, that every listed id is a quote tagged for its question, is unchanged. Coverage gains version 6 with `synthesis.corrections`, which the validator binds: on a model synthesis only; each dropped id no longer listed and, on the stage's own reply, not tagged for its question; each downgraded question unresolved with no id; the row's counts equal to the disclosure's. A gap is allowed at version 5 and above.
4. **Variant (ii) is not taken.** Keeping a mis-tagged id where the reply placed it would relax the validator's tag check, a persisted-contract change, for no gain in these counts.
5. **The E0 synthesis fixture** judges with the same tolerance function, and its summary and registry row record `judge` (`research_tolerance_v2`), so its rows are not mistaken for the three cells judged under version 1.
6. **The owner's approval.** The owner wrote "go ahead with your decision" in the coordinating session's chat, between 08:45 and 08:57 UTC by that session's record. That approved the session's decision as reported to the owner: the table (0, 2 and 3 of 10 as measured; 7, 10 and 10 post hoc); the rule; variant (ii) not taken; and a confirmation cell of 10 at 16,384 under the new check, at least 8 of 10 registered beforehand, without which the change does not merge. The report said the packet validator was unchanged. At about 08:58 UTC the session corrected that point to the owner: the tag rule is unchanged, and coverage gains a field the validator checks.
7. **The confirmation cell** is registered in the E0 card's addendum to Amendment 7, before any call.

Changes: src/main/private-agent/research-coverage.ts, research-pipeline.ts and research-contract.ts; scripts/synthesis-fixture.ts, export-role-schemas.ts and registry-row.py; tests; docs/experiments/e0-card-2026-11-13.md; this file.

Evidence:
- **Tests:** cases (a), (b) and both; findings and conflict downgrades; a corrected repair attempt; an assist's uncarried id; nine replies still refused, none naming an offending id; 15 tampered packets refused by the validator; the fixture's verdicts and corrections equal the stage's.
- **Mutants:** 35 of 35 fail a test (a 36th was equivalent; its redundant check was removed). **Full suite:** 205 files, 4,100 tests, 88 skipped, none failed; typecheck, readiness and the build-log validator pass.
- **What moves from `main` aa61e94:** the default hash `a46bfb55…` → `080c5111…`; under admission `36b73496…` → `0a49d5a2…`; under the adopted card's roles with admission `22d2d92d…` → `34b608f2…`; the four assist hashes; the source freeze `72263758…` → `e262dbc0…`; P10's synthesis bodies (6 of 18); the seeded writer's write phase. P10's plan and extract bodies and the card's roles do not move.

Failures or blockers: None.

Limitations and non-claims: No call has been made under the tolerant judge, and the post hoc 7, 10 and 10 decide nothing. The argument may still discuss a question in terms of a quote dropped from its list: coverage and the writer's sentence disclose the drop, and the argument is not checked against the corrected lists. The packet does not record an assist's citable ids, so the validator cannot check an assist's drops against them.

Paid exposure: None.

Next gate: the confirmation cell (at least 8 of 10) from this pull request's head, then review and merge; Amendment 8's re-probe then binds `080c5111…`.

References: the E0 card's Amendment 7 and its addendum; #171 (the synthesis fixture); #172 (coverage version 5 and the declared gap).
