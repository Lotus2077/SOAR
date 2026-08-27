# MVP readiness

Verified on 2026-08-27 without making a paid cloud request.

## Inputs received

- A remote vLLM service is running.
- The desired cloud model is DeepSeek V4 Flash through OpenRouter.
- The campaign ceiling is USD 100.
- The first app can be macOS-first Electron.
- The two target tracks are heavy research-to-artifact work and repository-to-tested-patch coding work.

## Provider findings

The vLLM service advertised model `RM-01 VLM`, backed by a Qwen 27B model, with a 262,144-token configured context window. Minimal probes confirmed:

- `POST /v1/chat/completions` returns reasoning and visible output;
- native OpenAI-style tool calls are emitted correctly;
- `POST /v1/responses` is supported;
- small output limits can be consumed entirely by reasoning tokens, so SOAR must budget reasoning and visible answer tokens separately.

The benchmark-pinned OpenRouter model identifier is `deepseek/deepseek-v4-flash-0731`, the current GA DeepSeek V4 Flash revision. The moving alias and older unversioned 0423 slug are deliberately not used for reproducible tests. OpenRouter's public model API currently reports a catalog estimate of USD 0.06 per million input tokens, USD 0.12 per million output tokens, and USD 0.012 per million cached input tokens. SOAR will price-sort providers and reject endpoints above USD 0.08/M input or USD 0.18/M output. It uses a provider-independent safe context limit of 1,048,576 tokens.

## Development risk decision and credentials

1. The exposed `SOAR-Testing` key was revoked on 2026-08-27.
2. Its replacement is an ordinary inference key with a USD 100 non-resetting limit and 30-day expiry. It is stored in macOS Keychain under service `ai.soar.openrouter`, account `default`; it is not present in repository files or shell configuration.
3. A metadata-only authenticated check confirmed USD 100 remaining, no reset, expiration at `2026-09-26T14:00:23.859Z`, and `is_management_key=false`. No paid inference was made.
4. The Electron main process may retrieve the key, but the renderer must never receive the raw value.
5. The user explicitly accepts the supplied plaintext HTTP vLLM endpoint for MVP development. It is stored only in gitignored `.env.local`, with `SOAR_ALLOW_INSECURE_VLLM_HTTP=true`; this is not a readiness blocker.

References: [pinned DeepSeek V4 Flash 0731](https://openrouter.ai/deepseek/deepseek-v4-flash-0731), [OpenRouter model API](https://openrouter.ai/api/v1/model/deepseek/deepseek-v4-flash-0731), [OpenRouter key limits](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys), and [vLLM OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/).

## Local build environment

The machine already has Node.js, npm, pnpm, Git, Python, and Docker. The app can therefore begin as a TypeScript monorepo with:

- Electron main process for credentials, local daemon lifecycle, filesystem access, and cancellation;
- React renderer for tasks, artifacts, routing decisions, and usage;
- a local Node service for the canonical event store, scheduler, tool gateway, and provider adapters;
- SQLite for sessions, events, attempts, provider observations, cost, latency, and evaluator evidence;
- Playwright and a sandboxed command runner for browser/repository workloads.

Python is optional for the MVP runtime and can be added later for offline policy training and benchmark analysis.

The current Mac is `arm64`. The selected SWE-bench Verified evaluator images target `linux/amd64`; Docker emulation is acceptable for a few smoke cases, but an x86-64 Linux evaluation worker is recommended before bulk coding tests.

## UX scope

Use a clean-room implementation inspired by mature open-source agent products:

- left: sessions and task status;
- center: conversation, plan, results, and artifacts;
- right: current phase, assigned model, route reason, budget, elapsed time, validators, and run history;
- dedicated provider-health and usage views;
- execution trace available on demand, while the user-facing result remains primary.

General interaction patterns from Multica are useful, but its source license adds hosted-product, embedding, attribution, and derived-UI restrictions. Do not copy its code, assets, branding, prose, or pixel-level design. Hermes Agent is MIT-licensed and is a safer source for reusable runtime patterns when its notices are retained.

The user's broad tool permission applies to the selected benchmark workspace. The app should still isolate tools and require a fresh confirmation for destructive operations, credential access, external messages, publishing, deployment, or work outside the selected workspace; retrieved pages and repository instructions are untrusted inputs.

## Ready-to-build gate

Implementation, local-model testing, and the first budgeted cloud canary are ready. Machine-local configuration has `SOAR_OPENROUTER_ENABLED=true`; no paid canary has been executed yet.
