# PR6R Development Real-Provider Slice v1

Status: **Phase R-A Approved and in progress; R-A1 Implemented but not Verified
or Released; R-A2/R-A3 not Implemented; no real credential,
configured-provider, off-device-egress, actual-budget, or paid authority**

- Plan ID: `pr6r-development-real-provider-slice-v1-plan-1`
- Product goal: first real-provider transport, accounting, and latency canary
- Baseline revision: `7e3a4488695d1e75e70f36509f45d6d89233c54e`
- Proposed: 2026-09-02
- Approval: granted 2026-09-02 for the exact R-A `$0` scope; see
  `BL-20260902-0445-pr6ra-approved`
- Phase R-A provider spend and external LLM requests: **USD 0 and none**
- Later proposed paid ceiling: **USD 0.25 aggregate**, not operative or
  approved under R-C
- Proposed cloud model: exact pinned slug
  `deepseek/deepseek-v4-flash-0731`
- Project log: [BUILD_LOG.md](../BUILD_LOG.md)

## Why this recalibration exists

SOAR's original product goal is an app-first agentic router that meets a task-
quality floor and then minimizes paid-model cost and end-to-end latency across
Local and Cloud providers. The repository now has a real Local app, canonical
event state, context compilation, deterministic checkpoint routing, exact
accounting, fake Hybrid simulation, and offline evaluation contracts. It still
has no real Cloud trajectory and no Local/Cloud/Hybrid outcome record.

The signed production credential sequence cannot advance on this host:
PR6B1-C may not even be proposed until a Developer ID Application identity,
private key, explicit App ID, and matching profile are installed, and the live
host check still reports none. Continuing to add unrelated UI, simulated
routing, credential substrate, or evaluator machinery would increase
infrastructure confidence without testing the real-provider boundary.

This proposal creates a narrow **unpackaged development-only** route toward the
first real-provider canary. It does not replace the signed credential path for a
packaged or releasable app. It changes roadmap ordering only: a bounded
development canary may precede production credential activation, while
PR6B1-C/D remain the only path to packaged production credential custody.

The owner's instruction to summarize progress, correct deviations, and build
the next milestone initiated this proposal. It is not informed approval of the
exact implementation, credential query, provider contact, public-fixture
egress, or paid authority below. Each phase retains a separate durable gate.

## Milestone split and approval gates

| Phase | Scope | Current state | Separate approval required? |
| --- | --- | --- | --- |
| PR6R-A | `$0` contracts, app flow, loopback transport, deterministic authority/accounting/replay proof, and packaged denial | Approved and in progress; R-A1 Implemented on `4cab8a7`, R-A2/R-A3 not Implemented | Granted for the exact R-A sentence below |
| PR6R-B | Main-only development credential resolution, bounded account/model/upstream/pricing validation, and one Local baseline over the frozen public fixture | Not Proposed | Yes: later exact plan after R-A exact-SHA closure |
| PR6R-C | At most two paid Cloud synthesis attempts over the exact R-B packet under a USD 0.25 aggregate reservation | Not Proposed | Yes: later exact plan after R-B evidence freezes every request fact |

One approval may not collapse these gates. In particular, R-C cannot be
proposed or approved until R-B has recorded the exact credential-metadata ID,
zero opening exposure, non-resetting provider-side USD 100 hard limit, remaining
limit, exact selectable upstream provider slug, separately bound endpoint and
deployment metadata, fresh prices/capabilities, Local baseline, and Cloud-bound
semantic packet commitment. General willingness to use a paid model is not R-B
or R-C authority.

## Exact frozen public fixture

All three phases are limited to the existing public calibration entry
`cal-007-flask-jinja-name` in `change-review-calibration-v1`:

- repository: `https://github.com/pallets/flask.git`;
- base revision: `38b4c1e19b50494cfcdc9332899e09b7fed34979`;
- change revision: `d8259eb11900285af9b80b0fa47f841174c054e3`;
- source commit: `use Jinja name consistently`;
- materialization: `git-patch-to-index-v1`;
- expected changed paths: `CHANGES.rst`, `docs/design.rst`,
  `docs/patterns/streaming.rst`, `docs/patterns/wtforms.rst`,
  `docs/quickstart.rst`, `docs/templating.rst`, `docs/web-security.rst`,
  `src/flask/sansio/app.py`, and `src/flask/templating.py`, 62 changed lines
  total;
