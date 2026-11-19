### BL-20261119-1555-owner-fix-writer-bugs-first -- 2026-11-19 -- The owner chooses to fix the writer's two faults that E2 exposed before E6 and a second E2 batch

Status: `Approved`

Scope or hypothesis: E2's result (BL-20261119-1454-e2-result) left five writer runs ended at a bound. Lane S-pipe's read-only diagnosis of their records found two faults in the writer's code, which every desktop writer shares. The session put one question to the owner: "Fix the two writer bugs before E6 and an E2 re-run, or run E6 as is?" This entry records the answer before anything is built.

Decisions:
1. **The owner's answer, quoted:** "Fix first" (2026-11-19, about 15:35 UTC).
2. **What it approves (S-pipe's two levers):**
   - **Ledger feedback.** The claims check accepts and ignores arguments. Finishing and the host's check at the bound return the check's claim codes and citation mismatches. Under the twelve-call bound, the host also runs the check once when claims.json first appears.
   - **The length nudge.** After a reply is cut off while reasoning, the nudge says so, and it says that write_file replaces the whole file, so later pieces use append_file. It no longer asks for ~1,500-character pieces.
3. **Not approved:** thinking turned off after a cut-off, and any change to Heavy's 90-minute clock, its 80-call allowance or its per-reply cap.
4. **The order:** one code pull request with its design entry and tests, then an E2 amendment that registers a second batch at the fixed commit and is reviewed before its first run, then E6 at the same commit, with its card-state entry first.
5. **A constraint the session sets:** the fix keeps both research protocol hashes, the default 4bb74c03… and 99bbc0e6… under the adopted card. That way the adopted card stays valid, and today's packets can seed the second batch. If either hash must move, the pull request says so before it merges.

Changes: this file.

Evidence: S-pipe worked from read-only copies of the batch's run directories and replayed the ledger check with main's code. All 22 length cut-offs in the batch came while reasoning. The claims check refused 41 of 41 calls. The two clock-bound Heavy runs rewrote report.md with write_file 21 and 36 times and never started claims.json. The two writer-2 failures were a 694-character claim sentence over the 600 limit and a citation [C40] past a ledger that ends at C39.

Failures or blockers: None.

Limitations and non-claims: The causes are read from 12 runs' records and not tested. Nothing is built yet. Whether the fixes change any outcome is for the second batch to show.

Paid exposure: None.

Next gate: S-pipe's pull request with one review, then the E2 amendment.

References: BL-20261119-1454-e2-result; docs/experiments/e2-card-2026-11-17.md; BL-20261117-0940-owner-direction-decisions-delegated; BL-20261118-1232-serving-card-2026-11-18-adopted.
