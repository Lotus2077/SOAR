# PR6R Development Real-Provider Slice v1

Status: **Phase R-A Approved and in progress; R-A1 Implemented but not Verified
or Released; R-A2/R-A3 not Implemented; no operative R-B/R-C real credential,
configured-provider, off-device-egress, actual-budget, or paid-dispatch
authority**

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
| PR6R-A | `$0` contracts, app flow, loopback transport, deterministic authority/accounting/replay proof, and packaged denial | Approved and in progress; R-A1 Implemented on `4cab8a7`; R-A2 design frozen but not Implemented; R-A3 not Implemented | Granted for the exact R-A sentence below |
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
  opaque credential-metadata ID. R-A uses a dedicated byte-preserving
  `node:http` transport that has no redirect behavior; it does not use `fetch`
  or an SDK. R-A permits HTTP only for loopback tests;
  R-B/R-C require HTTPS. Admission authorizes that immutable body. R-A sends no
  Authorization header; later R-B/R-C must inject real authorization only after
  their separately approved admission. The same bytes are sent with redirects
  and retries disabled. Equality means application-request bytes, not literal
  HTTP/TLS framing;
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

## Frozen R-A2 implementation design

R-A2 is a backend-only `$0` checkpoint. It adds no renderer, preload, IPC,
three-route coordinator, configured provider, credential resolver, actual-cost
operation, or package activation. Its implementation is split into three
reviewable seams:

1. a strict synthetic Chat Completions response parser and stable outcome
   classifier;
2. a dedicated direct `node:http` loopback transport guarded by a nominal,
   synchronously consumed one-use capability; and
3. a PR6R adapter around the existing EventStore, BudgetLedger, and atomic
   AttemptUnitOfWork, including a hash-only child-session checkpoint import.

The response parser is the internal strict schema
`pr6r-loopback-chat-completion-response-v1`. The wire body must be byte-for-byte
equal to `canonicalPr6rJsonV1(parsedEnvelope)` and contain exactly this shape;
every shown field is required and every unshown field is forbidden:

```json
{
  "choices": [{
    "finish_reason": "stop",
    "index": 0,
    "message": {
      "content": "<entire raw ReviewResultV1 JSON string>",
      "role": "assistant"
    }
  }],
  "created": 0,
  "id": "<exact sealed requestId>",
  "model": "deepseek/deepseek-v4-flash-0731",
  "object": "chat.completion",
  "provider": "soar-loopback",
  "usage": {
    "completion_tokens": 0,
    "completion_tokens_details": { "reasoning_tokens": 0 },
    "prompt_tokens": 0,
    "prompt_tokens_details": { "cached_tokens": 0 },
    "total_tokens": 0
  }
}
```

The numeric zeros illustrate field positions, not fixed usage. All five usage
values are nonnegative safe integers. Prompt tokens equal the sealed estimate
and are at most 163,840; completion tokens are at most 8,192; cached tokens do
not exceed prompt; reasoning tokens do not exceed completion; and total equals
prompt plus completion. Normalization is exact:
`inputTokens=prompt_tokens`, `cacheReadTokens=cached_tokens`,
`reasoningTokens=reasoning_tokens`,
`outputTokens=completion_tokens-reasoning_tokens`, and cache writes are zero.
The empty-content maximum-value canonical envelope is 519 UTF-8 bytes with the
maximum 128-byte request ID. Embedding at most 262,144 raw ReviewResult bytes can
add at most twice that length, so
`PR6R_MAX_LOOPBACK_RESPONSE_BYTES = 519 + 2 * 262,144 = 524,807`; code derives
the constant from the frozen schema/constants and tests both numbers.

The response also requires status 200; one exact `application/json`
Content-Type; one canonical Content-Length; no Transfer-Encoding,
Content-Encoding, upgrade, informational response, or trailers. The assistant
string is parsed only through `parseRawReviewResultV1`; evidence/citation/
coverage acceptance remains deferred to R-A3. Raw bodies, headers, status text,
trailers, socket diagnostics, and exceptions are discarded after bounded
hashing and classification. Incomplete or oversized bodies receive no purported
full-response hash.

Because existing generic structured-output completion requires immediate host
evidence acceptance, the A2 generic attempt/context deliberately omits its
`structuredOutputContract` fields. The exact response-schema hash remains bound
in the checkpoint import and sealed request. A2 persists only the normalized
attempt usage/cost/terminal facts and response/result hashes, returns the parsed
ReviewResult main-only, and never writes an `accepted` parse status. A3 must add
the host evidence-acceptance and result/projection bridge before session
completion; a crash before that bridge may block the consumed slot rather than
redispatch.

