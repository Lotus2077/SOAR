# Contributing to SOAR

SOAR is early-stage software. Focused bug fixes, tests, documentation, provider
compatibility improvements, and bounded tool/runtime changes are welcome. For a
large feature or a change to a persisted contract, open an issue first so the
design and migration cost are visible before implementation begins.

## Development setup

You need Git, Node.js 22.22.2 or later in the Node 22 line, pnpm 10.12.4, and a
C++20 compiler. Node 24 and Node 26 are not currently part of the supported
contributor contract.
The checked-in `.nvmrc` selects the exact CI baseline, and pnpm rejects an
unsupported Node engine before installing dependencies.
macOS contributors also need Xcode Command Line Tools because the locked native
credential module builds through `xcrun`; macOS is required for the desktop
application, Electron end-to-end tests, and package/canary checks. Most type
checks, unit tests, and production bundles also run on Linux.

```sh
git clone https://github.com/Lotus2077/SOAR.git
cd SOAR
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm check
```

Tests do not need a live model by default. To run the application, configure an
OpenAI-compatible vLLM endpoint in `.env.local`. Never commit that file, a live
endpoint credential, benchmark gold data, or generated run artifacts.

## Repository map

- `src/main`: Electron lifecycle, configuration, persistence, IPC, routing,
  providers, tools, and the session runner;
- `src/preload`: the narrow renderer-to-main bridge;
- `src/renderer`: the React desktop interface;
- `src/shared`: schemas, event contracts, context construction, and reducers;
- `src/benchmark`: fixture, workspace, preflight, evaluator, and result logic;
- `native`: version-pinned, platform-specific native modules. PR6B1-B permits
  only the activation-locked macOS credential broker flavor;
- `tests`: unit, integration, live opt-in, and Electron end-to-end coverage;
- `benchmarks`: public workload manifests, source pins, schemas, and protocol.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing a runtime
boundary or persisted event.

## Making a change

1. Keep the pull request narrow and explain the user-visible or invariant-level
   reason for the change.
2. Add or update a test that would fail without the change.
3. Preserve append-only event history. Add schema-compatible events or an
   explicit migration; do not reinterpret old records silently.
4. Keep filesystem access behind the central tool registry and workspace policy.
5. Keep network-dependent, paid, and real-model tests opt-in.
6. Update the architecture, readiness, routing, or benchmark docs when their
   contracts change.
7. Add an entry to [docs/BUILD_LOG.md](docs/BUILD_LOG.md) for a material
   product, architecture, persisted-contract, provider, cost, security,
   evaluation, failure, or milestone change. Append corrections; do not rewrite
   an earlier decision or negative result. Use the collision-resistant ID and
   concurrent-PR rules in that ledger, rebase before merge, and retain both
   entries when resolving a tail conflict.

An approval-gated plan is not authorized by a merge or by silence. Follow the
approval record and scope defined by that plan before beginning gated runtime
or paid-provider work.

Use existing naming and formatting conventions. `.editorconfig` defines the
portable whitespace baseline. Avoid unrelated mass formatting in a functional
pull request.

## Validation

Run this before opening a pull request:

```sh
pnpm check
```

`pnpm check` validates workload manifests and secret hygiene, type-checks both
process environments, runs the deterministic test suite, and creates a
production build.

After committing a release candidate, or before citing an integration test that
builds its fixture from `git archive HEAD`, run the committed-head gate:

```sh
pnpm check:release-head
```

This release-only wrapper refuses staged, unstaged, and untracked non-ignored
files, runs `pnpm check` exactly once, and confirms that the same clean commit
still exists afterward. It forces all live-provider opt-in flags off for the
child gate, while ignored build artifacts are allowed. Ordinary development
should continue to use `pnpm check`; it does not call the release-head wrapper
and the two commands do not recurse.

On macOS, also run:

```sh
pnpm test:e2e
pnpm package:mac
pnpm test:e2e:packaged-credential-status
```

Use live checks only when the change touches the corresponding integration:

```sh
pnpm test:live-vllm
pnpm test:live-repository
pnpm benchmark:preflight
```

Live tests may contact the configured provider. Benchmark evaluation may spend
money or require Docker and official evaluator dependencies; read
[benchmarks/README.md](benchmarks/README.md) first. A blocked preflight is a
missing prerequisite, not a model result.

## Pull request expectations

- describe the problem, approach, and important trade-offs;
- list exact validation commands and outcomes;
- include screenshots for renderer changes;
- call out event/schema, security-boundary, cost, or benchmark-comparability
  changes explicitly;
- include the required build-log entry for every material change;
- exclude `.env.local`, databases, caches, run traces, gold data, and generated
  build output.

By contributing, you agree that your contribution is licensed under the MIT
License in [LICENSE](LICENSE).
