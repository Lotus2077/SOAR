# SOAR

SOAR is a macOS-first agentic task router. Its first product surface is an
Electron desktop app for long-running research and repository-to-patch
sessions. It keeps one canonical session record; the project is designed to
assign individual phases to a local vLLM model or a paid cloud model as the
routing runtime matures.

> [!IMPORTANT]
> SOAR is an experimental, pre-release project. The checked-in runtime is a
> local-only repository investigator plus a local-only **Review Current
> Changes** slice. An explicitly enabled fake development/test configuration
> also exposes an app-visible **Hybrid simulation** that uses two in-process
> fake providers. Normal vLLM mode remains Local-only and Hybrid-locked. PR6B0
> is Implemented with automated exact-SHA closure, not Verified or Released:
> the simulation reads no
> credential, contacts neither the configured vLLM nor an external provider,
> and has `$0` actual external spend. Cloud execution, write tools, and learned
> routing remain design targets. PR6B1-B is **Implemented with automated
> exact-SHA closure**, not Verified, Activated, or Released: it replaces secret
> entry with a status-only, activation-locked native credential boundary.
> Deterministic, committed-head, package, canary, Electron, independent-review,
> and Linux/macOS CI gates passed on
> `ddd171c6092f695e64360d73e78a257ee3fb9159`. Manual VoiceOver, light/dark
> contrast, and reduced-motion proof for PR6B0 is still pending.

The MVP optimizes a constrained trade-off rather than promising an impossible per-task optimum:

1. meet a defined quality floor on the target workload;
2. minimize paid-model cost subject to that floor;
3. minimize end-to-end latency subject to the same floor and a deadline.

## Current readiness

- App tracks: Repository Investigator and Review Current Changes.
- App target: Electron on macOS.
- Runtime provider: one configured OpenAI-compatible vLLM endpoint classified
  as local by operator attestation. For a non-loopback endpoint, the operator
  must explicitly set `SOAR_VLLM_COST_POLICY=local_zero_cost`; that value means
  the operator declares no per-token fee for this endpoint. SOAR does not
  independently verify the endpoint's external billing or infrastructure cost.
  The endpoint may run on this Mac or another machine, so “local” is not a
  loopback-placement or privacy guarantee.
- Locked cloud candidate: OpenRouter DeepSeek V4 Flash 0731 remains
  metadata-only product intent, separate from the runtime provider registry.
  The PR6B1-B implementation removes credential entry and mutation from renderer,
  preload, and IPC. **Cloud credential** shows only strict, non-secret native
  identity, legacy-item metadata, operation-recovery, provider-not-run, and
  dispatch-locked status. The locked package has no protected-item locator,
  secure-entry sheet, lease consumer, provider transport, or cloud authority.
- Routing runtime: Repository Investigator retains its deterministic v1 local
  assignment. Review Current Changes creates an app-owned v2
  `local_only_v1` session and keeps inspection and synthesis on the same
  configured provider in normal vLLM mode. With `SOAR_PROVIDER_MODE=fake` and
  `SOAR_ENABLE_HYBRID_SIMULATION=true`, the app can instead create a strictly
  branded `hybrid_simulation_v1` review. That path routes local inspection to
  Fake Local, evaluates the bounded egress policy, may run one tool-free Fake
  Cloud synthesis, and permits one eligible Fake Local fallback. It persists
  only simulation-scoped accounting and reports actual external spend as `$0`.
- PR6B0 status: **Implemented with automated exact-SHA closure; not Verified or
  Released.** Exact-head tests, all seven Electron workflows, macOS package
  validation, independent final review, and exact-SHA Linux/macOS CI passed on
  `9495d6bcbaa8cef5d3342e0d53ab02efe28d0002`. The manual accessibility record
  remains outstanding. This status proves no real Hybrid request, model
  quality, cost saving, or latency improvement.
- Future paid-campaign design: a proposed USD 100 ceiling and USD 90 automatic
  stop. These values are not active runtime configuration and authorize no paid
  call.
- Selected paid exposure for the production app remains USD 0
  under the operator's local-zero-cost attestation. The app constructs no
  separately configured metered or OpenRouter provider, and paid benchmark
  calls are not authorized. The implemented PR6B1-B status boundary has no
  cloud transport or paid-attempt path. PR6B0's `$0.25` figure is a simulated
  maximum reservation excluded from actual spend. This is not proof that an
  incorrectly classified
  configured endpoint cannot bill its operator.
