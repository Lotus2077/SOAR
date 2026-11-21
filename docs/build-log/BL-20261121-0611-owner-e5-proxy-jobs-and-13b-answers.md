### BL-20261121-0611-owner-e5-proxy-jobs-and-13b-answers -- 2026-11-21 -- The owner lets agents that mimic real users proxy E5's real jobs by dispatching real tasks, and answers 13b's three questions: real private documents with Tier O's safeguards waived for 13b, the bundle the session judges best for evaluation, and one synthetic desktop run before an owner build

Status: `Approved`

Scope or hypothesis: On 2026-11-21 the session reported where the experiments stand and named the three questions 13b's design leaves to the owner (BL-20261120-0646-desktop-document-review-13b-design, #203). The owner answered them, added a decision on E5, and then answered one follow-up question on Tier O. This entry records the owner's words, quoted, and the session's reading of each, which the owner may replace. `Approved` covers the owner's four decisions and the waiver. The same pull request restates docs/HANDOFF.md's "Start here" around them.

Decisions:
1. **E5's real jobs may be proxied.** The owner's words: "E5: for the real jobs, this can be proxied by strong agents (the ones grow from real user communities that reflect their real needs) that mimic users and dispatch real tasks".
   - **The session's reading,** which the owner may replace. Agents that mimic users, grounded in the needs real user communities express, may proxy the owner in E5 by dispatching real tasks to the desktop build. Who gives each job's verdict, and by what rule, is not decided: E5's amendment proposes it, and verdicts stay the owner's until then (BL-20261117-0940, decision 7). The owner's own real jobs still count.
   - **What it changes.** E5's card admits only the owner's own jobs, public or synthetic, with the owner's verdicts. So no proxy job counts before an E5 amendment registers where the needs come from, how an agent turns one into a task and its inputs, who gives the verdict and by what rule, and what the agents cost and where their text goes. Whether proxy jobs also count toward the MVP measure, whose jobs the owner chose and ran (docs/PLAN.md §1), is left to that amendment and the owner's call.
2. **13b may run on the owner's real private documents, with Tier O's safeguards waived.** The owner's words: "work on my real private documents". Asked "Do PLAN.md's Tier O safeguards still apply before 13b runs on your private documents?", the owner chose "Waive them for 13b". So 13b's local route may take real private documents without PLAN.md §3's Phase 3 preconditions: the box checklist, a transport by SSH local forward or WireGuard, the packet-capture canary, the Mac's settings and the code it lists. The session's reading, which the owner may replace: the waiver covers 13b's route only, and E5's card and the research beta keep the public-or-synthetic rule. The risk the owner accepts is in E5's card: the endpoint is plain HTTP to a non-loopback address, and none of the box's 8 hardening gaps is recorded fixed.
3. **The export bundle is the session's choice,** which the owner may replace. The owner's words: "choose what's best to test and evaluate the results". The choice: the bundle holds the six deliverables E6 graded and scored. The flags file stays out of it, as in E6's blind bundles, and stays in the task's own record, so a desktop review can be graded and scored as E6's were; 13b's tests are to show that the grading and scoring tools can read that record.
4. **One synthetic desktop run is enough before an owner build.** Asked "Is one synthetic desktop run enough before an owner build?", the owner wrote "yes"; no E6-style grading of a desktop run is required first.

Changes: this file; docs/HANDOFF.md's "Start here", restated for 2026-11-21.

Evidence: The owner's message in the session's chat on 2026-11-21 at about 06:05 UTC, quoted as written, and the owner's answer to the follow-up question at about 06:40 UTC.

Failures or blockers: None.

Limitations and non-claims: No E5 amendment exists yet, so no proxy job counts. Nothing of 13b is built. With the waiver, PLAN.md's privacy promise does not cover 13b's route: a private document reaches the owner's box over plain HTTP, and the box's logging and egress are not verified.

Paid exposure: None here. Proxy agents may cost money; E5's amendment states the cost before any run, inside the USD 300 envelope (BL-20261117-0940-owner-direction-decisions-delegated, decision 5).

Next gate: 13b's code by lane S-desk, per #203 and decisions 2 to 4; E5's amendment for proxy jobs.

References: BL-20261120-0646-desktop-document-review-13b-design; docs/experiments/e5-card-2026-11-17.md; docs/PLAN.md (§1, §3 Phase 3); BL-20261117-0940-owner-direction-decisions-delegated; BL-20261120-0657-owner-opens-beta-with-fresh-check-and-starts-e5; BL-20261120-0233-e6-result.
