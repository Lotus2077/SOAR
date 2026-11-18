### BL-20261118-1125-e0-synthesis-structured-cell -- 2026-11-18 -- The E0 synthesis fixture's synthesis-16384-structured cell, ready in case the re-probe's card flags synthesis

Status: `Implemented`

Scope or hypothesis: This prepares the E0 card's Amendment 8, item 4. If the re-probe's revised card gives synthesis a structured-output flag with `thinkingOn` true, the stage would send synthesis with the strict format, which the addendum's confirmation cell did not send. One more fixture cell must then pass before the adoption is asked. This pull request makes that cell ready. If the card writes no such flag, it is closed unmerged.

Decisions:
1. **The cell, `synthesis-16384-structured`,** is `synthesis-16384` (16,384 tokens, thinking on both attempts) with the synthesis role's strict response_format on both attempts. The bodies are built as the stage builds a flagged call: `RESEARCH_ROLE_SCHEMAS.synthesis`, strict. The judge is the tolerant one (`research_tolerance_v2`). The trial unit, the void rule and the stage check are the fixture's.
2. **Manifest v2** (docs/experiments/e0-synthesis-fixture-v2.json) holds v1's two packets unchanged and this cell alone, five trials a packet. v1 is unchanged, so the earlier cells' summaries still match it. The run takes `--manifest docs/experiments/e0-synthesis-fixture-v2.json`.
3. **The dry run shows the format.** Each request record gains `structuredOutput` (`strict` or null), so the cell's dry run shows the format on all four requests, with a request set of its own.

Changes: scripts/synthesis-fixture.ts; scripts/registry-row.py (the cell mirror); docs/experiments/e0-synthesis-fixture-v2.json; docs/experiments/README.md; tests; this file.

Evidence:
- **Tests:**
  - the cell's two bodies equal, byte for byte, the stage's own synthesis bodies under a card whose synthesis flag is strict with `thinkingOn` true, the response_format included;
  - the cell's dry run shows the stage check, the tolerant judge, the strict format on all four requests, and a request set unlike `synthesis-16384`'s;
  - v2 pins v1's packets and the one cell;
  - the command line takes the cell, and the registry's mirror matches.
- **Mutants:** 6 of 6 fail a test.
- **Full suite:** 205 files, 4,104 tests, 88 skipped, none failed; typecheck, readiness and the build-log validator pass.
- **Unchanged:** no file under src/, so the source freeze `0b896d92…` and the protocol hashes stand (default `4bb74c03…`). The other cells' bodies are unchanged.

Failures or blockers: None.

Limitations and non-claims: No call has been made. The cell covers the format only as the revised card would send it if the re-probe flags synthesis with `thinkingOn` true. Another flag shape is not covered.

Paid exposure: None.

Next gate: The re-probe's card. With a synthesis flag (`thinkingOn` true): review, the merge, then the cell under Amendment 8's item 4. Without one: closed unmerged.

References: The E0 card's Amendment 8 (#180) and the addendum to Amendment 7; #171 (the synthesis fixture); #176 (the tolerant judge).
