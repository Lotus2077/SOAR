# PR6B1 Signed Native Credential Lease v1

Status: **Proposed; not Approved, Implemented, Verified, Activated, or Released**

- Plan ID: `pr6b1-signed-native-credential-lease-v1-plan-1`
- Parent plan: `hybrid-lease-router-v0-plan-2`
- Predecessor: `pr6b0-hybrid-simulation-v1-plan-1`
- Baseline revision: `9495d6bcbaa8cef5d3342e0d53ab02efe28d0002`
- Proposed: 2026-09-01
- Provider-spend ceiling: `$0`
- Provider requests: none
- Repository egress: none
- Project log: [BUILD_LOG.md](../BUILD_LOG.md)

The project owner directed SOAR to continue after PR6B0 and expressed willingness
to use a paid model when a later milestone needs it. That direction authorizes
planning only. It is not approval of this exact plan, a credential operation,
a provider request, repository egress, a budget, or any later milestone.

PR6B1 is split deliberately. Approval of this exact plan would authorize only
the fail-closed `$0` substrate in phase B below. A signed synthetic Keychain
proof, real credential re-entry, provider validation, and paid inference each
retain separate durable approval gates.

## Decision

SOAR will replace the setup-only, CLI-created credential design with a
macOS-native credential authority built around a signed host identity, Data
Protection Keychain, and short-lived native leases. Neither a newly entered
credential nor a retrieved credential may cross renderer IPC or enter renderer,
preload, or JavaScript memory. Real entry will eventually use a main-owned
native macOS secure sheet, but that sheet and the production Keychain namespace
remain absent and disabled in the phase approved by this plan.

The next safe unit is therefore not “turn on the cloud credential.” It is a
fail-closed native substrate whose signed behavior can later be proved with
synthetic data before a separate decision permits real re-entry.

## Milestone split and approval gates

| Phase | Scope | Current state | Separate approval required? |
| --- | --- | --- | --- |
| PR6B1-A | Correct plan and establish signing prerequisites | Proposed | This proposal does not install or export signing material |
| PR6B1-B | Fail-closed native substrate, locked UI, contracts, fakes, journal, package verifier | Not Approved | Yes: exact approval of this plan ID |
| PR6B1-C | Signed A/B synthetic continuity and hostile-host proof | Not Proposed | Yes: a later exact proof plan after signing prerequisites exist |
| PR6B1-D | Native secure re-entry and production protected-item activation | Not Proposed | Yes: only after a durable passing PR6B1-C checkpoint |
| PR6B2 | Bounded real provider/account/model/price/limit/health validation | Not Proposed | Yes |
| PR6B3 | One paid, public-fixture inference canary | Not Proposed | Yes |

The `$0.25` canary figure recorded in the PR6B0 sequence is a candidate ceiling,
not an approved PR6B3 plan or active reservation. The owner's general paid-model
willingness cannot be reused as exact approval for PR6B2, PR6B3, or a campaign.

## Current checked facts and blockers

At the baseline revision:

- normal vLLM mode constructs one Local provider and keeps real Hybrid locked;
- Fake Hybrid simulation is independent of Cloud Settings and records `$0`
  actual external spend;
- `SetupOnlyCredentialStore` exposes status, write/replace, and delete but no
  raw-secret read method;
- the current renderer accepts a credential and sends it through IPC;
- the current credential item is created by `/usr/bin/security` and is not
  isolated to an upgrade-stable signed SOAR identity;
- packaged builds honor `ELECTRON_RENDERER_URL`, have no single-instance gate,
  are ad-hoc signed, use the default Electron icon, disable Hardened Runtime,
  and are not notarized; and
- `/usr/bin/security find-identity -v -p codesigning` reports zero valid signing
  identities on the current host.

The missing Developer ID Application identity, private key, explicit App ID,
and matching Developer ID provisioning profile block PR6B1-C. They do not block
phase B's contracts, fakes, locked production adapter, UI removal, native state
machine, or package-verifier tests.

Private keys, Apple-account credentials, notarization credentials, and local
signing paths must never be committed, displayed, or attached to test artifacts.
Team IDs, certificates, entitlements, and embedded provisioning-profile
metadata are public signed-package metadata and may be inspected in bounded
signature reports; they must not be misclassified as secrets.

## Exact authority boundary for this proposal

