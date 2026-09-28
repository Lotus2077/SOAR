# Small planner-contract calibration

Status: Approved by the owner's request, "go for the small planner-contract
calibration". The bounded implementation must pass offline checks before dispatch.
This is a new diagnostic experiment; the closed twelve-episode comparison remains
failed and none of its assignments is retried or replaced.

Use at most two exposed development tasks, in this order: ordered build rules,
then cache discard. Start from the same committed public sources, public objectives,
file scopes and visible-check commands used in the closed comparison. Exclude
reference patches, hidden evaluator material, prior generated solutions and critic
feedback from the planner input. Keep the four untouched tasks reserved.

Reuse the existing planner prompt, deterministic repository excerpts, JSON/unittest
parser, direct OpenAI gpt-5.6-sol model and medium reasoning profile. Retain 8192
maximum completion tokens, 256000 input bytes, the 120-second request timeout and
600-second episode deadline. The wrapper uses the existing main/Python/Docker
path and stops immediately after an accepted plan, before constructing a local
request. The local model is configured only to satisfy the existing route contract
and receives no requests. Generated checks are parsed but never executed here.

Maximum new exposure is USD 2: two new diagnostic runs, one planner request per
run, USD 1 per run, concurrency one, no retries. Keep all prior fees, unknown
exposure and comparison records in the existing stage database under its USD 150
campaign ceiling. A one-use claim precedes dispatch; interrupted claims cannot
silently resume. Revalidate exact source, wrapper, driver, configuration and
historical database bindings before dispatch and at closure.

Stop at the first planner rejection, transport/usage uncertainty, unconfirmed
cleanup, unexpected request, source/configuration drift or accounting failure.
An accepted plan ends the diagnostic episode with an intentional stop, not a
completed coding task. Attempt the second task only after the first has an
accepted plan, exactly one settled request, no other work and confirmed cleanup.
Both assigned tasks remain in the report, including an unrun second task.

Record fixed rejection code and trusted parser call-site function/line bound to
its exact source hash. Do not retain raw rejected provider responses, traceback
text, frame locals, credentials or private endpoints. Rethrow the original parser
exception so production rejection behavior remains unchanged. The call site can
identify a violated contract rule; it does not by itself prove that the rule is
well aligned with the prompt or necessary for the product.

Offline verification must cover accepted/rejected plans, one-request enforcement,
no local/solver work, privacy, exact request accounting, stop and no-retry behavior,
source/authority drift and preservation of old database rows. Use a loopback
fixture for the actual wrapper/main/Python/Docker path before the real calls.

A successful calibration establishes only that one or two exposed planner inputs
satisfied the parser contract. It cannot establish test usefulness, patch quality,
local-model capability, routing savings or generalization. If rejected, inspect
the frozen rule and propose the smallest prompt/parser alignment experiment before
spending on another full comparison. Any change is separately versioned and cannot
relabel this experiment or earlier failures.

References: [closed comparison and diagnostic fix](../MVP_ROUTING_PUBLIC_CHECKS_DEVELOPMENT_REPORT.md),
[readiness](../MVP_READINESS.md), [build log](../BUILD_LOG.md).
