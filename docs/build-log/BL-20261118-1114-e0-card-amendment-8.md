### BL-20261118-1114-e0-card-amendment-8 -- 2026-11-18 -- E0 card Amendment 8: the re-probe at the new protocol hash, the card revision with synthesis at 16,384, the owner's adoption, and three r3 runs under it

Status: `Implemented`

Scope or hypothesis: #172 and #176 moved the default protocol hash, so the adopted serving card's P10 binding no longer resolves (`serving_card_p10_protocol_drift`) until a re-probe binds the new one. Amendment 7's fixtures and its addendum's confirmation cell decide the revision's values (BL-20261118-0923-e0-amendment-7-fixtures-result; BL-20261118-0905-synthesis-evidence-id-tolerance). This amendment registers the re-probe, the revision, the adoption and a three-run re-measurement before any of it runs.

Decisions:
1. **The values (item 0).** One role value moves: synthesis caps become [16384, 16384], with thinking [model, model] (the addendum's cell, 10 of 10). Synthesis attempt 2 keeps its thinking (`synthesis-8192-repair-thinking-off`, 3 of 10), and the plan row is unchanged (cell C, 5 valid of 10).
2. **The re-probe** is Amendment 5's full run at a `main` commit containing #172, #173, #176 and this amendment, with the export at `--plan-cap 16384 --synthesis-cap 16384` and the writer without `--attempt-thinking`. Items 1 and 2 give its six commands, the checks each step must show and its conditions; item 3 its time (45 to 60 minutes expected) and exposure (USD 0).
3. **The revision and the adoption** follow Amendment 5: plan/on and extract/off bind the adoption; a flag that differs from the adopted card's, a synthesis flag earned at 16,384 included, is a finding; the adoption commit is the owner's, after Amendment 5's P11 check. A revised synthesis flag with `thinkingOn` true, under which the stage would send synthesis with the strict format, first needs one more fixture cell, `synthesis-16384-structured` (10 trials under the tolerant judge, at least 8 model syntheses, a trial the drops leave all unresolved counting as none), or the session does not ask for adoption. No settings file is edited for the runs: each takes the card pair from its own environment, and the beta build's settings file takes it when the build is cut.
4. **The re-measurement** is Amendment 6's three r3 runs under the revised card, read by its items 3 to 5, with the gap, held-chunk and synthesis-correction counts added (descriptive where marked).
5. **Values at `main` 6e3879e:** freeze `0b896d92114fd0454cccde638f0b1f3582e84b6bb429d8b398d43bc3dc61baf1`; default `4bb74c03239942d786ec9100d65b462ffe8378629c8ab3cd2eff32e26dd31636`; under admission `0160d8f314c39f5989f8cd4d0a80d3a433de505d1ab01f948d3f92333adf3a6f`; under the adopted card's roles with admission `6d6dbf4311bd090fd4c8122e3f6713f0de60772848740c26f6ed990f989466fc`; under the revised card's expected roles with admission `8c8a56b9cf80ac8f2056e7b4efa6061cddabbb8622bd9d4793d94bf8c9a56243`, which is ⟨H⟩ if no flag changes.

Changes: docs/experiments/e0-card-2026-11-13.md (Amendment 8); this file.

Evidence: The values were computed at 6e3879e on a clean tree, the freeze with `localScreenSourceFreeze` and the hashes with `researchProtocolSha256`; the revised roles are the adopted card's with synthesis at [16384, 16384]. Every command and option the amendment names exists at 6e3879e: `probe:export-schemas` with `--plan-cap` and `--synthesis-cap`, `serving-probe.py --only`, `probe:assess`, and `card:serving` with `--compare-*` and `--policy-out`. The time estimate rests on the 2026-11-17 re-probe's 44 minutes (BL-20261117-1356-e0-reprobe-result-plan-cap-16384).

Failures or blockers: None.

Limitations and non-claims: Nothing has run. The revised card's flags, rates and ⟨H⟩ come from the re-probe, and the expected ⟨H⟩ holds only if no flag changes. The re-measurement's three runs estimate no rate.

Paid exposure: None registered: every call goes to the owned endpoint at USD 0.

Next gate: the merge; the coordinating session reviewed the amendment itself at d3da113, and there is no separate reviewer. The re-probe then runs from the main checkout at a commit containing this amendment, after the window is announced to the lanes and the owner; then its result entry, item 4's extra cell if the card flags synthesis, the owner's adoption go, and the three runs.

References: The E0 card's Amendments 5, 6 and 7 and the addendum to Amendment 7; BL-20261118-0923-e0-amendment-7-fixtures-result; BL-20261118-0905-synthesis-evidence-id-tolerance; #172, #173 and #176.
