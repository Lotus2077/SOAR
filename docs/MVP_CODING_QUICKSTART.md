# Coding MVP

Status: **Implemented; mechanics, recovery and real cloud execution verified.
Original 36-run comparison complete; hybrid benefit not demonstrated.
Native coding routes also pass Docker and built-app fixture checks. Their fresh
comparison stopped after 24 of 48 assignments on a local HTTP 500. Independent
review originally accepted six cloud, two local-only, three local-first and four
cloud-plan/local patches among six attempted tasks per policy. A later audit found
defects in two cloud controls, correcting that six-of-six assessment. Preserved
quality remains unproven. A mandatory cloud-review policy has runtime and app mechanics
verified, but its exposed development batch failed the savings gate and was stopped.
Independent blind review accepts one of its three completed runs; two have material
regressions despite passing tests. Its six assignments also include one cancelled
and two unrun tasks. The later compact-critique/local-repair policy finishes with
four accepted out of six assigned and also fails advancement. Router-derived tool
filtering now passes focused runtime tests; it has no new live quality proof.
Unknown requests are retained. Not Released.**
See the [screen report](MVP_HYBRID_SCREEN_REPORT.md) and
[preserved pilot failures](MVP_CODING_PILOT_REPORT.md), plus the
[latest repair result and cloud-control correction](MVP_ROUTING_REPAIR_REPORT.md).

This pilot adds **Fix a repository** to the Electron app. Select a small public
Python repository, describe a fix, review the resulting diff and visible checks,
then export the patch and record Keep or Reject. The selected checkout is never
modified. SOAR works from its committed HEAD; uncommitted files are excluded.

## Start it

Prerequisites: Node 22.22.2+, pnpm 10, Python 3.10+, and a running Docker or
OrbStack engine. The initial container includes Python's standard library, Git
and Bash. Dependencies must already be in a separately prepared image: task
containers have no network access and cannot install packages from the internet.

```sh
pnpm install --frozen-lockfile
pnpm setup:patch-pilot
pnpm demo:patch
```

Choose **Fix a repository**, choose the supplied calculator repository, enter
“Fix addition so it adds numbers,” acknowledge the public synthetic source,
and start. This mode uses predetermined actions and actual container checks.
It is clearly labeled **Scripted test — mechanics only**. It proves neither
model quality nor savings.

For a real run, launch with a session provider key. A shell's hidden prompt
avoids putting the key into command history. For example, in zsh:

```sh
read -s 'SOAR_PATCH_API_KEY?OpenRouter session API key: '
export SOAR_PATCH_API_KEY
pnpm dev:patch
unset SOAR_PATCH_API_KEY
```

If a prepared Terminal session already holds `SOAR_PATCH_API_KEY`, launch from
that same shell; a separate shell or an already-running app will not inherit
it. Check availability with `test -n "$SOAR_PATCH_API_KEY"` without printing
the value. An existing, explicitly authorized Keychain credential can supply
the trusted launch process in memory; it need not be entered or saved again.

