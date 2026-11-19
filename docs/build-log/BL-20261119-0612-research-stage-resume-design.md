### BL-20261119-0612-research-stage-resume-design -- 2026-11-19 -- Research stage resume designed: a paused desktop research stage resumes by reusing its settled calls from a reply journal, and sends only the rest

Status: `Proposed`

Scope or hypothesis: Today a research stage that started and did not transfer its packet can never continue. session.ts refuses it as `research_stage_not_replayed`, because no call persists its reply and a restart would reset the role ceilings while keeping the spent calls. Decision 3 of BL-20261118-0438-desktop-local-research-13a-design has the desktop warn that a pause or quit ends a running stage. Two r3 runs took 36 and 42 minutes (BL-20261118-0606-e0-r3-remeasurement-result). Manus's workflows survive a restart by replaying against a journal of completed calls, and on 2026-11-19 the owner asked this session to take that idea forward. This entry designs the resume and builds nothing. The pull request's description holds the file references.

Decisions:
1. **A reply journal.** When a zero-risk local call of a research reader context settles, the store keeps, in the same transaction, the reply the stage uses: content, finish reason and usage, never reasoning, with the request body's digest, keyed by the row. Only a context whose diagnostic retention is `raw` (public or synthetic-attested, as every desktop research task is) keeps one. The journal never enters a row, event, receipt, export or diagnostics file. It is deleted when the stage transfers its packet or the task ends.
2. **The replay.** A resume of an unfinished stage runs the stage again on the same inputs, card, roles and models. A request whose purpose and body digest match a journaled settled row of the reader context, not yet used in this run, is answered from the journal, in commit order, without a dispatch. Every other request is sent as today. The stage's logic, ceilings and counts are unchanged, so every reused call counts toward the ceiling it counted toward before, which removes the reason session.ts gives for refusing.
3. **No row is edited.** The `failed` row that a pause leaves stays `failed`. The producer counts a `failed` reader row only when no later row of the same context, purpose and packet exists; when one exists, the later row is that call. No uninterrupted stage has such a row, so every producer made today is unchanged. A replay that diverges leaves a settled row unused, and the producer's existing count check refuses the packet.
4. **Still refused** as `research_stage_not_replayed`: a blocking row; a settled reader row without its journal entry (a stage begun before this change, or a hash-only context); an assist or a diagnostics sink (headless runs only). A card, configuration or model change stays refused as today.
5. **Admission.** Its budget part is unchanged. Its clock part is decided before the first request that is actually sent, over the work left at that point, against the time left. In a fresh run that point is the stage's start, so fresh runs are unchanged. No policy value moves, so the protocol hash does not move: a resume changes which calls are sent, never what a call asks.
6. **Counts.** A resumed run's stage events say how many calls and tokens they reused. The verdict receipt and registry-row.py count only the calls that were sent, so nothing is counted twice.
7. **The desktop.** The pause and quit-after-waiting offers say that a running stage resumes from its settled calls. The badge and the stage section show the calls reused and sent. Resume is offered for an unfinished stage whose journal is complete.
8. **Left for later, each its own decision.** A crash or "quit now" leaves the in-flight row `committed`, which nothing resolves, so only Cancel is offered. Resolving such a zero-risk local row as `failed` at the next start is a ledger rule, for a later part with a skeptic. The task's 90-minute clock keeps running while the task is paused, so a resume helps only inside that window. Stopping the clock during a pause would change every desktop task, so that is the owner's call.
9. **Parts.** (a) The journal, the replay, the producer rule and the session's resume, tested on a scripted broker, with a skeptic on the ledger rules. (b) The desktop's offers, counts and receipt, plus a gated end-to-end case that pauses mid-stage and resumes. Each part gets one light review.

Changes: this file. No code.

Evidence: This session and one read-only agent read `main` 5ab1b47. A settled row holds `packetSha256` and `responseSha256` but no reply, and no stage reply persists anywhere. A pause resolves its zero-fee in-flight row `failed`. The producer counts every row no retry superseded. The task's clock runs from its first start. Every `research_stage` event's calls enter the verdict receipt.

Failures or blockers: None.

Limitations and non-claims: Nothing is built or measured. The journal stores local replies, only for raw-retention contexts. Decision 8 bounds the value. Whether the endpoint returns the same reply for the same body does not matter, because nothing is asked twice.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: One light review of this design, then the coordinating session's or the owner's read before part (a) starts.

References: BL-20261118-0438-desktop-local-research-13a-design; BL-20261118-0652-desktop-research-task-view; BL-20261118-0606-e0-r3-remeasurement-result; BL-20261109-0336-desktop-resume-reasons-design.
