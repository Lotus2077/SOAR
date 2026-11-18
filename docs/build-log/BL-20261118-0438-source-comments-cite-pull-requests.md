### BL-20261118-0438-source-comments-cite-pull-requests -- 2026-11-18 -- Source comments cite pull requests instead of build-log entry IDs

Status: `Implemented`

Scope or hypothesis: The owner's change of plan in BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout puts no entry IDs in source files. This change replaces every entry ID cited in a comment or docstring under src/ and scripts/ with the number of the pull request that added the entry to `main`. It changes comments only.

Decisions:
1. **The mapping.** An ID names the pull request of the first first-parent commit on `main` that added its heading: 85 distinct IDs and 270 citations in 57 files, naming 47 pull requests, plus three date-only references (#28 and #12). One wrapped ID and eight phrasings were fixed by hand.
2. **What stays.** Eight IDs in scripts/validate-build-log.ts are data the validator reads. Test titles are out of scope.
3. **When.** It merges after the r3 series and before the next fixtures run, so the source freeze moves once.

Changes: 57 files under src/ and scripts/, comments and Python docstrings only; tests/unit/private-agent-research-pipeline.test.ts, whose pin of the hook contract's bytes moves to d8ba77a0… because that file's comments changed; this file.

Evidence:
- **The code is unchanged against `main` 468fdca.** The 51 TypeScript files minify to identical code, the 5 Python files parse to identical trees once docstrings are set aside, and the shell script differs in one comment.
- **The hashes are unchanged.** `researchProtocolSha256()` is e3e08871… by default and f157570b… under admission, the adopted card binds af4715a1…, and P10's 18 request bodies are byte-identical.
- **The source freeze moves** from `main`'s 15aca2ead08f68c782f17f522697631b7250971f1fb189c25b0e3af75d8dfc6e (since #160) to e8d78bd859beddb043e91386ac705da46495a702e182ee522a8367df7c68c12b.
- **Checks:** typecheck, readiness and the validator pass. The full suite passes with a 30 s test timeout: 202 files and 4,012 tests, 88 skipped, none failed. At the default 5 s, two runs under a load average near 30 each timed out two tests: the validator's command-line test both times, and an assist-capture and a sandbox-capture test once each. Each passes alone.

Failures or blockers: None.

Limitations and non-claims: A pull request is coarser than an entry: a comment that cites "decision 5" now points to the pull request, whose entry holds that decision.

Paid exposure: None.

Next gate: CI, then the coordinating session's merge after its check that only comment lines changed. A run after the merge names the new freeze.

References: BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout; #159, the entry-file layout.
