# Local model capability and routing diagnosis

Study date: 2026-09-08. Status: bounded study completed; measurements below are
separated from proposed runtime changes. This extends the completed
[original hybrid screen](MVP_HYBRID_SCREEN_REPORT.md), which remains unchanged.

Conclusion: the original hybrid result cannot support rejecting the local
model's coding ability. It tested a fixed read-only role, encountered concrete
interface failures and forwarded no local evidence to cloud. The new study
demonstrates useful source-provided coding, a thinking-budget tradeoff and real
code defects. It also finds repeated protocol and progress failures in the
autonomous harness. Reliable native-tool coding, heavy-session quality and
hybrid savings remain unproven.

## Subsequent native calibration

The separate [native coding calibration](NATIVE_LOCAL_CALIBRATION.md) subsequently
completed 60 local requests with preserved tool calls/results and no protocol
failures. Two of four exposed tasks submitted and passed independent checks;
two remained unfinished. That later evidence verifies native execution in
isolation and supersedes the earlier multi-turn verification gap. The 118-request
study and all of its findings below remain unchanged. Production routing and
hybrid savings remain unverified.

## What the original screen actually tested

The original result does **not** establish that the local model is a weak coding
model. The user-selected hybrid workflow put it in a read-only retrieval phase.
It could neither produce the candidate patch nor eliminate the cloud solver.
There is no dynamic model-selection or escalation mechanism in that workflow.

In all twelve hybrid runs the local stage fell back. Their first cloud request
bodies matched the corresponding deterministic-context arm exactly. Consequently,
the observed downstream cost differences cannot measure useful local contribution
or cloud reuse of local work. This is a failure of the tested integration and
policy; it is not evidence that a functioning local-first coding policy failed.

| Layer | Observed implementation | Implication |
|---|---|---|
| Dispatch | User-selected fixed policy, optional scout then cloud | No adaptive router was evaluated |
| Local role | Read-only tools; objective without existing host inventory | Coding competence was excluded and inventory could be rediscovered |
| Budget | Eight model calls, including format failures and submission | Not eight successful tool actions |
| Request profile | Non-streaming, 2048 output tokens, no thinking control | Differs from the earlier local adapter's explicit no-thinking request |
| Output parser | Final string content with one fenced shell action | Native tool calls or empty final content do not become actions |
| Handoff | Last three successful source excerpts, each capped at 1200 bytes | Most gathered evidence can be discarded; no patch or local findings are transferred |

Source: policy admission in `src/main/patch-runs/worker.ts`, fixed workflow and
source selection in `runtime/patch-worker/worker.py`. These are code observations,
not claims about live model accuracy.

## Local-only study design

The owner identifies the deployed model as Qwen-3.8 27B FP8. The current endpoint
reports the served alias RM-01 VLM, vLLM 0.28.0 and a 262144 model-context limit.
The weights and server launch flags have not been independently inspected.
The owner authorized other coding tasks because GPU execution access is absent;
this study makes no GPU-kernel correctness or speedup claim.

Twelve new synthetic Python maintenance tasks span pure functions, stateful
components and small multi-file repositories. Each baseline passes its
compatibility test and fails three requested behaviors; every reference patch
passes all four independent tests. All twenty-four final Docker proofs confirm
cleanup. An independent agent audited the task/source/oracle correspondence and
hashes. Four pre-exposure oracle corrections and their superseding proofs remain
in the ignored evidence bundle.

All twelve tasks have short source-provided prompts. Three representatives also
have exact 8, 32 and 64 KiB prompts padded with irrelevant prose, producing
twenty-one conditions. These are twelve tasks, not twenty-one independent tasks.
Padding measures tolerance to irrelevant context, not real repository retrieval.
Independent acceptance code and reference patches are never sent to the model.
Generated code executes only in credential-free, network-disabled Docker.

The separate autonomous diagnostic starts with an objective, file inventory and
visible test command, then permits inspection, editing, checks and submission
through the pinned mini-SWE-agent and SOAR Docker environment. Independent
acceptance runs after submission and is never an action or routing signal.

Every request has a frozen body hash and durable outcome. Unknown requests stop
their batch without automatic retry. Zero paid cloud calls are authorized in this
study. The scope is at most 120 local requests, concurrency one, 180 seconds per
request and explicit context/output caps. This is diagnostic implementation,
not a production route or a release.

## Initial observations

