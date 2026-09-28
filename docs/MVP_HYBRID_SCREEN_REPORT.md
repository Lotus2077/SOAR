# First coding MVP: hybrid screen result

**2026-09-08 — MVP implemented; original live comparison complete; not Released.**

The app can solve a scoped public Python task in an isolated container, show its
patch and checks, preserve interrupted work, and export the exact patch. The
first hybrid policy failed its advancement test: every local investigation fell
back, none forwarded source evidence, and hybrid cost more than cloud with
simple host preparation. Keep the cloud workflow available. Hybrid remains
experimental; a bounded handoff repair is implemented separately and has no live
quality or savings result yet.

## What actually ran

Twelve agent-authored maintenance/features on three pinned public repositories,
once under each of three policies, produced **36 real episodes**:

- **C, Cloud:** cloud inspection, editing and checking.
- **D, Prepared cloud:** the same cloud loop with deterministic file inventory.
- **H, Hybrid v1:** D plus at most eight read-only local model calls, then a fresh
  cloud loop. The original policy required the local scout to submit evidence.

All arms used direct OpenAI `gpt-5.6-sol`, medium reasoning, standard service,
configured input/output rates of USD 4/20 per million, 8192 output tokens,
256000 input bytes, and no explicit cache breakpoints. Each episode shared a
USD 3, 600-second, 40-cloud-step ceiling. H allowed at most 300 seconds of local
work inside that deadline, with 2048 output tokens and 64000 input bytes per
local request. Concurrency was one. All six arm orders appeared twice using
seed 20260908; no paid episode was retried or replaced.

The owner-supplied endpoint served the alias `RM-01 VLM`; metadata reported
vLLM, version 0.28.0 and a 262144-token context limit. Underlying weights, GPU,
precision and quantization were not verified. The Sol identifier is undated.
Neither model identity is an immutable weight-level reproduction guarantee.

The public revisions were boltons `78ec69cac4465c57bb7debafcf3181d7d1ceaa76`,
more-itertools `b656ecc0a64e328549a9858af1c4b609f9922b07`, and cachetools
`4500e3d04288738d25acbb4973eb3c3e1bf41db9`.
Before dispatch, all twelve unmodified baselines failed their expected new
behavior and all twelve references passed: 57 reference test methods and all
visible commands, plus 17 baseline compatibility methods. Four oracle issues
were corrected before any model exposure; weaker preproof artifacts remain
preserved. The earlier schedule and signed-integer development tasks were
excluded. These are internal feature tasks, not known upstream issues or an
external human-curated held-out benchmark.

## Complete result

Every episode submitted a patch and passed visible and frozen independent
checks. Two reviewers then examined all 36 patches using neutral candidate IDs,
without arm, cost or latency information. Their final judgments agree after one
explicit TTL adjudication. “Review acceptable” is a provisional code review
result, not proof that no other bug exists and not an owner Keep decision.

| Measure | C: Cloud | D: Prepared cloud | H: Hybrid v1 |
| --- | ---: | ---: | ---: |
| Assigned / evaluated | 12 / 12 | 12 / 12 | 12 / 12 |
| Frozen independent checks pass | 12 | 12 | 12 |
| Reviewed / unreviewed / uncertain | 12 / 0 / 0 | 12 / 0 / 0 | 12 / 0 / 0 |
| Review acceptable / assigned | 11 / 12 | 10 / 12 | 10 / 12 |
| Review rejected | 1 | 2 | 2 |
| Accounted API cost | $4.426520 | $3.846788 | $4.036588 |
| API cost per review-acceptable patch | $0.402411 | $0.384679 | $0.403659 |
| Median episode time | 133.922 s | 120.796 s | 136.109 s |
| Maximum episode time | 220.693 s | 185.987 s | 208.046 s |
| Local fallbacks | — | — | 12 / 12 |
| Owner decisions | 0 | 0 | 0 |

Every assigned patch was reviewed, so acceptable/assigned and
acceptable/reviewed use the same denominator. All cost numerators include rejected patches. The screen used 310 settled model
requests, **USD 12.309896**, with zero unresolved screen exposure. These are
ledger-accounted usage fees at configured prices, not invoice reconciliation.
There were no incomplete blocks, screen infrastructure failures or manual solver
interventions. Earlier development adds USD 0.652425 accounted and USD 0.069440
unresolved: cumulative known USD 12.962321, maximum USD 13.031761. Earlier
failures remain in the [pilot report](MVP_CODING_PILOT_REPORT.md).

H cost **4.93% more than D**, with the same review-acceptable count. The median
of matched task latency differences was **H minus D = +10.390 seconds**, with H
slower on 9/12 tasks. Against C, H's raw fee was 8.81% lower, but it produced one
fewer review-acceptable patch and cost 0.31% more per acceptable patch. Its paired
median delay was +0.663 seconds, slower on 7/12. These paired differences are
computed task by task, not by subtracting the arm medians.

| Task | C review | D review | H review |
| --- | --- | --- | --- |
| Duration accumulation | Acceptable | Acceptable | Acceptable |
| TTL touch | Reject | Reject | Reject |
| Split attachment | Acceptable | Acceptable | Acceptable |
| Chunk boundaries | Acceptable | Acceptable | Acceptable |
| Consecutive step | Acceptable | Acceptable | Acceptable |
| Frozen key | Acceptable | Acceptable | Acceptable |
| Map key filter | Acceptable | Acceptable | Acceptable |
| Cache peek | Acceptable | Acceptable | Acceptable |
| Replace factory | Acceptable | Acceptable | Acceptable |
| Gzip modification time | Acceptable | Acceptable | Acceptable |
| Cache resize | Acceptable | Acceptable | Acceptable |
| Window step | Acceptable | Reject | Reject |

