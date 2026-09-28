# Same-episode local draft, cloud critique and local repair

Status: Implemented; runtime mechanics Verified through four synthetic
end-to-end fixtures. Application interface assertions remain unverified.
No real model episode or release is claimed by this report.

The new opt-in `local_critic_repair` route connects a local draft, one compact
cloud critique and an optional local repair inside one coding episode. It is
available in the application only when the compatible live profile is configured.
The existing cloud default and earlier policy meanings are preserved.

This follows the two-response critic calibration, which identified a real defect
in the rejected local draft and accepted the valid control. That signal did not
establish whether the local model could carry out the advice. The implementation
makes that next question measurable without splicing separate historical runs.

## Runtime contract

| Boundary | Implemented behavior |
| --- | --- |
| Draft | At most eight local requests, including a fresh visible check and explicit submission. |
| Critique | One tool-free cloud request built by the host from the original source and the exact checked draft. |
| Repair | At most four more local requests, only after a settled, valid repair verdict. The first repair request includes the actual parsed feedback. |
| Shared limits | Twelve cumulative local requests, thirteen total model requests, one deadline, and one episode/campaign accounting system. Unused draft calls cannot increase repair calls. |
| Failure | Invalid or insufficient critique stops. Unknown transport cost retains its reservation. There is no automatic retry, second critique or full cloud solver fallback. |
| Final artifact | Reconstruct against the original source, require a fresh final check and explicit submission, and preserve the draft critique as advice tied to the earlier source. |

The host hashes the baseline, candidate, patch, objective, visible command,
complete context, request body, visible response and typed verdict receipt. It
reconstructs the candidate independently from its trusted materialized baseline;
the worker cannot supply a replacement host path. A source change invalidates
check authority and the critique's currency. The repair conversation restarts
once under the recorded verdict while retaining cumulative counters and deadline.

The critic context deliberately has a small complete-source envelope: at most
64 files per revision and a 96 KiB bundle, with a request body capped at 128,000
bytes and output capped at 8,192 tokens. Unsupported files, incomplete context
and oversize bodies stop; source is not silently omitted. Final artifact
verification uses the ordinary workspace envelope instead of that prompt limit.
This is currently suitable for small admitted repositories, not broad repository
coverage.

Each draft admission must preserve the conservative maximum critic cost in both
episode and campaign capacity. At the configured USD 4/20 per million Sol rates,
the maximum headroom is USD 0.675840. This is an admission ceiling, not a charged
fee; only the actual critic request is reserved and subsequently settled. The
profile requires zero local API token fees for the owned GPU. The approximately
USD 3,500 purchase, power and utilization remain separate from API accounting.

## Verification record

Verification uses temporary synthetic providers and databases. It does not add
real model requests to the historical stage ledger.

- Host/store admission and adjacent behavior: 121 tests passed, including the
  final transactional monetary guard and preparation regression; focused strict
  TypeScript checks passed.
- Trusted context and existing routing scope behavior: 78 tests passed after
  extracting the unchanged strict patch parser into a standalone module.
- The application controller, configuration and compact critic parser: 35 tests
  passed in the initial application batch.
- Python final router/execution/native checks: 84 tests passed after source and
  response binding hardening. An earlier overlapping 101-test pass is historical
  evidence, not added to that final count.
- Both application TypeScript projects pass.
- The application interface test has not yet executed: both a fork-worker batch
  and a separate single-thread-worker attempt timed out during worker startup.
  Direct dependency initialization also exceeded bounded 30- and 60-second
  checks while progressing through CSS modules, before loading application code.
  Both child processes terminated; no dependency versions, test assertions or
  worker timeouts were changed. The precise underlying I/O cause is unconfirmed.
- The first four controller/HTTP/Python/Docker cases all stopped before worker
  launch because the new phase guard rejected the controller's initial
  preparation transition. They made zero synthetic or real provider requests;
  all fixture finalizers completed. The correction permits only the initial
  preparation event before any checkpoint or phase usage, never a solver reset.
- The second invocation passed all four cases in 29.86 seconds and exited zero.
  All cases verified caller-source immutability, source/check linkage, request
  accounting, replay, cleanup receipts and absence of owned Docker containers.
- Readiness metadata validation passed, with no high-confidence repository-file
  secret-pattern match. This is not a full-suite or release gate.

| Verified synthetic case | Observed requests and outcome |
| --- | --- |
| Acceptable draft | Three local requests and one critic; submitted the same checked draft without repair. |
| Repair required | Three draft requests, one critic and three repair requests; the exact actual feedback reached local and the changed final patch passed fresh checks. |
| Invalid critic JSON | Three local requests and one critic; stopped, retained the settled critic fee, and made no repair or retry. |
| Unknown critic transport | Three local requests and one critic; stopped, retained unknown exposure, and made no repair or retry. |

The passing invocation made nineteen synthetic model requests and zero real
provider requests. Synthetic usage values exercise charging and reservation
logic; they do not measure model speed, quality, token use or savings. The first
failed invocation remains recorded separately and is not relabeled as successful.

The initial application batch also exposed a real circular import through the
critic context helper and comparison module. Extracting the existing patch-scope
parser removed that cycle; all 78 affected context/scope tests then passed.
Cross-review corrected phase/check freshness, the final allowed edit, final
source invalidation, duplicate verification and the first repair feedback
binding. These are implementation corrections, not revisions to historical
model outcomes.

A read-only ledger check still matches the previous closure: 60 runs and 570
requests, ledger SHA
`8c59a88b4314b0fe1b6f077d7596226ec7cf8dacc6476062a9e8ead4d119d689`.
Earlier paid outcomes and unknown exposure are preserved.

The root closure receipt is
`191085907a3703e90d60ee83d451ec05341a53c943bde3dc62cc14fff1460c5d`.
It verifies all 37 runtime/fixture source bindings unchanged and links the
passing integration receipt
`8aa49e2a85a9a2ab5eb0772092a07d2617db1b69f0df3626039a8542bd99236e`
and the preserved failed invocation. Private fixture evidence stays outside
version control.

## Next experiment

The four runtime cases and independent source review pass. Next, freeze one
fresh complete policy episode with independent final acceptance. A submitted patch, visible
checks and an acceptable draft critique remain separate from that acceptance.
Only a fresh comparison can establish preserved quality and lower cost per
accepted task, including failed work and unknown fees. Retain the 20 percent API
savings and 25 percent median-latency gates, and keep the four untouched tasks
reserved. The previous four-of-six critique/repair acceptance failure remains.

References: [approved implementation plan](plans/MVP_LOCAL_CRITIC_REPAIR_V1.md),
[critic calibration](MVP_POST_DRAFT_CRITIC_CALIBRATION_REPORT.md),
[local-first rejection](MVP_LOCAL_FIRST_EXECUTION_REPORT.md),
[build log](BUILD_LOG.md).
