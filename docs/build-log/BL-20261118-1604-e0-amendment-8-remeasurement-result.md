### BL-20261118-1604-e0-amendment-8-remeasurement-result -- 2026-11-18 -- E0's r3 runs under the adopted 2026-11-18 card: 2 of 3 reached the packet, each only through the second repair and the one disclosed gap, both with a model synthesis; the third ended with two unresolved chunks

Status: `Verified`

Scope or hypothesis: The three serial zero-fee r3 runs that Amendment 8 of E0's card registers in its item 6 (BL-20261118-1114-e0-card-amendment-8), under the serving card of 2026-11-18 as adopted (BL-20261118-1232-serving-card-2026-11-18-adopted), read by Amendment 6's items 3 to 5 with item 6's added counts. `Verified` covers that the runs were made as registered and that the figures are their records'. It covers no rate, no report's quality and no cause. The pull request's description holds each run's full reading.

Decisions:
1. **The second repair helps on r3,** by Amendment 6's rule: chunks were saved by it in every run (3, 4 and 4). Runs 1 and 2 reached the packet only through it too (3 and 4 saved); it stays as built. Run 3's two failed second repairs were both `needs_followup`.
2. **By that rule the budget did not bind:** no unfinished chunk was cut by it. Run 3 used all 40 extraction calls, and its 3 held chunks kept their first readings.
3. **The disclosed gap carried both packets.** Runs 1 and 2 each reached the packet with one chunk declared unresolved after both repairs (#172); without the gap each would have ended incomplete, since the gap was its run's only unfinished chunk. Run 3 had two such chunks, which the one-gap rule does not allow.
4. **No value changes by these runs** (Amendment 6, item 5). The first half of 13a's gate is met again, in the session's reading: at least 2 of 3 reached the packet.

Changes: this file; docs/experiments/registry.jsonl gains three rows in batch `e0-2026-11-18-a8`, `e0-r3-grid-batteries-local-heavy-pipeline-run1-remeasure-a8` to `-run3-`. The `-a8` suffix keeps them apart from this morning's rows, which hold the ids without it.

Evidence:
- **How they ran.** From the main checkout pinned at 2996218, the merge of the adoption, with a clean tree and the source freeze `0b896d92…`, one at a time, by lane S-pipe's runbook for item 6 (sha256 2f229627…, read by the session). Before each run its 28 checks passed: the card's file, digest and entry; the doctor's `card.status` `matches`; the dry run's protocol hash `99bbc0e6…`, admission basis `serving_card` and the card's rates.
- **Run 1,** 14:49:18 to 15:19:07 UTC (1,789 s): `submitted`. 23 of 24 chunks and one gap (S8C1, 1 question, 3 attempts); 9 first repairs; 4 second repairs sent, 3 saved; 37 of 40 calls; 2 held chunks, neither kept its first reading (S19C1 completed on repair; S8C1 is the gap). Plan attempt 1 cut at the cap with no content, attempt 2 accepted. A model synthesis on its first call, with 4 ids dropped as not tagged for their question and none downgraded.
- **Run 2,** 15:19:31 to 15:56:18 UTC (2,207 s): `submitted`. 23 of 24 and one gap (S23C1, 1 question, 3 attempts); 10 first repairs; 5 second repairs sent, 4 saved; 39 of 40 calls; 4 held chunks, none kept its first reading (three completed, S17C1 on its second repair; S23C1 is the gap). The first plan attempt accepted. A model synthesis on its first call, with 2 ids dropped as not tagged and none downgraded.
- **Run 3,** 15:56:38 to 16:03:04 UTC (386 s): `incomplete`, `research_extraction_incomplete`. 22 of 24; 10 first repairs; 6 second repairs sent, 4 saved, 2 failed; 40 of 40 calls; 3 held chunks, all kept their first readings. The first plan attempt accepted; no synthesis reached. Its two unfinished chunks, S5C1 and S12C1, were `needs_followup` at all three attempts, and all 18 rejected replies in the run were `needs_followup` (lane S-pipe's read-only replay of the stage's passes, which reproduced every count of the stage row).
- **In total:** 68 of 72 chunks and 2 gaps; 29 first repairs, held included; 15 second repairs sent, 11 saved, 4 failed; none cut by the budget; 116 of 120 extraction calls; 9 held chunks, 3 kept their first readings; 6 ids dropped as not tagged, none as not citable, no question downgraded.
- **Admission** admitted all three with one record: 24 chunks, 6 reserved repairs, 117.5 s expected against a share of 2,700 s. No stage row carries `denied`, and no run was stopped.
- **The reports' claim checks,** recorded and not read here: 19 supported and 21 partial of 40 (run 1), 28 and 12 of 40 (run 2), none contradicted or unsupported.

Failures or blockers: None stopped a run. Run 3 did not reach the packet.

Limitations and non-claims:
- **Counts, not rates:** three runs of one exposed task on one day. Beside this morning's three under the earlier card (2 of 3 packets, synthesis the skeleton in both), the comparison is post hoc and confounded: the card, the judge, the gap, the commit (5140f5d, then 2996218) and the hour all changed.
- **No report is assessed.** The submitted runs are rowed `incomplete`, as E0's earlier submitted runs were.
- **"Only through"** the second repair or the gap is read from each run's own replies; it is not a run without either.
- **The unfinished chunk differed in every run** (S8C1, S23C1, then S5C1 and S12C1), and S5C1 and S12C1 completed in runs 1 and 2. This morning's hardest chunk, which lane S-pipe mapped to S19C1, completed in runs 1 and 2. The mapping rests on equal chunk inventories and call order, read-only.

Paid exposure: None. Every call went to the owned endpoint at USD 0. The runs fall after the card's two days (Amendment 4, item 8).

Next gate: E2's amendment against this card, reviewed; then E2's and E6's runs from one pinned commit.

References: docs/experiments/e0-card-2026-11-13.md (Amendments 4, 6 and 8); docs/experiments/serving-card-2026-11-18.json; docs/experiments/registry.jsonl; BL-20261118-1114-e0-card-amendment-8; BL-20261118-1206-e0-amendment-8-reprobe-result; BL-20261118-1232-serving-card-2026-11-18-adopted; BL-20261118-0606-e0-r3-remeasurement-result; BL-20261118-0712-research-one-declared-gap; BL-20261118-0905-synthesis-evidence-id-tolerance.