The default-thinking cohort used 8192 output tokens and stopped after two
requests. Dependency-levels passed all four independent tests in 176.569 seconds,
with 7458 reasoning tokens out of 7799 completion tokens. Counter-ledger timed
out after 180.002 seconds before HTTP headers. It has no assessable candidate;
nineteen conditions remain unrun. The server was subsequently verified idle.

These results are retained separately from later thinking controls. Default
thinking can consume most of an output budget, but one completed request and one
timeout do not establish the cause of the original scout failures.

Six matched direct controls changed only the requested thinking setting. All
returned complete, strictly valid final JSON. None reported cached input.

| Task | Thinking disabled | Medium thinking |
|---|---|---|
| Dependency levels | Pass, 13.102 s | Pass, 33.029 s |
| Idempotent counter ledger | Pass, 4.238 s | Pass, 19.949 s |
| Escaped assignments | Fail, 5.657 s | Pass, 111.508 s |

The failed parser treated an escaped equals sign in a key as the assignment
separator. Medium thinking solved the same request. All disabled requests
reported zero reasoning tokens; medium requests reported 1016–4481. These
single observations show a concrete tradeoff, not a population accuracy estimate.
The documented controls and default behavior are described in the
[official Qwen model card](https://huggingface.co/Qwen/Qwen3.8-27B-FP8).

The subsequent fast-profile screen completed all twenty-one conditions:
eight of twelve short tasks and seven of nine padded conditions passed the
independent tests. Every response had complete final content; ten needed removal
of a whole Markdown fence before JSON parsing. Normalized coding correctness and
strict output-format compliance are therefore separate results. Its failures
include delimiter escaping, digest normalization, incremental decoding and stable
queue behavior. This is a low-latency setting screen, not the model's upper limit.

The independent audit verified 74/84 passing test-method executions, 71,213
input tokens and 7,213 output tokens. Median request time was 6.961 seconds;
total request time was 171.116 seconds. These are client-observed times, not
GPU-active time or full episode latency. Nine short tasks outside the repeated
three-task calibration set passed 6/9. Exactly 9/21 conditions both obeyed the
strict no-fence format and passed their independent tests.

Selected medium-thinking follow-ups repaired digest normalization and the queue
regression in 35.472 and 45.895 seconds. Incremental decoding still failed after
76.207 seconds. Its 8 KiB variant then timed out at the 180.004-second wall
deadline, stopping the batch and leaving the selected 64 KiB variant unrun.
The earlier successful medium escaped-assignment result was reused rather than
requested again. This selection used offline evaluation failures for diagnosis;
it is not a routing policy, and hidden evaluator outcomes must never trigger a
live escalation.

Dependency-levels and casefold-search passed every tested context size.
Incremental decoding failed at short, 8 and 64 KiB but passed at 32 KiB in the
fast profile. That pattern establishes no monotonic context threshold. It also
does not test the full advertised model context window. Sampling and serving
load were not controlled; later aggregate serving counters showed an active
generation after a client timeout, so its remaining work could not be identified
or attributed from those counters alone.

## Exact scout interface replication

Three exposed original public tasks were selected before new scout outcomes.
Each default request body exactly matches its archived original first-request
hash. Its paired request adds only the official disable-thinking flag. Both
retain the original operating prompt and 2048-token cap. No action was executed.

| Setting | Empty final content | Nonempty but wrong action format | Accepted fenced actions |
|---|---:|---:|---:|
| Original default | 2/3 | 1/3 | 0/3 |
| Thinking disabled | 1/3 | 2/3 | 0/3 |

All six finished with `stop`, not `length`. Nonempty failures were introductory
prose or a JSON command object where the adapter requires one fenced command.
Thus disabling thinking alone did not fix this interface, and output-token
exhaustion does not explain these six observations. Modern `tool_calls` were
absent; the initial recorder did not retain the legacy `function_call` value, so
it cannot exclude that field as a cause of an empty final response.

These replications diagnose the current deployment. They cannot reconstruct
missing original response envelopes or prove that server weights, template and
parser settings were unchanged. The fixed read-only role and severe handoff loss
remain separate reasons the original workflow could not exploit local coding.

Appending only a literal fenced `inventory` example to the original scout
instruction produced **6/6 accepted first actions**, across the same three tasks
and both thinking settings. The cap stayed at 2048 tokens. All six emitted
inventory, so this establishes responsiveness to a format example rather than
useful investigation, multi-turn completion or general instruction adherence.
The sequential cohorts also retain sampling/serving-state confounds.

Three native-interface probes returned exactly one valid modern `inventory`
function call with an ID, `{}` JSON arguments and `finish_reason=tool_calls`.
These changed the system instruction and supplied a function schema together,
so they test a coherent protocol bundle. No returned function was executed.
This proves compatibility for a zero-argument function, not arbitrary shell
arguments or multi-turn coding. A native adapter still needs explicit request,
tool-result, history, permission and accounting contracts before production use.

## Autonomous execution and the call limit

The three preselected synthetic episodes started from the objective and file
inventory, without full source in the initial prompt. The local model inspected,
edited and checked files in real isolated containers. All three exhausted eight
model calls without submission; they remain **0/3 submissions**.

| Task | Independent test result on captured, unsubmitted artifact | Trajectory finding |
|---|---|---|
| Incremental lines | 1/4 | Fenced shell commands included literal XML parameter tags; useful prefixes ran before shell syntax errors, and the buffer logic was incorrect |
| TSV roundtrip | 4/4 | Productive inspection, editing and correction yielded a passing artifact before the call limit, but no submission |
| Manifest normalization | 3/4 | Its own check exposed uppercase-digest handling, then it changed the expectation to contradict the requirement |

These artifact checks ran afterward in fresh independent evaluators. They do
not convert unfinished episodes into successes. All visible checks passed on
the captured artifacts, illustrating their limited coverage.

The first task was selected for a fresh 24-call episode before those artifact
grades were opened. It submitted after **22 requests**, but passed only **3/4**
independent tests despite a visible pass. It still delayed an invalid UTF-8
error until finalization instead of rejecting it during `feed`. Stray XML also
persisted inside shell actions; a contaminated submission was followed by a
clean one. This fresh longer episode reached submission at request 22 but did
not produce an independently acceptable patch.
A fresh stochastic episode is not a deterministic continuation of the first.

The manually reviewed trajectories support three separate operational limits:
format compatibility, enough useful action budget to finish, and reasoning that
preserves the specification when feedback is inconvenient. Counting tool steps
or visible passes alone does not distinguish them.

The final larger diagnostic used the original exposed `cachetools` peek task:
43 source files, a pinned public revision and a five-method independent oracle.
It started with an inventory, used a literal shell-format example and explicit
no-XML instruction, and allowed 24 calls. It still exhausted all 24 without
submission. Repeated XML-contaminated actions accompanied extensive reading,
duplicate source insertions and an explicit `git checkout` reset of that file;
the terminal patch
was empty. Cleanup was confirmed. There was no candidate to grade and no result
to count as a solved task. This combined scaffold/task diagnostic is neither a
held-out result nor an isolated call-limit comparison.

## Implemented correction and next experiment

The production scout instruction now includes exactly the literal inventory
example measured in the six successful first-turn controls. Its read-only
permissions, parser, call limit and handoff policy remain unchanged. That small
correction does not implement a dynamic router or establish useful full-scout
completion. All earlier worker versions and negative results are preserved.

The [primary-source policy comparison](ROUTING_POLICY_RESEARCH.md) informs the
next engineering priority: a native local coding adapter with explicit
tool-call IDs, validated arguments, tool-result history, cancellation, usage and
thinking-setting semantics. Current production admission does not support that
schema or a local coding phase. The successful zero-argument probes are a reason
to implement and validate it; they are not a multi-turn execution proof. Test it
on the known failing episodes for calibration, then freeze it before fresh tasks.

After that adapter gate, compare local-only and cloud-only against two simple
policies: local-first with bounded escalation, and cloud planning followed by
local implementation. Keep identical tools, visible checks and whole-episode
limits; retain enough budget and time for any promised cloud phase. Observable
help requests, failed visible checks and repeated no-progress can inform an
escalation. A protocol error or unknown request stops separately. A local visible
pass produces a reviewable candidate, not automatic acceptance. Independent
tests and blind review remain evaluation-only.

Use cloud-only as the primary cost/quality comparator and local-only as the
quality/cost frontier. A fresh twelve-task screen can reject a policy; it cannot
prove general parity. The proposed advancement threshold is at least 20% lower
API cost per independently acceptable patch, no material regression, and at
most 25% median latency increase against cloud-only. Count failed, planning,
review and routing calls. These are proposed product thresholds, not measured
results. A larger confirmation set and owner use follow only a promising screen.

The study attempted **118 local requests: 116 complete and two unknown**. No
unknown was retried automatically. No paid cloud request or server configuration
change was made. The owner's approximately $3500 device cost and unmeasured
electricity/utilization remain separate from the attested zero API token fee;
this study establishes no all-in saving or payback.
