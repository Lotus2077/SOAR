# General-task consultation milestone

Status: **Implemented and verified with controlled desktop responses; not
released or quality-calibrated.** September 14, 2026 local date. This is an optional route in the
existing general-task session, with no new task-family runner or classifier.

## Delivered behavior

A task starts in Local only by default. With an explicitly configured session
consultant, the user may choose Ask before consulting. The local coordinator can
request one question and selected checkpoint text. That action freezes the packet
and pauses; it does not send to the consultant. Goal-only questions are supported.

The desktop exposes the actual packet, selected and omitted paths, inherited
context identity, checkpoint, destination/account/credential version, model,
prices, output limit, maximum reservation and expiry. Packet text is inert.
Approval requires an exact preview, a released worker claim, the unchanged task
and profile, and remaining allowance. Approve records permission; Resume performs
the next action. Decline and pre-dispatch revocation can return to local work.
Historical packets remain readable after a decision or expiry.

Every consultant destination requires a one-use priced grant, including public
contexts. Packet, context, destination, proposal, price profile and maximum charge
must still match in the transaction that consumes the grant and reserves fees.
Proposal reuse is rejected across jobs and database reopen. A model cannot select
a destination, price, credential, new budget or automatic fallback.

The consultant receives one tool-free text request. The host validates the served
model, final text, token counts and charge before settlement, then stores the
response with its receipt and hash before local continuation. Advice is replayed
as untrusted tool evidence. It grants no authority and is not independent artifact
acceptance. Later local checkpoints do not invalidate already settled advice.

## Limits and recovery

- One proposal per task; at most eight selected text files, 32 KiB per file and
  64 KiB total, with a 96 KiB request-body ceiling. Invalid UTF-8 and oversized
  selections fail without silent truncation. Omitted contents are not included;
  their paths and checkpoint metadata are visible in the exact packet.
- The same twenty model calls, thirty tool actions, forty broker requests and
  fifteen-minute task deadline remain. Permission waiting uses that deadline.
  Consultation consumes one model attempt and one broker request; the proposal
  requires space for consultation and a following local action.
- A committed or unknown request, or an attempted consultation without its
  durable response, cannot be replayed. Recorded reservations survive restart.
  A late revoke requests cancellation but cannot recall disclosed data.
- Decline/revoke can still be recorded after a consultant profile is removed.
  Resuming the frozen job continues to require its original configuration;
  removal or key/price/model changes never silently select a replacement.
- Existing local-only records keep their prior session identities and zero-fee
  policy. The new optional task variant binds its profile and fee allowance.

## Session setup

The new `SOAR_GENERAL_CONSULTANT_*` fields in `.env.example` document the explicit
host configuration. A model, full endpoint, account, credential version, session
key, token prices, output limit, timeout and task fee cap are required. There is
no legacy-key lookup or automatic provider activation. The renderer receives no
key. Key rotation changes the opaque profile identity even if its version was
not advanced.

Production profiles require HTTPS. Literal loopback HTTP is admitted only by the
explicit test fixture setting together with `NODE_ENV=test`. This milestone uses
only self-authored synthetic data and controlled receivers. The profile remains
synthetic-only; it does not qualify real-private inference or the advisory local
privacy filter. A real provider still needs its compatible model/settings,
verified current prices and exact packet/fee approval.

## Verification state

The consolidated focused batch passed **270 tests across thirteen files**:
broker and exact grants, text response/billing validation, manager and runner
recovery, unchanged budget behavior, session and public-retrieval regressions,
checkpoint integrity, desktop controller/configuration/IPC and runtime identity.
Both application TypeScript checks pass. Independent source review found no
material blocker in the permission, accounting and continuation path.

The normal production build and **eight actual desktop scenarios pass** on the
corrected build: four consultation cases and four existing local/public-source
regressions. The tests use normal Electron launch, real IPC, controlled localhost
coordinator/consultant HTTP and the same installed offline Docker image. No runner
substitution bypasses the production path. The complete eight-case invocation
took 50.016 seconds; no case was skipped or marked flaky.