- expected snapshot ID:
  `193bf5f4aa818fd2e901fd49c50b288f7a7d966c21278cb09953c3b9a6088e4c`;
- expected index SHA-256:
  `98fb7b5210dbc87b5526535eb60b8da01736a112f843b5df464d2b169b58f181`;
- expected discovery SHA-256:
  `2bd15f5da86c96a3e694dfae8ac83aea2d079189826da80063fdcffa14e6d7c7`;
- classification: mechanically verified high risk with score 3 and curator
  attention label `heightened`; and
- development-canary bounds: 262,144 canonical packet bytes, 163,840 admitted
  input tokens, and 8,192 requested output tokens.

Any identity, path set, changed-line count, snapshot, index, discovery, or bound
mismatch denies the relevant phase. The workspace is a
network-disabled detached materialization with no retained remote after its
required objects are present.

The calibration label is **review attention only, not correctness gold**. This
fixture has no defect oracle, executable witness, blinded rubric, or adjudicated
quality threshold. Therefore no phase in this plan measures task correctness,
quality, best-result regret, recall, precision, or false accepts. Structural
schema acceptance, citation support, evidence integrity, and coverage are
reported only as **output-validity checks**, never as task quality. A later
held-out campaign remains mandatory before any quality or optimizer claim.

## Comparison unit

The development record has one common Local investigation followed by three
synthesis-route decisions over one frozen checkpoint:

1. `local_only_v1`: Local synthesis from the checkpoint;
2. `cloud_synthesis_v1`: one Cloud synthesis from the identical semantic
   messages, schema, and output allowance; and
3. `hybrid_checkpoint_v1`: the deterministic router chooses Local or Cloud from
   that same checkpoint and immutable router input.

The Local investigation runs once. Its duration, tool calls, and packet
compilation are common antecedents and are reported separately, not copied into
three measured episodes. Only synthesis-from-checkpoint duration is observed
per route. A derived `common investigation + route synthesis` value may be shown
only with the label **derived, shared-prefix, one sample**. It is not an
independent end-to-end latency measurement.

R-B must freeze the exact semantic-message hash, system/objective prompt hashes,
schema hash, context-compiler version, actual packet bytes, input estimate,
output allowance, temperature, seed support/absence, Local provider/deployment
fingerprint, investigation duration, and execution order before R-C may be
proposed. R-C must predeclare Cloud then Hybrid ordering. Cache usage and any
provider-side transformation remain visible. One order-sensitive sample cannot
support Faster, Slower, p50, p95, or causal latency claims.

## Phase R-A: `$0` implementation boundary

R-A may implement only a development-shaped vertical slice using deterministic
in-process or loopback providers. Its Cloud-like registration must reject every
non-loopback URL and every nonsynthetic credential. It may add:

- strict phase, authority, fixed-slot, provider-validation, pricing, campaign,
  comparison, and safe-projection contracts;
- an app-visible development-canary surface with Local selected by default,
  fresh disclosure challenge, cancellation, replay, and explicit simulation/
  no-authority copy;
- the exact public fixture materializer and common-checkpoint coordinator;
- Cloud-shaped Chat Completions serialization with the exact pinned model slug,
  tool-free `ReviewResultV1` schema, provider-routing object, and wire-bound
  egress identity, sent only to bounded loopback test servers;
- a sealed `CloudApplicationRequestV1` containing exact origin/path, method,
  allow-listed non-secret headers, canonical JSON body bytes, body hash, and
  opaque credential-metadata ID. R-A permits HTTP only for loopback tests;
  R-B/R-C require HTTPS. Admission authorizes that immutable body;
  Authorization is injected afterward, and the same bytes are sent with
  redirects and retries disabled. Equality means application-request bytes,
  not literal HTTP/TLS framing;
- reuse of the current context compiler, checkpoint router, provider registry,
  atomic attempt unit of work, micro-USD budget ledger, cancellation, recovery,
  and projection contracts; and
- package, Electron, integration, adversarial, and deterministic tests.

R-A may not add or call a real credential resolver, accept an API-key value from
the environment/renderer/preload/IPC/database/arguments/files, contact the
configured vLLM or OpenRouter, use a non-loopback transport, send repository
content off-device, create an actual-cost reservation, or spend money. Every
R-A attempt and reservation remains `costScope=simulation`. The real development
provider registration and `commitActualPaidStart` operation remain absent and
are deferred to later approval.

