# Phase 4 experiment record — November 5, 2026

This indexes preserved [BUILD_LOG](../BUILD_LOG.md) decisions and results without rewriting history.
Dates follow the log; exact UTC observations remain in cited entries. [PLAN](../PLAN.md) holds living status.

**As of this audit:** service compatibility is qualified, but the artifact/content
gate remains failed. H4 is not accepted; the newly conditional three-loop sequence
and H5 have not started. The latest planner repair is verified offline, with green
source CI. PRs 32, 33 and 34 were merged into main on November 5; the
merge evidence is recorded in [BL-20261105-1042][main-sync].

## Recovery, accounting and Claude calibration

- **October 31 — cleanup recovery:** cancelled tasks can retry interrupted cleanup
  and recover saved artifacts without replay. Controller/renderer regressions and
  integrated checks passed. See [BL-20261031-1259][cleanup] and [BL-20261031-1305][integration].
- **October 31 — accurate metrics:** pipeline/critique truncations and judged support
  rates were corrected through additive registry records, preserving original
  measurements and failures. See [BL-20261031-1304][metrics].
- **October 31 — Claude calibration:** the owner accepted two preserved probes
  together for the step-0 gate. The exposed all-cloud run then completed 79 settled
  cloud calls in 525.522 seconds for USD 1.127758. Console reconciliation accepted
  USD 1.151653 including probes against the owner's USD 1.15 reading, with no competing
  usage confirmed. This establishes transport/cost calibration, not capability or
  H4/H5 acceptance. See [BL-20261031-1328][composite], [1636][console] and [1640][no-use].

## Local serving migration and qualification

- **October 31 — q4t and the Thor recipe:** inventory found q4t's greedy contract
  incompatible with Heavy sampling. A recoverable NemoClaw-derived trial stalled;
  cleanup and q4t restoration were verified. An instrumented retry reached readiness
  with 12 GiB KV capacity. These are separate failed/recovered and ready outcomes.
  See [BL-20261031-1723][q4t], [2003][rollback] and [2040][ready].
- **October 31–November 1 — initial qualification/H4:** bounded combined qualification
  passed after an explicitly approved assertion correction. H4 later accumulated six
  attempts, including one mechanically accepted deck loop and failed/interrupted
  research attempts; full H4 acceptance remained absent. See [BL-20261031-2208][qualified]
  and the cumulative outcome [BL-20261101-2044][h4].
- **November 1–3 — fast-v3:** protected image/conversion work, recovery and named
  continuations are retained in the log. F2 failed before dispatch at the fixture's
  16,384-token prompt cap; later offline admission repair did not erase that slot.
  A subsequent disk gate stopped candidate admission, and read-only attribution
  identified accumulated router dumps. See [BL-20261102-0847][f2] and [BL-20261103-1033][disk].
- **November 4 — API-only pivot:** the owner authorized the new API target and
  November 5 cutoff. API-native token admission distinguishes observable contracts
  from unobservable physical identity. All sixteen qualification cases passed:
  fifteen settled plus the planned F15 cancellation UNKNOWN, with F16 recovery.
  Matched cold-cache workloads measured 70.20 end-to-end and 153.77 decode tokens/s
  versus an 18.46 end-to-end baseline; these are not all-workload averages.
  See [BL-20261104-1319][api] and [1419][api-result].

## Artifact pilots and the integrated v4 trial

| Attempt | Actual outcome | Record |
| --- | --- | --- |
| First API pilot | Four settled calls/four tools; no substantive report by the draft gate. The refused fifth model entry was not a generation. | [November 4, 1419][api-result] |
| Named replacement | Four settled calls/four successful tools, 3,607 output tokens, 51.899 seconds; inspection continued without a report. | [November 5, 0231][replacement] |
| Final preloaded pilot | Four calls/four tools, 14,801 output tokens, 205.151 seconds; report/claims artifacts and mechanical checks passed, final content rejected. | [November 5, 0357][preloaded] |
| v4 original startup | Read-only permissions inherited by the ledger copy prevented initialization; zero new claims or model requests. Failed namespace retained. | [November 5, 0743][startup] |
| Named startup continuation | Startup succeeded; eight index calls covered all 24 source entries, then both planning replies failed. Ten requests settled, no extraction/synthesis/writer. | [November 5, 0918][continuation] and [0923][planning] |

