# PR6A Cloud Setup and Dispatch Lock v1

Status: **Verified locally and on exact-SHA Linux/macOS CI; not Released;
provider contact and Hybrid execution remain prohibited**

- Plan ID: `pr6a-cloud-setup-dispatch-lock-v1-plan-1`
- Parent plan: `hybrid-lease-router-v0-plan-2`
- Baseline revision: `e73f5d3012e0e478eb158fea740f9dd60b82ae08`
- Approved: 2026-08-31 by the project owner in the project task
- Approval ledger: `BL-20260830-1629-pr6a-cloud-setup-approved`
- Implementation ledger: `BL-20260830-1726-pr6a-cloud-setup-implemented`
- Verification ledger: `BL-20260831-1419-pr6a-cloud-setup-verified`
- Project log: [BUILD_LOG.md](../BUILD_LOG.md)

## Decision

PR6 is split into two separately authorized milestones:

1. **PR6A — Cloud Setup and Dispatch Lock** builds and tests the local credential,
   Settings, readiness, egress-policy, and dispatch-interlock foundation without
   contacting any provider.
2. **PR6B — Provider Validation and One Paid Canary** remains unapproved. It will
   require a new committed plan and explicit approval before any credential
   validation, model or pricing request, repository egress, paid reservation, or
   cloud inference.

This plan authorizes PR6A only. It refines the delivery decomposition of the
parent plan; it does not retroactively authorize the original paid PR6 scope.

The product wedge remains **Review Current Changes**. PR6A does not broaden SOAR
into an autonomous coding or research agent, and it does not claim that SOAR is
already a production two-provider router.

## Why this milestone exists

The project has verified a local-only Electron review path and deterministic
hybrid mechanics with two fake providers. Production still has:

- one dispatch-capable local or fake provider in the runtime catalog;
- a fake-only hybrid coordinator;
- no production credential-store adapter;
- no cloud Settings lifecycle;
- no canonical provider-message cloud-egress policy implementation; and
- a disabled Hybrid route that truthfully reports that cloud setup is absent.

The next highest-risk product work is the boundary between local state and a
future metered provider. Building that boundary locally first is useful only if
it cannot accidentally become cloud execution. Therefore PR6A deliberately
separates **candidate metadata**, **stored but unvalidated credential state**,
and **dispatch authority**.

## User promise

After PR6A, a macOS user can open Settings and add, replace, or remove the
dedicated OpenRouter credential. SOAR reports only whether a credential is
stored locally. It explicitly states that the credential, model, price, limits,
and provider reachability have not been remotely validated and that Hybrid is
locked in this build.

Local-only review remains usable without cloud onboarding. The user is never
forced through a cloud-setup modal, and storing a credential never grants
per-session egress consent or starts a provider request.

## Approval boundary

The project owner's contextual instruction to proceed authorizes the following
local implementation and deterministic proof:

- direct macOS Keychain credential add, replace, status, and delete behavior;
- narrow typed main/preload/renderer Settings contracts;
- metadata-only cloud-candidate and local readiness projections;
- pure canonical provider-message egress admission and semantic message hashing;
- explicit production dispatch interlocks;
- synthetic credentials and local fixtures in deterministic and macOS tests;
- current-truth documentation and append-only build-log entries; and
- local build, Electron, packaging, and GitHub Actions validation that performs
  no provider request.

This approval authorizes local Keychain state changes only for isolated,
synthetic test identities with cleanup. It does not authorize reading,
migrating, validating, displaying, or exercising the user's existing real
credential during implementation proof.

PR6A may not:

- contact OpenRouter, the configured vLLM, or any other provider;
- call a model-list, key-metadata, pricing, health, limit, or account endpoint;
- make an inference, evaluator, retry, fallback, or canary request;
- send repository evidence or any other task content off the machine;
- register an enabled or dispatchable production cloud provider;
- create or start a production `hybrid_v0` session;
- create a paid campaign, reservation, settlement, release, or overrun record;
- claim credential validity, provider reachability, model availability,
  structured-output compatibility, context limits, current price, budget-limit
  truth, cloud readiness, provider switching, routing benefit, quality, cost
  saving, or latency improvement; or
