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
development-canary build followed by a production build. The dual-flavor gate
requires the normal package policy to reject the special output and leaves
`out/` restored to the normal application.

### PR6R-A1 development-only checks

PR6R-A1 is an in-progress, unpackaged, `$0` structural checkpoint. Its special
Electron graph is not a production Cloud path and must never receive a real
credential, provider endpoint, repository-egress permission, or paid authority.
Run its build checks explicitly with:

```sh
pnpm build:pr6r-development-canary
pnpm verify:pr6r-development-build-flavors
```

The first command intentionally leaves the special flavor in `out/`. Do not
package or publish that output. The second command builds and verifies the
special flavor, confirms that the normal policy rejects it, then rebuilds and
verifies the normal flavor. `pnpm check` includes that dual-flavor sequence.
If the dual-flavor command is interrupted, treat `out/` as unknown and possibly
special. Run `pnpm build` to rebuild and verify the normal flavor before running,
packaging, or publishing anything from `out/`.
These A1 gates have no network dependency: dependencies and fixture objects must
already be present locally, and any outbound connection is a failed proof.
Any change to a persisted PR6R campaign, comparison, safe-projection, fallback,
transition, or chronology contract must deliberately update the payload-contract
descriptor/version and its migration tests; the fingerprint is an explicit
contributor ratchet, not an automatic digest of the Zod implementation. The A1
store intentionally accepts only its one fresh schema because it is unshipped.
Do not treat a version/fingerprint bump alone as a migration: the first
post-A1 persisted-contract change must add an ordered schema migration and a
compatibility test that opens the immediately preceding committed database.

The exact frozen public fixture proof additionally requires an already-present
local Flask Git repository containing the pinned objects:

```sh
SOAR_PR6R_FLASK_REPO=/absolute/path/to/local/flask \
  pnpm test:pr6r-development-fixture
```

The fixture command accepts a local repository root only. It may make its
bounded local shared clone, but it must not clone from a URL, fetch, contact a
model provider, or read a secret; missing objects fail closed.
Keep the source path in the untracked environment only and never paste a private
path, endpoint, credential, raw trace, or generated database into a commit or
review artifact. A successful materialization returns a caller-owned cleanup
handle; the explicit proof invokes it in `finally` and verifies that its
temporary workspace is gone. A future app coordinator must preserve that rule
on success, failure, and cancellation. After an interrupted run, inspect and
remove only the exact leftover temporary directory—never use a broad recursive
cleanup target. `$0` here means zero external provider spend; local compute and
storage are not measured.

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
