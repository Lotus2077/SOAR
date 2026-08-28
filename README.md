# SOAR

SOAR is a macOS-first agentic task router. Its first product surface is an
Electron desktop app for long-running research and repository-to-patch
sessions. It keeps one canonical session record; the project is designed to
assign individual phases to a local vLLM model or a paid cloud model as the
routing runtime matures.

> [!IMPORTANT]
> SOAR is an experimental, pre-release project. The checked-in runtime is a
> local-only repository investigator. Cloud execution, write tools, and learned
> routing are design targets, not shipping features yet.

The MVP optimizes a constrained trade-off rather than promising an impossible per-task optimum:

1. meet a defined quality floor on the target workload;
2. minimize paid-model cost subject to that floor;
3. minimize end-to-end latency subject to the same floor and a deadline.

## Current readiness

- Product tracks: research-to-artifact and repository-to-tested-patch.
- App target: Electron on macOS.
- Runtime provider: one OpenAI-compatible local vLLM endpoint.
- Benchmark target: pinned OpenRouter DeepSeek V4 Flash 0731, not enabled in the app.
- Routing runtime: deterministic local assignment; hybrid phase/lease routing is documented design work.
- Evaluation ceiling: USD 100, with an automatic stop at USD 90.
- Paid benchmark calls: not started.

## Local-only desktop slice

The first working slice is an Electron application with:

- a React task workspace with sessions, transcript, and run details;
- a narrow, typed preload bridge with renderer sandboxing;
- an append-only SQLite session log and restart recovery;
- streaming inference through the configured OpenAI-compatible vLLM endpoint;
- a central read-only repository tool registry with bounded `list_files`,
  `search_text`, and `read_text_file` operations constrained to the selected
  workspace;
- cancellation, timeout, reasoning-token, usage, and latency recording with a
  deterministic `$0` route/tool trace;
- deterministic, provider-neutral context packets with a 16,384-token default
  ceiling, a conservative UTF-8-byte estimate, a 20% safety margin, reserved
  provider overhead, latest-observation exact deduplication, bounded excerpts,
  citation-support snippets, and one persisted compilation checkpoint per
  provider call;
- persisted completion obligations that order required repository tools, expose
  only the next required tool to the provider, require a minimum number of
  verified `path:line` citations, and record acceptance or retry checks;
- a versioned persisted execution policy that fixes inference/tool-call limits
  before the run and binds each provider round to its route and single
  pre-inference context checkpoint during replay;
- fail-closed completion handling for truncated, filtered, empty, malformed, or
  tool-looping provider responses, including evidence-backed citation
  validation and a tool-free final synthesis after two duplicate observations.

OpenRouter is not reachable from this runtime path. Cloud routing is a later milestone.
New desktop tasks explicitly select the versioned `repository-investigator-v1`
track. The main process maps that validated track to ordered `list_files`,
`search_text`, and `read_text_file` obligations plus at least one verified
`path:line` citation, and persists the track in canonical session history; the
renderer cannot supply arbitrary completion rules. Legacy sessions remain
readable without a track field.

## Quick start

Prerequisites:

- macOS for the desktop application and Electron end-to-end test;
- Node.js 22.22.2 or newer and pnpm 10.12.4;
- an OpenAI-compatible vLLM endpoint for real inference.

