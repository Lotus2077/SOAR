### BL-20261118-1142-handoff-start-here-restated -- 2026-11-18 -- Handoff: docs/HANDOFF.md "Start here" restated for `main` at b17a590, with the merges of 2026-11-18, 13a.1's completion, E0's Amendment 8 re-probe and the card's adoption, and what waits on the owner

Status: `Implemented`

Scope or hypothesis: Replace "Start here (2026-11-17)", 691 lines, with "Start here (2026-11-18)", 248 lines, under the 250 the coordinating session set, for the next session and the owner. The sources are today's 24 entry files, pull requests #155 to #184 and `main` at b17a590, the merge of #180. The seven subsections stay, each rewritten from today's state rather than added to. It is today's one restatement (decision 5 of BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout).

Decisions: None of its own; the section restates what the entries and pull requests record. The pull request's description lists what each subsection now says.
- **Not without the owner** follows decisions 5 and 7 of BL-20261117-0940-owner-direction-decisions-delegated and Amendment 8, item 5.
- **Amendment 8's re-probe and the card's adoption** are written as done: §4, item 1 gives the re-probe's outcome in the coordinating session's words, whose figures match BL-20261118-1206-e0-amendment-8-reprobe-result (#183), and the adoption follows BL-20261118-1232-serving-card-2026-11-18-adopted (#184), which merges before this pull request.
- **The e2e rule** is the one of #167 and BL-20261118-0800-git-command-deadline-15s: a failed electron-e2e run is read before anyone re-runs it, in place of one re-run.
- **The merge practice** is the one since the owner's delegation, as the coordinating session states it: the session merges its own and the lanes' pull requests on a clean review and green CI, and asks the owner by name only for the items under "Not without the owner".

Changes: docs/HANDOFF.md, the "Start here" section only; this file.

Evidence: The default and admission hashes and the source freeze were recomputed at b17a590 and match Amendment 8's values; #180 changed no code. Every entry ID the section names is on `main` once #184 merges, apart from BL-20261113-0730 on the draft #86; each pull request's state is GitHub's at 12:34 UTC. `pnpm --silent validate:build-log` against the branch point and `pnpm validate:readiness` exit 0. The section names no address, key, local path or account name. The coordinating session read it in full at c2708d1 and asked for one correction, to §6's merge practice, which is taken.

Failures or blockers: None.

Limitations and non-claims: No reviewer read the draft before the coordinating session. The re-probe's and the adoption's figures are #183's and #184's entries', not re-derived from their records. The E2 and E6 runbooks it names are outside Git.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: The coordinating session merges it after #184, on green CI, under the owner's go for handoff restatements (BL-20261117-0530-owner-merge-go-handoff-restatements).

References: BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout; BL-20261117-0940-owner-direction-decisions-delegated; BL-20261118-1114-e0-card-amendment-8.