- Local Evaluation Bridge v1: a specialized, fail-closed command can now run
  the canonical production local-only change-review coordinator on one frozen
  nonempty public SOAR change and export a lossy privacy-safe canonical-event
  proof. Exact local release-head and Electron gates passed on the implementation
  revision, its one authorized real-vLLM episode passed, and the exact
  post-proof revision passed Linux and macOS GitHub Actions. It is Verified but
  not Released.
- Held-out Evaluator Readiness v1: a separate `$0` offline command validates a
  policy-neutral 24-case runner contract against evaluator-private oracle,
  witness, signed judgment, and signed-resolution records, then publishes only
  a bounded aggregate and last-written completion marker. Its implementation
  and synthetic/adversarial proofs passed exact-SHA Linux and macOS CI. The
  harness is Verified but not Executed or Released. No real held-out corpus,
  human adjudication, provider campaign, or review-quality result exists.

## Planning and project history

- [Hybrid Lease Router v0 and Review Current Changes v1](docs/plans/HYBRID_LEASE_ROUTER_V0.md)
  is approved for its $0 PR 1 through PR 5 sequence. The PR 1 through PR 5
  implementation is present in this revision, including the local review app
  slice. Its deterministic gates, Electron workflows, and one-shot synthetic
  empty-snapshot structured-schema canary passed on 2026-08-30; the append-only
  build log records the exact scope and non-claims. The live canary demonstrates
  schema compatibility only, not a post-fix real-repository flow or full release
  validation. PR 6 is now split:
  [PR6A Cloud Setup and Dispatch Lock](docs/plans/PR6A_CLOUD_SETUP_DISPATCH_LOCK_V1.md)
  is Verified but not Released;
  [PR6B0 Hybrid Simulation](docs/plans/PR6B0_HYBRID_SIMULATION_V1.md) is
  Implemented with automated exact-SHA closure but not Verified or Released.
  [PR6B1 Signed Native Credential Lease](docs/plans/PR6B1_SIGNED_NATIVE_CREDENTIAL_LEASE_V1.md)
  is Implemented with automated exact-SHA closure for local `$0` phase B, not
  Verified, Activated, or Released. PR6B1-C signed proof, PR6B1-D real re-entry,
  PR6B2 provider validation, PR6B3's paid OpenRouter canary, and every paid call
  remain separately unapproved and approval-gated.
- [PR6R Development Real-Provider Slice](docs/plans/PR6R_DEVELOPMENT_REAL_PROVIDER_SLICE_V1.md)
  phase R-A is **Approved and in progress** for `$0`, loopback-only
  implementation around one exact public fixture while preserving the packaged
  production lock. R-A1 contracts, frozen fixture, append-only canary store,
  OS-user one-shot authority ledger, and compile-time development-canary build
  isolation are **Implemented** on exact revision `4cab8a7`, but not Verified or
  Released. R-A2 transport/accounting and R-A3 app flow remain not Implemented.
  This does not authorize real credential resolution, configured-provider
  contact, off-device repository egress, actual-cost reservation, or paid work.
  Real credential/provider validation and a later at-most-two-request USD 0.25
  canary remain separate unproposed R-B/R-C gates; the owner's broader paid-work
  intent is not operative authority for either unproposed phase.
- [Local Evaluation Bridge v1](docs/plans/LOCAL_EVALUATION_BRIDGE_V1.md)
  defines the independently approved `$0`, local-only, one-live-episode proof
  boundary. Another live attempt requires new explicit approval and a new
  committed plan authority ID. The plan does not authorize cloud routing, paid
  inference, or PR 6.
- [Held-out Corpus and Evaluator Readiness v1](docs/plans/HELD_OUT_CORPUS_EVALUATOR_READINESS_V1.md)
  defines the separately approved deterministic offline harness. It authorizes
  no provider call and cannot become a quality baseline until an independent
  curator, two blinded humans, an external coordinator, and a new campaign
  authority supply the missing private evidence.
- [Build and change log](docs/BUILD_LOG.md) is the append-only project evidence
  ledger for crucial decisions, implementation milestones, failures, proofs,
  costs, limitations, and next gates.

## Local Review Current Changes slice

