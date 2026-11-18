### BL-20261118-0606-e0-r3-remeasurement-result -- 2026-11-18 -- E0's r3 re-measurement under the adopted card: 2 of 3 runs reached the packet, each only through the second repair, and 3 of 5 plan attempts were cut at the cap with no content

Status: `Verified`

Scope or hypothesis: The three serial zero-fee r3 runs that Amendment 6 of E0's card registered (BL-20261117-1701-e0-card-amendment-6-r3-remeasurement, with BL-20261117-1709-correction-e0-card-amendment-6-lane-check and BL-20261118-0419-correction-e0-card-amendment-6-card-pair-from-environment). `Verified` covers that the runs were made as registered and that the readings below are those of their records. It covers no rate, no report's quality and no cause. The pull request's description holds each run's full reading.

Decisions:
1. **The second repair helps on r3,** by the amendment's rule: every run had chunks saved by it (4, 4 and 2). It stays as built.
2. **By the amendment's rule the budget did not bind:** no chunk was cut in any run. Run 1 spent all 40 extraction calls, and 6 held chunks kept a first attempt that was not repaired.
3. **No value changes by these runs** (the amendment's item 5). The card stays adopted and the incomplete-chunk rule stays.
4. **The first half of 13a's gate is met,** in the session's reading of decision 2 of BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout: at least 2 of the 3 runs reached the packet.
5. **Two findings outside the registered rule go to a later entry.** The plan stage was cut at its cap in 3 of 5 attempts, and synthesis fell back to the skeleton in both runs that reached it. Lane S-pipe writes the proposal; nothing changes here.

Changes: this file; docs/experiments/registry.jsonl gains three rows, `e0-r3-grid-batteries-local-heavy-pipeline-run1-remeasure` to `-run3-remeasure`, in batch `e0-2026-11-18`.

Evidence:
- **How they ran.** All three at commit 5140f5d with a clean tree, `--runtime-sha256` c39a5ccb…, protocol hash af4715a1…, the card 79ce2481… with its entry BL-20261117-1356-e0-reprobe-result-plan-cap-16384, admission basis `serving_card`, K 1. The runbook set the card's pair in each run's environment. By the session's account the owner's settings file holds no pair: a doctor run without it, at 04:16 UTC, reported no card configured. Each run's doctor and dry run showed every value the amendment lists, checked by lane S-pipe's runbook (sha256 790e0f56…) before the run started.
- **Run 1,** 04:32:36 to 04:43:10 UTC, 634 s: `incomplete`, `research_extraction_incomplete`. 23 of 24 chunks; 11 first repairs; 5 second repairs sent, 4 chunks saved, 1 failed with `needs_followup` and `quote_length`; 40 of 40 extraction calls. Both plan attempts were cut at 16,384 tokens with no content (166.5 s and 174.7 s), so the host plan was used.
- **Run 2,** 04:44:39 to 05:20:34 UTC, 2,155 s: `submitted`. 24 of 24 chunks; 11 first repairs; 4 second repairs sent, 4 saved; 39 of 40 calls. Plan attempt 1 was cut at the cap with no content, and attempt 2 was accepted. Synthesis fell back to the skeleton.
- **Run 3,** 05:20:56 to 06:03:16 UTC, 2,540 s: `submitted`. 24 of 24 chunks; 11 first repairs; 2 second repairs sent, 2 saved; 37 of 40 calls. The first plan attempt was accepted. Synthesis fell back to the skeleton.
- **By the per-run reading,** runs 2 and 3 reached the packet only through the second repair: one repair would have left 4 and 2 chunks unfinished. Run 1 lost its packet to 1 chunk that failed both repairs.
- **Admission** admitted all three with the same record: 24 chunks, 40 extraction calls, 6 reserved, 93.8 s expected against a share of 2,700 s. No stage row carries `denied`, and no run was stopped.
- **In total:** 71 of 72 chunks; 33 first repairs, repairs of held chunks included; 11 second repairs sent, 10 saved, 1 failed; 116 of 120 extraction calls.
- **Rejected extraction replies:** 17, 15 and 13. `needs_followup` is among the codes of 14, 10 and 11 of them; a question-set mismatch of 2, 1 and 2. None was truncated and none carried `schema_too_big`.

Failures or blockers: None stopped the runs. Run 1 did not reach the packet.

Limitations and non-claims:
- **Counts, not a rate.** Three runs of one exposed task. Beside E0's five r3 runs (1 of 5 reached the packet) the comparison is post hoc and confounded, as the amendment says.
- **No report is assessed.** The two submitted runs are rowed `incomplete`, as E0's run 5 was. Their claim-check counts differ (35 of 40 claims supported, then 16 of 39) and are not read here.
- **"Only through the second repair"** is read from each run's own replies. It is not a second run under one repair. That each run was read before the next started is the session's account; no record shows it.
- **The plan finding has no shown cause.** The records hold no reasoning text. Lane S-pipe's reading from the code is that the re-probe's plan cell (20 of 20 valid) was built from the export's small synthetic packet, and that the planner fixture on a real index, without streaming, was cut 1 time in 10. In runs 1 and 2 the brief is the fixture's and the prompt is within 2% of the fixture's size. The comparison of 3 of 5 with 1 of 10 was chosen after the counts.
- **One machine, one endpoint, one day.**

Paid exposure: None. The runs are zero-fee, and they fall after the card's two days (Amendment 4, item 8).

Next gate: Lane S-pipe's proposal on the plan stage, the chunk lost after two repairs and the synthesis fallback, and an entry of its own before any change. E2's first packet run, after its Amendment 1.

References: docs/experiments/e0-card-2026-11-13.md (Amendment 6); docs/experiments/serving-card-2026-11-17.json; docs/experiments/registry.jsonl; BL-20261117-1616-serving-card-2026-11-17-adopted; BL-20261116-0813-e0-r3-runs-index-and-harvest; BL-20261116-1546-e0-structured-fixtures-result; BL-20261117-1130-lane-decisions-second-repair-before-reprobe.