Approval of `pr6b1-signed-native-credential-lease-v1-plan-1` would authorize
only local `$0` phase-B work to:

- disable PR6A staged store/replace and remove its renderer credential field;
- retain only noninteractive staged status; remove staged mutation actions;
- add strict metadata, operation, error, journal, identity, and lease contracts;
- add deterministic unavailable/fake authorities and a production adapter that
  is structurally activation-locked;
- add a version-pinned Objective-C++ Node-API broker, native serialized queue,
  lease state machine, and zeroization helpers without a production item
  locator or production consumer;
- add packaged-renderer, top-level-frame, native-module, signed-identity,
  single-instance, entitlement, and package-verification hardening;
- add a non-secret mutation journal and conservative unknown-outcome recovery;
- implement and test honest locked UI states with no credential entry action;
- run deterministic, Electron, unsigned-package, static bundle, and CI proof;
  and
- update current-truth, contributor, architecture, and evidence documentation.

Approval would not authorize:

- any real credential entry, read, migration, replacement, or protected write;
- any production protected-item service/account locator in a runnable build;
- acquiring or consuming a lease in normal app operation;
- a signed synthetic Keychain call or test namespace;
- reading, silently migrating, overwriting, or deleting the existing staged
  item;
- provider key, account, model, price, health, limit, or capability validation;
- a model-list, inference, retry, fallback, evaluator, or other provider call;
- repository or task-content egress;
- real provider registration, real Hybrid availability, actual budget
  reservation, or paid spend; or
- notarization, distribution, or a quality, cost, or latency claim.

## Security and correctness invariants

### Secret boundary

- Renderer and preload expose only metadata requests and results. No IPC schema
  contains a credential, lease handle, authorization header, or secret-derived
  diagnostic.
- Real credential entry, when separately approved in PR6B1-D, is owned by
  Electron main and presented through a native `NSSecureTextField` sheet. The
  native broker receives its bytes directly; they never enter V8 or Electron
  IPC.
- Retrieved credential bytes stay in mutable native storage. Main holds only an
  opaque handle. Provider catalog, router, runner, tools, shared contracts,
  preload, renderer, SQLite, logs, and events never receive that handle or the
  bytes.
- Native code minimizes immutable copies, bounds every SOAR allocation, rapidly
  releases framework-owned values, and clears SOAR-owned mutable memory with a
  non-optimizable primitive on controlled terminal paths. AppKit owns temporary
  secure-field string storage and Security.framework returns secret data in
  framework-owned `CFData`; SOAR cannot promise deterministic clearing of those
  copies. Crash, `SIGKILL`, and power loss also cannot run cleanup and rely on
  OS memory reclamation. PR6B1 must not claim otherwise.

### Host and package identity

- The signed flavor uses the fixed bundle identifier, Developer ID Application
  identity, Hardened Runtime, active library validation, secure timestamp, and
  an exact Keychain access-group entitlement authorized by its profile.
- Debug, DYLD-environment, disabled-library-validation, unapproved executable-
  memory, wildcard app-entitlement, and development-signing configurations fail
  closed.
- A byte-identical copy of a valid signed app retains the same code identity and
  is not claimed to be denied. A copied addon loaded by an unsigned, wrong-team,
  wrong-bundle, or otherwise ineligible host must be denied.
- OS signature enforcement and library validation admit a sealed addon from one
  fixed bundle-relative path. Once loaded, the addon immediately validates both
  its host process and itself before exposing capability status; every Keychain
  operation repeats the native gate. TypeScript does not pretend it can obtain
  native-backed eligibility before importing the native module.
- Linux and unsigned/ad-hoc macOS builds load a structural unavailable adapter.
  They never resolve a production service/account or call protected Keychain
  APIs.

### Renderer and IPC identity

- Packaged builds ignore `ELECTRON_RENDERER_URL` and load only their sealed
  renderer file. Development URL loading is allowed only when `app.isPackaged`
  is false.
- Navigation and new-window creation remain denied outside the exact expected
  renderer. Every credential IPC handler verifies the current main window's
  expected `WebContents`, top-level frame, and exact packaged URL before parsing
  payloads.
- The app acquires Electron's single-instance lock before database recovery,
  credential status, native loading, or window creation. A second instance
  exits before credential or database work.

### Provider and cost isolation

