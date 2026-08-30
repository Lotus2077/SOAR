# Benchmark protocol

The workload manifests contain 22 research and 20 coding records from pinned public benchmarks. They identify the source fixture and its official evaluator; they are not a list of invented example prompts.

- [`research.jsonl`](research.jsonl): ten structured LiveDRBench discovery cases and twelve long-form DeepResearch Bench reports.
- [`coding.jsonl`](coding.jsonl): twenty SWE-bench Verified issues spanning all twelve upstream repositories in that suite.
- [`sources.json`](sources.json): immutable revisions, checksums, field visibility, and evaluator isolation rules.

Prompt and gold fields are loaded from the pinned source at run time. Gold answers, solution patches, hidden tests, reference reports, and provenance pull requests must never enter the agent's context.

## Comparison policies

The intended same-harness comparison would run every selected workload with the
same tools, time limit, initial fixture, and evaluator under three policies:

1. `local_only`: local vLLM for every inference;
2. `cloud_only`: pinned DeepSeek V4 Flash 0731 for every inference;
3. `hybrid_v0`: the deterministic phase-and-trigger policy in `docs/ROUTING_POLICY.md`.

This is an evaluation design, not current command behavior. The checked-in
research/coding utilities prepare fixtures, check prerequisites, evaluate an
already-produced submission, and export a result. They do not execute an agent
episode under any of these three policies. Production constructs one configured
local provider, and production Hybrid remains unavailable.

External products such as Manus, Genspark, and Claude Code can be recorded as separate product baselines, but their results must not be mixed with same-harness model-routing comparisons.

The selected SWE-bench evaluator images are `linux/amd64`, while the current macOS development machine is Apple Silicon. Docker Desktop can emulate them for a few smoke cases, but repeatable bulk coding evaluation should run on an x86-64 Linux worker while the Electron app remains macOS-first.

## Proposed USD 100 campaign gate (unapproved)

This table is a future campaign design, not authorization or active runtime
configuration. The USD 100 figure would be a hard campaign ceiling, not
permission for an individual run to consume the balance. Its USD 0.75 episode
cap applies only to this proposed broad campaign; the separately proposed PR 6
canary has a USD 0.25 cap and remains unapproved as well.

| Stage | Work | Maximum paid exposure |
| --- | --- | ---: |
| 0 | Once an agent runner exists, validate all 40+ workloads with `local_only`; repair fixtures and evaluators. | USD 0 |
| 1 | Canary set: 2 research and 2 coding workloads under `cloud_only` and `hybrid_v0`, capped at USD 0.75 per episode. | USD 6 |
| 2 | Run the remaining 38 workloads under both paid policies, capped at USD 0.75 per episode. | USD 57 |
| 3 | Evaluator calls and reruns of invalid or flaky results, admitted only while budget remains. | USD 27 automatic reserve |
| Holdback | Never spent automatically. | USD 10 |

A future approved campaign runtime must deny a paid call when its conservative
projected cost would cross the applicable per-episode cap, USD 90 automatic
stop, or USD 100 campaign ceiling. Cancellation, retries, cached-token pricing,
provider-reported cost, and late usage reconciliation must all be logged. The
shipping app parses none of these campaign settings and has no production paid
provider.

## Required run record

A future same-harness agent episode record must include:

- workload and immutable fixture revision;
- policy, model/provider version, prompt compiler version, and routing reason;
- canonical event stream and tool side effects;
- input, cached, reasoning, and visible-output tokens when exposed;
- time to first token, inference time, tool time, and end-to-end time;
- projected and provider-reported cost;
- deterministic validator evidence, citation audit, or benchmark score;
- stop reason, failures, retries, and model switches.

Primary metrics are task success, cost per successful episode, end-to-end p50/p95, false-accept rate, escalation rate, and regret versus the best fixed provider on the evaluated sample.