The five review rejections expose acceptance gaps. Two TTL implementations
compare deadline objects beyond the documented clock contract; the third breaks
expiration ordering after a supported datetime clock moves backward. D/H window
implementations pass an otherwise valid large positive index value to `islice`,
which rejects values above its platform limit. Independent network-disabled
Docker counterexamples reproduced these defects. The original oracle passes
were retained, with review-discovered false accepts reported separately. The
raw CLI's automated false-accept counter does not include this later review.

## Why local work did not help

All twelve persisted H outcomes are fallback, with **zero forwarded source
bytes**. Local activity totaled 21 settled requests and 54.852 seconds, with
47144 input and 2127 output tokens. Output includes 575 reasoning tokens; input
includes 17600 cache-read tokens. These subsets must not be added again.

Ten runs made one request and executed no local tool. One made three requests
without a tool. The cache-peek run made eight requests, executed an inventory
and six successful source reads, and gathered 43758 bytes. Its next-call limit
and the submission-only code explain why the useful reads were discarded; the
step-limit diagnosis is inferred from that sequence. The other exact finish
causes were not persisted and cannot be reconstructed confidently. Two small
synthetic protocol probes returned a valid inventory action, which establishes
only narrow format compatibility.

A fallback-only H episode ultimately gives cloud the same host inventory as D.
The first admitted cloud-input hash matched D exactly on all twelve tasks.
Consequently, fee variation against either control is no evidence that local
reasoning reduced downstream work. This is a failure of the tested serving,
action-format and handoff combination, not a measured verdict on unspecified
local weights or on all hybrid designs.

## The owner's approximately $3,500 device

Ownership removes a rental invoice and the owner attests zero local token fees.
It does not establish zero power or allocated hardware cost. At 36 months and
80 utilized hours per month, capital alone is **$1.215/hour**; applying that to
the observed 54.852 seconds adds about **$0.0185**. Across 12/24/36 months and
40/80/160 used hours per month, capital-only rates range from $0.608 to $7.292
per hour. Lifetime and utilization are scenarios, not measurements; electricity
and idle-time allocation remain unknown.

There is **no supported payback estimate**. Against D, hybrid already has
negative API savings before hardware cost. Against C, it fails the observed
review-quality count and has no demonstrated local contribution. The raw
report's $25.59/hour break-even against C is arithmetic under automated
acceptance only; it is not a review-qualified investment or advancement gate.
No statistical quality-parity claim follows from twelve selected tasks and one
sample per arm, especially for the intended heavy agentic workload.

## What changed after the screen

The original report, ledger, configuration and fourteen matching runtime hashes
were preserved before three bounded repairs:

1. Settled empty versus truncated local output now has distinct receipt/UI
   diagnostics; old generic failures honestly say their exact cause was not
   recorded. Raw provider responses are not retained.
2. A cleared/zero budget survives readiness refresh, and future admission text
   shows the configured campaign ceiling. The original screen correctly
   enforced USD 180 despite stale human-readable USD 70 events; those old events
   remain unchanged.
3. **Partial handoff v2** forwards existing bounded host source excerpts only
   when the scout hits its step limit. It labels the investigation incomplete,
   makes no ninth local call, and preserves cancellation, unsettled-request and
   deadline stops. No extra model diagnosis or expanded evidence budget is added.

A real Docker regression also exposed a cancellation arriving while the worker
waited for request admission being mislabeled as an admission mismatch. The
worker now rechecks cancellation immediately after that wait, before examining
the response. The focused regression confirms cancellation after a source read
makes no further HTTP request and forwards no partial evidence.

These repairs are separate from the live screen. They do not retroactively
improve v1, identify its missing failure causes, or establish live v2 savings.
The next experiment requires a new freeze and new tasks; the optional USD 150
extension has not been approved or spent. No additional paid v2 run was started.

## Verification and usable boundary

The post-screen repository gate passed both TypeScript checks, native credential
proof, 112 test files / 1410 tests (4 files / 7 tests skipped), and both build
flavors. All 41 Python worker/evaluator tests passed against real Docker with
no skips after the cancellation correction. Three built Electron tests passed
again in 22.1 seconds: patch/export/restart, cancellation with cleanup, and
unfinished-work recovery. All three public source revisions remained clean;
the final check found zero active coding runs and zero owned worker containers.
Earlier sandbox failures and the reproduced admission race remain in the
build log.
These are mechanics tests using fixtures, not additional paid model results.

The actual app was reopened against the completed screen ledger. Its real H
cache-peek history showed eight local and six cloud receipts, the original
fallback explanation, per-phase fees, checks and diff. Export produced 7918
bytes with SHA-256
`c1964cc86eca498dc56c3b721ac759c3647ab8ee0e08d783404456ce90cf509f`,
matching the immutable submitted patch. No owner decision was fabricated.
Source checkouts remain unchanged; generated patches require review before use.

The MVP is a local working implementation, not a committed release, installer,
auto-apply feature or learned router. Use the [quickstart](MVP_CODING_QUICKSTART.md)
for the cloud workflow; retain H as experimental. The next product evidence is
an owner using and reviewing a real patch. The next hybrid evidence is a fresh,
frozen comparison that actually forwards useful local work and improves total
cost at an acceptable quality level. Neither is replaced by more infrastructure.

Reproduction: see the [comparison guide](MVP_COMPARISON_SCREEN.md). Original
configuration SHA-256:
`ac749dc47d2e8293f0a8d0fb457208bbb9bcf41047e251f82aa5feb19a5d5788`.
Original final report SHA-256:
`7d43afc67b0e464e8307713c5354647afd048594793bb3950a9a5440309de211`.
Private destinations, manifests, evaluator gold, generated patches and databases
remain ignored local evidence, outside this tracked report.
