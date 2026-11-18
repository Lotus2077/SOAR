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

- `src/main/private-agent` and `src/main/general-tasks`: the current General
  task runtime (broker, sandbox, durable loop, consultation, artifact export);
- `src/main/patch-runs` and `runtime/patch-worker`: the opt-in coding pilot;
- `src/main` (other modules): Electron lifecycle, configuration, persistence,
  IPC, providers, tools, and the legacy Repository Investigator, Review Current
  Changes and hybrid-simulation paths (frozen; see [docs/PLAN.md](docs/PLAN.md));
- `src/preload`: the narrow renderer-to-main bridge;
- `src/renderer`: the React desktop interface;
- `src/shared`: schemas, event contracts, context construction, and reducers;
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
7. Add one entry file under [docs/build-log/](docs/build-log/) for a material
   product, architecture, persisted-contract, provider, cost, security,
   evaluation, failure, or milestone change. The rules are in
   [AGENTS.md](AGENTS.md); `pnpm validate:build-log -- --base-ref origin/main`
   checks them.
   - The file is named by its ID, `BL-YYYYMMDD-HHMM-slug.md`, in UTC. Its first
     line is `### <ID> -- <UTC date> -- <title>`, and the ten fields follow.
   - It runs about 25 lines, with the detail in the pull request's description.
   - It may be revised until the pull request merges, and must be true then.
   - A file on `main` never changes; correct it with a new `Correction` file.
   - [docs/BUILD_LOG.md](docs/BUILD_LOG.md) is the frozen archive of every entry
     to 2026-11-18. Nothing edits it.
   - Entries do not conflict, so they are never re-stamped, and pull requests
     merge in any order.
   - A pull request adds no log ID to a file under `src/` or `scripts/`.

   **A branch opened before the switch** moves the entries it appended to the
   archive into files:

   ```bash
   git fetch origin && git merge origin/main   # resolve any other conflict; leave docs/BUILD_LOG.md as it is
   pnpm build-log:to-files                     # moves your entries to docs/build-log/ and restores main's archive
   git add docs/BUILD_LOG.md docs/build-log && git commit -m "Move this branch's log entries to docs/build-log/"
   ```

   - **When it refuses.** The command refuses while another file is still
     unmerged, and outside a merge it refuses an unmerged archive, as a rebase
     leaves one. It moves nothing when it refuses.
   - **Afterwards,** remove any log ID the branch added under `src/` or
     `scripts/`; the validator names each one.

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
```

Live tests may contact the configured provider. Never send personal or
professional data to any cloud model, search engine, telemetry service or
development agent (see the privacy rule in [docs/PLAN.md](docs/PLAN.md)).
The held-out benchmark evaluator and PR6R development canary were removed on
2026-09-28; they remain available at tag `archive/router-era-2026-09-28`.

## Pull request expectations

- describe the problem, approach, and important trade-offs;
- list exact validation commands and outcomes;
- include screenshots for renderer changes;
- call out event/schema, security-boundary, cost, or benchmark-comparability
  changes explicitly;
- include the required entry file under `docs/build-log/` for every material
  change;
- exclude `.env.local`, databases, caches, run traces, gold data, and generated
  build output.

By contributing, you agree that your contribution is licensed under the MIT
License in [LICENSE](LICENSE).