LiveDRBench's ten preview cases have structured gold and should be the first research smoke set. DeepResearch Bench uses model-judged RACE and FACT evaluation; FACT also needs web-content extraction credentials. If those dependencies are not configured, run deterministic citation checks plus RACE and label the result `SOAR-pilot`, not an official FACT-comparable score.

The current `evaluate` export is narrower: it records fixture and evaluator
identity, the caller-supplied policy label, submission and optional trace hashes,
and evaluator outcome. It is not evidence that SOAR executed the submission or
that the supplied trace came from the production runtime.

## Local Evaluation Bridge v1

The separate `benchmark:local-review` command does execute one agent episode,
but only for the frozen `cal-001-soar-plan-approval` change. It shares the
production Electron session constructor and local-only review coordinator; it
does not run any research or SWE-bench workload and cannot select cloud,
fallback, or paid providers. The bridge is Implemented; its full deterministic
exact-commit verification and its separately gated nonempty live proof are
pending. It is neither Verified nor Released.

The source must be an explicit local Git repository root containing the frozen
base and change objects. `--source-repository .` is valid when the current
directory is a clean full clone with those objects. Materialization disables
network access and removes the temporary clone's remote. Provider dispatch
requires both the command-line flag and
`SOAR_RUN_LIVE_LOCAL_REVIEW_V1=true`, the exact recorded four-round, three-tool,
163,840-input-token configuration, a healthy configured local model, a clean
unchanged implementation revision, an unused run ID, and the one-shot
OS-user-local authority for fixed plan ID
`local-evaluation-bridge-v1-plan-1`. Run the deterministic release-head and
Electron exact-commit gates before enabling either live opt-in.

```bash
SOAR_RUN_LIVE_LOCAL_REVIEW_V1=true \
SOAR_MAX_INFERENCE_ROUNDS=4 \
SOAR_MAX_TOOL_CALLS=3 \
SOAR_CONTEXT_MAX_INPUT_TOKENS=163840 \
SOAR_CONTEXT_SAFETY_MARGIN=0.2 \
SOAR_MAX_OUTPUT_TOKENS=8192 \
pnpm benchmark:local-review -- \
  --calibration-id cal-001-soar-plan-approval \
  --source-repository . \
  --run-id local-review-001 \
  --live-local-vllm
```

Operator contract:

- The default artifacts live below the ignored
  `benchmarks/runs/local-review-v1/<run-id>/<fixture-id>` tree. The ignored
  `.run-ledger` beside those runs makes a reserved run ID non-reusable only
  while that ledger is preserved. A blocked run after namespace reservation
  also consumes its run ID.
- The live authority ledger is separate OS-user application state on this
  machine—under the signed-in account's
  `Library/Application Support/SOAR/evaluation-ledger` directory on macOS—and
  is fixed to the committed plan authority ID. It is a cooperative same-account
  guard, not a hardened security boundary. A sent or disposition-unknown
  inference consumes the authority even when the run fails; a crash after the
  claim may conservatively consume it. Another live attempt requires new
  explicit approval and a new committed plan authority ID.
- A definitely pre-dispatch model-list or admission failure can release the
  live authority, but its already-reserved run ID remains consumed and the
  classified blocked record is retained.
- The final directory is complete only when
  `publication.complete-v1.json` exists; the marker is written last. This is
  not atomic directory publication. Recorded hashes make later changes
  detectable, not impossible.
- Emergency `safe_projection_failed` and `unsafe_output` results preserve
  bounded execution facts and safe events when independently scannable, and
  drop unsafe material fail-closed. Accepted review prose and relative evidence
  references are still untrusted model output; inspect them before sharing.
- “Local only” constrains the selected provider, not physical egress. Fixture
  evidence is sent to the configured vLLM endpoint, which may run on another
  machine.

