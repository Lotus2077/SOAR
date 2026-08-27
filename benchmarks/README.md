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