OpenRouter is the default. For a direct OpenAI session, load the OpenAI key into
that same variable and run `SOAR_PATCH_PROVIDER=openai pnpm dev:patch`. This
selects the fixed OpenAI API destination and `gpt-4.1-mini-2025-04-14`, without
inheriting the older OpenRouter model or upstream routing. Its documented
standard token prices are $0.40 input/$1.60 output per million, checked on
2026-09-07 against the [official model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
The ledger uses conservative usage estimates when an invoice-level cost is not
returned. Only use a model's explicit documented price configuration when
changing `SOAR_PATCH_MODEL`; never point another provider's key at OpenRouter.

The first live pilot also used this explicit full-model configuration after the
mini model failed the development task. It reached a functional patch, but did
not establish reliable task completion; see the pilot report. With an OpenAI
key already loaded into the session, reproduce that configuration with:

```sh
SOAR_PATCH_PROVIDER=openai \
SOAR_PATCH_MODEL=gpt-4.1-2025-04-14 \
SOAR_PATCH_INPUT_USD_PER_MILLION=2 \
SOAR_PATCH_OUTPUT_USD_PER_MILLION=8 \
SOAR_PATCH_EPISODE_USD=1 pnpm dev:patch
```

These are standard prices from the
[official GPT-4.1 page](https://developers.openai.com/api/docs/models/gpt-4.1),
checked on 2026-09-07. Model defaults are compatibility presets, not a calibrated
quality or cost recommendation.

The recovery iteration adds an explicit current-model calibration profile:

```sh
SOAR_PATCH_PROVIDER=openai \
SOAR_PATCH_MODEL=gpt-5.6-sol \
SOAR_PATCH_INPUT_USD_PER_MILLION=4 \
SOAR_PATCH_OUTPUT_USD_PER_MILLION=20 \
SOAR_PATCH_EPISODE_USD=1 \
SOAR_PATCH_TIMEOUT_SECONDS=300 \
SOAR_PATCH_STEPS=30 pnpm dev:patch
```

This profile fixes medium reasoning, standard service, 8192 total output tokens
(including reasoning), and a 256000-byte input envelope. Explicit caching without
breakpoints disables cache reads/writes for this calibration; unexpected cache
activity is accounted and stops the run. Previous 2/8 price overrides reject.
The published Sol ID is undated and is not an immutable model snapshot.
See [model/prices](https://developers.openai.com/api/docs/models/gpt-5.6-sol) and
[cache semantics](https://developers.openai.com/api/docs/guides/prompt-caching).

The key is passed through the trusted worker's private stdin. It is not stored
in SQLite, sent to the renderer, inherited by the task container, or resolved
through the older locked Keychain flow. Do not put keys in a task description,
source snapshot, tracked config, screenshot or chat.

`pnpm dev:patch` starts the Cloud-only pilot independently of older local-model
settings. Local investigation and the retained local-review tools are
unavailable in that launch. Use `pnpm dev:patch:hybrid` after configuring the
local provider below to enable the local and cloud collaboration policies. Normal `pnpm dev` also
retains the existing local setup. These launch choices do not rewrite it.

With OpenRouter selected, the pilot uses `SOAR_PATCH_MODEL`, falling back to `SOAR_OPENROUTER_MODEL` and
then `deepseek/deepseek-v4-flash-0731`. For a different model, explicitly set
`SOAR_PATCH_INPUT_USD_PER_MILLION` and `SOAR_PATCH_OUTPUT_USD_PER_MILLION`.
The default model's conservative ceilings are $0.44 input/$1.32 output per
million, checked against the [OpenRouter model page](https://openrouter.ai/deepseek/deepseek-v4-flash-0731)
on 2026-09-07. These are admission ceilings, not a promised bill. Each exact
request carries the corresponding OpenRouter provider price caps, excludes
per-request fees and requires the requested parameters. The default model uses
only OpenRouter's `deepseek` provider; `SOAR_PATCH_PROVIDER_SLUG` can pin a
different provider for an explicitly selected model. Provider fallback is
disabled. These controls follow OpenRouter's
[provider selection contract](https://openrouter.ai/docs/guides/routing/provider-selection).
There are no transport retries or redirects. Freeze the same provider slug
across all arms before any comparative experiment.

A valid key and a listed model do not guarantee that the pinned upstream is
eligible under the account's provider/privacy settings. The app reports safe
HTTP and transport diagnostics. If a route returns HTTP 404, inspect its
eligibility before creating another run. Select a compatible, explicitly
pinned upstream with `SOAR_PATCH_PROVIDER_SLUG`; preserve the account's privacy
settings and the price ceilings. Failed attempts remain in the ledger.

## Available policies

| Policy | Behavior |
| --- | --- |
| Cloud | The cloud model reads, edits and checks the isolated repository. |
| Cloud with host preparation | The same cloud loop starts with a deterministic file inventory. |
| Local investigation + Cloud | The inventory plus at most eight read-only local actions precede a fresh cloud loop. |
| Local only | Native local tools edit and check; completion requires a fresh trusted check and explicit submission. No cloud calls. |
| Local first | Local editing and checks, with at most one irreversible cloud recovery phase that retains the local edits. |
| Cloud plan + Local | One cloud planning request, then native local work, with at most one later cloud recovery phase. |
| Cloud plan + Local + Cloud review | One cloud plan and native local work, followed by a required cloud review and optional repair before final submission. Experimental; quality and savings unproven. |

Hybrid requires the configured `SOAR_VLLM_BASE_URL`, `SOAR_VLLM_MODEL`, optional
`SOAR_VLLM_API_KEY`, and an explicit `SOAR_VLLM_COST_POLICY=local_zero_cost`.
HTTP also requires `SOAR_ALLOW_INSECURE_VLLM_HTTP=true`. “Local zero cost” means
the operator attests there is no inference fee. Hardware/electricity/time are
not zero and must be included in the later experiment's total cost.

Local evidence is bounded host-captured command output. It may contain untrusted
repository text; it is not a verified diagnosis. A safely failed local phase
can fall back once. Cancellation or unknown provider exposure stops the run.
The local model has separate defaults of 2,048 output tokens and 64,000 input
bytes, configurable with `SOAR_PATCH_LOCAL_MAX_OUTPUT_TOKENS` and
`SOAR_PATCH_LOCAL_MAX_INPUT_BYTES`. It can read numbered sections of a file;
up to three recent source/search excerpts form the bounded handoff. The app
shows that evidence, local elapsed time, fallback outcome and usage by phase.
After the original screen, partial-handoff v2 also permits existing source
excerpts when only the eight-call step limit prevented submission. The app
labels the investigation incomplete. Cancellation, unknown provider exposure
and an expired deadline still stop. Empty/truncated output has distinct labels
for new receipts; older generic failures retain an explicitly unknown cause.
No live benefit of this repaired policy has been measured.

The four native coding policies use a separate 8192-output-token,
256000-input-byte profile, configured through
`SOAR_PATCH_LOCAL_CODING_MAX_OUTPUT_TOKENS` and
`SOAR_PATCH_LOCAL_CODING_MAX_INPUT_BYTES`. The approved comparison uses at most
40 total model calls and 600 seconds per episode, with at most 24 local calls.
The last two local calls are reserved for a trusted check, submission or help.
Three identical observations with unchanged source, two failed trusted checks,
or explicit help trigger a checkpoint. Local-only stops; the other native
policies may hand off once if sufficient time and budget remain. Protocol errors,
timeouts and unknown accounting stop without automatically buying cloud recovery.
Checks run against the captured candidate in a fresh container, and a changed
source tree invalidates an earlier passing check. See the
[routing plan](plans/MVP_ROUTING_V1.md) for the exact experimental bounds.

The mandatory-review policy treats local submission as a provisional checkpoint,
even when its visible check passes. It reserves time and a model call for the one
cloud phase; cloud can inspect the complete workspace and repair the candidate.
Cloud commands mark the earlier local check stale, while final checks report the
final source separately. A cloud review action does not establish independent task
acceptance. See the [review experiment](plans/MVP_ROUTING_REVIEW_V2.md) for the
bounded development and fresh-confirmation requirements.

## Boundaries and accounting

- Source admission requires an explicitly acknowledged public committed Git
  snapshot, at most 2,000 files/32 MiB and 1 MiB per file. Symlinks, submodules,
  ignored dependency directories and known credential paths are rejected.
  This policy cannot prove that an arbitrarily chosen repository is public.
- Generated commands run only in credential-free containers with no network,
  host mounts, Docker socket, host PID namespace or elevated capabilities.
  The trusted worker and Docker engine remain trusted; this is a developer
  pilot, not a hostile multi-tenant service.
- The default episode ceiling is $5, with a persisted $70 smoke/calibration
  ceiling across runs in this app database. The explicitly approved comparison
  uses $3 per arm, reserves a complete $9 task block, and sets
  `SOAR_PATCH_CAMPAIGN_USD=180`; its 36 assignments reserve at most $108.
  See the [comparison entry](MVP_COMPARISON_SCREEN.md). Database deletion or a second independent database
  is outside this cooperative accounting boundary.
  The separately approved native-routing stage has a USD 150 aggregate ceiling,
  including six exposed calibration episodes and 48 fresh comparison assignments.
  It preserves the prior screen ledger; its budget is not reported savings or spend.
- Before every HTTP request, main verifies the exact body hash, destination,
  phase, model, price limits and output cap, then transactionally reserves
  exposure. A sent request without a usable receipt retains its full reserved
  amount across restart. Nothing automatically redispatches it.
- Reported provider cost is used when present. Otherwise accounted cost uses
  normalized usage at the configured price ceilings, with an explicit event;
  it is an estimate, not an invoice. Local infrastructure is separately measured.
- Main waits for the worker to exit and independently confirms container
  cleanup before completion. Cancellation shows **Stopping…** until cleanup.
- The immutable submitted patch is saved before visible checks, so cancelling
  or timing out during checking preserves it.
- In the original fixed policies, a generated-command timeout preserves bounded output, stops and verifies the
  whole container, and reconstructs source edits in a fresh pinned-image container.
  At most two such recoveries are allowed per run. The timed-out command is not
  automatically rerun; any next model request still needs normal admission.
  Native coding policies instead terminate on a generated-command timeout and
  attempt to preserve the unfinished patch, without automatic cloud escalation.
- Graceful cancellation, deadline and execution failure allow a twenty-second
  artifact-only recovery attempt. Main allows forty-five seconds for worker
  termination and then independently confirms cleanup. Recovered work is visibly
  unsubmitted and unchecked; it can be exported but cannot complete a run.
  A later actual submission replaces its recovery artifact. Immediate hard kills,
  Docker/host loss or invalid/oversized candidate files can prevent recovery;
  only already durable artifacts are guaranteed across restart.
- The hybrid view shows the captured local handoff and distinguishes missing
  evidence from successful investigation. Token fees exclude machine and energy
  costs; the comparison reports those separately.
- A fresh container reconstructs the patch against the original source; the
  agent's `.git` is discarded. Visible checks run after the patch is frozen.
  The submitted patch may change tests. A green check is useful feedback, not
  hidden-evaluator success or proof of correctness.
- No in-app Apply, learned router, automatic oracle retry, fleet scheduler,
  credential-manager activation or installer release is included.

## Reproduce the checks

```sh
pnpm check
SOAR_TEST_DOCKER_IMAGE=soar-patch-python:1 pnpm test:patch-worker
pnpm test:patch-runtime
pnpm test:e2e:patch
```

The last three commands use real local containers and/or a synthetic loopback
model. They make no paid model requests. Electron tests need GUI access.

The completed internal screen found five compatibility bugs missed by its frozen
checks. Review-acceptable counts were Cloud 11/12, prepared Cloud 10/12 and
Hybrid 10/12. Hybrid forwarded no local source and cost more than prepared Cloud.
Use the cloud workflow for initial owner trials and keep local investigation
experimental. The separate partial-handoff repair needs a new frozen comparison
before a quality or savings claim; do not rerun or relabel the original screen.
The new native-routing comparison has started after six exposed calibration
episodes; final acceptance and economics remain pending.
See the [screen report](MVP_HYBRID_SCREEN_REPORT.md) for costs and limitations.