| Consultation case | Model allowance used | Tool actions | Consultant requests | Result |
| --- | ---: | ---: | ---: | --- |
| Approve, restart pending, restart after saved advice | 4 | 3 | 1 | Exact packet sent once; advice and artifact/export survive restart |
| Decline | 3 | 3 | 0 | Same task continues locally and exports |
| Revoke before dispatch | 3 | 3 | 0 | Grant revoked unused; local continuation and export |
| Tool-bearing consultant response | 2 | 1 | 1 | Unknown outcome retains reservation; no next local call or replay after restart |

The first row uses three scripted local calls plus one consultant. Its simulated
settled fee is 64 microdollars, independently recomputed from 32 input tokens at
one microdollar each and 16 output tokens at two each. Tests join the exact wire
body to the preview, one-use grant, receipt, response hash, saved advice bytes and
unchanged task start/phase. Advice remains untrusted and independent acceptance
stays `not_evaluated`. Cleanup checks confirm released claims and no owned
containers. The approval screen was also visually inspected.

The complete corrected batch contains twenty local protocol requests, two
consultant requests and four public GETs. The two expected unknown outcomes are
the deliberately invalid consultant response and the existing public 503 fixture.
The latter verifies no-replay behavior; it does not supply source evidence. These
are protocol counts, not real inference usage.

An independent read-only audit reconciled all eight retained databases: twenty-four
settled receipts, two expected unknown receipts, 64 microdollars of simulated
settled fees and 9,887 microdollars still reserved for the invalid consultant
response. It verified exact request/grant/response joins, restart counts, released
claims and all 178 admitted source bindings without making new runtime requests.
The sealed audit receipt SHA-256 is
`dff7d0de30cde30c7e2acda4d2094791e2ceded0f49f51f84800ef922798cb31`.

The original four consultation cases all failed before task creation because the
selector's implicit accessible name included its help text. Each had zero jobs or
model requests and confirmed cleanup. The minimal label association was corrected,
the app rebuilt, and the unchanged strict tests passed in the separately admitted
batch above. Four existing regressions had also passed on the original build;
that earlier result is separate and not added to the current eight-case count.
Both source snapshots and failed attempts remain retained.

Two mocked React invocations timed out during worker initialization with zero
assertions. That test gap remains explicit despite the successful actual desktop
flow; its underlying environment cause has not been established. The first image
inspect used an unsafe missing-field template, then the existing controller's
nil-safe format confirmed the exact Linux image with no declared volumes. No
image was pulled or changed.

The executed corrected runtime identity is
`48a73d725d1899ff92402342b79888d7f2f92acb363e09ff8f69d53abf975528`.
Its 178-file source/build/fixture admission manifest is
`1943b2b95cd1ba51383cd94ccd087ac508ff718b988ff6cf84a49229dc32d261`.

The controlled test amounts are simulated fees, not API spending. No real model,
paid provider or new quality experiment has run in this milestone. The accepted
audit/deck and rejected research/website results remain unchanged. Consultation
selection quality, useful repairs, savings, actual private-data support and
release readiness are unproven.

The next useful milestone is a bounded real-task consultation with the exact
provider, current price and packet admitted first. Preserve the local draft and
independently assess the result. A previously exposed failed website or research
task can diagnose repair behavior, but cannot be relabeled a held-out quality or
savings experiment. The full first-MVP goal remains open.

References: [approved consultation plan](plans/MVP_GENERAL_TASK_CONSULTATION_V1.md),
[completion audit](MVP_COMPLETION_AUDIT.md),
[preserved artifact results](MVP_DESKTOP_ARTIFACT_DELIVERY_REPORT.md).

## Follow-up: provider preparation

The [session setup guide](MVP_GENERAL_CONSULTANT_SETUP.md) now includes a safe
`pnpm check:general-consultant` command and an explicit proposed OpenAI profile.
It reports field names and fixed reasons without reading credential stores or
sending requests. Local configuration validity is separate from provider access.

Subsequent code adds optional explicit default-tier binding and persists validated
model/token/tier inputs for fee recomputation after restart. Newly created
proposals require that evidence; historical proposals remain readable without
inventing missing usage. These changes do not relabel the earlier eight-case
runtime. See the separately recorded
[real-trial preparation](plans/MVP_GENERAL_CONSULTATION_REAL_TRIAL_V1.md) for current
verification and unresolved execution gates.