- modify the held-out evaluator except for a regression directly caused by this
  milestone.

Provider, model-list, inference, and selected metered-provider exposure must all
remain zero.

## Architecture decisions

### 1. Candidate metadata is not a runtime provider

PR6A introduces a strict metadata-only cloud candidate for the intended
OpenRouter provider and model. It is not a `ProviderDescriptor`, does not
implement `InferenceProvider`, is not registered in `ProviderRegistry`, and
cannot be required by `SessionRunner`.

The candidate records only stable product intent:

- provider label and stable candidate ID;
- adapter family;
- intended model slug;
- setup state; and
- explicit unverified and dispatch-locked status.

It contains no asserted price, context window, output limit, capability,
health, reachability, account balance, or provider-side hard-limit fact. The
dated planning snapshot is not promoted into runtime evidence.

The dispatch-capable runtime catalog remains local-only. A contributor cannot
turn the candidate into a provider by changing a boolean; PR6B must supply a
separate validated construction path and new authority.

### 2. Direct macOS Keychain storage

The production credential store uses a generic-password item in the user's
default macOS Keychain with fixed, non-secret service and account identifiers.
It invokes `/usr/bin/security` directly through argument-array process
execution, never through a shell.

For add or replacement, `-w` is the final option and the credential is supplied
through the child process's standard input. The credential must never appear in
process arguments, environment variables, command strings, output, logs, or
errors. Commands have bounded time, output, and termination behavior.

The adapter exposes a new setup-only main-process contract. It deliberately
does not implement the existing `CredentialStore`, because that interface's
`read` method would create a raw-secret resolver before dispatch is authorized.
PR6A application code can use only:

- metadata-only presence/status;
- add or atomic replacement; and
- delete.

No raw-secret read method or dispatch-time resolver exists in the PR6A
production dependency graph. A future PR6B adapter may add one only after
separately authorized validation and dispatch gates are implemented.

Required invariants:

- credential references are fixed opaque identifiers, not renderer input;
- raw credentials never enter SQLite, session events, logs, configuration,
  application errors, snapshots, artifacts, screenshots, or renderer storage;
- add/replace becomes visible only after the Keychain command succeeds;
- replacement succeeds or fails as one Keychain item operation; because PR6A
  creates no validation snapshots, it persists no separate generation ID whose
  crash consistency could diverge from the Keychain item;
- deletion removes staged readiness; a failed deletion remains visible as a
  stable local-storage error and keeps Hybrid locked;
- app restart derives status without returning the secret;
- Keychain locked, denied, unavailable, timed-out, malformed-output, and
  non-macOS cases fail closed with stable secret-free codes; and
- synthetic integration items use unique test-only service/account identities
  and are deleted in bounded cleanup.

Implementation clarification: `/usr/bin/security` stdout and stderr are not a
parsed data protocol. The adapter discards bounded diagnostic bytes and uses
only exit status. The approved `malformed-output` requirement is implemented as
fail-closed stream errors and output-limit violations; it is not a claim that
arbitrary bounded diagnostic text has a semantic schema. An attempted `-T ""`
ACL tightening did not terminate without interactive authorization and was
reverted. PR6A remains setup-only with no read capability; native Security-
framework app identity, ACL design, and staged-item migration or recreation are
required before PR6B may resolve a credential.

### 3. Settings is optional and metadata-only

Cloud setup is an optional Settings surface reachable from the existing app
shell and from a `Set up cloud` action beside the disabled Hybrid row.

The renderer receives only:

- candidate provider and model labels;
- `not_configured`, `stored_unvalidated`, or `local_storage_error`;
- `dispatch: locked` with a stable explanation.

It never receives a credential, suffix, fingerprint derived from the secret,
Keychain reference, raw endpoint, provider response, or raw subprocess error.

