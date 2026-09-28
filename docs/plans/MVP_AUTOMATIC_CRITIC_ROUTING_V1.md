# Automatic source-size admission for the coding MVP

Status: Approved for implementation and offline verification within the owner's
continuing routing goal. No paid batch is opened by this implementation plan.

Preflight of the original six-task cohort found that cachetools (232,059 bytes),
more-itertools (677,398 bytes) and boltons (980,231 bytes and 112 files) exceed the
existing complete-source critic's 98,304-byte / 64-file baseline limits. The
proposed local-critic route on every task would spend local effort on candidates
that the critic cannot admit. Preserve all six tasks and the critic's complete
context requirement. Do not truncate source or silently narrow the experiment.

Add an explicit experimental Automatic selection to the app's create input.
Resolve it to an existing concrete policy before any model request: use prepared
cloud when the committed baseline exceeds either size limit, or when the critic
profile or its conservative monetary headroom is unavailable; otherwise use the
existing local-critic-repair policy. Require a live cloud profile for Automatic.
Keep explicit policy choices and the default unchanged. This rule detects known
structural ineligibility; a later draft or serialized critic body can still exceed
its envelope and must fail closed under the existing policy. It does not predict
task difficulty, correctness or guaranteed savings.

Measure files and bytes from the same validated committed Git-tree entries used
by workspace materialization. Never trust renderer-supplied counts, task IDs or
working-tree contents. Persist a host-created selection receipt containing rule
version, selected policy, reason, base revision, committed tree and nonsecret
configuration digests, source counts and exact admitted
episode ceiling. Preserve the concrete worker policy in the run snapshot; add no
new worker protocol or database migration. Verify the receipt against the actual
materialized source and compatible current configuration before worker launch.
Drift stops the run rather than selecting another route after creation.

Automatic local episodes retain eight draft calls, one critic, four optional
repair calls, thirteen total calls and at most USD 0.70. Automatic cloud episodes
retain at most forty calls and USD 3. Both use at most 600 seconds. Never increase
the owner's requested budget. Preserve the complete-source/body checks and the
single optional repair; no after-draft cloud solver fallback is added. Use a
configuration compatible with both concrete policies rather than passing the
local policy's twelve-call override into prepared cloud.

Verify input/schema rejection, selection boundaries, budget/profile fallback,
receipt preservation and replay, materialization/configuration drift before
dispatch, and unchanged explicit policy behavior. Exercise both selected routes
through the real controller/worker fixture path without real providers. Show the
selected route and reason in the app. Retain the unresolved prior UI initialization
gap unless an actual interface test runs successfully.

The subsequent comparison becomes fresh prepared cloud versus Automatic across
all six original tasks, with three expected local-critic selections and three
expected cloud selections in the Automatic arm. Freeze actual selection receipts
before paid dispatch and include cloud-selected tasks in Automatic costs and
quality. The expected twelve episodes permit nine cloud ceilings and three local
ceilings, USD 29.10 total and 399 requests maximum, subject to exact future
authority and the existing USD 150 stage cap. Any selection mismatch stops
preparation or dispatch; do not quietly enlarge this allowance.

References: [initial comparison design](MVP_LOCAL_CRITIC_REPAIR_COMPARISON_V1.md),
[accepted episode](../MVP_LOCAL_CRITIC_REPAIR_EXECUTION_REPORT.md),
[build log](../BUILD_LOG.md).