The main process now has a bounded `inspect_git_changes` operation that can
capture staged, unstaged, renamed, deleted, and bounded untracked changes as a
content-addressed `ChangeSnapshotV1`. It records the base commit, index and full
Git-discovery digests (including index visibility flags), sorted file metadata,
admitted-content hashes, bounded text hunks, and explicit omission counts/codes.
It then rechecks discovery and working-file identity so observed drift fails
closed. Binary, symlink, submodule, policy-excluded, unavailable, oversized, or
truncated content cannot be silently treated as complete. A path changed in
both the index and worktree is normalized to one base-to-working record and is
always explicitly incomplete because v1 does not separately admit the index
content side.

This remains an application-owned operation rather than a general repository
tool. It is absent from the default model tool surface, but the local review
coordinator explicitly exposes only its schema for the required inspection
round and executes it through the host gateway. The app now has a dedicated
Review Current Changes entry point that creates a `change-review-v1`,
`agentic-execution-v2`, `local_only_v1` session with no egress consent and zero
selected metered-provider exposure. Its `$0` attempt records rely on the
operator's `local_zero_cost` attestation for the configured vLLM endpoint.

Change hunks, snapshots, and evidence sets have strict canonical SHA-256
identities. Coverage is re-derived by the host from verified evidence,
final-packet retention, and fresh snapshot revalidation; a supplied `complete`
flag is not trusted. The review coordinator re-derives every inspection,
full-read, and search observation from matching successful canonical
request/result and inference events before constructing the evidence set. The
final review packet must keep the complete admitted evidence body set; it is not
allowed to truncate that set and still call the review complete.

Git inspection uses fixed non-shell operations, bounded process output and
deadlines, no-follow file reads, no lazy fetch, no submodule recursion, and an
isolated environment that disables external diff/textconv, hooks, prompts,
pagers, and caller transport configuration. The discovery bundle runs against
one securely copied temporary index, preserving the canonical index's bytes,
inode, and timestamps; split indexes and hidden assume-unchanged/skip-worktree
entries fail closed. A partial clone with missing objects fails instead of
fetching. Repository clean/process filters and protocol overrides are rejected
before sensitive status/diff calls. Git offers no lock covering that check and
the next process, so a concurrently hostile writer of repository config remains
an explicit TOCTOU trust limitation.

The accompanying frozen `change-review-eval-v1` calibration contains 12 real
public changes: 3 SOAR, 6 Flask, and 3 pytest. The mechanical policy produces 5
low-risk and 7 high-risk records and deliberately retains one disagreement
with the independent review-attention labels. Default tests verify the frozen
files offline; its changed-line feature is the exact additions/deletions
projection from admitted host hunks, not an independent Git-numstat count. An
opt-in `$0` test can rematerialize all 12 from explicit local clones. The labels
are not defect gold, and no held-out fixture identities or gold are checked in.
This work therefore does not prove review quality, dynamic routing, cost
savings, or latency gains.

After evidence collection, the same selected provider receives one tool-free
structured synthesis request using the exact `ReviewResultV1` JSON Schema. The
host accepts only complete, non-truncated output whose snapshot/evidence
identities, finding references, coverage, conclusion, attempt, checkpoint, and
canonical event provenance all verify. The workspace is inspected again before
acceptance and again before display or copy. Drift or unavailable reinspection
withholds findings; incomplete host coverage or a model-declared omission is
shown explicitly as unverifiable and cannot be copied.

The accepted structured result may include bounded evidence references for its
findings. Its separate aggregate coverage view—counts, status, test signal, and
omission codes—does not include changed paths or snapshot/evidence-set IDs.
Review session events use an allow-listed redacted projection that excludes raw
provider output and raw review event payloads, and streaming text deltas are
replaced by snapshots. See
[ADR 0003](docs/adr/0003-immutable-change-acquisition-v1.md) and the
[calibration protocol](benchmarks/change-review/README.md). These contracts and
deterministic tests alone do not prove review quality, latency advantage,
dynamic routing, or release readiness. The separate schema canary described
below proves only exact-schema compatibility for its synthetic fixture. The
Local Evaluation Bridge has a narrow proof command for one pinned nonempty
public change; it still does not measure defect recall, precision, or general
repository-review quality.

## Fake-only hybrid mechanics

PR6B0 adds a separate app-visible path only when main-process configuration
selects fake provider mode and explicitly enables Hybrid simulation. Local is
still the default. Selecting simulation issues a bounded, single-use,
workspace-bound disclosure challenge; the user must acknowledge it before the
session can start. The renderer cannot choose providers, model IDs, pricing,
the `$0.25` simulated cap, or real egress consent.

