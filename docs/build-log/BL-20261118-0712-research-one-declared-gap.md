### BL-20261118-0712-research-one-declared-gap -- 2026-11-18 -- A research packet may stand with one disclosed chunk whose last reply declared questions unresolved

Status: `Implemented`

Scope or hypothesis: The owner allowed a packet with one disclosed unresolved chunk (BL-20261118-0639-owner-allows-one-disclosed-unresolved-chunk). Until now, one such chunk ended the stage and lost the report; in today's r3 runs it lost 1 run of 3, and possibly 1 of E0's 5.

Decisions:
1. **The rule.** The stage ends ready if exactly one chunk is unfinished, its last reply is `needs_followup`, and every repair has run: two attempts, or three under a card's rates. A chunk whose repair the budget cut, a second such chunk, or one left invalid, truncated or denied still ends the stage.
2. **The disclosure.** Coverage, now version 5 (version 4 still reads), gets an optional `gaps` entry: the chunk, its source, its declared questions and its attempts. The presentation shows coverage.json as it is. The writer's instructions say to state the gap as a limitation, never as absence. The host flags count it, and the report's issue lines say so.
3. **No evidence from the gap.** Its declared questions stay `needs_followup`, and the others become `no_verified_evidence`, which the host flags do not count as no-evidence outcomes. The presentation guard runs as for any packet.
4. **The ready gate** accepts only a gap that is its chunk's own, with the attempt count its admission implies, recorded as `declaredGaps: 1`. The coverage policy is restated to match.
5. **Two counts join the extract row, under a card's rates only:** `heldChunks`, set once the initial pass drains, and `heldKeptUnrepaired`.

Changes: research-pipeline.ts, research-coverage.ts, research-contract.ts, host-flags.ts, general-tasks/controller.ts, export-role-schemas.ts and registry-row.py; the protocol pins and the tests that record version 5 and the new counts; new tests; this file.

Evidence:
- Tests pin the answer's four points, the budget-cut and last-reply cases, the guard, the writer's sentence, host flags from a real packet, a gap seed, the gate's refusals and the hashes. Mutants of each fix fail.
- **The protocol hash moves:** the default from e3e08871… to a46bfb55d2f841f1dbf426f2c8be6a03fa5cf27d9e61b1e6421ef85c83d73de0, and the adopted card's from af4715a1… to 22d2d92d5ac67ce3733c3a2a31189c3060c2c73d50ff6d8bd46da8e22ab8b076. The pull request lists the others.
- The source freeze moves from 3580af68… to 96268f510c82e8f7e6781a5b449a221ac67435c10aac0d8bd8c120d15c18f737.
- P10's 12 plan and extract bodies are unchanged. Its 6 synthesis bodies change only in the coverage version and the protocol hash inside their synthetic coverage.

Failures or blockers: The first version let a chunk whose repair the budget cut pass as the gap, and skipped the presentation guard for a gap packet. The review found both before merge.

Limitations and non-claims: No run has used the rule. Until P10 is re-probed under the new hash, the reader refuses the adopted card (`serving_card_p10_protocol_drift`).

Paid exposure: None.

Next gate: the review's second look, CI and the coordinating session's merge. Then the re-probe and re-measurement amendment.

References: BL-20261118-0639-owner-allows-one-disclosed-unresolved-chunk; BL-20261118-0606-e0-r3-remeasurement-result.
