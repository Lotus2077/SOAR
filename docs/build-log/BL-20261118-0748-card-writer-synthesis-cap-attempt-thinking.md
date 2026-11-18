### BL-20261118-0748-card-writer-synthesis-cap-attempt-thinking -- 2026-11-18 -- The role export takes a synthesis cap and the card writer a per-attempt thinking pair, so a revised card needs no hand edit of its roles

Status: `Implemented`

Scope or hypothesis: The E0 card's Amendment 8 (drafted) revises the serving card after #172's re-probe, with the synthesis caps and the thinking pairs that Amendment 7's fixtures decide. The writer proposed the export's caps and one thinking mode on both attempts, so it could write neither without a hand edit. The coordinating session asked for both as options, the writer refusing a pair the reader would refuse.

Decisions:
1. **`pnpm probe:export-schemas -- --synthesis-cap <tokens>`** builds both synthesis cells at that cap, as #136's `--plan-cap` does for plan, and records it as `outputTokens.synthesis`. Each cell's word cap is the one the stage would send at that cap and thinking. A cap whose synthesis length ceiling falls below the pipeline's floor is refused (`researchSynthesisBelowFloor`).
2. **`pnpm card:serving -- --attempt-thinking ROLE=FIRST,SECOND`** (plan, extract or synthesis; `model` or `disabled`), once per role and only with `--policy-out`, writes that role's two attempts' thinking. It refuses two kinds of attempt:
   - an attempt that would send the format at a cap its P10 cell did not measure, as the reader does (`serving_card_structured_output_cap_unmeasured`);
   - an attempt the option moves to a thinking mode the role's structured-output flag does not name. The reader accepts that, but the attempt would go without the format its fixture measured.

   A role with no structured-output flag, like the adopted card's synthesis, sends the format on no attempt, so its pair is written as given.
3. **Without either option**, the export, P10's bodies and the card are unchanged.

Changes: scripts/export-role-schemas.ts; scripts/serving-card.py; their tests; docs/experiments/README.md; this file.

Evidence:
- **Tests:**
  - the synthesis cells and their word caps, against the model layer's body;
  - the floor and the range;
  - a probe built from the export, through the writer, to a card the reader resolves;
  - the writer's pairs, with the Markdown byte for byte;
  - each refusal;
  - the command lines.
- **Mutants:** removing the moved-attempt refusal, the cap check, the per-cap word cap or the floor each fail a test.
- **Unchanged against `main` 527d3d6:** the default export's 18 P10 bodies, the source freeze and the protocol hash.

Failures or blockers: None.

Limitations and non-claims: No probe has run with the options. The writer does not check the synthesis floor, which depends on the cap alone; the export refuses it there.

Paid exposure: None.

Next gate: CI and the coordinating session's merge, before Amendment 8's re-probe.

References: #136 (the plan cap); #172 (the declared gap, whose hash the re-probe binds); the E0 card's Amendment 7.