The strict coordinator acquires and validates repository evidence locally,
runs the pure checkpoint router at session start, evidence completion, and one
eligible fake-cloud failure, and keeps routine work on its current lease. It
binds an immediate semantic egress-admission record to the exact fake-cloud
messages and provenance. Denial causes zero Fake Cloud attempts and zero
simulated reservation. An admitted attempt uses a no-tools, structured-result
Fake Cloud implementation with no network client. One eligible denial or
failure may continue through Fake Local; cancellation creates no fallback.

Simulation campaigns, reservations, attempts, settlements, and recovery rows
carry the immutable `simulation` cost scope. Legacy rows remain
`legacy_unclassified`; actual-spend views select only `actual`. The UI and copy
repeat the exact fake-only marker, provider labels, simulated cap/reserved/
settled amounts with settlement provenance, and `$0` actual external spend.
Restart replays persisted events without dispatching again.

Normal vLLM mode still constructs one configured, operator-attested Local
provider and exposes no Hybrid simulation authority. The PR6B1-B implementation
exposes status only and cannot enter, mutate, retrieve, validate, or dispatch a
credential. Its exact-SHA closure passed on
`ddd171c6092f695e64360d73e78a257ee3fb9159`, but manual VoiceOver remains
unrecorded and it is not Verified, Activated, or Released. Separately, PR6B0
neither reads any Keychain item nor constructs an OpenRouter transport. Its
automated exact-head, Electron, package, independent-review, and Linux/macOS CI
gates passed on `9495d6bcbaa8cef5d3342e0d53ab02efe28d0002`, but its manual
VoiceOver, keyboard-only, contrast, zoom/reflow, and reduced-motion record
remains pending. PR6B0 is therefore not yet Verified or Released.
There is no claim that fake results measure quality, cost
savings, or latency improvement. See
[the PR6B0 plan](docs/plans/PR6B0_HYBRID_SIMULATION_V1.md) and
[ADR 0004](docs/adr/0004-checkpoint-router-budget-runner-v0.md).

## Desktop slice and fake-only simulation

The first working slice is an Electron application with:

- a React task workspace with sessions, transcript, and run details;
- a narrow, typed preload bridge with renderer sandboxing;
- status-only **Cloud credential** settings with exact top-level renderer
  authority, no secret or mutation IPC, an activation-locked native macOS
  broker, conservative SQLite operation recovery, provider-not-run copy, and a
  dispatch-locked real Hybrid control;
- a fake-only Review Current Changes route picker, challenge-bound disclosure,
  simulated accounting, route/fallback trace, cancellation copy, and persistent
  replay attribution when the main process explicitly enables simulation;
- an append-only SQLite session log and restart recovery;
- streaming inference through the configured OpenAI-compatible vLLM endpoint;
- a central read-only repository tool registry with bounded `list_files`,
  `search_text`, and `read_text_file` operations constrained to the selected
  workspace;
- a dedicated Review Current Changes action whose host-owned v2 coordinator
  requires one model-proposed `inspect_git_changes` call, schedules bounded full
  reads for admitted modified files, and requests one same-provider,
  tool-disabled, exact-schema synthesis after preserving the complete evidence
  set;
- cancellation, timeout, reasoning-token, usage, and latency recording with a
  deterministic `$0` route/tool trace; local requests explicitly disable
  hidden reasoning so tool calls and visible answers receive the output budget;
- deterministic, provider-neutral context packets with an 18,432-token default
  ceiling, a conservative UTF-8-byte estimate, a 20% safety margin, reserved
  provider overhead, latest-observation exact deduplication, bounded excerpts,
  citation-support snippets, finalization-only empty labels, valid `{}` read
  arguments, and removal of separately encoded search paths after strict
  validation, plus one persisted compilation
  checkpoint per provider call;
- persisted completion obligations that order required repository tools, expose
  only the next required tool to the provider and require its invocation at the
  transport layer, enforce a minimum number of verified `path:line` citations,
  and record acceptance or retry checks;
- a versioned persisted execution policy that fixes inference/tool-call limits
  before the run and binds each provider round to its route and single
  pre-inference context checkpoint during replay;
- fail-closed completion handling for truncated, filtered, empty, malformed, or
  tool-looping provider responses, including evidence-backed citation
  validation and a tool-free final synthesis after two duplicate observations;
