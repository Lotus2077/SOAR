### BL-20261118-1142-handoff-start-here-restated -- 2026-11-18 -- Handoff: docs/HANDOFF.md "Start here" restated for `main` at b17a590, with the merges of 2026-11-18, 13a.1's completion, E0's Amendment 8 re-probe and what waits on the owner

Status: `Implemented`

Scope or hypothesis: Replace "Start here (2026-11-17)", 691 lines, with "Start here (2026-11-18)", 245 lines, under the 250 the coordinating session set, for the next session and the owner. The sources are today's 24 entry files, pull requests #155 to #181 and `main` at b17a590, the merge of #180. The seven subsections stay, each rewritten from today's state rather than added to. It is today's one restatement (decision 5 of BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout).

Decisions: None of its own; the section restates what the entries and pull requests record. The pull request's description lists what each subsection now says.
- **Not without the owner** follows decisions 5 and 7 of BL-20261117-0940-owner-direction-decisions-delegated and Amendment 8, item 5.
- **Amendment 8's re-probe** is written as running, with one marked line that the coordinating session fills with its outcome before the merge (§4, item 1).
- **The e2e rule** is the one of #167 and BL-20261118-0800-git-command-deadline-15s: a failed electron-e2e run is read before anyone re-runs it, in place of one re-run.
- **The merge practice** is the one since the owner's delegation, as the coordinating session states it: the session merges its own and the lanes' pull requests on a clean review and green CI, and asks the owner by name only for the items under "Not without the owner".

Changes: docs/HANDOFF.md, the "Start here" section only; this file.

Evidence: The default and admission hashes and the source freeze were recomputed at b17a590 and match Amendment 8's values; #180 changed no code. Every entry ID the section names exists in the archive or under docs/build-log/, apart from BL-20261113-0730, which the section says is on draft #86; each pull request's state is GitHub's at 11:42 UTC. `pnpm --silent validate:build-log` against the branch point and `pnpm validate:readiness` exit 0. The section names no address, key, local path or account name. The coordinating session read it in full at c2708d1 and asked for one correction, to §6's merge practice, which is taken.

Failures or blockers: None.

Limitations and non-claims: No reviewer read the draft before the coordinating session. The re-probe's outcome is not in it until the marked line is filled. The E2 and E6 runbooks it names are outside Git.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: The coordinating session fills the marked line, reads the section and merges on green CI under the owner's go for handoff restatements (BL-20261117-0530-owner-merge-go-handoff-restatements).

References: BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout; BL-20261117-0940-owner-direction-decisions-delegated; BL-20261118-1114-e0-card-amendment-8.