Production packaging remains locked. A hostile packaged environment, command
line, deep link, second instance, renderer message, stored database, or copied
development configuration must not parse, construct, or reach the development
Cloud registration. The production archive must exclude any later real
credential resolver and pass a static marker scan plus the packaged zero-request
canary.

R-A is delivered as three reviewable `$0` implementation checkpoints under the
same narrow approval:

1. **R-A1 — contracts and structural build isolation:** strict persisted
   contracts/migration, fixed fixture/authority/slot identities, a distinct
   compile-time development build flavor, and a unique marker that the normal
   package verifier rejects. `app.isPackaged` is defense in depth, not the
   structural boundary.
2. **R-A2 — sealed loopback request and accounting authority:** canonical
   application-request bytes, loopback-only direct transport, egress binding,
   a nominal compile-time development-loopback authority that still requires
   `costScope=simulation`, budget/recovery/replay tests, stable error codes, and
   zero external provider construction. The current simulation guard is not
   relaxed and no actual-paid operation exists in R-A.
3. **R-A3 — coordinator, renderer projection, and package proof:** common Local
   checkpoint, deterministic three-route loopback flow, honest output-validity/
   latency/cost labels, cancellation, one campaign-wide Local fallback ratchet,
   Electron tests, hostile package tests, archive verification, and canary.

Each checkpoint must pass focused tests and review before the next starts. R-A
closure additionally requires the full exact-head gate, package/canary proof,
independent security and UX/IPC review, and exact-SHA Linux/macOS CI.

## Requirements for a later PR6R-B plan

R-B may be proposed only after R-A is Implemented on an exact committed SHA,
independently reviewed, and green in Linux/macOS CI. Its separate exact plan
must define and prove:

1. a main-owned, read-only, unpackaged-development credential resolver that does
   not place a secret in Electron's launch environment or any renderer/helper
   environment;
2. exact machine-local non-secret locator input, `/usr/bin/security` argument-
   array execution with `shell: false`, minimal allow-listed child environment,
   closed/ignored stdin, bounded stdout, discarded raw stderr, timeout/late-
   completion behavior, no mutation flag, and main-memory-only secret lifetime;
   invocation occurs only after special-build, unpackaged, authority, and
   fixture gates. Nonzero, timeout, late, or malformed completion discards and
   zeroizes raw stdout plus the raw execution error before returning a stable
   code, and no resolver error may reach the raw startup console boundary;
3. compile-time exclusion of the resolver from the production package plus a
   package scan proving its command/activation markers are absent;
4. stable host-authored credential/provider error codes only. Raw provider
   bodies, headers, SDK exceptions, command stderr, and transformed diagnostics
   are discarded before persistence or UI; exact and encoded-secret scans are
   defense in depth, not the primary boundary;
5. a dedicated credential's trustworthy metadata, zero opening exposure,
  non-resetting provider-side USD 100 hard limit, remaining limit, and no
  balance reset or shared-key claim, using bounded current-key/account metadata
  and safe before/after usage facts;
6. bounded OpenRouter account/model/endpoint/capability/context/output/pricing
  validation that sends no repository content and performs no inference;
7. one exact selectable upstream provider slug and separately bound endpoint/
   deployment candidate, with request routing using `provider.only`/
   `provider.order`, `allow_fallbacks: false`, `require_parameters: true`, and a
   conservative `max_price` ceiling. If the selected provider slug does not map
   uniquely to the accepted endpoint/deployment metadata, later R-C is denied;
8. exact decimal-to-rational/integer price parsing with no binary-float budget
   arithmetic. Every possible request, input, output, cache-read, cache-write,
   reasoning, service, plugin, web, or other billing component must be either
   conservatively represented by the ledger or proved disabled/zero; unsupported
   components deny the route;
9. one separately authorized configured-Local baseline on the exact public
   fixture, with no Cloud inference and provider cost recorded under the Local
   operator attestation; and
10. durable R-B authority claimed before any credential resolution, configured-
   vLLM request, or OpenRouter API contact. A definitely pre-contact denial may
   release it; initiated, sent, unknown, crashed, missing, or corrupt state
   consumes or blocks it and can never reset through app-database deletion.

R-B evidence must freeze the exact Cloud-bound packet and every fact needed for
an informed R-C approval. R-B authorizes no paid inference.

Because PR6B1-B deliberately made the legacy namespace status-only, R-B's exact
plan and approval must explicitly supersede that rule only for one bounded,
read-only, unpackaged development resolution. It cannot authorize mutation,
migration, general re-entry, packaged access, or production activation.