The password field is uncontrolled. The renderer reads it only on submit,
clears the DOM value synchronously before awaiting IPC, never places it in React
state or browser storage, and receives no echo in success or failure results.

PR6A copy must distinguish:

- **Stored locally** — a Keychain item exists;
- **Not validated** — no provider contact has occurred; and
- **Hybrid locked** — this build cannot create a cloud session or dispatch.

There is no `Save and validate` action in PR6A. Add/replace is labeled `Save`
or `Replace`; remote validation belongs to PR6B.

### 4. Pure canonical-message egress shadow check

PR6A adds a pure, versioned admission function over a canonical provider-message
array plus a host-derived provenance manifest. The manifest binds admitted
message segments to relative evidence paths and admitted artifact classes. The
function performs no I/O and returns only:

- policy version;
- pass or deny;
- sorted bounded finding codes; and
- the canonical semantic provider-message hash and provenance-manifest hash.

It denies rather than redacts when candidate bytes contain:

- the canonical workspace root or user-home absolute path, including relevant
  escaped and normalized forms;
- an explicitly supplied known credential value;
- a bounded recognized private-key or API-token form;
- content attributed to a denied secret/config path; or
- an artifact body not admitted by the task policy.

Bounded workspace-relative source/change evidence may pass under an explicit
synthetic consent input. Cloud synthesis always has no tools and no tool
definitions.

Rejected content, matched substrings, credential values, workspace roots, and
message bodies are never returned or persisted. PR6A tests the pure result and
hashes only; it does not attach the result to a live session or send it
anywhere.

The PR6A message hash is a canonical semantic identity, not a claim about the
OpenAI SDK's eventual HTTP wire bytes. PR6B must compile with freshly verified
provider limits, run admission immediately before dispatch over the actual
candidate messages and provenance, assert the unchanged semantic hash, and
send without another semantic compilation.

This scanner is a bounded policy guard, not general data-loss prevention and
not proof that arbitrary repository text is non-sensitive.

### 5. Dispatch remains structurally impossible

PR6A must leave all of these interlocks true:

1. Production constructs no cloud `InferenceProvider`.
2. `ProviderRegistry` contains only the selected local or deterministic fake
   provider.
3. Electron bootstrap passes no real hybrid runtime to `SessionRunner`.
4. The v2 hybrid coordinator retains its nominal two-fake-provider gate.
5. Review creation accepts no renderer-supplied provider, model, policy, cap,
   or egress-consent identifier.
6. `startLocalChangeReviewSession` still persists `local_only_v1` with consent
   `none`.
7. `ReviewAvailability.hybrid.enabled` remains false.
8. The Hybrid radio remains disabled and no production IPC method can create a
   Hybrid session.
9. No production code can acquire fresh cloud health, price, limit, or
   credential-validation evidence.
10. No real cloud campaign or reservation is created.

Tests must assert these properties directly and install throwing network seams
where applicable. The milestone does not rely on convention or on the absence
of a button click.

## Contracts and implementation surface

Expected new modules:

- `src/shared/cloud-setup-contracts.ts` — strict candidate, setup-state, and
  metadata-only renderer contracts;
- `src/main/providers/cloud-provider-candidate.ts` — locked, unverified
  candidate metadata only;
- `src/main/providers/macos-keychain-credential-store.ts` — direct Keychain
  adapter with injectable process seam;
- `src/main/cloud-credential-service.ts` — metadata-only setup lifecycle with
  no raw-secret resolver;
- `src/main/cloud-egress-policy.ts` — pure canonical-message and provenance
  admission; and
- a focused cloud-settings IPC registration module if keeping these handlers
  separate makes workspace IPC easier to audit.

Expected existing modules to change:

- runtime catalog adds locked candidate metadata without changing its provider
  registry;
- shared contracts and preload add only status/add/replace/delete methods;
- main bootstrap constructs the local credential/readiness service but never a
  cloud transport;
