# Benchmark protocol

The workload manifests contain 22 research and 20 coding records from pinned public benchmarks. They identify the source fixture and its official evaluator; they are not a list of invented example prompts.

- [`research.jsonl`](research.jsonl): ten structured LiveDRBench discovery cases and twelve long-form DeepResearch Bench reports.
- [`coding.jsonl`](coding.jsonl): twenty SWE-bench Verified issues spanning all twelve upstream repositories in that suite.
- [`sources.json`](sources.json): immutable revisions, checksums, field visibility, and evaluator isolation rules.

Prompt and gold fields are loaded from the pinned source at run time. Gold answers, solution patches, hidden tests, reference reports, and provenance pull requests must never enter the agent's context.

## Comparison policies

Run every selected workload through the same agent harness, tools, time limit, initial fixture, and evaluator under three policies:

1. `local_only`: local vLLM for every inference;
2. `cloud_only`: pinned DeepSeek V4 Flash 0731 for every inference;
3. `hybrid_v0`: the deterministic phase-and-trigger policy in `docs/ROUTING_POLICY.md`.

External products such as Manus, Genspark, and Claude Code can be recorded as separate product baselines, but their results must not be mixed with same-harness model-routing comparisons.

The selected SWE-bench evaluator images are `linux/amd64`, while the current macOS development machine is Apple Silicon. Docker Desktop can emulate them for a few smoke cases, but repeatable bulk coding evaluation should run on an x86-64 Linux worker while the Electron app remains macOS-first.

## USD 100 campaign gate

The USD 100 figure is a hard campaign ceiling, not permission for an individual run to consume the balance.

| Stage | Work | Maximum paid exposure |
| --- | --- | ---: |
| 0 | Validate all 40+ workloads with `local_only`; repair fixtures and evaluators. | USD 0 |
| 1 | Canary set: 2 research and 2 coding workloads under `cloud_only` and `hybrid_v0`, capped at USD 0.75 per episode. | USD 6 |
| 2 | Run the remaining 38 workloads under both paid policies, capped at USD 0.75 per episode. | USD 57 |
| 3 | Evaluator calls and reruns of invalid or flaky results, admitted only while budget remains. | USD 27 automatic reserve |
| Holdback | Never spent automatically. | USD 10 |

The app must deny a paid call when its conservative projected cost would cross the per-episode cap, USD 90 automatic stop, or USD 100 campaign ceiling. Cancellation, retries, cached-token pricing, provider-reported cost, and late usage reconciliation must all be logged.

## Required run record

Each episode records:

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

## Executable harness

The first executable canary is defined in [`canary.json`](canary.json):

- `research-ldr-023` and `research-ldr-031` use the pinned LiveDRBench preview artifact and evaluator;
- `coding-flask-5014` and `coding-pytest-7432` use the pinned SWE-bench Verified artifact and official Docker evaluator.

All command responses are JSON, so CI and a future app screen can consume the same output.

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

# Evaluate an existing agent answer/patch and preserve its complete route/tool
# trace next to the deterministic result record.
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