## Requirements for a later PR6R-C plan

R-C may be proposed only after a durable passing R-B checkpoint. Its separate
plan and approval must bind:

- the exact R-A/R-B implementation SHA and one global canary authority ID;
- exact fixture, snapshot, packet, semantic-message, prompt, schema, compiler,
  Local deployment, and route-input hashes plus byte/token/output bounds;
- the exact pinned model slug, one exact selectable upstream provider slug, a
  separately bound endpoint/deployment fingerprint, quantization when exposed,
  supported parameters, fresh component prices, validation time, and
  `max_price`;
- the verified credential-metadata ID, zero opening exposure, non-resetting USD
  100 hard limit, and remaining limit without disclosing the secret or locator;
- exact `provider.only` and `provider.order` arrays containing one provider slug,
  `allow_fallbacks: false`, `require_parameters: true`, no model fallback, and
  denial if OpenRouter cannot honor all constraints or that slug does not map
  uniquely to the accepted endpoint/deployment metadata;
- exactly two immutable possible paid slots: `cloud_synthesis` and
  `hybrid_cloud_if_selected`, with at most one dispatch each, no retry,
  speculation, parallelism, background continuation, or third slot;
- one campaign-wide Local fallback maximum across both slots, durably ratcheted
  and incapable of authorizing another Cloud request;
- worst-case integer-micro-USD reservation for each slot and an aggregate USD
  0.25 ceiling; and
- a fresh packet-bound user egress disclosure and cancellation semantics.

The separate OS-user-local authority ledger must be independent of the app
database. It claims the global authority before the first paid admission and a
slot before its reservation. A definitely unsent slot may release only after
durable proof of no network dispatch; `sent`, `unknown`, crash-after-claim,
publication failure, missing/corrupt ledger, or ambiguous recovery consumes or
blocks the slot. Deleting the app database, output directory, or app never
restores authority. The second slot may run only inside the same reconciled
campaign after the first slot reaches a durable terminal accounting state.

## Provider and request boundary

The Cloud model is the exact pinned OpenRouter slug
`deepseek/deepseek-v4-flash-0731`. It is not an immutable deployment identity.
Aliases such as `latest`, `:free`, `:nitro`, or `:batch` are denied. OpenRouter
load-balances and falls back across providers by default, so an R-C request must
select one exact upstream provider slug, bind its accepted endpoint/deployment
metadata separately, and explicitly disable fallbacks. If validation cannot
prove the slug maps uniquely to that metadata or cannot bind all supported
parameters and a conservative price, the paid route is denied.

The Cloud request uses HTTPS Chat Completions, the strict `ReviewResultV1` JSON
Schema, bounded output, no tools, and the exact R-B semantic messages. Optional
attribution headers may contain only the public product name and public
repository URL. They may contain no local URL, workspace, user, task, key, or
private identifier.

The canonical application-request body admitted by the egress guard must be the
same immutable byte buffer passed to a dedicated direct-fetch transport. The
transport uses the exact origin/path/method, `redirect: "error"`, no SDK
reserialization, and no retry. Provider routing, price, structured-output,
sampling, reasoning, and output-limit fields are part of the body hash;
Authorization is injected only after admission and is represented by a separate
credential-metadata identity, never by secret bytes.

The atomic reservation and attempt-start event commit before dispatch. Unknown
dispatch consumes the full reservation; trustworthy late overrun is recorded in
full and disables the remaining slot rather than clamping spend.

The existing `commitBudgetedStart` simulation guard must not be removed or
relaxed. Actual paid work uses a separate nominal operation that requires an
unforgeable main-owned R-C authority bound to plan, campaign, fixture, packet,
slot, and OS-user ledger state while retaining the existing atomic
reserve/event commit and crash recovery. Streamed provider-reported cost and
bounded generation metadata are reconciled with the host calculation. Missing
or divergent billing consumes the full reservation and stops the campaign.

## Persisted canary record and honest UI

The append-only record binds the plan/authority/slot IDs; fixture and packet
facts; route proposal/input/resolution/lease; provider endpoint and pricing
snapshot; every attempt; reported/unreported input, cache, reasoning, visible
output, and total tokens; projected/reserved/settled cost and provenance;
common investigation and per-synthesis timing; output-validity checks;
cancellation/fallback/terminal reason; and safe result hashes.