- a pure cloud-egress guard over canonical messages and host-derived provenance.
  It returns bounded codes and hashes only and performs no I/O. Normal vLLM
  operation retains the PR6A shadow boundary; PR6B0 binds the same policy to a
  fake in-process invocation only.

Normal vLLM runtime constructs no separately configured OpenRouter provider and
exposes no Hybrid session creation. The Review UI reports the local credential
state separately from provider validation and keeps real Hybrid locked. The
separate fake-only configuration can expose Hybrid simulation, but its authority
cannot be widened by renderer input or stored setup state.
The configured vLLM adapter is still a
generic OpenAI-compatible network path: its `local_zero_cost` classification is
operator-attested and does not independently prove that the endpoint cannot
bill. Production cloud routing remains later PR6B1-C/PR6B1-D through PR6B3 work
with separate approval gates. The phase-B implementation is structurally
activation-locked and cannot route to Cloud. New desktop tasks
select either the versioned `repository-investigator-v1` or `change-review-v1`
track. The main process owns each track's policy and obligations; the renderer
cannot supply arbitrary completion rules. Legacy sessions remain readable
without a track field.

## Quick start

Prerequisites:

- macOS for the desktop application and Electron end-to-end test;
- Node.js 22.22.2 or later in the Node 22 line and pnpm 10.12.4; Node 24 and
  Node 26 are not currently part of the supported contributor contract;
- an OpenAI-compatible vLLM endpoint for real inference.

