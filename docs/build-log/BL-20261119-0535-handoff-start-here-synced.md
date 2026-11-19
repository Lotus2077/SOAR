### BL-20261119-0535-handoff-start-here-synced -- 2026-11-19 -- The handoff's "Start here" is synced with the merges since its restatement: the r3 runs under the adopted card, E2's Amendment 1, and E2's runs as the next step

Status: `Implemented`

Scope or hypothesis: The owner asked whether everything is written and synced in the handoff. The restatement of 2026-11-18 (BL-20261118-1142-handoff-start-here-restated, #182) was written to be true at #184's merge; since then #185 to #188 merged. This entry records a sync of docs/HANDOFF.md's "Start here" section, not a new restatement.

Decisions:
1. **What changes:** the heading's date and sources (#155 to #188, `main` 9b171de); the state and the first step; §1's list of merges and its values (no freeze-covered file changed since 6e3879e; E0's r3 runs and E2's runs are made at 2996218); §3 gains the r3 runs under the adopted card (#186), E2's Amendment 1 (#187) and the "resolved" wording (#185); §4 marks E0's Amendment 8 done and E2's amendment merged; §5's next step is E2's runs, then their grading; §7 adds #183 and #186 to what is `Verified` and says the adopted card's only live use so far is #186.
2. **What does not change:** the owner's open items, the rules, and every decision already in force.

Changes: docs/HANDOFF.md; this file.

Evidence: The figures are those of the merged entries BL-20261118-1604-e0-amendment-8-remeasurement-result and BL-20261118-1605-e2-card-amendment-1. The freeze at 9b171de equals 0b896d92…: the only source changes since 6e3879e are two desktop files outside the freeze (#185), as that pull request recorded.

Failures or blockers: None.

Limitations and non-claims: No E2 run has started. The section describes `main` at 9b171de; later merges are read from `gh pr list` and `docs/build-log/`, as its first step says.

Paid exposure: None.

Next gate: E2's runs, announced to the lanes and the owner first.

References: docs/HANDOFF.md; BL-20261118-1142-handoff-start-here-restated; BL-20261118-1604-e0-amendment-8-remeasurement-result; BL-20261118-1605-e2-card-amendment-1; pull requests #182 and #185 to #188.