The generic `inference.attempt.finished` payload gains optional bounded
`responseBodySha256` and `reviewResultSha256` fields as the only A2 durable hash
carrier. A response hash is permitted only for a complete bounded body with
`requestDisposition: "sent"`; it is absent for not-sent, unknown, incomplete,
or oversized bodies. A result hash additionally requires that response hash,
`outcome: "succeeded"`, and the strict parsed ReviewResult. The PR6R valid-
response adapter requires both hashes and binds `reviewResultSha256` to
`canonicalPr6rReviewResultSha256(parsedResult)` exactly, while error adapters
include the response hash only when the complete bounded bytes are known.
Existing events omit both and replay unchanged; reducer/projection copies them
without synthesizing them. This is a backward-compatible generic session-event
addition, not a canary payload-contract v7 change.

The transport accepts only a fully reparsed `CloudApplicationRequestV1`, a
main-created fixture-listener capability, and a genuine one-use dispatch grant.
The listener capability is minted only by the dedicated bounded test server and
privately binds its actual listening origin; no renderer, IPC, environment,
argument, deep link, database, or general factory can nominate a port. This
prevents the loopback-only URL rule from becoming arbitrary local SSRF, but does
not authenticate the same-user process that owns the host.

The dispatch grant is minted after all of these are simultaneously proven:
special-build runtime authority, live OS campaign and slot claim, exact request
and listener/slot bindings, an admitted simulation reservation, and the matching
open EventStore attempt. A private state machine moves the live slot out of
`claimed` exactly once; pre-dispatch terminalization requires a nominal
budget-denial or durable pre-reservation-cancellation receipt, while
sent/completed terminalization requires nominal transport/accounting evidence.
The cancellation receipt is minted only inside BudgetLedger `runImmediate`,
after `assertEventReconciled` and nested EventStore replay revalidate the
imported child, confirm there is no reservation or started attempt, and append
its exact `session.cancelled` terminal in the same `BEGIN IMMEDIATE`. The grant
is held in a private WeakMap and consumed before the first await or socket
construction, so parallel or repeated use can create at most one request.

The one `node:http.request` uses literal `127.0.0.1`/family 4 or `::1`/family 6,
an explicit port, fixed POST path, `agent: false`, disabled default/Host header
injection, strict HTTP parsing, no duplicate-header joining, an 8,192-byte
header bound, and a 30-second total deadline. It derives exact Host,
Content-Length, and `Connection: close` framing, adds only the sealed Accept and
Content-Type values, sends no Authorization/cookie/user-agent/encoding header,
and passes one private body buffer once to `request.end`. Connection reuse,
proxy/DNS resolution, redirects, retries, SDK serialization, speculation, and
background continuation are absent. Time, header, declared length, streamed
length, fatal UTF-8, and response bounds fail closed to stable host codes. A 3xx
is an `http_error`; no target is followed.

Build-graph proof advances from v5 to v6 only when this transport is retained.
Until A3 retains it, A2 remains backend/test-only and the shipped special build
keeps graph v5. The eventual v6 proof preserves and re-enumerates every exact v5
source/specifier/binding edge, including existing `randomUUID`, database,
filesystem, OS, path, and `better-sqlite3` use. It admits only these new edges:
named `node:http.createServer` from the bounded fixture-server source, named
`node:http.request` from the transport source, and named
`node:crypto.createHash` from the exact new hash source if needed. It rejects
namespace/default/re-export use and every other *new* importer or binding, plus
bare `http`, HTTPS, HTTP/2, net, TLS, DNS, undici, OpenAI, Electron net, global
fetch, and dynamic loaders. This is structural graph proof, not a semantic
sandbox.

The common investigation remains in one parent session. Main may mint a nominal
checkpoint-import capability only after replaying that exact parent through its
bound sequence and verifying completed investigation evidence plus the common
checkpoint, packet, semantic-message, response-schema, and provenance hashes.
The capability is consumed atomically/idempotently to create each distinct
synthesis child and its hash-only import record before OS slot claim. It contains
no prompt, source, workspace root, endpoint, or credential. Forged, cloned,
transplanted, stale-parent, or reused import capabilities fail closed.

The append-only event is `synthesis.checkpoint.imported` with payload schema
`synthesis-checkpoint-import-v1`. It binds the import ID, parent session and last
sequence, common-investigation/checkpoint/packet/message/response-schema/
provenance hashes, review snapshot/evidence/provenance identities, canonically
sorted completed required-tool names, the retained Local lease ID, and one
timestamp equal to the event timestamp. All IDs, hashes, array counts, and text
use the existing bounded primitives; no raw investigation or review material is
stored. Duplicate or second imports are invalid.

The import establishes one inherited Local active lease derived from the
child's exact simulation authority, without creating an investigation attempt.
Generic `RouterStateViewV0`, `CheckpointProposalInputV0`, and
`checkpoint-router-input-v0` remain unchanged: normal evidence readiness still
requires a real successful investigation attempt in the same session. A
development-build-only PR6R imported-evidence adapter instead replays and
validates the nominal import, then emits the ordinary bounded router-input v0
snapshot and routing decision with canonical facts
`router_evidence_source=pr6r_imported_checkpoint_v1`, the exact import ID,
`router_evidence_ready=true`, and
`router_successful_investigation_attempt_count=0`. It can do so only when the
immediately following admission and decision use the same import/checkpoint/
message/provenance hashes. Reducer validation recognizes that exact PR6R fact
set as a strict alternative; it does not loosen the generic checkpoint router or
fabricate a child attempt. Existing sessions and old events replay unchanged,
and normal builds cannot construct the adapter. This is context handoff, not
duplicated tool work or a quality claim.

