# Bounded reasoning during local repair

Status: Approved for offline implementation and preparation under the continuing
owner objective. Live dispatch requires a separate recorded gate binding the
completed mechanics checks, reviewed driver, immutable inputs and exact frozen
configuration. No new cloud calls, default policy promotion or model-weight changes.

The preceding compact-critique/local-repair policy failed with four accepted patches
out of six assigned. Tool filtering now fixes its observed request/action mismatch,
with focused runtime verification. Semantic defects remain. Earlier direct matched
controls found that medium reasoning fixed one failure while taking substantially
longer; selected follow-ups fixed two more failures and also encountered a timeout.
These observations justify a bounded native-coding comparison, not a general model
quality claim. The previous failed batch is closed and its evidence remains intact.

## Change and comparison

Add one programmatic local-coding thinking setting: disabled by default, or medium
for a separately configured local-only run. Do not add a UI/environment option or
change the app default. Pass the normalized setting to the worker and independently
validate it in main admission. The disabled request retains
`chat_template_kwargs: {enable_thinking: false}` and omits `reasoning_effort`.
The medium request uses `reasoning_effort: medium` and omits
`chat_template_kwargs`, matching the earlier direct controls. Reject contradictory
or unauthorized profiles. Preserve native tool masks and complete action/result
history; do not retain or replay hidden reasoning. This tests medium reasoning
within that existing history contract, not maximum model capability.

Run two exposed tasks under both settings, with four fresh episodes and separate
run histories. Use the exact original cloud-plan/local candidate seeds and original
public-task-plus-compact-critic repair objectives. Do not add later source-review
findings or evaluation counterexamples to those objectives. All assignments use the
same corrected tool interface, model identity, source, checks and sampling defaults.
The only request-profile intervention is the thinking setting.

| Order | Task | Thinking |
| --- | --- | --- |
| 1 | Cache discard API | Disabled |
| 2 | Cache discard API | Medium |
| 3 | Retry-After | Medium |
| 4 | Retry-After | Disabled |

Each episode has eight model calls including two finishing calls, 8,192 total output
tokens per request, a 256,000-byte input envelope, the existing 120-second request
timeout, and a 600-second episode limit. Maximum new exposure is four episodes,
32 local requests and zero API fees. Concurrency is one. There is no cloud provider
or key in the operator. Use the already authorized local endpoint and pinned Docker
image without changing the server. Metadata readiness is not generation evidence.

## Evidence and execution gates

Before dispatch, verify default-profile compatibility, exact medium admission and
rejection, reasoning usage bounds, tool-history preservation, check/submission
binding, and actual main-to-worker-to-loopback execution in Docker. Independently
review the runtime change and bounded driver. Freeze their code hashes, the exact
seed/objective manifest, configurations, assignment order, evaluation contracts and
the offline evidence. Record the resulting live execution authority separately.

The new study uses its own ledger and storage. Original studies, costs, unknown
requests and failed results remain immutable and are reported separately. One-use
batch and assignment claims prevent retries or accidental resume. Unknown outcomes
stop dispatch; keep all four assigned dispositions including any unrun assignments.
Cancellation waits for owned workers and confirms container cleanup. Do not recover
or redispatch unrelated historical runs. No extra attempt is granted for a parser,
timeout, tool, check or semantic failure.

Only a submitted patch with fresh source-bound checks can become an eligible
candidate. Compose incremental repairs against the original task baseline and
verify exact source equality. Run independent checks after generation, then blind
source review and the same frozen diagnostic probes for both settings. Keep visible
passes, submission, independent test passes and review acceptance distinct.

## Decision

The primary measure is accepted submitted patches out of two assigned per profile.
Also report requests, total/reasoning tokens, full repair latency, local service
time where observable, cleanup, unknown outcomes and API fees. Medium qualifies for
selection only if both tasks are accepted, it introduces no additional regression,
and it improves acceptance over disabled. If both settings solve both tasks, prefer
the faster disabled setting. A one-task win is diagnostic evidence, not a quality
guarantee. Neither profile can claim all-in savings merely because local API fees
are zero; the owned device, power and utilization still matter.

Rejoin selected repairs with the exact four retained original candidates and review
the six final artifacts before declaring this development gate passed. Only then
freeze the complete generation/critique/repair policy for four untouched paired
tasks against cloud. Count every phase and failed attempt; require no additional
paired material regression, at least 20 percent lower API cost per accepted task,
and no more than 25 percent median full-session slowdown. That small confirmation
can reject a policy or justify a larger pilot; it cannot establish general quality
equivalence. Do not use evaluator outcomes as live routing signals.

References: [repair result](../MVP_ROUTING_REPAIR_REPORT.md),
[local capability diagnosis](../LOCAL_CAPABILITY_DIAGNOSIS.md),
[tool-filtering plan](MVP_ROUTING_TOOL_MASK_V1.md).
