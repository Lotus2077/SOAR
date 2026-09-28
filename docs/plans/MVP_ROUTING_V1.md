# App-integrated coding routing MVP

Status: Approved for implementation and bounded evaluation by the owner's active
goal to execute the four next steps and pursue measured savings with preserved
quality. This supersedes the prior local-only stage closure only for this new
stage; prior evidence and costs remain unchanged.

## Scope and execution contract

1. Complete the local control loop with native tools, a trusted exact visible-check
   action, source-bound check freshness, detection of repeated command/output with
   unchanged source, and a finishing reserve. Three consecutive identical
   observations or two failed trusted checks produce an observable checkpoint.
2. Integrate local-only, local-first and cloud-plan/local-execute into the app,
   alongside existing fixed policies. The main process admits every request and
   persists phase changes, checks, routes, usage and immutable artifacts. Local-first
   can escalate once; cloud-plan/local uses one planner request and at most one
   later recovery phase. Neither protocol failure nor unknown accounting authorizes
   automatic escalation. Local success avoids cloud in local-first mode.
3. Freeze the implementation and evaluate twelve fresh tasks under cloud-only,
   local-only, local-first and cloud-plan/local. Use the same task, source snapshot,
   check, independent evaluator, total deadline and model-call ceiling per task.
   Randomize balanced arm order; preserve all failures and unknowns. Held-out oracle
   results and reviewer judgments must not enter prompts or routing signals.
4. Evaluate quality, API cost per independently review-acceptable patch and latency.
   Advance a policy only with no additional material regression and a meaningful
   cost reduction; initial advancement thresholds are at least 20 percent lower API
   cost per acceptable patch, no fewer accepted tasks than cloud-only, and no more
   than 25 percent median latency increase. A twelve-task screen is a fail-fast
   filter, not population-level noninferiority proof. Confirmation on fresh tasks
   is required before claiming deployment-quality equivalence.

## Initial bounds

The new C arm maps to `prepared_cloud`: cloud-only with the same bounded host
file inventory supplied to L/E/P. It is the strongest prior cost-per-acceptable
baseline. The historical C/D/H labels and outcomes are unchanged. All four new
arms use 30-second generated commands, 60-second exact visible checks and a final
check reserve before every request. A late admission acknowledgement cannot
borrow that reserve. Allowed paths are supplied identically to every arm and
checked against the full submitted patch before independent scoring.

The six initial calibration episodes reuse two exposed native tasks (incremental
UTF-8 lines and cachetools peek) under L/E/P. They test the previously observed
progress/finishing failures through the new app path; they are not held-out quality
evidence. Their source, task, scope, evaluator and runtime identities must be
frozen separately, with one-use dispatch/evaluation claims and the same stage
ledger. The 12 fresh comparison tasks remain outside calibration.

The new stage permits at most USD 150 of new cloud API exposure, including
unresolved requests and planner/recovery calls. Initial allocation is at most six
calibration episodes at USD 3 each plus twelve four-arm blocks: three potentially
paid arms at USD 3 each per block, or USD 108. Local-only has zero attested token
fees. The remaining USD 24 is an explicitly recorded reserve, not permission to
silently retry a failed assignment. Any use is a separately frozen follow-up within
the same USD 150 aggregate bound. No paid work starts before runtime tests, source/
reference proofs, admission parity, provider readiness and frozen configurations.

Per episode: at most 40 total model requests, 600 seconds of solving, 8192 output
tokens and 256000 serialized input bytes per coding request, 120-second HTTP wall
deadline, 30-second generated command deadline and 60-second trusted check deadline.
The local phase allows at most 24 requests, with its final two reserved for check,
submission or explicit help. Escalation must reserve enough remaining time for a
complete cloud request and final verification. An incomplete request or cleanup
stops its batch and is never automatically retried.

Only new synthetic/public task material and already explicitly admitted public
repositories may be sent to the owner's existing local endpoint or explicitly
selected OpenAI provider. Keys stay in trusted process memory. Gold and reference
solutions never enter task containers or provider prompts. All generated commands
execute only in credential-free network-disabled Docker. The approximately USD
3500 owned device, power, utilization and amortization remain separate from API
fees; report break-even sensitivities rather than calling local computation free.

## Acceptance evidence

Require app-level policy selection, routing/check state, patch preview/export,
cancellation/restart recovery and both offline/provider-fixture tests. For live
claims require exact admitted request/receipt identities, complete total costs,
independent candidate grading and blind code review; passing visible checks alone
is insufficient. Preserve a full patch and structured command/check evidence in a
handoff without exposing internal reasoning. Unfinished/recovered artifacts remain
separate from completed submissions and owner Keep/Reject decisions.

The archived previous worker/native helper hashes preserve the prior calibration
configuration before runtime evolution. No commit, push, installer or release is
part of this milestone unless separately requested.