Credential metadata, identity eligibility, journal state, or an opaque native
handle cannot register a provider, enable Hybrid, create a cloud route, run
egress admission, reserve budget, or dispatch. PR6B1-B and PR6B1-C install
network traps that fail on any OpenRouter model-list, validation, inference, or
other request. Configured Local vLLM behavior is outside these credential
operations and must not be described as “no provider contacted.”

## Phase-B architecture

### 1. Frozen contracts and adapters

Add a main-only `CredentialLeaseAuthority` with strict metadata types. The
production phase-B implementation returns `activation_locked` and exposes no
item locator or mutation method. Deterministic fakes exercise the state machine
without Security.framework or a real secret.

Shared/renderer contracts may expose only:

- build eligibility and activation phase;
- legacy staged-item presence class;
- protected-item state as `not_observed | present | unknown`, only when the
  native source can substantiate it;
- provider check `not_run` and cloud dispatch `locked`;
- operation kind, reconciliation state, and allow-listed recovery code; and
- a bounded capability/schema version.

Unknown fields and secret-shaped values fail contract validation. Native error
text, paths, entitlement values, certificate data, provider responses, and
input values never cross into renderer contracts or persisted journal rows.

### 2. Native broker and build flavors

Create a pinned Objective-C++ Node-API addon under
`native/macos-credential-lease/`, linked directly to Security.framework. The
broker runs all operations on one serialized native background queue.

Build flavors are explicit and fail closed:

- `locked`: normal phase-B production/contributor build; no production or
  synthetic item locator and every SecItem/lease mutation returns
  `activation_locked` before Keychain I/O;
- `synthetic-proof`: unavailable until PR6B1-C approval; signed with the same
  production bundle requirement and exact access-group entitlement but compiled
  with a dedicated synthetic service/account, proof-only native secret
  generator, and proof-only consumer; and
- `production`: unavailable until PR6B1-D approval; contains the production
  service/account, native secure sheet, and real mutation entry point.

The proof-only generator/consumer and synthetic service/account must be absent
from the production bundle. The production service/account and native secure
sheet must be absent from phase B and C bundles. The proof generator creates
high-entropy bytes, stores and clears them entirely inside native code, and
returns only non-secret generation metadata plus a one-way test commitment,
never the generated value.

### 3. Native lease state machine

The internal lease lifecycle is:

`acquiring -> active -> consumed | released | expired | abandoned`

At most one lease may be active across the admitted instance. A lease is bound
to one item generation, purpose, authority instance, monotonic expiry no longer
than 30 seconds, and unguessable handle. Wall-clock changes cannot extend it.

Consumption is one atomic native transition:

`consumeLease(handle, expectedPurpose, nonce)`

It validates state, generation, purpose, nonce, and monotonic expiry, marks the
lease consumed exactly once, runs the native consumer, then clears controlled
buffers. Acquire/release alone are not evidence of single use. PR6B1-B has no
consumer. PR6B1-C may add only a proof target that returns a nonce-bound one-way
proof; PR6B2 must separately approve the first provider consumer.

### 4. Keychain item design reserved for later gates

PR6B1-C may propose a synthetic generic-password item using:

- `kSecUseDataProtectionKeychain = true`;
- an exact app entitlement for the profile-authorized access group;
- `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`;
- synchronization disabled;
- a dedicated synthetic service/account; and
- a random non-secret generation attribute.

Every query must repeat class, service, account, Data Protection Keychain, and
access group. Broad enumeration is forbidden. Passive status requests use
`kSecUseAuthenticationUIFail`, request attributes only, and never request data.
Opening Settings or starting SOAR must never trigger a Keychain prompt. An OS
authentication prompt is permitted only after a separately approved, explicit
mutation action.

The production service/account is not defined until PR6B1-D. PR6B1-C uses the
production signed app requirement and access-group entitlement with synthetic
service/account data so it proves signer continuity without touching a real
credential namespace.

### 5. Legacy staged-item retirement

PR6B1-B makes the PR6A namespace status-only in every build:

- remove and reject staged `store` and `replace` in main, preload, IPC, shared
  contracts, and renderer;
- show no credential field in unsigned, ad-hoc, ineligible, phase-B, or phase-C
  builds;
- status queries request metadata only, prohibit authentication UI, and degrade
  to `Local credential status unavailable` rather than prompting; and
