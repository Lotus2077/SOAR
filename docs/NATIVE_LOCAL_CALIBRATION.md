# Native local coding calibration

Status: implemented and verified in isolation on 2026-09-08 UTC. The four-task
live calibration is closed: two submitted patches passed independent acceptance;
two tasks exhausted their call limit. All 60 native requests completed without
protocol rejection. The [118-request diagnosis](LOCAL_CAPABILITY_DIAGNOSIS.md)
remains unchanged. The production app still uses its existing fixed policies.

The native interface fixes the measured execution boundary and produces real
local coding successes. It also exposes failures that a router must handle:
repeated actions without applying feedback, and unfinished regression tests.
This is a small exposed calibration, not a model accuracy estimate or savings proof.

The earlier fenced command loop repeatedly executed commands containing XML
suffixes and lost native call/result identities. A standalone native protocol
module now builds explicit thinking-disabled requests, accepts exactly one
validated function call, and preserves its ID with the matching tool result.
`run_command` executes its exact JSON command argument in SOAR's network-disabled
Docker container. Only `submit_task({})` submits. Text, fences, reasoning and XML
are never alternative executable channels or automatic repair inputs.

The adapter rejects reused IDs, malformed or duplicate-key arguments, unsupported
tools, multiple calls, legacy calls, refusals, invalid history and truncated
responses. It preserves nonzero shell exits, timeout recovery notices and output
truncation. Model output never executes on the host. Complete HTTP and usage
receipts precede semantic validation; unknown outcomes stop the batch without a
retry. Cancellation is checked before commands and submission. A submitted patch
is extracted from a stopped container, reconstructed against a trusted source
snapshot and evaluated independently in a fresh container.

## Frozen experiment boundary

The owner authorized this separate local-only calibration by asking to continue
to the next step. Its ceiling is 100 local requests, concurrency one and zero paid
cloud calls. Four immutable episodes receive at most 24 requests each, 600 seconds
of solver time, 8192 output tokens, 256000 serialized input bytes, a 180-second
request deadline and 30 seconds per command. A request must fit the remaining
solver deadline with two seconds for its receipt. Artifact capture, cleanup and
independent evaluation are measured separately from solver time.

The selected tasks are incremental UTF-8 lines, TSV round trips, manifest
normalization and the public cachetools `peek` change. They reuse the exact prior
source revisions, objectives, inventories, visible commands and independent
oracles. They are exposed calibration tasks. Prior failure notes and evaluator
outcomes stay outside model inputs. The new system prompt, native tools, request
profile, runtime and harness are frozen before live dispatch.

Success requires a real native submission, a nonempty patch confined to allowed
paths, the exact visible check passing, full independent acceptance and confirmed
cleanup. Protocol compliance alone is not task success. A good unsubmitted
artifact remains unsubmitted. Compared episodes have different call caps where
explicitly identified; missing cap pairs are unrun rather than inferred.

