### BL-20261118-0923-e0-amendment-7-fixtures-result -- 2026-11-18 -- E0 Amendment 7's fixtures: neither registered rule was met; synthesis gave 0, 2 and 3 model syntheses of 10 and the plan cells 7, 6 and 5 valid of 10, and, post hoc, every `unknown_evidence_id` refusal listed a packet quote under a question it was not tagged for

Status: `Verified`

Scope or hypothesis: The six zero-fee fixture invocations that Amendment 7 of E0's card registered before any call (BL-20261118-0652-e0-synthesis-and-plan-cell-fixtures), on the records of the r3 re-measurement (BL-20261118-0606-e0-r3-remeasurement-result). `Verified` covers that the six ran as registered and that the figures below are their summaries'. It covers no rate and no cause. A count over the synthesis replies, made after the cells were read, is reported apart as post hoc. The pull request's description holds each cell's full reading.

Decisions:
1. **No card value moves by the registered rules.** Synthesis: the best cell gave 3 model syntheses of 10. That is 3 more than `synthesis-8192`, but the rule also needs 8 of 10. Plan: cell C gave 5 valid of 10, where the rule needs 8.
2. **The rows' outcome.** `rejected` for `synthesis-16384`, `synthesis-8192-repair-thinking-off` and cell C, each read against its rule and short of it. `rejected` for `synthesis-8192` too, as a label of the session's: it is the rule's comparator, not a cell the rule could move to, and it gave 0 of 10. `accepted` for cells A and B, which are descriptive with no level, as E0's planner fixtures of 2026-11-16 were rowed.
3. **What followed is recorded with its own change.** The session decided, and the owner approved, that the synthesis judge drops a mis-tagged placement instead of refusing the reply. Pull request #176 carries it, with a confirmation cell registered before any call; it merges only if that cell meets its rule.

Changes: this file; docs/experiments/registry.jsonl gains six rows in batch `e0-2026-11-18`: `e0-synthesis-fixture-8192-2026-11-18`, `e0-synthesis-fixture-16384-2026-11-18`, `e0-synthesis-fixture-8192-repair-thinking-off-2026-11-18`, and `e0-planner-fixture-v3-a-2026-11-18` to `-c-`.

Evidence:
- **How they ran.** All six from the main checkout at 527d3d6 with a clean tree, in the registered order, one at a time, from 07:42:18 to 09:22:16 UTC. No proxy switch was set. Each dry run showed item 4's list before its cell started: for synthesis, `stageCheckPassed` true with every body size and packet digest equal to the runs' receipts, and `lengthCapWords` 1000 on every request; for the planner, `stageCheck` `bodyBytes` and `packetSha256` true. No cell was void.
- **The requests each cell sent.** Synthesis request sets: `synthesis-8192` b28c6de4f8e0b62c029699c1e0ad2c1b7f00d7eb7e058eec8e99e8f50c6aa4b2; `synthesis-16384` a92698f582b346acac29e1836d587e7465ae5bd8215e165633d7fd093ad7dbf4; `synthesis-8192-repair-thinking-off` eabda9f592aec82eb3bd04448d9e6af25cfb1db009cd1abefc523990f4ae9b6f. Plan requests: A fa489dc66aff9cb2afe8f2e49e395a6f6efd5121b5325e62532c8c66d36995e5; B c30fa9c58c41286d2d01233db28d571963b9f4138946d7a9464effae38d3a590; C 3badde6b835c3547475a0dc796345875fb09fcc7f6493424e8f6aa0bcb4ecde2.
- **Synthesis,** 10 trials a cell on runs 2 and 3's packets, 5 each. `synthesis-8192`: 0 model syntheses, 10 skeletons, 1,178 s. `synthesis-16384`: 2 and 8, both on attempt 1, one on each packet, 1,473 s. `synthesis-8192-repair-thinking-off`: 3 and 7, all on attempt 2 and on run 2's packet, 805 s. No trial was `no_outcome`.
- **Synthesis refusal codes,** of which a reply may carry several. Attempt 1: `truncated` 6, 2 and 7; `unknown_evidence_id` 4, 6 and 2. Attempt 2: `truncated` 4, 1 and 0; `unknown_evidence_id` 6, 7 and 6; `presentation_too_large` 0 in each cell. Besides: two missing required headings (`synthesis-8192`, attempt 1); `schema_invalid_format`, `invalid_json` and `duplicate_evidence_id` once each (`synthesis-8192-repair-thinking-off`).
- **Plan,** 10 first attempts a cell on run 2's index at 16,384. A, unstreamed: 7 valid; 3 cut at the cap, 2 of them with no content; 1,197 s. B, streamed, the stage's own call: 6 valid; 4 cut, 2 with no content, each cut call 153 to 170 s; 1,160 s. C, thinking off: 5 valid, 5 `binding_invalid`, none cut, 6 to 18 s a call; 126 s.
- **Post hoc, after the cells.** Lane S-pipe's read-only script (sha256 df7bd5c8…, read by the session before it ran; no endpoint call) first reproduced every recorded classification, then re-judged every synthesis reply. Each of the 31 replies refused with `unknown_evidence_id` listed a packet quote under a question that quote was not tagged for; none listed an id outside the packet. Dropping those placements would have given 7, 10 and 10 model syntheses, with no question left without evidence.

Failures or blockers: None stopped a cell.

Limitations and non-claims:
- **Counts, not rates.** Ten trials or calls a cell, one exposed task's two packets and one index, one day.
- **The stage's checks are not a verdict on content.** An accepted synthesis or plan passed the checks; no one read it for quality.
- **The post hoc count was chosen after the cells were read** and is no test. It covers the `unknown_evidence_id` refusals only. Pull request #176's confirmation cell is the registered test of the change it suggested.
- **The plan cells.** C measured the first-attempt payload, not the repair's. A against B is descriptive. E0's planner fixture gave 9 of 10 for cell A's call on run 5's index on 2026-11-16; today's index and day differ.

Paid exposure: None. All 88 calls went to the owned endpoint at USD 0.

Next gate: Pull request #176's review fixes and its confirmation cell. Then Amendment 8: the re-probe, the revised card and the owner's adoption go.

References: docs/experiments/e0-card-2026-11-13.md (Amendment 7); docs/experiments/e0-synthesis-fixture-v1.json; docs/experiments/e0-planner-fixture-v3.json; docs/experiments/registry.jsonl; BL-20261118-0652-e0-synthesis-and-plan-cell-fixtures; BL-20261118-0606-e0-r3-remeasurement-result; BL-20261116-1546-e0-structured-fixtures-result; pull requests #171 and #176.