- remove and reject staged deletion in main, preload, IPC, shared contracts,
  and renderer until PR6B1-D defines the complete mutation-safety contract.

SOAR never reads, migrates, or deletes the old secret in phase B or C. PR6B1-D
must create and confirm the new protected item before it may offer a separate,
main-owned legacy cleanup confirmation governed by the same journal,
unknown-outcome, and duplicate-mutation lock as every other mutation. Cleanup
failure never rolls back a successful protected write.

### 6. Mutation journal and unknown outcomes

Add a checksummed database migration for a non-secret operation journal. Rows
contain only:

- operation ID and operation kind;
- requested non-secret generation, when applicable;
- start/update timestamps;
- `pending | confirmed | outcome_unknown | superseded`;
- stable allow-listed result/recovery code; and
- identity-capability version.

Before a future native mutation, main records `pending`. A UI timeout or caller
abandonment is not cancellation: the native completion observer remains alive
while the process lives. The state becomes `outcome_unknown` and duplicate
mutation stays blocked until the original native call resolves and metadata
reconciles.

After a process crash, a request already delivered to `securityd` may commit
later. Absence or a different generation therefore does not prove failure or
`not_observed`; it remains ambiguous and does not authorize retry. Phase B tests
this conservative lock with fakes. PR6B1-D must separately define a safe human
recovery contract before real mutation activation. The project makes no claim
that restart alone cancels or recovers an in-flight Keychain request.

### 7. App states and exact copy

The screen title becomes **Cloud credential** and the navigation action becomes
**Manage cloud credential**. Existing **Cloud synthesis** and **Set up cloud**
copy must not survive PR6B1-B.

Every state shows:

- **OpenRouter check — Not run**;
- **Cloud requests — Locked**; and
- **OpenRouter was not contacted by this credential operation**.

The last statement is operation-scoped; it does not deny the existence of Local
vLLM or Fake provider activity elsewhere.

| Source-proven state | User-facing headline | Required behavior |
| --- | --- | --- |
| Unsigned/ad-hoc/ineligible | **Signed setup is not available in this build** | No credential field or protected action |
| Phase B/C locked | **Real credential setup is still locked** | Explain the next proof gate; no credential field |
| Staged item present | **Older setup item present** | Keep unchanged; cleanup is a later activation action |
| No staged item observed | **No older setup item found** | Do not imply protected setup is available |
| Eligibility cannot be established | **This build's credential identity could not be confirmed** | No claim that an item exists; inspect a correctly signed build |
| Keychain locked | **Unlock your Mac Keychain to continue** | Prompt only after explicit mutation; otherwise metadata unavailable |
| Keychain permission denied | **Keychain access was denied** | Keep prior source-proven state and offer explicit retry |
| Metadata unavailable | **Local credential status unavailable** | Noninteractive metadata-only retry |

Future fake UI contracts use operation-specific progress and unknown copy:

- **Storing credential in Keychain...**;
- **Replacing credential in Keychain...**;
- **Removing protected credential...**;
- **Removing older setup item...** (future PR6B1-D fake state only); and
- **The previous <operation> has not been confirmed**.

Unknown-operation UI preserves the last source-proven item state, disables
duplicate mutation, names the operation, and exposes only its defined recovery.
Never use **Connected**, **Valid**, **Verified**, **Ready**, **Authenticated**,
or **Hybrid available** for stored state.

### 8. Accessibility

The locked screen and all fake future-state fixtures must preserve:

- title focus on entry and origin-focus restoration on exit;
- focus on the non-destructive action when a destructive confirmation opens;
- native controls, visible focus, at least 32-point critical targets, and
  operation-scoped `aria-busy`;
- one polite live region for progress/success and alerts for actionable errors;
- initiating-action/status focus restoration after a macOS prompt;
- persistent unknown/pending states with no fake countdown or auto-dismissal;
  and
- keyboard-only traversal, VoiceOver, 200% zoom/reflow, light/dark contrast,
  reduced motion, and long-copy clipping checks.

## Build and open-source contract

- `package:mac` remains a contributor-safe ad-hoc package whose credential
  authority is locked.
- A future `package:mac:signed` command must fail closed rather than silently
  fall back to ad-hoc signing.
- Linux must never import or package a Darwin binary.
- Native build inputs are pinned and use the existing Electron native-module
  rebuild path.