The endpoint identifies its served alias and vLLM version; the owner identifies
the weights as Qwen-3.8 27B FP8. Server weights and launch flags have not been
independently inspected. Native tools require a matching serving template/parser
according to the [vLLM tool-calling documentation](https://docs.vllm.ai/en/latest/features/tool_calling/)
and [Qwen deployment recipe](https://recipes.vllm.ai/Qwen/Qwen3.8-27B).
Those requirements are reference material, not proof of this server's launch flags.

## Observed results

| Task | Calls / shell actions | Shell exits of zero | Submitted | Independent acceptance | Total wall time |
|---|---:|---:|---|---|---:|
| Incremental UTF-8 lines | 24 / 24 | 22 | No; call limit | Unrun for the episode; both visible invocations failed | 87.942 s |
| TSV round trip | 6 / 5 | 5 | Yes | 4/4 plus exact visible check | 24.496 s |
| Manifest normalization | 6 / 5 | 5 | Yes | 4/4 plus exact visible check | 32.803 s |
| cachetools `peek` | 24 / 24 | 24 | No; call limit | Unrun for the episode; separate artifact result below | 157.599 s |

All four original source snapshots stayed unchanged and all containers were
removed. Independent audit verified every frozen body hash, all 60 native call
IDs, exact command arguments, paired tool results in subsequent requests, both
terminal native submissions, and submitted patch/evaluator identity. There were
58 shell actions, two submission calls, zero XML-contaminated commands, zero
format failures and zero unknown requests. Shell exit zero is deliberately not
reported as a passed test or completed task.

The TSV and manifest tasks completed within six calls, below the old eight-call
cap. Their successes therefore do not require the enlarged ceiling. The native
system prompt, tools and history form one changed adapter package; this is not an
ablation attributing improvement to a single field. Tasks were previously exposed,
sampling and server load were not controlled, and missing matched-cap cases remain
unrun. The prior negative results are retained.

### Failure to apply observed feedback

The UTF-8 implementation uses `buf[:-cut]` when `cut == 0`, producing an empty
slice and discarding input. The visible test fails, and a model-authored scalar
probe demonstrates both the bug and a correct conditional slice. The model never
applies that correction to the file. Its last source edit is command three;
commands eight through twenty-four are identical probes. The same command appears
eighteen times overall. The final artifact remains visibly broken and unsubmitted.
No hidden-test count is inferred. Static review also finds pending-text loss that
a slicing-only repair would leave behind.

This is an observable progress failure after correctly delivered feedback. It is
not a native parsing error, and increasing the same loop's cap has no demonstrated
benefit. The existing command-prefix inspection metric misses `cd && cat`; full
command/output review supplies the inspection finding instead.

### The unfinished repository artifact

The native cachetools run retains a 10164-byte patch spanning the implementation,
type stub, documentation and required new regression tests. The earlier fenced
24-call run ended with an empty patch after resetting duplicate edits. The new
run makes material progress but never invokes its exact configured visible command
or submits. Several test commands pipe output through another command; their shell
exit code is zero while their output reports failures or errors. A zero shell code
cannot be used as this task's completion signal.

After live closure, one separately recorded offline evaluation tested the immutable
unfinished artifact without any model continuation. It passed all five frozen
independent methods, but the exact visible command failed: the 71 newly authored
tests produced six failures and two errors. They include missing TTL/TLRU
constructor arguments, incorrect expectations about lazy expiration when asking
for cache length, and an expectation of `None` despite supplying a fallback.
The full visible command stops at that failing stage. Static review also finds
LRU-specific assertions reused for random/LFU caches; unchanged live test files
produced different failure counts across invocations. These assumptions can make
the generated tests unstable. This is useful evidence of implementation progress
and unfinished test work; it is not full acceptance. The
original episode result and strict two-of-four success count remain unchanged.

### Accounting and verification limits

Exactly 60 local requests settled, with 431942 input tokens and 12116 completion
tokens; 276800 input tokens were reported cached and zero reasoning tokens were
reported. Cache tokens are a subset of input, not extra tokens. Summed supervised
request wall time is 284.514 seconds, including client-process supervision;
HTTP-client receipt times sum to 281.250 seconds. The four complete episode times
sum to 302.840 seconds. These are client measurements, not GPU-active time. A pre-run health snapshot was
idle; closure found one unattributed active generation, zero queued requests, zero
SOAR worker containers and no unreceipted dispatch. Workload isolation is unproven.

The approved and frozen request bound was 8192 output tokens and every actual body
used it. Audit found that the copied private authority retained an older 16384-token
scalar. That bookkeeping mismatch is recorded without changing the frozen evidence;
the higher value did not authorize or cause larger requests. The stage is closed,
and the unused portion of its 100-request ceiling does not authorize continuation.

Ten protocol tests, twelve harness unit tests and seven real-Docker methods pass.
The original timeout canary incorrectly assumed that no write could occur during
Docker's shutdown grace period. SOAR rejected the resulting disallowed file; the
test was corrected to check for surviving processes after removal. Its failed
record remains preserved. The verified recovery contract captures source only
after confirmed stop; it does not promise an instantaneous freeze at the deadline.

Native module SHA-256:
`4d49932c9eeeb4ffb2d22e47e470cd8f982d3892d250e3d40cdafa34174d700a`.
Frozen experiment SHA-256:
`53f138d5bc8bce4c61cabf60c9a1ea9a723edbc746ecb01dc7f285036aaeae17`.
Raw requests, sources, gold, private authority and evaluation artifacts remain
ignored. No app route, persisted production policy, credential or worker admission
was changed by this calibration.

## Advancement rule

Argument-bearing actions, multi-turn result round trips and actual submission are
now verified on this exposed set. The next implementation should add a small
checkpoint policy before any learned router: a trusted exact visible-check action,
reserved calls/time for final validation and submission, and a bounded no-progress
stop or explicit help transition. Repeated command/output pairs should be combined
with host-observed source-state changes before treating them as no progress.
Preserve the current patch and check failures at a handoff; never turn a protocol
or unknown-accounting failure into an automatic paid escalation. Reusable protocol source
is implemented separately from production admission. A later local-first or
cloud-plan/local-execute experiment needs a frozen state transition, observable
escalation signals, complete patch/check handoff and fresh held-out tasks.
Independent hidden outcomes cannot drive routing. The proposed comparison and
kill-or-pivot criteria remain in [routing research](ROUTING_POLICY_RESEARCH.md).

Owner-attested local token fees are zero. The approximately USD 3500 device,
electricity, utilization and useful life remain separate cost inputs. This phase
cannot establish total-cost savings, cloud parity, GPU-kernel performance or a
released product.
