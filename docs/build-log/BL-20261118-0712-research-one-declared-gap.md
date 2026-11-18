### BL-20261118-0712-research-one-declared-gap -- 2026-11-18 -- A research packet may stand with one disclosed chunk whose last reply declared questions unresolved

Status: `Implemented`

Scope or hypothesis: The owner allowed a packet with one disclosed unresolved chunk (BL-20261118-0639-owner-allows-one-disclosed-unresolved-chunk). Until now, one such chunk ended the stage and lost the report; in today's r3 runs it lost 1 run of 3, and possibly 1 of E0's 5.

Decisions:
1. **The rule.** After every repair has run as before, the stage ends ready if exactly one chunk is unfinished and that chunk's last reply is `needs_followup`. Two such chunks still end the stage, as does one invalid, truncated or denied.
2. **The disclosure.** The coverage record gets an optional `gaps` entry: the chunk, its source, the questions its last reply declared unresolved, and its attempts. The writer's presentation shows coverage.json as it is. The host flags count the gap and its questions, and the report's issue lines say so.
3. **No evidence from the gap.** The chunk's declared questions stay `needs_followup`, and the others become `no_verified_evidence`. The quotes of its rejected replies are never kept.
4. **The ready gate** accepts only a gap that is its chunk's own, and the extract row must record it as `declaredGaps: 1`.
5. **Two counts join the extract row, under a card's rates only:** `heldChunks` and `heldKeptUnrepaired`.

Changes: research-pipeline.ts, research-coverage.ts, host-flags.ts, general-tasks/controller.ts and registry-row.py; the protocol pins and the tests that record the new counts; a new test file; this file.

Evidence:
- One test pins each of the answer's four points, and others pin the gate's refusals and the held counts. Mutants that allow two unresolved chunks, drop the gate's check on the extract row or miscount the kept held chunks each fail.
- **The protocol hash moves:** the default from e3e08871… to 2e3847578bd96bdb2ec99e95f87194d36f972fb49e8f2e17f5356e4c20bfaaf3, and the adopted card's from af4715a1… to cad2bcbe7231bce2b6a249f5ce3410e371840f4e16819e8ed73eefaf8e058858. The pull request lists the other pins.
- The source freeze moves from 3580af68… to e8125676062c6ef4a879b01e8067957d01c89deeb86804150e94db99dece4fd6.
- P10's 12 plan and extract bodies are unchanged. Its 6 synthesis bodies change only in the protocol hash inside their synthetic coverage.

Failures or blockers: None.

Limitations and non-claims: No run has used the rule. Until P10 is re-probed under the new hash, the reader refuses the adopted card (`serving_card_p10_protocol_drift`).

Paid exposure: None.

Next gate: one review, CI and the coordinating session's merge. Then the re-probe and re-measurement amendment.

References: BL-20261118-0639-owner-allows-one-disclosed-unresolved-chunk; BL-20261118-0606-e0-r3-remeasurement-result.