- Signed inspection verifies the fixed bundle identifier, Team ID, designated
  requirement, secure timestamp, Hardened Runtime, exact app entitlement,
  profile authorization, forbidden-entitlement absence, and all nested helper
  and native-module signatures.
- A provisioning profile may authorize an entitlement through a profile
  wildcard; the final app entitlement itself must be the exact expected access
  group.
- The signed flavor must not use disabled library validation, debug/DYLD
  exceptions, or an unreviewed executable-memory exception to make Electron or
  the addon load.
- Notarization remains a later release gate and is not evidence of credential
  continuity by itself.

## Phase-B implementation sequence after exact approval

1. Freeze metadata, operation, error, activation-phase, and journal contracts.
2. Acquire the single-instance lock before database, native, credential, or
   window work; harden packaged renderer loading and credential IPC identity.
3. Retire every staged mutation and replace the existing credential-entry UI
   with the locked, status-only experience.
4. Add unavailable/fake authorities, journal migration, conservative unknown-
   outcome recovery, and renderer fixtures.
5. Add the locked native broker, immediate host/self validation, serialized
   queue, lease state machine, atomic consume transition, and zeroization tests.
6. Add locked/synthetic/production flavor enforcement and prove production and
   synthetic item locators plus proof consumers are absent from the phase-B
   package.
7. Add signed-package verifier tests without requiring a real signing identity;
   signed success remains an explicit blocked fixture until prerequisites exist.
8. Run exact-head unit/integration tests, Electron workflows, ad-hoc package
   verification, secret/private-path scans, independent review, and Linux/macOS
   CI. Record failures and non-claims before calling phase B Implemented.

## Phase-B verification matrix

### Deterministic source and contract proof

- all renderer/preload schemas reject credential, lease, header, and unknown
  fields;
- production mode has no staged write/replace path and no credential field;
- locked builds contain no production/synthetic item locator or native consumer;
- packaged mode ignores `ELECTRON_RENDERER_URL` and rejects foreign frame,
  origin, `WebContents`, navigation, and window-open cases;
- the second app instance exits before database or credential work;
- pure identity-policy fixtures reject every unavailable, invalid, wrong-team,
  wrong-bundle, wrong-module, and wrong-path case, while the ad-hoc native build
  proves only `activation_locked` before Keychain I/O;
- passive status is noninteractive and requests no secret data;
- lease lifecycle, monotonic expiry, purpose/generation binding, replay,
  replace/delete invalidation, atomic consumption, and controlled zeroization
  pass under fakes;
- abrupt termination is described as OS reclamation, not explicit zeroization;
- journal tests cover caller abandonment, late completion, process-crash
  ambiguity, mismatched generation, and duplicate-mutation denial;
- stored/eligibility/journal state leaves provider registry, Hybrid, egress,
  budget, attempts, and dispatch unchanged;
- migrations adopt frozen old databases and reject checksum drift; and
- network, secret, private-path, and production-bundle traps stay clean.

### Electron and package proof

- ad-hoc package shows **Signed setup is not available in this build**, has no
  credential field, and makes zero protected Keychain call;
- legacy staged status never prompts and no staged mutation action exists;
- Local tasks and Fake Hybrid simulation remain usable and unchanged;
- locked and fake pending/unknown/recovery states pass keyboard and focus tests;
- the app refuses a second instance before mutable initialization;
- package inspection verifies broker placement and locked flavor and rejects
  production/synthetic constants or proof consumers; and
- provider/network traps prove zero OpenRouter request.

Phase B can be Implemented without a signing identity. It cannot prove signed
identity admission, Data Protection Keychain access, upgrade continuity, a real
credential lease, or real provider use.

## Requirements for a later PR6B1-C signed synthetic plan

PR6B1-C may be proposed only after a valid Developer ID Application identity,
private key, explicit App ID, and matching profile are installed locally without
entering repository history or logs.

Its exact plan must require:

1. static inspection of the exact production package configuration and a
   separately identified synthetic-proof flavor;
2. signed versions A and B with the same production bundle identifier, Team ID,
   designated requirement, Hardened Runtime, exact access-group entitlement,
   and profile authorization;
3. a dedicated synthetic service/account and random synthetic value, never a
   maintainer credential or production service/account;
4. one proof-only native generator that creates, stores, and clears a random
   synthetic secret without returning it, plus one proof-only atomic consumer
   that returns a nonce-bound one-way result; both are proven absent from the
   locked and production packages;