- renderer adds optional Settings and precise disabled-Hybrid copy; and
- architecture, readiness, contributor-facing documentation, and the build log
  state exactly what changed and what remains impossible.

Implementation may use a smaller file set if the same boundaries remain easier
to audit. File names are not persisted contracts.

## Typed IPC requirements

The credential-write request contains exactly one bounded secret string. The
main process rejects unknown fields, invalid sizes, leading/trailing whitespace,
NULs, and non-macOS production use. It clears local references after the
Keychain operation and maps failures to allow-listed codes.

The renderer cannot supply:

- Keychain service/account/reference;
- provider or model ID;
- endpoint;
- route or policy ID;
- campaign or budget;
- pricing, health, limit, or validation state; or
- dispatch authority.

Delete and status requests carry no secret. Every response is a strict
metadata-only projection.

## Delivery sequence

### A0 — plan and approval checkpoint

- Commit this plan and its `Approved` build-log entry on the clean baseline.
- Validate and push the exact planning commit.
- Require its Linux and macOS GitHub Actions checks to pass before runtime
  implementation begins.

### A1 — contracts, Keychain, and lifecycle

- Implement candidate/setup contracts and stable error codes.
- Implement the direct Keychain adapter and credential lifecycle service.
- Prove add, replace, status, delete, restart, timeout, denial,
  cleanup, and secret isolation with synthetic values only.
- Keep production runtime registration and sessions unchanged.

### A2 — Settings and dispatch-lock UX

- Add narrow IPC/preload methods and optional Settings.
- Preserve Local only as the default and immediately usable route.
- Show stored-but-unvalidated and dispatch-locked states accurately.
- Keep Hybrid unselectable and reject forged Hybrid inputs in main.

### A3 — egress shadow policy and final interlock proof

- Implement pure canonical-message/provenance hashing and egress admission.
- Prove required deny/pass cases without a session or network request.
- Assert the complete production dispatch interlock.
- Run independent correctness, privacy, and product-boundary reviews.

## Validation matrix

| Area | Required evidence |
| --- | --- |
| Approval lineage | Plan and `Approved` log entry exist in a prior exact commit before runtime changes |
| Keychain CRUD | Synthetic add/status/replace/delete and restart pass on macOS with cleanup |
| Secret process boundary | Secret absent from argv, environment, stdout, stderr, thrown errors, and timeout diagnostics |
| Secret persistence | Secret absent from SQLite, events, renderer storage/state, logs, snapshots, artifacts, screenshots, and Git tree |
| Credential lifecycle | Replace/delete changes stored-presence state without a separate crash-divergent generation record; PR6A creates no validation metadata |
| IPC | Strict inputs, allow-listed outputs/errors, no secret echo, and no renderer-controlled provider/policy authority |
| Settings UX | Optional first run, immediate password-field clearing, accurate stored/unvalidated/locked copy, accessible keyboard flow |
| Runtime catalog | One dispatch registration plus separate locked candidate metadata; candidate cannot parse as an enabled runtime provider |
| Session authority | Local review still creates only `local_only_v1` with consent `none`; forged Hybrid creation fails before Keychain/runtime/budget work |
| Egress deny | Absolute roots, relevant escaped forms, known credentials, token/private-key forms, denied paths, and unapproved artifacts deny |
| Egress pass | Bounded admitted workspace-relative evidence passes only under explicit synthetic consent input |
| Egress privacy | Findings contain codes and hashes only; rejected content is never returned or persisted |
| Dispatch lock | Zero cloud provider construction, zero cloud sessions, zero budget campaign/reservation, and zero configured/external cloud-provider calls from PR6A; local synthetic loopback fixtures remain permitted |
| Regression | Existing local review, fake-hybrid, recovery, budget, renderer, and Electron tests remain green |
| Release candidate | `pnpm check`, `pnpm test:e2e`, clean `pnpm check:release-head`, and exact-SHA Linux/macOS CI pass |