Structured output contains only status, stable identifiers, relative artifact
names, counts, and hashes. The retained result and safe event sidecar omit raw
source, prompts, provider/tool bodies, endpoints, credentials, absolute paths,
and raw diagnostics. Exit 0 means pass; exit 2 is a classified blocked, failed,
invalid, or admission outcome; exit 130 is cancellation; and exit 1 is invalid
invocation or an unclassified harness defect. `passed` proves only the recorded
production-path invariants for this fixture; it does not establish review
quality or any routing, cost, or latency advantage.

## Fixture and evaluator utilities

The first fixture/evaluator canary selection is defined in
[`canary.json`](canary.json):

- `research-ldr-023` and `research-ldr-031` use the pinned LiveDRBench preview artifact and evaluator;
- `coding-flask-5014` and `coding-pytest-7432` use the pinned SWE-bench Verified artifact and official Docker evaluator.

All current command responses are JSON, so CI and a future app screen can consume
the same output. None of these commands runs a research or coding agent episode.

```bash
# Setup downloads are revision-pinned and artifacts are rejected unless their
# SHA-256 matches benchmarks/sources.json.
pnpm benchmark fetch --id research-ldr-023 --id coding-flask-5014

# Reads the local Parquet cache and splits each row into an allow-listed agent
# fixture and a private evaluator oracle. This performs no network request.
pnpm benchmark prepare \
  --id research-ldr-023 --id research-ldr-031 \
  --id coding-flask-5014 --id coding-pytest-7432

# Fetch only a coding repository's exact base_commit (no tags, later history,
# gold PR, or remote retained), or make a prompt-only research workspace. The
# workspace must be outside benchmarks/cache.
pnpm benchmark workspace --id coding-flask-5014 \
  --workspace /private/tmp/soar-workspaces/coding-flask-5014

# Fetch an evaluator and detach it at its immutable revision.
pnpm benchmark setup-evaluator --id coding-flask-5014

# Machine-readable readiness for all four canaries. Exit 2 means blocked, not a
# failed task. On Apple Silicon, official SWE-bench evaluation remains blocked.
pnpm benchmark:preflight

# Evaluate an existing agent answer/patch and copy an optional caller-supplied
# route/tool trace next to the deterministic result record.
pnpm benchmark evaluate --id research-ldr-023 \
  --submission /path/to/answer.json \
  --trace /path/to/route-tool-trace.jsonl \
  --run-id local-canary-001 --policy local_only
```

For LiveDRBench, `answer.json` may be the single JSON value requested by the
task prompt or the benchmark's official keyed `[{"key": ..., "preds": ...}]`
schema. The harness validates and normalizes either form before any judge call.
For SWE-bench, the submission file is the unified diff produced by the agent.
`evaluate` is not offline: LiveDRBench uses its configured paid judge, and the
official SWE-bench Docker harness may pull evaluator images.

Prepared data is split under `benchmarks/cache/prepared/<id>/agent` and
`benchmarks/cache/prepared/<id>/evaluator`. Only the former may be copied into
an agent workspace. Agent workspaces that contain, or sit inside,
`benchmarks/cache` are rejected. Official evaluators receive the private oracle
only after inference is complete. Exported records under
`benchmarks/runs/<run-id>/<workload-id>` contain dataset and evaluator revisions,
artifact, submission, and trace hashes, status, score, and evaluator evidence;
the result record never
copies the evaluator oracle, gold answer, hidden patch, or private evaluator log.
The trace sidecar is the agent's own route/tool stream preserved byte-for-byte.

Parquet loading requires Python plus `pyarrow` (the tested local version is
15.0.2). LiveDRBench's official grader additionally requires its pinned checkout,
dependencies, and a separately authorized `OPENAI_API_KEY`; the harness does not
silently substitute a free heuristic score. Official SWE-bench evaluation
requires its pinned checkout and Python dependencies, a running Docker daemon,
and a native x86-64 Linux worker. Darwin/arm64 is intentionally reported as
`blocked`; emulation results are not labeled official.
