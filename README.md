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
| General task (desktop) | A goal with optional files and exact public URLs, saved progress, pause/resume/cancel, preview and export. Accepted examples: two synthetic audits and one three-slide deck. Research tasks with public sources require a host-checked claims ledger (verbatim quotes against retained source bytes). Research and websites are not yet accepted. |
| Local model profile | `heavy` (thinking on, 16K output, 80 calls / 90 min) is the default since 2026-10-06; `standard` (the September profile: thinking off, 4,096 tokens, 20 calls / 15 min) stays selectable with `SOAR_GENERAL_TASK_PROFILE=standard`. Every result before that date used `standard`. |
| Liveness | Local replies stream, with a 120 s inactivity limit counted from the first byte (`SOAR_STREAMING=false` restores the non-streaming request). The Mac stays awake while a task runs, and a late host heartbeat is recorded. Quitting while a task runs waits for it to pause, with a "Quit now" option that leaves it unable to resume. |
| Document review | Headless only so far. With `--document-review`, the model writes an edit plan for a task's one `.docx`. A host-owned script turns the plan into tracked changes by "SOAR draft" with a comment per edit, a clean amended copy, an issues list and a hygiene report. A host check proves several things: rejecting every change restores the original, accepting every change gives exactly the plan, nothing else in the file changed, and both files render. Not yet in the desktop. |
| Cloud comparison | Not yet run. The Phase 2 fair test compares local and `gpt-6-sol` through the same loop, on public or synthetic tasks; the headless driver's `--arm cloud` (OpenAI request shape, cached-rate settlement, USD 8 cap per task, key from the launching shell only) is implemented but has made no live call. |
| Tier O (private data) | Blocked until the box checklist, an encrypted tunnel, telemetry-off checks and an owner approval are recorded. |
| Coding pilot | Opt-in "Fix a repository" flow with cloud execution in isolated containers. |
| Legacy tracks | Repository Investigator, Review Current Changes, the coding pilot and the hybrid simulation stay wired but are hidden unless `SOAR_ENABLE_LABS=true`; the general task is the default surface and the ⌘N target. The PR6R canary and held-out evaluator were removed; they remain at tag `archive/router-era-2026-09-28`. |

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

If a system proxy runs in fake-IP mode (every hostname resolves to
`198.18.0.0/15`), SOAR refuses those answers for cloud and public destinations
by default. Set `SOAR_PROXY_FAKE_IP=true` to admit them for approved public
sources, and pass `--proxy-fake-ip true` to the headless driver's cloud arm or
the Phase 2 critic. Certificates are still verified, and the proxy sees
hostnames, not content. The local model destination accepts any resolved
address, so give it an IP literal: a hostname behind such a proxy would send
model traffic into the proxy's tunnel.

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
| `pnpm setup:general` | Doctor for the general task runtime: Node, Docker, the qualified image, the model endpoint; `--write` records the image id and profile in the app's user-data settings |
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