PR6A may become `Implemented` after the code and deterministic/local evidence
exist. It may become `Verified` only after the exact implementation commit and
required Linux/macOS checks pass. It cannot become `Released` under this plan.

## Required tests

At minimum:

- Keychain adapter unit tests for command arguments, stdin handling, bounds,
  timeout, stable errors, and absence of the sentinel from every observable;
- an isolated macOS Keychain integration or packaged Electron test with a
  unique synthetic service/account and guaranteed cleanup;
- credential-service lifecycle, restart, and concurrent-operation tests;
- IPC tests for strict inputs, one-way secret handling, and secret-free errors;
- renderer tests for optional setup, save/replace/delete, immediate field
  clearing, no browser storage, and precise locked copy;
- egress-policy adversarial tests for path, secret, token, private-key,
  artifact, Unicode, escaping, ordering, and deterministic hashing;
- integration tests that make any unexpected `fetch`, cloud provider
  construction, Hybrid session, or budget mutation fail; and
- Electron E2E proving Settings is reachable while Hybrid remains disabled
  before and after storing a synthetic credential.

No test may use the real OpenRouter key, private repository content, a raw home
or workspace path in a committed artifact, or a provider request.

## Documentation truth after implementation

Current-state documentation may say:

- cloud setup and direct Keychain credential lifecycle are implemented;
- a candidate is stored as unverified metadata;
- canonical-message/provenance egress policy is implemented and tested locally;
- production cloud dispatch remains locked and unavailable.

It may not say:

- two production providers are active;
- the stored credential works;
- DeepSeek V4 Flash is currently available or has a particular price/limit;
- Hybrid is ready;
- repository evidence has safely traversed a real cloud boundary; or
- routing improves quality, cost, or latency.

## PR6B approval gate

A separate proposed plan, build-log entry, and explicit project-owner approval
must precede any of:

- reading the stored production credential for remote validation;
- OpenRouter key-metadata, model-list, health, pricing, or limit requests;
- verifying zero opening exposure or the non-resetting provider-side `$100`
  limit;
- promoting the candidate into an enabled production `ProviderDescriptor`;
- constructing a cloud transport or production hybrid coordinator;
- user-selectable Hybrid and persisted per-session cloud consent;
- repository evidence egress;
- a real campaign, reservation, settlement, or cloud attempt; or
- the one paid canary capped at `$0.25`.

PR6B must freeze the exact implementation revision, credential metadata,
provider/model, current price and limits, campaign ID, public fixture, token and
cost envelope, retry/fallback policy, egress disclosure, and one-shot authority.

## Risks and stop conditions

- **False activation:** stop if any cloud transport or Hybrid session becomes
  reachable during PR6A.
- **Secret exposure:** stop, rotate the synthetic test identity, and record a
  failure if any sentinel reaches an unauthorized observable.
- **Keychain ambiguity:** stop if direct generic-password behavior cannot be
  implemented without putting the secret in argv or another unauthorized
  channel; do not silently substitute Electron `safeStorage` while claiming
  direct Keychain storage.
- **Shadow-policy drift:** preserve canonical provider-message and provenance
  hashes. PR6B must re-run admission over the actual provider-limited candidate
  immediately before dispatch, assert unchanged semantic identity, and avoid a
  second semantic compilation after admission.
- **Scanner overclaim:** keep bounded reason codes and limitations explicit;
  never market the guard as complete DLP.
- **Stale external facts:** do not copy dated planning price, model, or limit
  assumptions into active readiness.
- **Complexity relapse:** do not add evaluator, campaign, general-agent, or
  provider-preflight machinery unless a concrete PR6A contract requires it.

## References

- [Hybrid Lease Router v0](HYBRID_LEASE_ROUTER_V0.md)
- [MVP readiness](../MVP_READINESS.md)
- [Routing policy](../ROUTING_POLICY.md)
- [ADR 0004](../adr/0004-checkpoint-router-budget-runner-v0.md)
- [Project build log](../BUILD_LOG.md)