The renderer receives only a bounded projection. It contains no raw prompt,
source, key, credential locator, endpoint URL, absolute path, raw provider
envelope, header, body, exception, or command diagnostic. The app labels schema,
citation, freshness, and coverage results as **Output validity**, not Quality.
It may show the three outputs side by side for operator inspection, but that
inspection is not blinded evaluation and produces no score.

The app may say **Development transport canary passed** only when the relevant
attempts and accounting records are terminal and structurally valid. It may not
say Best, Optimal, Faster, Slower, Cheaper, Higher quality, Production ready,
Verified, or Released. Passing proves only bounded transport, admission,
accounting, replay, and projection behavior over one public fixture.

## Required R-A deterministic proof

- Existing production Local and fake-simulation paths are unchanged when the
  development mode is absent.
- Packaged builds deny hostile environment, renderer, IPC, deep-link, database,
  command-line, second-instance, and navigation attempts to reach the slice.
- Every R-A Cloud-shaped request targets loopback, uses a synthetic credential,
  and is trapped; configured vLLM/OpenRouter request counts remain zero.
- Fixture identity, packet bounds, consent, route input, model slug, provider
  shape, request hashes, authority, cap, and state mismatches fail closed.
- The wire body hash equals the admitted serialized-request hash.
- The existing simulation-only paid-start guard remains intact; R-A has no
  actual-paid start operation, and every loopback reservation is simulation-
  scoped.
- Reservation/attempt events commit before loopback dispatch; unknown dispatch,
  overrun, cancellation, fallback, and reconciliation follow existing v2 rules.
- Fixed slots and global authority cannot be recreated by app-database or
  generated-output deletion in tests.
- Raw loopback bodies/headers/errors cannot enter persisted or renderer-safe
  output; only stable host codes survive.
- Restart/replay never redispatches, and package/Electron/CI proof records USD 0
  actual external spend.

## Status and approval rules

- **Proposed**: this plan and its append-only proposal entry exist.
- **Approved**: the owner approves only the exact R-A sentence below; the
  approval is appended, committed, reviewed, pushed, and green in Linux/macOS
  CI before R-A runtime work starts.
- **Implemented**: R-A code and USD 0 deterministic, Electron, package, review,
  and exact-SHA CI evidence exist. This grants no R-B or R-C authority.
- **Verified**: not attainable under R-A or this one-fixture canary. It requires
  a later independently evaluated multi-fixture result.
- **Released**: impossible under this plan. Packaged production Cloud remains
  gated by PR6B1-C/D and later release work.

The exact approval sentence for the next buildable phase is:

> Approve `pr6r-development-real-provider-slice-v1-plan-1` phase R-A for local
> `$0` implementation and loopback proof only, with no real credential
> resolution, configured-vLLM or OpenRouter request, off-device repository
> egress, actual budget reservation, or paid spend. Every R-A attempt and
> reservation remains simulation-scoped; actual-paid authority is absent.

Anything broader requires the later exact R-B or R-C plan and approval.

## Non-goals

- measuring task correctness or satisfying the original quality objective;
- bypassing signed credential requirements in a packaged or released app;
- real credential access, account/model validation, or provider contact in R-A;
- private-repository or arbitrary-workspace Cloud egress;
- browser, shell, patch, test, commit, push, or external-message model tools;
- autonomous general research or coding sessions;
- a 42-workload campaign, held-out quality claim, learned router, statistical
  conclusion, or USD 100 campaign authorization;
- provider failover, model aliases, paid retry, speculation, parallel paid
  calls, or background dispatch; and
- notarization, release, production activation, or general user-value claims.

## Next gate

Commit and push the A1 closure record, then require its own Linux/macOS
repository-health CI to pass and bind that result in an append-only evidence
entry. Only after that durable closure may R-A2's sealed one-use loopback
transport and simulation-accounting work begin. Require focused proof and
independent review before R-A3 begins. Stop before every R-B/R-C
real-credential, configured-provider, off-device-egress, actual-budget, or paid
boundary.

## References

- [MVP readiness](../MVP_READINESS.md)
- [Routing policy](../ROUTING_POLICY.md)
- [Architecture](../ARCHITECTURE.md)
- [PR6B0 Hybrid Simulation](PR6B0_HYBRID_SIMULATION_V1.md)
- [PR6B1 Signed Native Credential Lease](PR6B1_SIGNED_NATIVE_CREDENTIAL_LEASE_V1.md)
- [Benchmark protocol](../../benchmarks/README.md)
- [OpenRouter model page](https://openrouter.ai/deepseek/deepseek-v4-flash-0731)
- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
