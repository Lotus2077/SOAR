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
- fail-closed completion handling for truncated, filtered, empty, malformed, or
  tool-looping provider responses, including a no-thinking, tool-free final
  synthesis round and evidence-backed path/line citation validation.

OpenRouter is not reachable from this runtime path. Cloud routing is a later milestone.

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
model unless their command is explicitly prefixed with `test:live-`.

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

Run the three-task Local Repository Investigator proof against the real vLLM:

```sh
pnpm test:live-repository
```

The ignored proof artifact is written to
`benchmarks/runs/local-repository-investigator-v1.json` with the complete
session event, route, tool, citation, latency, and token trace.

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
