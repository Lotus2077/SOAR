# Phase 4 writer throughput proposal v1

Status: **Proposed**. Documentation only; no implementation, new request allocation,
service change, H4 acceptance or H5 launch follows from this document.

## Problem and evidence

The latest local-research H4 attempt reached its generation deadline without the
required output artifacts. It recorded ninety settled requests and one unresolved
request; later stages and H5 did not run. Existing decode measurements were about
**19.94 tokens/second**, or approximately twenty tokens/second. The settled
responses generated **100,602 output tokens**, equivalent to about **84.1 minutes
of decoding alone** at that rate, before prefill, tools and host checks.

The writer's fifty-three completed responses account for 77,083 output tokens,
16,176 tool-argument characters (also 16,176 UTF-8 bytes), and 193 assistant-content
characters. Existing normalized events contain no exact thinking-token split or
retained reasoning-byte total. Characters and bytes are not tokens and cannot be
subtracted from output-token usage to invent that split. Excessive total generation
is established; the exact reasoning share and the quality of a thinking-off writer
are not. A longer deadline or another wording change is not the proposed remedy.

The pinned HF template supports per-request `enable_thinking=false`. Its
`preserve_thinking=false` setting controls replay of old reasoning, not generation
of new reasoning. The template recognizes qualitative low/medium/xhigh effort;
the current host exposes disabled/medium and a total output-token ceiling. No
separately qualified numeric thinking-token budget is established. Qualification
Q04 and Q05 were both thinking-on SSE history turns, not an on/off pair. Existing
short thinking-off JSON/cache/liveness checks do not prove multi-turn writing or
artifact quality. The accepted serving profile already has MTP disabled.

## One combined owner decision

The requested decision would approve:

1. Implement and verify the exact named writer policy
   `flash-next-writer-thinking-off-v1`, including its narrow admission, repair and
   identity bindings described below.
2. Grant **one new, zero-fee pilot**, with at most **twelve model requests, twelve
   model-directed tool actions and twenty minutes**, one attempt and zero
   replacements. This is a new request grant beyond the fully spent twenty-four
   compatibility requests and consumed H4 allocations; it cannot be inferred from
   earlier approvals or unused fees.
3. Conditional on pilot success, independent CPU/source/package review, required
   successful CI, new exact runtime/role/authority pins and current serving/device
   readiness, grant **exactly three fresh H4 loops** under this same named policy:
   local research, deck, then split. Stop on the first failure; zero replacements.
4. Continue into the existing conditional H5 scope only after all H4 mechanics and
   usable split semantics are actually accepted. No second generic approval is
   needed if these exact conditions pass.

All prior attempts, consumed claims, failures and unresolved receipts remain
recorded. Close and reconcile the failed run before accepting new preparation or
execution evidence. A pilot failure ends this proposed continuation; it grants no
alternative profile, retry or replacement allocation.

## Pilot controls and success

Reuse exactly one existing completed H4 research packet through the unchanged
seed/provenance/integrity loader. Run the ordinary host-checked seeded writer
phase with `GeneralAgentRunner`, rather than the full session path that adds
post-submission entailment requests. This pilot runs no research stage, planner,
synthesiser, critic or judge model calls and provides **no H4 credit**. Normal
H4/H5 research, criticism, selection and entailment remain required afterward.

The reviewed pilot admission must enforce:

| Control | Exact value |
| --- | --- |
| Model requests, including failed or unknown requests | At most 12 total committed requests |
| Model-directed tool actions | At most 12 |
| Generation and host-check deadline | 1,200,000 ms |
| Attempts / replacements | 1 / 0 |
| Per-request output ceiling | 16,384 tokens |
| Provider fees / admitted destinations | USD 0 / the pinned local model only |
| Automatic transport retransmission or application retry | None |

Use runner contract limits of twelve model calls, twelve tool calls and twenty
minutes, plus broker policy `maxRequests=12,maxFeeMicrousd=0` and the shared
abort/deadline. Disable pilot destination recoverability; failure or unknown status
consumes its request and stops without replacement. The thirteenth request or tool
must be refused before execution. Host checks use their existing implementation.

Success requires all substantive required artifacts and claims to pass the existing
host checks within twenty minutes, followed by root content review for supported
findings, correct citations and honest limitations. The frozen final work must use
**at most 20,000 provider-reported completed output tokens**. Root review permits no
additional model calls or edits. File presence, placeholders or unsupported claims
fail the pilot.