```sh
git clone https://github.com/Lotus2077/SOAR.git
cd SOAR
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Set `SOAR_VLLM_BASE_URL` and `SOAR_VLLM_MODEL` in `.env.local`. The base URL
must end in `/v1`; it may identify a vLLM server on another machine. Review
evidence is sent to that configured endpoint, so do not interpret “local only”
as “never leaves this Mac.” Tests use deterministic providers and do not
require a live model unless their command is explicitly prefixed with
`test:live-`. Context limits can be tuned with `SOAR_CONTEXT_MAX_INPUT_TOKENS` and
`SOAR_CONTEXT_SAFETY_MARGIN`; mandatory task intent fails closed if it cannot
fit the configured envelope.

For every non-loopback endpoint, explicitly set
`SOAR_VLLM_COST_POLICY=local_zero_cost` only after confirming that the endpoint
charges no token fee. SOAR treats that value as the operator's attestation; it
does not identify the service behind an arbitrary URL, inspect an external
billing account, or measure electricity, hosting, networking, or other
infrastructure cost. The proposed, unapproved non-runtime readiness snapshot in
`config/providers.readiness.example.json` points to the same local accounting
field. Its cloud and campaign fields document planning assumptions only and are
intentionally absent from `.env.example`; the shipping app builds its validated
single-provider runtime registry in the Electron main process.

For the `$0`, no-network development/test simulation, start the app with both
`SOAR_PROVIDER_MODE=fake` and `SOAR_ENABLE_HYBRID_SIMULATION=true`. This replaces
the normal configured-vLLM runtime with the two branded in-process fakes; it
does not read Cloud Settings, contact either configured endpoint, or authorize
real Hybrid. Local remains selected until the user chooses Hybrid simulation
and acknowledges the workspace-bound disclosure.

### Local Evaluation Bridge v1

The specialized `pnpm benchmark:local-review` command is the only checked-in
benchmark command that runs the canonical local-only review agent. The generic
research/coding benchmark command still evaluates caller-supplied submissions;
it is not an agent runner. Before the authorized live bridge command, the exact
clean implementation commit must pass the deterministic release-head and
Electron gates. `--source-repository .` is valid for a clean full clone that
already contains the fixed fixture objects. See the
[benchmark operator contract](benchmarks/README.md#local-evaluation-bridge-v1)
for the exact limits, opt-ins, and exit codes.

The bridge's live authority is a cooperative OS-user-local guard fixed to its
committed plan ID, not a hardened same-account security boundary. Run IDs remain
non-reusable only while the ignored `.run-ledger` is preserved; a blocked run
after namespace reservation consumes its run ID, and a crash after live-authority
claim may conservatively consume that authority. Output is complete only when
the last-written `publication.complete-v1.json` marker exists. Hashes are
tamper-evident, not immutable. Emergency records retain execution and safe trace
data only where independently scannable. Review prose and relative evidence
references remain untrusted and must be inspected before sharing.

“Local only” constrains provider selection, not network placement. The frozen
fixture evidence is sent to the configured vLLM endpoint and can leave this Mac
when that endpoint is remote.

### UI design reference

The desktop shell adapts general layout, typography, color, and interaction patterns from the MIT-licensed [Hermes Agent](https://github.com/NousResearch/hermes-agent) desktop app. SOAR keeps its own product identity, copy, data model, and runtime. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and the pinned source revision.

### Development

For a non-loopback plaintext endpoint, set `SOAR_ALLOW_INSECURE_VLLM_HTTP=true`
in `.env.local`. Never commit that file or a live credential.

Run the complete local check suite:

```sh
pnpm check
```

The real-vLLM canary is opt-in and uses only the configured vLLM adapter; it
does not construct the separate OpenRouter provider:

```sh
pnpm test:live-vllm
```

The separate structured Review Current Changes schema canary is also opt-in and
uses the same configured vLLM endpoint without constructing a separate metered
provider:

```sh
pnpm test:live-review-schema
```

The structured review canary passed once against the configured `RM-01 VLM` on
2026-08-30. Review Current Changes health admission, including this opt-in
canary, invokes a configured-model availability check. For that check, the
selected unique `/v1/models` entry must supply a positive safe-integer
`max_model_len` at least as large as the configured maximum input plus maximum
output allowances; missing, invalid, or insufficient capacity rejects the
review admission. The current defaults require at least 26,624 tokens (18,432
input + 8,192 output). The one-time `$0` availability response that day
advertised 262,144. That is endpoint-supplied metadata for that response, not
proof of universal provider support or empirically verified capacity. The
capacity check is not implicit in every OpenAI-compatible completion call. The
canary demonstrates exact-schema compatibility on a synthetic empty snapshot
only, not a post-fix real-repository review flow. The broader live
Repository Investigator proofs and final release suite are separate gates and
are not claimed current here. Both live commands trust the operator's
`local_zero_cost` attestation; neither command independently proves that the
configured endpoint cannot produce an external bill.

Run the three-task guided Repository Investigator evidence contract against the
configured vLLM:

```sh
SOAR_PROOF_REVISION="$(git rev-parse HEAD)" \
SOAR_PROOF_MODEL="RM-01 VLM" \
pnpm test:live-repository
```

The proof requires a clean Git worktree and the exact declared HEAD. It copies
that revision into a temporary `git archive` workspace, excludes the evaluator
source from the agent-visible fixture, and records the archive SHA-256. It pins
`RM-01 VLM`, an 18,432-token context cap with a 0.2 safety margin, per-task
provider/tool-call limits, and episode limits of 34 provider calls and 29 tool
calls, with a derived maximum of 626,688 reported input tokens. Every provider
call must report positive input usage within the cap,
`servedModel: "RM-01 VLM"`, zero cost, and
`costProvenance: "local_zero_cost_policy"`. That provenance records the
operator-attested policy; it is not independent evidence about external
billing.

The task objectives deliberately disclose evaluator-owned paths, source
substrings, required relationships, and exact tool schedules. This is a guided
execution, evidence-verification, and accepted-answer context-retention proof;
it is not blind repository discovery or a repository-quality benchmark. The
persisted model result remains separately model-attributed. Deterministic
`evaluatorRecords` are an additive host-generated audit and are never presented
as model-authored. Before the tasks, the harness calls the configured
`/v1/models`, requires exactly one advertisement for `RM-01 VLM`, and applies
the same fail-closed capacity check against the proof's 18,432-token input and
8,192-token output allowances. It records only a hash of the normalized API
base plus bounded model metadata and a response hash. The raw endpoint, API key,
model root, and raw response are not serialized.

The evaluator derives the independent expected symbol matching-line set with
its own bounded UTF-8 filesystem scan rather than SOAR's production
`search_text`, and records the oracle method, scope, count, and hash. All three
tasks use authoritative claim manifests that supply claim IDs, summaries, and
required source evidence. After a successful run, the harness binds each claim
to distinct citations found both in successful parsed tool observations and in
the accepted completion check's verified citations.
Architecture must perform exactly one bounded non-recursive root `list_files`,
one exact `read_text_file` of `src/main/index.ts`, and seven ordered,
case-sensitive, file-scoped `search_text` calls—one for each disclosed claim
evidence row—before synthesis. The evaluator rejects a missing, extra,
reordered, broad, or argument-mismatched architecture call.
Cancellation requires its nine manifest evidence rows as nine ordered,
case-sensitive, file-scoped `search_text` calls before synthesis; the evaluator
rejects a missing, extra, reordered, broad, or mismatched search.
The symbol task adds a structural call-path manifest and requires successful
complete `read_text_file` observations of all five call-path evidence files in
the disclosed order, each with exactly its single `relativePath` argument. Five
exact file-scoped supporting searches must then refresh every
non-`cancelSession` evidence snippet in evaluator-owned order before synthesis.
The persisted trace must contain exactly the disclosed raw argument keys and
values for the global symbol search and all five support searches. Context
Packet v1 may omit explicit default-valued fields from its normalized argument
excerpt because the registered tool defaults recover them. The host derives the
symbol occurrence record from the successful, complete global-search result and
only then cross-checks that record against the independent oracle; oracle data
alone can never manufacture a passing record. The model result is still checked
for normal completion and citation integrity, but this proof does not grade its
general semantic quality.

For each accepted answer, the harness binds the captured provider input to the
unique accepted completion-check round and its persisted packet/message hashes.
Every completion-guard-verified answer citation and every evaluator-required
claim snippet must remain in completed tool evidence in that exact packet; the
symbol packet must also retain every independent-oracle occurrence. In the v7
proof, the fully admitted global-symbol-search envelope keeps its own compact
citation membership even when a read also keeps fuller support for an
overlapping line. The audit identifies that one global-search
envelope by its exact scope and arguments, sorts its citations and the oracle
independently, and compares the exact sets—not the union of all tool citations.
That accepted-packet retention audit publishes only bounded counts and hashes,
never the packet or source content it checked.
The deterministic retention gate repeats the exact symbol schedule after
inserting 250 UTF-8 bytes of inert objective padding before the finalization
instruction; both runs must retain the complete evidence sets.

An accepted schema-v5 artifact is written only after every gate passes, at
`benchmarks/runs/local-repository-investigator-v1.schema5.<HEAD>.accepted.json`.
Artifact schema v5 is unchanged. The artifact identifies the strengthened
architecture schedule, exact-argument, and tool-derived evaluator-record checks
as task-validator contract v7.
A failed run instead writes the distinct
`local-repository-investigator-v1.schema5.<HEAD>.failed.json` diagnostic with
`passed: false`. Before serialization, repository and temporary fixture roots
are replaced with stable labels so an attachable report does not expose
machine-local absolute paths. The artifact still contains objectives, model
results, and event/tool trace content derived from the workspace, so inspect it
before sharing. Before a run, same-revision reports and the
ambiguous legacy `local-repository-investigator-v1.json` names are moved into the ignored
`benchmarks/runs/quarantine/` directory, so a stale artifact cannot stand in for
the current result. Once a full revision is declared, model, repository,
configuration, fixture, database, or provider setup failures also publish a
self-identifying preflight diagnostic instead of leaving a stale accepted file.

The older 934,311-input-token, 49-provider-call, 46-tool-call report is retained
only as a non-comparable historical reference: it identifies a dirty working
tree, has no fixture hash, and used a different task validator. The earlier 60%
reduction target therefore is not claimed by this proof. See
[ADR 0001](docs/adr/0001-context-handoff-engine-v1.md) for the current
acceptance contract. Treat a revision as accepted only when its clean live run
produces the matching revision-addressed artifact above.

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
metadata cannot invalidate the application bundle before it is archived. The
package verifier also checks the single locked native addon, its sealed
bundle-relative placement, activation-marker absence, and the contributor
package's reviewed ad-hoc entitlement contract. Run
`pnpm test:e2e:packaged-credential-status` only after building that exact
archive; it launches the packaged app in Local mode behind a loopback network
trap and proves status/dispatch lock behavior, not signed continuity or a real
credential.

Start with [MVP readiness](docs/MVP_READINESS.md), [routing policy](docs/ROUTING_POLICY.md), and the [benchmark protocol](benchmarks/README.md).

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and
[the architecture guide](docs/ARCHITECTURE.md). Automated contributors must
also follow [AGENTS.md](AGENTS.md). Bug reports and focused pull requests are
welcome. Please keep provider calls opt-in, preserve the append-only event
contract, append material project decisions to the build log, and include tests
for behavior changes.

Security issues should follow [SECURITY.md](SECURITY.md). The project is MIT
licensed; additional UI and asset reuse notices are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
