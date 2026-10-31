# Flash-Next qualification continuation v1

Status: **Proposed; next decision only; no execution authority**.
Prepared 2026-11-01 (Asia/Shanghai).

## Preserved evidence

The original qualification remains failed: Q01–Q12 passed; Q13 remains UNKNOWN
with `response_or_usage_invalid`, and its missing response/cause is unresolved.
Its original driver, receipts, artifacts and consumed authority remain unchanged.
The separately owner-approved diagnostic dispatched once, settled at USD 0 and
passed native response validation and exact prompt-usage parity. Both recorded
heading predicates remain false: the new response uses the exact section titles
as plain paragraphs. Those recorded predicate failures must stay intact.
A new response cannot establish what the unseen original Q13 contained.

## Proposed semantic adjudication of the new diagnostic

The production synthesis prompt and frozen fixture design require Markdown with
two sections titled exactly “Conflicting evidence” and “Unanswered questions”;
they do not explicitly require formal Markdown heading syntax. Ask the owner to
adjudicate the **new diagnostic only** against that literal requirement:

- Each exact title must occupy a complete standalone top-level paragraph **or**
  an actual top-level Markdown heading. Both named sections must be present.
- Fenced code, quoted/blockquote examples and titles embedded within other text
  do not count as sections. Matching words anywhere in a response is insufficient.
- Retain the same toy answer, host-known E citations, packet-only evidence,
  no reasoning leakage, model identity, usage and output-limit requirements.

This proposes a named interpretation of section structure, not quality acceptance
or retroactive relaxation of the failed Q13. Any owner decision and its evidence
must be appended separately. The original and diagnostic predicate results stay
intact; no corrected automatic checker is claimed implemented by this memo.

## Proposed ten-request allocation

Conditional on acceptance of the new diagnostic as synthesis compatibility
evidence, propose this ordered allocation under unchanged model, role, serving,
source, tokenizer/template and shared-admission pins:

| Original slots | Remaining proof | Requests | Output reserved |
| --- | --- | ---: | ---: |
| Q14 | Independently loaded local critic and production repair packet | 1 | 16,384 |
| Q15–Q18 | Supported, partial, unsupported and contradicted judge cases | 4 | 1,024 |
| Q19 | Large allowed prompt, full Heavy output reservation | 1 | 16,384 |
| Q20–Q21 | In-flight cancellation, idle return and fresh-job recovery | 2 | 16,512 |
| Q23–Q24 | Thinking-off raw JSON and final SSE liveness | 2 | 384 |
| **Total** | | **10** | **50,688** |

Explicitly omit Q22's same-arithmetic-prompt JSON/SSE parity comparison. Q02
already demonstrated thinking-on JSON; Q05 demonstrated a thinking-on SSE final
answer with separated reasoning, and Q11 demonstrated thinking-on SSE planning.
The tradeoff is losing the identical-prompt transport comparison, while retaining
both response modes and all remaining role/context/cancellation checks. This is
a proposed fixture-allocation amendment, not permission to reuse unused slots.

| Cumulative allocation | Requests | Reserved output | Prompt envelopes |
| --- | ---: | ---: | ---: |
| Original thirteen plus the one diagnostic | 14 | 80,128 | 323,712 |
| Proposed ten remaining | 10 | 50,688 | 272,384 |
| **Combined / original ceiling** | **24 / 24** | **130,816 / 131,072** | **596,096 / 1,000,000** |

All failed/cancelled attempts retain their full reservation; short actual outputs
cannot fund replacements. The combined output headroom is only 256 tokens.
Keeping all eleven original remaining cases instead would require 25 requests
and 132,864 reserved output tokens: amendments of +1 request and +1,792 tokens.
No such increase is proposed here. Declared inference fee remains USD 0.

## Time, stops and unchanged gates

Carry the original start, 2026-10-31 21:05:27.546 UTC, into every later accounting
record. The unchanged 90-minute hard stop is **2026-10-31 22:35:27.546 UTC**.
The broader owner availability cutoff does not extend it. The ten row deadlines
sum to 21m15s; three metadata gates of at most five minutes and ten minutes for
orchestration give a conservative 46m15s remainder. Preparation and review time
also consume the original clock. Clamp requests, helpers and waits to remaining
time; no silent new 90-minute clock or deadline extension is permitted.

Require fresh idle/ownership/availability checks, exact actual-body token proofs,
serial dispatch, durable aggregate counters and stop-on-first-unexpected-failure.
Q20 retains its actual planned cancellation receipt classification, including
UNKNOWN/cancelled where produced, with no replay; prove idle before fresh-job Q21.
No automatic retries, replacements, service tuning or fresh-task/gold access.

This memo supplies neither a runnable continuation operator nor launch authority.
The existing batch runner starts at Q01 with a new clock, so it must not be used
unchanged. A separate operator with aggregate accounting, a one-shot claim and
the original absolute deadline needs implementation and offline review. If that
work and bounded execution no longer fit, stop; extending or resetting the clock
requires an explicit amendment. A separately recorded decision and reviewed,
frozen allocation are required before any further generation. Qualification acceptance remains pending. All
three H4 loops, their embedded split calibration and subsequent H5 gates remain
unchanged; this proposal starts none of them.

References: [migration plan, section 4](PHASE4_FLASH_NEXT_MIGRATION_V1.md#4-bounded-local-compatibility-qualification),
BL-20261031-2114-flash-qualification-stopped,
BL-20261031-2120-q13-diagnostic-prepared,
BL-20261031-2137-q13-diagnostic-approved,
BL-20261031-2141-q13-diagnostic-result.
