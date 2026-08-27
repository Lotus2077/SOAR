# SOAR

SOAR is a macOS-first agentic task router. Its first product surface is an Electron desktop app for long-running research and repository-to-patch sessions. It keeps one canonical session record while assigning individual phases to a local vLLM model or a paid cloud model.

The MVP optimizes a constrained trade-off rather than promising an impossible per-task optimum:

1. meet a defined quality floor on the target workload;
2. minimize paid-model cost subject to that floor;
3. minimize end-to-end latency subject to the same floor and a deadline.

## Current readiness

- Product tracks: research-to-artifact and repository-to-tested-patch.
- App target: Electron on macOS.
- Providers: one OpenAI-compatible vLLM endpoint and pinned OpenRouter DeepSeek V4 Flash 0731.
- Routing: a provisional phase plan with model affinity, plus event-driven rerouting.
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

### UI design reference

The desktop shell adapts general layout, typography, color, and interaction patterns from the MIT-licensed [Hermes Agent](https://github.com/NousResearch/hermes-agent) desktop app. SOAR keeps its own product identity, copy, data model, and runtime. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and the pinned source revision.

### Development

Install dependencies and configure the machine-local `.env.local` file:

```sh
pnpm install
pnpm dev
```

The vLLM base URL must end in `/v1`. For a non-loopback plaintext endpoint, set
`SOAR_ALLOW_INSECURE_VLLM_HTTP=true` in `.env.local`.

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