The fixed saga order is:

`pure validation -> atomic child checkpoint import -> OS slot claim -> atomic
simulation reserve/start -> mint one-use grant -> consume grant -> one loopback
request -> atomic finish/accounting -> OS slot terminal`.

OS files and SQLite cannot share a transaction. R-A2 therefore chooses the
conservative no-migration rule already permitted by the plan. An OS claim with
no matching SQLite admission/accounting is **blocked and incomplete** after
restart. It is not rewritten as budget denial, success, failure, cancellation,
fallback, or a comparison; the second slot and fallback remain unavailable and
restart performs zero redispatches. Exact replay of a durable budget denial, a
pre-reservation `session.cancelled` terminal with no attempt/reservation, or a
terminal SQLite attempt may mint a reconciliation-only nominal capability that
can publish only the matching OS terminal and can never dispatch. An admitted
open attempt recovers through the existing unknown/full-reservation path before
publishing `loopback.recovery_required`. A matching pair of terminal SQLite and
OS records is observed idempotently. Missing, corrupt, conflicting, unprovable,
or deletion-split evidence blocks. A2 hardens the downstream authority boundary:
an OS terminal alone, including one created by the A1 raw recovery helper, can
no longer authorize the second cloud slot, fallback, comparison, or projection.
Those operations require a nominal cross-store-reconciled terminal capability
whose private binding was minted from exact matching SQLite terminal/accounting
and OS evidence. The raw recovery terminalizer is removed or made incapable of
producing downstream authority; wrapper convention is not accepted as proof.

This choice changes no A1 campaign/comparison/safe-projection schema, canary
store, or authority-ledger record format, so payload-contract v6 remains exact
and no pretend fingerprint bump occurs. The first future change to those
persisted contracts still requires a real ordered migration and an immediately
preceding-database compatibility test. A2's optional generic checkpoint import
is a backward-compatible append-only session-event addition and must receive an
old-event replay regression.

Budget projection uses only integer micro-USD arithmetic, the fixed synthetic
rates, actual estimated input, zero cache assumption, zero provider fee, and
the 8,192-token output ceiling. Every campaign, reservation, and attempt remains
`costScope=simulation`; `commitBudgetedStart`'s non-simulation rejection stays
unchanged. Budget denial creates no loopback request and leaves the existing
explicit retained-Local attempt for R-A3 rather than pretending that fallback
ran. Cancellation is checked again after the asynchronous OS claim and before
the synchronous reservation; a cancellation there atomically terminates the
child in SQLite with `session.cancelled`, mints the nominal cancellation receipt,
and only then writes the OS `cancelled/not_sent` terminal, with no reservation.
A crash between those terminal writes is reconciliation-only and cannot
dispatch or unlock downstream authority. After an admitted start, grant mint
and consumption occur in the same synchronous turn with no cancellation gap. A
crash or later cancellation is conservatively `unknown` and consumes the full
reservation. A response observed from the server is `sent`; valid usage settles
from the host pricing snapshot without trusting a provider cost field.

Focused acceptance requires exact captured method/path/headers/body/hash;
IPv4/IPv6 success; forged, cloned, mismatched, stale, concurrent, and reused
grant denial; zero requests for budget denial and pre-reservation cancellation;
no redirect or retry; stable classifications for HTTP, oversize, malformed
JSON/UTF-8, model/protocol/usage/result errors, timeout, socket ambiguity, and
post-dispatch cancellation; atomic start-before-server observation; exact
host-priced settlement; injected crash tests at every saga boundary; durable
close/reopen replay with zero redispatch; no raw transport material in SQLite or
safe output; unchanged normal Local/Fake simulation behavior; source/build
proof of zero configured-provider construction; and focused independent
security, accounting, recovery, and maintainability review.
Checkpoint proof additionally rejects forged, transplanted, reused, stale-parent,
and post-parent-mutation imports and covers crash after child import but before
OS claim without consuming the slot. Recovery proof additionally injects crashes
after the SQLite cancellation and after its OS terminal, and proves that an
OS-only raw recovery terminal, deleted SQLite evidence, or mismatched terminal
cannot authorize the second slot, fallback, comparison, or projection.

## Next gate

Commit and push the exact A1-closure evidence plus this frozen A2 design, then
require their repository-health Linux/macOS CI to pass. Only after that durable
checkpoint may the exact R-A2 implementation above begin. Require focused proof
and independent review before R-A3 begins. Stop before every R-B/R-C real-
credential, configured-provider, off-device-egress, actual-budget, or paid
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
