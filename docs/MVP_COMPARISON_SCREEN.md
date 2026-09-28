# Internal C/D/H comparison

This entry executes the same `PatchRunController`, `PatchRunStore`, Python
worker and sandbox used by the app. It is an internal experiment, not a second
solver or a public benchmark. All 36 episodes are linked to ordinary coding
runs in the selected SOAR database. Reopen the app against that database to
review their patches and visible checks. Keep the app closed while running the
CLI; cancel the CLI with Ctrl-C, which uses controller cancellation and cleanup.

The frozen screen contains 12 tasks from at least three public repositories.
Every baseline must fail and every reference must pass the independently frozen
acceptance suite before any model episode starts. Oracle files, reference
patches, receipts, manifests, databases and generated reports remain ignored
local artifacts. Only each task's public source, objective and visible command
reach the solver. The trusted evaluator helper runs oracle code inside a
separate container after the original run has reached a terminal state.

All arms use the same Sol cloud configuration, $3 episode cap, 600-second total
deadline and 40-step limit. C receives the task normally; D adds deterministic
preparation; H adds bounded local investigation to D. The six C/D/H permutations
occur exactly twice, shuffled with the frozen seed in whole task blocks. A
block reserves $9 before its first episode. This reservation is visible to the
shared request budget ledger, so other coding requests cannot spend it. The
36 assignments have a maximum $108 exposure, within the approved $180 screen
ceiling; previous known costs and unresolved exposure still count globally.

Use the supported Node runtime and its working SQLite binding. If the installed
binding belongs to Electron, use Electron's run-as-node mode with the installed
tsx loader rather than rebuilding a shared native dependency while the app is
running. No model key belongs in an argument or file: inherit the existing
session `SOAR_PATCH_API_KEY` from a trusted launcher. The CLI never prints it or
serializes raw runtime configuration.

Set the explicit approved configuration in that launcher:

```sh
SOAR_PATCH_MODE=live
SOAR_PATCH_PROVIDER=openai
SOAR_PATCH_MODEL=gpt-5.6-sol
SOAR_PATCH_INPUT_USD_PER_MILLION=4
SOAR_PATCH_OUTPUT_USD_PER_MILLION=20
SOAR_PATCH_EPISODE_USD=3
SOAR_PATCH_CAMPAIGN_USD=180
SOAR_PATCH_TIMEOUT_SECONDS=600
SOAR_PATCH_STEPS=40
SOAR_PATCH_CLOUD_ONLY=false
```

The existing user-owned local provider must also be configured. Its destination
is represented by a hash in comparison evidence. Runtime/code hashes, exact
model IDs, local/cloud limits, image digest, generation controls and prices are
frozen before dispatch and rechecked between episodes. No dated immutable Sol
snapshot is currently published. Local API token fees are zero; $3,500 purchase
cost is recorded separately from unmeasured utilization and electricity.

Commands use operator-supplied absolute paths below. Prefer an output directory
under the ignored `.soar` directory. `freeze` validates inputs without making
model calls. `run` resumes that exact screen; it never reruns an episode whose
dispatch was already claimed, including a crash just before start. Read-only
`report` works without provider credentials.

```sh
node --import tsx scripts/patch-comparison.ts freeze --manifest /absolute/manifest.json --database /absolute/soar.sqlite --output /absolute/ignored-screen
node --import tsx scripts/patch-comparison.ts run --manifest /absolute/manifest.json --database /absolute/soar.sqlite --output /absolute/ignored-screen
node --import tsx scripts/patch-comparison.ts report --screen frozen-screen-id --database /absolute/soar.sqlite --output /absolute/ignored-screen
```

The report retains incomplete blocks, task failures, infrastructure failures,
unknown costs, false accepts and owner decisions. Independent acceptance,
passing visible checks and owner-kept usefulness have separate counters. A zero
solve count produces unavailable cost per solve, never zero cost. JSON includes
task-level paired outcomes, phase token/cost totals, scout/cloud request time,
latency, capital-only utilization scenarios and local hourly break-even costs.
These small-screen results choose the next experiment; they do not establish
statistical parity or advertised savings.

## Completed original screen and later code

The 2026-09-08 screen is complete: see the [result](MVP_HYBRID_SCREEN_REPORT.md).
Its original acceptance outcomes remain unchanged; a separate join of 72 blinded
reviews and one documented adjudication records five review-discovered false
accepts. Owner decisions remain unset. Raw automated report counters must not
be presented as this later review judgment or as user usefulness.

Partial-handoff v2 and precise local-output diagnostics were applied only after
all original runtime digests, the final report and ledger were preserved.
Resuming the original screen with changed runtime hashes correctly rejects
configuration drift. The credential-free `report` command still reads the old
screen; it is not permission to dispatch a new one. Any new policy comparison
needs a distinct freeze and approved scoped exposure. Do not pool versions.
