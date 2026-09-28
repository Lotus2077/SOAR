# One-call planner prompt-adherence probe

Status: Approved within the owner's continuing instruction to build and iterate
the routing MVP, following the requested small planner-contract calibration.
Dispatch remains conditional on a durable approval entry and frozen offline
verification. This is a separately versioned experiment. V1 is closed after its
first declaration rejection; its unused second assignment cannot be resumed.

Test one hypothesis: a complete JSON/unittest example and an explicit distinction
between the host's visible command and generated source improve planner adherence.
Change only prompt constants. Preserve every parser function, size/count limit,
artifact schema and execution rule. The example uses self.fail so an unchanged
copy cannot become a passing placeholder. It contains no task answer.

Use only the previously exposed ordered-build-rules public task, with its original
objective, source revision, scope, visible command and deterministic excerpts.
Exclude previous model outputs, critiques, reference patches and hidden checks.
Keep the four untouched tasks reserved. Retain direct OpenAI gpt-5.6-sol, medium
reasoning, 8192 output tokens, 256000 input bytes, 120-second request timeout and
600-second episode deadline.

Maximum new exposure: one new diagnostic run, one initial planner request, USD 1,
concurrency one, no retry or resume. Stop after that response, including on parser
acceptance, before local or solver inference, generated-test execution or patching.
Transport uncertainty, unexpected requests, accounting drift, source/authority
changes or unconfirmed cleanup also stop the probe. Keep the existing USD 150 stage
ceiling and all historical costs and unresolved exposure.

The private wrapper retains fixed parser rejection codes and trusted call sites.
For the source-bound combined class-declaration rule only, it may also record fixed
flags for a non-class statement, decorated class, class keywords or wrong base
count, plus a bounded source-line integer. Never persist rejected response text,
AST nodes, identifiers, frame locals, exception text, keys or private endpoints.
The original parser exception and rejection behavior remain intact.

Before dispatch, verify prompt-only AST changes, parser acceptance of the example
and rejection of host wrappers/invalid declarations, wrapper privacy and lifetime
guards, single-use claims, budget/cancellation/drift handling, and the actual
main/loopback-provider/Python/Docker accepted and rejected paths. Capture a fresh
historical admission covering all 55 previous runs and 550 requests, including V1.
Freeze exact reviewed source, configuration, authority and input bindings. Use the
session credential only after read-only model readiness; retain the same launch
through terminal closure without automatic retry.

Report the one assigned task whether attempted or not, exact request accounting,
plan admission, safe diagnostics, cleanup and preservation of prior records. A
parsed plan is not evidence of useful tests, patch quality, local capability,
routing savings or generalization. A successful result permits designing a small
execution probe; it does not authorize a full comparison by itself.

References: [V1 result](../MVP_PLANNER_CONTRACT_CALIBRATION_REPORT.md),
[V1 frozen plan](MVP_PLANNER_CONTRACT_CALIBRATION_V1.md),
[build log](../BUILD_LOG.md).