The final pilot's false corpus-absence assertions and missing required coverage
were rejected despite verified quote occurrence. Offline inspection found 21/24
index entries without semantic metadata, incomplete extracted-source coverage and
a truncated synthesis. These observations motivated the generic [v4 coverage design](../plans/PHASE4_RESEARCH_COVERAGE_V4.md),
whose offline controls were verified in [BL-20261105-0454][v4-offline]. They did not
prove that any single repair would produce acceptable content.

The continuation used 68,460 input / 17,505 output tokens in 169.964 seconds at
USD 0, with no truncation observed. Raw planner replies and caught validation errors
were not retained, so the actual rejected fields remain unknown. Offline examples
reproduced omitted prompt/schema bounds; causation for the live failure is unproven.

## Latest repair, accounting and remaining gates

The [planner contract repair](../plans/PHASE4_RESEARCH_PLAN_CONTRACT_REPAIR_V1.md)
exposes the unchanged full schema, records bounded safe diagnostics and gives the
existing second call specific feedback plus bounded, untrusted prior-reply context.
All 159 unique focused tests, both TypeScript checks and independent review passed;
see [BL-20261105-0944][repair]. No live success or additional attempt is implied.

| Accounting population | Preserved actual total |
| --- | --- |
| Standalone fast-v3/API/pilot/v4 allocation | 42 slots, seven claims; 41 committed, 40 settled, one historical UNKNOWN; USD 0 known fees/reservations. One other historical slot failed before dispatch. |
| Three API artifact pilots, included above | Twelve settled model requests and twelve tool invocations; USD 0. |
| Historical H4, separate population | Six attempts; 352 dispatches, 348 settled, four unresolved; USD 0 known fees/reservations. |
| Claude calibration, separate population | USD 1.151653 settled including probes; Console reconciliation accepted. |

The 70 unused slots under the 112-slot ceiling are not retry authority. H4 retains research → deck → split
order and USD 0.60 all-history split cap; H5 retains eighteen rows / USD 21.60 total /
USD 3 cloud row / USD 0.60 split row. The last approved cutoff is November 5, 18:00
Asia/Shanghai. Fresh H5 inputs and gold remain unread. A new reviewed, named live
amendment and actual integrated research/writer acceptance still precede downstream work.

