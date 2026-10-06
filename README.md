# SOAR

SOAR is a privacy-first desktop agent. You delegate heavy, end-to-end work to it:
deep research, document review and amendment, websites, editable slide decks,
day-to-day administration, and (at lower priority) coding.

- **Where it runs.** The main agent runs on an inference device you own.
- **Cloud models.** They see only public or synthetic work, never your personal or
  professional data.
- **Priority order.** Privacy >= quality > savings > latency.

> [!IMPORTANT]
> Experimental and unreleased. Real private data is not yet admitted: the local-only
> "Tier O" is gated on device and transport checks. Nothing here is certified for
> HIPAA, GDPR, PIPL or professional-confidentiality regimes, and SOAR makes no such
> claim.

## Start here

| Document | What it is |
| --- | --- |
| [docs/PLAN.md](docs/PLAN.md) | The current plan (owner-approved 2026-09-29): phases, decision rules, cloud envelope, owner decisions |
| [docs/plans/PRIVATE_WORK_DESIGN_V1.md](docs/plans/PRIVATE_WORK_DESIGN_V1.md) | Strict privacy profile, draft-only admin assistant, research and document-review design, device notes |
| [docs/PROJECT_REVIEW_2026-09-28.md](docs/PROJECT_REVIEW_2026-09-28.md) | Verified whole-project review: what is right and wrong |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Code map and the September state of the runtime |
| [docs/BUILD_LOG.md](docs/BUILD_LOG.md) | Append-only record of decisions, results and failures |
| [docs/README.md](docs/README.md) | Index of current and historical documents |

## Status

| Area | State |
| --- | --- |
| General task (desktop) | A goal with optional files and exact public URLs, saved progress, pause/resume/cancel, preview and export. Accepted examples: two synthetic audits and one three-slide deck. Research and websites are not yet accepted. |
| Local model profile | `heavy` (thinking on, 16K output, 80 calls / 90 min) is the default since 2026-10-06; `standard` (the September profile: thinking off, 4,096 tokens, 20 calls / 15 min) stays selectable with `SOAR_GENERAL_TASK_PROFILE=standard`. Every result before that date used `standard`. |
| Cloud comparison | Not yet run. The Phase 2 fair test compares local and `gpt-6-sol` through the same loop, on public or synthetic tasks. |
| Tier O (private data) | Blocked until the box checklist, an encrypted tunnel, telemetry-off checks and an owner approval are recorded. |
| Coding pilot | Opt-in "Fix a repository" flow with cloud execution in isolated containers. |
| Legacy tracks | Repository Investigator, Review Current Changes and the hybrid simulation are still wired but frozen. They will be flagged off. The PR6R canary and held-out evaluator were removed; they remain at tag `archive/router-era-2026-09-28`. |

## Setup

Requirements: macOS, Node 22.22.2 (`.nvmrc`), pnpm 10.12.4, and Docker (for the
tool sandbox). Keep the repository outside iCloud-synced folders. Files that
iCloud evicts made tests and builds stall for minutes.

```sh
nvm use
corepack prepare pnpm@10.12.4 --activate
pnpm install --frozen-lockfile
pnpm check
```

Put the local inference settings in `.env.local`, which Git ignores. Never commit
it:

```sh
SOAR_VLLM_BASE_URL=http://<your-device>/v1
SOAR_VLLM_MODEL=<served model name>
SOAR_VLLM_COST_POLICY=local_zero_cost
SOAR_ALLOW_INSECURE_VLLM_HTTP=true   # only for a non-loopback plain-HTTP endpoint
SOAR_GENERAL_TASK_IMAGE_ID=sha256:<tool sandbox image built from runtime/private-agent/Dockerfile>
```

A plain-HTTP endpoint on a network is acceptable only for public or synthetic
data.

Two read-only diagnostics are available:

- `python3 scripts/box-checklist.py`: run on the inference device. It prints a
  whitelisted summary that is safe to review before sharing.
- `python3 scripts/serving-probe.py`: run from the Mac. It measures the endpoint.
  Its full results stay under the ignored `.soar/`.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the desktop app |
| `pnpm check` | Readiness and build-log validation, typecheck, tests, build (about 40 s) |
| `pnpm test:e2e` | Electron end-to-end tests (after `pnpm build`) |
| `pnpm check:general-consultant` | Check the optional consultant environment without printing values |
| `pnpm setup:patch-pilot` / `pnpm dev:patch` | Coding pilot setup and cloud-only launch |
| `pnpm check:release-head` | Release-only gate on a clean committed head |

## Working rules

See [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md) and the process
section of [docs/PLAN.md](docs/PLAN.md).

- **Build log.** Record decisions, failures and results in the build log. Never
  rewrite an earlier entry.
- **Evidence standard.** Keep submitted and accepted separate. File existence, test
  totals and mechanics are not acceptance.
- **What never goes into Git or cloud tools:** credentials, private endpoints, raw
  traces, evaluator gold, generated databases, and any personal or professional
  data.

The detailed pre-September-28 README is kept at
[docs/history/README-2026-09-28.md](docs/history/README-2026-09-28.md).

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
