# One local-first policy experiment

Status: Approved within the owner's continuing routing MVP implementation and
evaluation request. Dispatch requires durable approval, focused verification and
an exact source/input/evaluator freeze. Prior experiments remain closed.

Test the existing local_first policy on the same exposed ordered-build-rules task
that produced an accepted cloud-plan/local patch. Start from the original public
source and objective, not the prior patch or plan. Keep source scope, visible
command, local model/settings, cloud recovery model/settings and independent
evaluator fixed. Do not change production prompts or routing logic in this run.
The four untouched confirmation tasks remain reserved.

This policy starts locally and may recover through the cloud once. It makes no
up-front planner call and generates no planner-owned tests. That removes both
planning guidance and generated-check feedback; the experiment evaluates the whole
existing policy rather than isolating their separate causal effects. Keep the
host_repair_window visible-check schedule, explicit submission and all freshness
guards. Configure plannerMode as its ordinary plan default so the local-first
policy does not request the planned-native generated-check contract.

Use one new episode, concurrency one, USD 3 maximum under the existing USD 150
stage ceiling, 600 seconds, 40 total model calls, at most 24 local calls and one
possible cloud recovery. Keep the existing 8192-token/256000-byte profile and
disabled local thinking. Count every local, fallback, failed and unknown request.
No retry, resume or replacement. Uncertain usage, source/authority drift,
unconfirmed cleanup or exhausted limits closes further work.

Before dispatch, verify local-first completion through real main/HTTP/Python/Docker
and normal recovery, with no planner request, final visible-check freshness,
accounting and cleanup. Reuse existing tested components. Independently review the
bounded driver/session and evaluator runner. Observe zero owned containers after
fixtures, then bind all 57 prior runs and 561 requests, preserving old unknown
exposure and exact accounting-only critic exceptions. Freeze the original qualified
independent evaluator and its invocation before generation. Verify cloud and local
metadata through read-only requests; send the session key only to OpenAI.

After a submitted patch is fixed, verify scope and exact source/hash bindings,
run the same five-test independent evaluator in Docker, and obtain neutral source
review without route, cost, prior patch or runtime verdict. Passing the visible
check is insufficient. Failed-runtime submitted artifacts may be diagnostically
evaluated but cannot count as completed tasks; absent/recovered artifacts remain
unfinished. Freeze every evaluation claim and preserve the ledger.

An accepted local-produced patch without recovery shows this exposed task can be
completed under local-first. A fallback-produced accepted patch shows recovery,
not the value of local execution. Neither one proves a general selector or savings.
Compare the new measured cost and time descriptively with the closed planned-local
and earlier cloud episodes, retaining order/exposure limitations. Only a fresh,
complete comparison at preserved quality can clear the broader economics gate.

References: [planned-local result](../MVP_PLANNER_LOCAL_EXECUTION_REPORT.md),
[routing comparison limits](MVP_ROUTING_PUBLIC_CHECKS_DEVELOPMENT_V2.md),
[build log](../BUILD_LOG.md).
