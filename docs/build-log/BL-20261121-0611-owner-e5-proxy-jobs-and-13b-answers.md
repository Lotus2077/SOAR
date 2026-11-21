### BL-20261121-0611-owner-e5-proxy-jobs-and-13b-answers -- 2026-11-21 -- The owner lets agents that mimic real users stand in for E5's real jobs, and answers 13b's three questions: real private documents, the bundle the session judges best for evaluation, and one synthetic desktop run before an owner build

Status: `Approved`

Scope or hypothesis: On 2026-11-21 the session reported where the experiments stand and named the three questions 13b's design leaves to the owner (BL-20261120-0646-desktop-document-review-13b-design, #203). The owner answered them and added a decision on E5. This entry records the owner's words, quoted, and the session's reading of each, which the owner may replace. `Approved` covers the owner's four decisions. The same pull request restates docs/HANDOFF.md's "Start here" around them.

Decisions:
1. **E5's real jobs may be proxied.** The owner's words: "E5: for the real jobs, this can be proxied by strong agents (the ones grow from real user communities that reflect their real needs) that mimic users and dispatch real tasks".
   - **The session's reading.** Agents that mimic users, grounded in the needs real user communities express, may stand in for the owner in E5. They bring real tasks to the desktop build and judge the results as those users would. The owner's own real jobs still count.
   - **What it changes.** It changes E5's card (the owner's jobs and verdicts, and the public-or-synthetic rule) and how the MVP measure's "real owner jobs" is read (docs/PLAN.md §1). So no proxy job counts before an E5 amendment registers five things: where the needs come from; how an agent turns one into a task and its inputs; who gives the verdict and by what rule; what the agents cost and where their text goes; and how the counts are read against the measure.
2. **13b may run on the owner's real private documents.** The owner's words: "work on my real private documents". 13b's route is local only, so a document goes only to the owner's Mac and the owner's own model endpoint. This replaces the public-or-synthetic rule for 13b's review route only; E5's card and the research beta's attestation are unchanged.
3. **The export bundle is the session's choice.** The owner's words: "choose what's best to test and evaluate the results". The session's choice: the bundle holds the six deliverables E6 graded and scored. The flags file stays out of it, as in E6's blind bundles. It stays in the task's own record, where the grading and scoring tools can read it, so a desktop review can be graded and scored as E6's were; 13b's tests show that they can. The verdict receipt carries the flags' counts.
4. **One synthetic desktop run is enough before an owner build.** Asked "Is one synthetic desktop run enough before an owner build?", the owner wrote "yes".

Changes: this file; docs/HANDOFF.md's "Start here", restated for 2026-11-21.

Evidence: The owner's message in the session's chat on 2026-11-21 at about 06:05 UTC, quoted as written.

Failures or blockers: None.

Limitations and non-claims: No E5 amendment exists yet, so no proxy job counts. Nothing of 13b is built.

Paid exposure: None here. Proxy agents may cost money; E5's amendment states the cost before any run, inside the USD 300 envelope (BL-20261117-0940-owner-direction-decisions-delegated, decision 5).

Next gate: 13b's code by lane S-desk, per #203 and decisions 2 to 4; E5's amendment for proxy jobs.

References: BL-20261120-0646-desktop-document-review-13b-design; docs/experiments/e5-card-2026-11-17.md; docs/PLAN.md; BL-20261117-0940-owner-direction-decisions-delegated; BL-20261120-0657-owner-opens-beta-with-fresh-check-and-starts-e5; BL-20261120-0233-e6-result.