5. A/B generate/store, status, acquire, consume-once, expiry, replace, and
   delete proof entirely through native synthetic operations;
6. denial for ad-hoc, wrong-team, wrong-bundle, wrong-entitlement, wrong-module,
   and other ineligible-host cases, without falsely claiming a byte-identical
   signed app copy is denied;
7. deterministic crash/unknown lock proof; no claim that a process restart
   cancels a request already delivered to `securityd`;
8. zero provider/network request and zero production service/account query; and
9. confirmed final synthetic absence with only bounded public signature
   metadata, stable codes, hashes, counts, and cleanup result retained.

Any uncertain cleanup, raw value in output/artifacts, production namespace
query, disabled security entitlement, or unreproducible identity fails the
proof. Passing PR6B1-C authorizes no real re-entry; it only permits a later
PR6B1-D plan to be proposed.

## Requirements for a later PR6B1-D activation plan

PR6B1-D must remain disabled until PR6B1-C passes on an exact committed SHA and
the result is durably logged. It then requires a new exact plan and explicit
approval for:

- the production service/account and native secure-entry sheet;
- protected store/replace/delete with user-visible, operation-specific states;
- a safe recovery contract for process-crash outcome ambiguity;
- explicit real re-entry with no staged-secret read or migration;
- optional, separately confirmed legacy deletion after protected write
  confirmation; and
- a production activation manifest sealed into an eligible signed package.

Even PR6B1-D permits no provider validation, inference, repository egress,
Hybrid availability, budget reservation, or paid spend.

## Stop conditions

Stop phase-B implementation immediately if:

- this exact plan ID is not durably approved first;
- a private key, Apple-account credential, notarization credential, or local
  signing path would need to be committed or displayed;
- a real or synthetic item locator, native secure sheet, proof consumer, or
  production mutation becomes reachable;
- staged store/replace or a renderer credential field remains reachable;
- a packaged build can honor an environment-provided renderer URL;
- a second instance can reach database or credential work;
- a passive status action can display authentication UI;
- a timeout is called cancellation or absence/generation mismatch is called a
  definite failure after a crash;
- credential state changes provider, Hybrid, egress, budget, or dispatch; or
- any OpenRouter/provider request or nonzero external spend occurs.

## Status rules

- **Proposed**: this document and its append-only build-log entry exist.
- **Approved**: the owner approves this exact plan ID; the approval is committed
  and exact-SHA Linux/macOS CI passes before phase-B runtime work begins.
- **Implemented**: only phase B is complete on an exact SHA with deterministic,
  Electron, ad-hoc package, independent-review, and Linux/macOS CI evidence.
- **Verified**: reserved for a separately approved, passing PR6B1-C signed A/B
  synthetic proof with confirmed cleanup. Phase-B implementation alone is not
  Verified.
- **Activated**: reserved for separately approved PR6B1-D real re-entry in an
  eligible signed build after PR6B1-C passes. Verified is not Activated.
- **Released**: additionally requires product icon, notarization, distribution
  testing, release notes, and release approval. Activated is not Released.

## Handoff to PR6B2 and PR6B3

PR6B1 establishes local identity and secret custody only. PR6B2 must separately
define one bounded native consumer for credential/provider/model/price/limit/
health validation, current authoritative sources, response limits, credential
failure behavior, and zero repository content. PR6B3 must separately define the
exact wire request, immediately-before-dispatch egress admission, budget
reservation/settlement, public fixture, one cloud attempt, no retry or model
substitution, one eligible Local fallback, and its paid ceiling.

No paid request is necessary or permitted in PR6B1.

## Primary references

- Apple: [Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)
- Apple: [Creating distribution-signed code for macOS](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/)
- Apple: [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)
- Apple: [TN3127: Inside Code Signing Requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)
- Apple: [TN3125: Inside Code Signing Provisioning Profiles](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles)
- Apple: [Code Signing Services](https://developer.apple.com/documentation/security/code-signing-services)
- Apple: [Data Protection Keychain](https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain)
- Apple: [Sharing access to Keychain items](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)
- Apple: [TN3137: On Mac keychains](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains)
- Apple: [SecItemUpdate](https://developer.apple.com/documentation/security/secitemupdate(_:_:))
- Electron: [Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