Source CI is green: [PR #33 run 41950175860](https://github.com/Lotus2077/SOAR/actions/runs/41950175860) at `c0db0be`,
and [PR #34 run 41950918777](https://github.com/Lotus2077/SOAR/actions/runs/41950918777) at `181f024`,
both with check and Electron end-to-end success. PR 32 also passed both jobs
after its cancelled end-to-end job was rerun at the same head in
[run 41902115080, attempt 2](https://github.com/Lotus2077/SOAR/actions/runs/41902115080).
The three source merges preserve the exact reviewed trees and original commits;
[BL-20261105-1042][main-sync] records their identities and scope.
Private raw traces/databases remain outside Git; selected hashes and limitations are in the log.

[cleanup]: ../BUILD_LOG.md#bl-20261031-1259-cancelled-cleanup-recovery----2026-10-31----cancelled-tasks-retry-interrupted-cleanup-without-replay-and-regain-saved-artifacts
[integration]: ../BUILD_LOG.md#bl-20261031-1305-integrated-corrections-verified----2026-10-31----full-offline-checks-pass-for-the-cleanup-accounting-and-probe-verdict-integration
[metrics]: ../BUILD_LOG.md#bl-20261031-1304-experiment-metrics-and-current-status----2026-10-31----count-pipeline-and-critique-truncations-correct-judged-support-rates-and-update-project-status
[composite]: ../BUILD_LOG.md#bl-20261031-1328-composite-probe-owner-adjudication----2026-10-31----owner-accepts-the-two-preserved-shape-probes-together-for-this-calibration-only
[console]: ../BUILD_LOG.md#bl-20261031-1636-claude-console-reconciled----2026-10-31----owner-console-evidence-completes-historical-claude-step-1-acceptance
[no-use]: ../BUILD_LOG.md#bl-20261031-1640-console-no-competing-usage-confirmed----2026-10-31----owner-explicitly-reconfirms-the-calibration-reconciliation-window-had-no-competing-usage
[q4t]: ../BUILD_LOG.md#bl-20261031-1723-flash-next-box-inventory----2026-10-31----read-only-ssh-inventory-identifies-q4t-and-a-concrete-heavy-contract-conflict
[rollback]: ../BUILD_LOG.md#bl-20261031-2003-nemoclaw-trial-failed-q4t-recovered----2026-10-31----candidate-startup-stalls-reconcile-failed-container-cleanup-and-verify-q4t-recovery
[ready]: ../BUILD_LOG.md#bl-20261031-2040-nemoclaw-retry-ready----2026-10-31----instrumented-retry-reaches-api-readiness-with-12-gib-kv-and-unchanged-context
[qualified]: ../BUILD_LOG.md#bl-20261031-2208-flash-qualification-accepted----2026-10-31----accept-the-bounded-combined-flash-next-qualification
[h4]: ../BUILD_LOG.md#bl-20261101-2044-writer-completion-stopped----2026-11-01----preserve-the-failed-draft-first-writer-attempt-and-quantify-its-generation-burden
[f2]: ../BUILD_LOG.md#bl-20261102-0847-qualification-f2-precommit-failed-recovery-pending----2026-11-02----stop-qualification-on-the-second-fixture-before-dispatch-preserve-accounting-and-request-exact-qualified-recovery
[disk]: ../BUILD_LOG.md#bl-20261103-1033-disk-usage-attributed-read-only----2026-11-03----identify-accumulated-router-dumps-and-model-storage-behind-the-disk-gate
[api]: ../BUILD_LOG.md#bl-20261104-1319-api-only-target-and-new-window-approved----2026-11-04----accept-the-owner-directed-api-only-experiment-target-and-november-5-cutoff
[api-result]: ../BUILD_LOG.md#bl-20261104-1419-api-only-qualification-passed-pilot-first-draft-refused----2026-11-04----verify-full-api-qualification-and-retain-the-failed-artifact-pilot
[replacement]: ../BUILD_LOG.md#bl-20261105-0231-api-only-replacement-pilot-first-draft-failed----2026-11-05----retain-the-replacements-four-successful-inspection-turns-and-failed-draft-gate
[preloaded]: ../BUILD_LOG.md#bl-20261105-0357-final-pilot-artifacts-created-content-rejected----2026-11-05----preserve-completed-artifacts-and-reject-unsupported-final-coverage
[v4-offline]: ../BUILD_LOG.md#bl-20261105-0454-research-v4-offline-trial-controls-verified----2026-11-05----verify-the-complete-offline-path-and-hold-the-new-allowance
[startup]: ../BUILD_LOG.md#bl-20261105-0743-research-v4-preclaim-startup-failed----2026-11-05----preserve-the-zero-dispatch-ledger-initialization-failure
[continuation]: ../BUILD_LOG.md#bl-20261105-0918-startup-continuation-approved----2026-11-05----record-the-named-one-time-startup-continuation-approval
[planning]: ../BUILD_LOG.md#bl-20261105-0923-research-v4-planning-failed----2026-11-05----preserve-the-all-settled-planning-failure-and-close-continuation-authority
[repair]: ../BUILD_LOG.md#bl-20261105-0944-planner-contract-offline-verified----2026-11-05----implement-and-verify-the-bounded-planner-contract-repair-offline

[main-sync]: ../BUILD_LOG.md#bl-20261105-1042-experiment-stack-integrated-main----2026-11-05----merge-the-reviewed-experiment-stack-and-record-exact-main-integration-evidence