```sh
git clone https://github.com/Lotus2077/SOAR.git
cd SOAR
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Set `SOAR_VLLM_BASE_URL` and `SOAR_VLLM_MODEL` in `.env.local`. The base URL
must end in `/v1`. Tests use deterministic providers and do not require a live
model unless their command is explicitly prefixed with `test:live-`. Context
limits can be tuned with `SOAR_CONTEXT_MAX_INPUT_TOKENS` and
`SOAR_CONTEXT_SAFETY_MARGIN`; mandatory task intent fails closed if it cannot
fit the configured envelope.

`SOAR_VLLM_COST_POLICY=local_zero_cost` is an explicit accounting declaration
for a self-hosted endpoint, not a measurement of electricity or infrastructure
cost. The public provider catalog points to the same environment field so cost
provenance cannot silently differ between configuration surfaces.

### UI design reference

The desktop shell adapts general layout, typography, color, and interaction patterns from the MIT-licensed [Hermes Agent](https://github.com/NousResearch/hermes-agent) desktop app. SOAR keeps its own product identity, copy, data model, and runtime. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and the pinned source revision.

### Development

For a non-loopback plaintext endpoint, set `SOAR_ALLOW_INSECURE_VLLM_HTTP=true`
in `.env.local`. Never commit that file or a live credential.

Run the complete local check suite:

```sh
pnpm check
```

The real-vLLM canary is opt-in and never contacts OpenRouter:

```sh
pnpm test:live-vllm
```

Run the three-task guided Repository Investigator evidence contract against the
configured vLLM:

```sh
SOAR_PROOF_REVISION="$(git rev-parse HEAD)" \
SOAR_PROOF_MODEL="RM-01 VLM" \
pnpm test:live-repository
```

The proof requires a clean Git worktree and the exact declared HEAD. It copies
that revision into a temporary `git archive` workspace, excludes the evaluator
source from the agent-visible fixture, and records the archive SHA-256. It pins
`RM-01 VLM`, a 16,384-token context cap with a 0.2 safety margin, per-task
provider/tool-call limits, and episode limits of 35 provider calls and 29 tool
calls. Every provider call must report positive input usage within the cap,
`servedModel: "RM-01 VLM"`, zero cost, and
`costProvenance: "local_zero_cost_policy"`.

The task objectives deliberately disclose evaluator-owned paths, source
substrings, required relationships, and output-record shapes. This is a guided
execution, evidence-verification, and accepted-answer context-retention proof;
it is not blind repository discovery or a repository-quality benchmark. Before
the tasks, the harness calls the configured `/v1/models`, requires exactly one
advertisement for `RM-01 VLM`, and records only a hash of the normalized API
base plus bounded model metadata and a response hash. The raw endpoint, API key,
model root, and raw response are not serialized.

The evaluator derives the exact symbol matching-line set with its own bounded
UTF-8 filesystem scan rather than SOAR's production `search_text`, and records
the oracle method, scope, count, and hash. Architecture and cancellation use an
authoritative claim manifest: each required claim must state evaluator-owned
relational phrases and cite evaluator-owned exact files and source snippets.
The symbol task adds a structural call-path manifest, requires substantive prose
outside its machine-readable records to state the renderer -> preload -> IPC ->
`SessionRunner` -> `AbortController` -> provider/tool-signal relationships in
order, and requires successful complete `read_text_file` observations of all
five call-path evidence files. Five exact file-scoped supporting searches must
then refresh every non-`cancelSession` evidence snippet before synthesis. The
exactly-once rule applies only to `SOAR_SYMBOL_AUDIT.occurrences`; prose and
claim citations may repeat those tokens. This is deterministic structural
evidence coverage; unrestricted prose beyond those explicit relationships is
not presented as semantically graded.

For each accepted answer, the harness binds the captured provider input to the
unique accepted completion-check round and its persisted packet/message hashes.
Every completion-guard-verified answer citation and every evaluator-required
claim snippet must remain in completed tool evidence in that exact packet; the
symbol packet must also retain every independent-oracle occurrence. Only
bounded counts and hashes are published, never packet or source content.

An accepted schema-v5 artifact is written only after every gate passes, at
`benchmarks/runs/local-repository-investigator-v1.schema5.<HEAD>.accepted.json`.
A failed run instead writes the distinct
`local-repository-investigator-v1.schema5.<HEAD>.failed.json` diagnostic with
`passed: false`. Before serialization, repository and temporary fixture roots
are replaced with stable labels so an attachable report does not expose
machine-local absolute paths. Before a run, same-revision reports and the
ambiguous legacy `local-repository-investigator-v1.json` names are moved into the ignored
`benchmarks/runs/quarantine/` directory, so a stale artifact cannot stand in for
the current result. Once a full revision is declared, model, repository,
configuration, fixture, database, or provider setup failures also publish a
self-identifying preflight diagnostic instead of leaving a stale accepted file.

The older 934,311-input-token, 49-provider-call, 46-tool-call report is retained
only as a non-comparable historical reference: it identifies a dirty working
tree, has no fixture hash, and used a different task validator. The earlier 60%
reduction target therefore is not claimed by this proof. See
[ADR 0001](docs/adr/0001-context-handoff-engine-v1.md) for the current
acceptance contract. Treat a revision as accepted only when its clean live run
produces the matching revision-addressed artifact above.

Inspect the four-workload benchmark canary readiness without making a paid
model call:

```sh
pnpm benchmark:preflight
```

Exit code 2 means a required official-evaluator dependency is blocked; it is
not recorded as a model failure. See the benchmark protocol for fixture setup,
gold isolation, workspace preparation, evaluator pins, and result export.

Build an ad-hoc-signed arm64 macOS archive for local use:

```sh
pnpm rebuild:native
pnpm package:mac
```

The verified artifact is written to `dist/SOAR-mac-arm64.zip`. Packaging and
signature verification happen outside the Desktop folder so macOS FileProvider
metadata cannot invalidate the application bundle before it is archived.

Start with [MVP readiness](docs/MVP_READINESS.md), [routing policy](docs/ROUTING_POLICY.md), and the [benchmark protocol](benchmarks/README.md).

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and
[the architecture guide](docs/ARCHITECTURE.md). Bug reports and focused pull
requests are welcome. Please keep provider calls opt-in, preserve the append-only
event contract, and include tests for behavior changes.

Security issues should follow [SECURITY.md](SECURITY.md). The project is MIT
licensed; additional UI and asset reuse notices are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