The 20,000-token value is a **success threshold, not an enforced cumulative token
cap**. Twelve per-request ceilings reserve up to 196,608 tokens; request/tool/time
limits are the actual hard bounds. Report output usage, elapsed time, first
substantive-draft time, host-check results and review limitations. Use existing
metadata; do not retain raw reasoning. Keep the failed thinking-on run as a
historical reference, without claiming this one-sided feasibility check establishes
causality or a comparative quality distribution.

## Exact policy and source amendments

Keep the budget profile `heavy`. Add a separately authority-bound writer-policy
identifier; do not substitute Standard, whose output limits, timeouts and task
budgets differ. Derive the local private writer configuration from the unchanged
Heavy base by changing only `thinking` to `disabled`. The existing request builder
then sends `enable_thinking:false,preserve_thinking:false` and omits
`reasoning_effort`. Inherited pinned generation defaults remain temperature 1,
top-p .95 and top-k 20. Keep the per-call output ceiling, tools, draft-first prompt,
artifact/claims/OOXML checks, packet rules and selection/repair limits unchanged.

| Actual role ID | Policy under this proposal |
| --- | --- |
| `writer`, `repair_writer` | Named thinking-off policy; 16,384 output tokens |
| `reader_index`, `reader_extract` | Existing thinking-off settings; 1,536 / 2,048 tokens |
| `planner`, `synthesiser` | Existing medium settings; 8,192 tokens; existing Claude roles in split |
| `critic` | Separately loaded existing Heavy medium setting; 16,384 tokens |
| `judge` | Existing thinking-off setting; 256 tokens |

The all-cloud Claude writer retains its supported medium/adaptive setting. Any
later H5 comparison must disclose the amended local reasoning policy while keeping
independent blind scoring.

The implementation requires these explicit, reviewed changes:

- In the local-screen driver, retain the base local model for research and derive
  only the private writer model. Supply an explicit base-model judge factory for
  local sessions too, so the writer change cannot alter the fallback judge identity.
  Record the named policy and actual writer/base identities in the freeze.
- Retain the existing Heavy assertions in loop and seeded admission. Add exact
  policy/authority equality checks and a separately bounded pilot path; do not let a
  pilot result enter the H4/H5 operator as a passing loop.
- Version the strict repair source binding to include the writer policy and actual
  identity, and reject mismatched repair sources. Preserve historical version-one
  records, the same packet/seed/draft checks and the independent Heavy critic.
- Replace the current private bridge's all-eight-roles-unchanged shortcut with an
  explicit owner-approved two-role amendment. Pin actual writer/repair identities,
  preserve the other six request settings, and bind new runtime/protocol/role/
  authority references. Retain serving, tokenizer/helper and physical-mapping pins.

Before dispatch, focused CPU review must verify actual writer request bodies in
both prompt layouts, isolation of research/critic/judge settings, no automatic
pilot stage/judge calls, hard request/tool/deadline enforcement, unchanged host
checks and repair-policy mismatch rejection. Required CI and current readiness
must pass on the exact implementation. CPU evidence does not prove live quality.

## Retained boundaries

The pilot is zero-fee. The single all-history H4 split ceiling remains **USD .60**.
H5 retains **eighteen rows, USD 21.60 total, USD 3 per cloud row and USD .60 per
split row**, along with isolation and independent blind scoring. Normal H4/H5
limits and all failed historical evidence remain intact.

The existing new-start cutoff remains **November 2, 2026, 10:00 UTC
(18:00 Asia/Shanghai)**. No MTP enablement, service restart, model/serving change,
replacement loop or window extension is included. If the conditions cannot be met
within that window, retain the hold; no extension is inferred.

References: [writer-completion policy](PHASE4_WRITER_COMPLETION_V1.md),
[Flash-Next migration](PHASE4_FLASH_NEXT_MIGRATION_V1.md),
[qualification continuation](PHASE4_FLASH_NEXT_QUALIFICATION_CONTINUATION_V1.md),
and the append-only build log. Supporting private records contain aggregate
metadata and hashes; no raw traces, private endpoints, local paths, fresh H5 task
content or evaluator gold belong in this public plan.
