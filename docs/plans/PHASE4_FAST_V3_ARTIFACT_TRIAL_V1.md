# Fast-v3 serving qualification and artifact trial

Status: **Proposed; not approved or implemented.** One concrete owner decision is
required for the build, serving change, new request allocation and conditional
continuation below. The current qualified service stays running during preparation.
The [writer-thinking-off proposal](PHASE4_WRITER_THROUGHPUT_V1.md) remains a separate
unapproved alternative; this trial retains Heavy thinking for writer and repair.

## Exact candidate

Use [NemoClaw-Thor dd07dcc](https://github.com/pastoriomarco/NemoClaw-Thor/blob/dd07dcc2f5650916e18e2c706144c6fd1f8bf13c/serving/docs/QWEN38-FLASH-NEXT-FAST-THOR.md)
and the retained third-stage image
`sha256:10d0df20a140d12e987013b12da289e2dec0bcb1db4a14f2491d75c0c7ae5d6c`.
Build only its fourth fast-v3 layer from checksum-verified local sources, with
networking and pulls disabled. Review the adapted build context before execution.
Pin the resulting image and actual package/patch sources; do not upgrade the base.

| Setting | Proposed value |
| --- | --- |
| Target checkpoint | RadixArk revision `7b719225242aacd3dbd3f9407468c2ee9a9d2594`, with exactly 300 dense side-layer matrices converted to blockwise FP8 in four shards |
| Retained target components | Native NVFP4 experts, PLE, vision, embedded MTP and full target verification vocabulary |
| Fast-v3 additions | Refreshed deterministic QSA top-k at `e0ef69d4f5575dad00d34e05479eaf4c6547bace`, restricted 47,149-ID draft vocabulary, PLE prefetch and XGrammar termination patch |
| Decoding | MTP=3; fused SM110a CUDA GDN; BF16 recurrent state and KV |
| Context / scheduler | 262,144 tokens / three slots |
| KV allocation | Fixed 12 GiB; deliberate override of the published automatic pool |
| Compilation / sampling | Retain PIECEWISE CUDA graphs, AOT, FlashInfer sampling and existing Heavy settings |
| Application roles | Existing writer/repair medium 16,384; index off 1,536; extraction off 2,048; planner/synthesis medium 8,192; critic medium 16,384; judge off 256 |

Retain current telemetry/offline controls, native tool/reasoning parsers, prompt-token
details, thinking/preservation defaults and scoped startup diagnostics. Pin the exact
argv/environment before launch. This is `full-fast-v3-fixed12g-v1`, not a promise of
the published 46.7 TPS or three full contexts. Startup must prove capacity/admission
for one complete 262,144-token context, including output/lookahead requirements.
Failure permits no automatic context reduction, profile change or candidate retry.

## Protected preparation and recovery

Verify original assets, current owned service and exact rollback before generation.
Run the two newly authorized baseline requests, then stop only that verified service
and confirm GPU quiescence under the shared ownership lease. Build and conversion
take place after this stop; no competing model service or unrelated container is touched.

Keep the original checkpoint read-only. Stage a separate sibling using weight links
and real copies of the eleven small metadata files; never copy the full 135 GB base.
For each selected shard, verify that the converter moves its staged link aside before
creating a new real file. The original mount stays read-only throughout conversion;
serve both completed mounts read-only. Verify original identities, unchanged tensors,
exactly four changed shards/300 scale tensors, index, finite scales and conversion
error bounds. Freeze hashes and a completion manifest after all checks. Preserve
failed staging rather than rerunning or deleting it.

| Preparation bound | Limit or refusal condition |
| --- | --- |
| Ordinary-user disk | At least 49 GiB before preparation; preserve 24 GiB reserve; budget 16 GiB conversion, 8 GiB image build, 1 GiB logs/manifests |
| Fourth-stage build | Two CPUs/jobs, at most 16 GiB RAM and 60 minutes |
| Conversion | After stop, at least 96 GiB available RAM; two CPUs, at most 96 GiB RAM, CPU only, 30 minutes |
| Numerical tests | 15 minutes; retained 22 GDN cases plus two reviewed actual-shape BF16/sigmoid reference cases, no skips; verify refreshed top-k against its reference |
| Candidate startup | 60 minutes, with actual memory/capacity/ownership/readiness checks |

Resource ceilings must be enforceable before starting. Refuse unsupported limits,
insufficient space/memory or loss of ownership. Build/conversion CPU and RAM caps
apply only to preparation; serving retains the current runtime resource policy.
No cache purge, swap expansion,
pruning, original-file deletion or second candidate is included. A failed gate stops
and restores the exact immediately previous qualified vLLM semantic profile after
confirmed owned cleanup. Rollback uses fresh physical identities and metadata
verification, with no extra generation calls. Unconfirmed cleanup blocks restoration;
it never licenses removal of unrelated resources or a silent q4t switch.

## New bounded qualification allocation

Request **at most 30 new zero-fee model requests**: 18 qualification requests below,
then at most 12 artifact-pilot requests. These are new grants beyond the spent
24-request qualification and consumed H4 allocations. Every committed attempt,
including invalid, failed or UNKNOWN, consumes a slot. No automatic retries,
replacements, extra warmups or reassignment of unused slots. Ordinary failure stops.

| Qualification phase | Requests | Required evidence |
| --- | ---: | --- |
| Current baseline B1–B2 | 2 | Short native Heavy SSE and bounded large-context fixtures |
| Candidate F1–F3 | 3 | Matched short fixture; actual tool-result history/next SSE turn; nonstream native repair JSON |
| Candidate F4–F8 | 5 | Index, plan, extraction, synthesis and independently configured critic contracts |
| Candidate F9–F10 | 2 | Known-supported and known-contradicted judge fixtures at the actual 256-token ceiling |
| Candidate F11–F13 | 3 | Cache A cold/A repeat/B isolation with actual usage details |
| Candidate F14 | 1 | Matched large-context fixture, exact prompt envelope at most 128,000 tokens |
| Candidate F15–F16 | 2 | One deliberate cancellation and one predeclared recovery request |

Baseline phase is at most 30 minutes; candidate qualification at most 60 minutes,
including host checks, with each request clamped to remaining phase time. The
qualification matrix reserves 152,064 output and 518,144 prompt tokens in total;
every body is at most 655,360 bytes, with exact prompt plus output within context.
No slots are borrowed from future H4/H5. Their separate, conditional budgets remain.

Freeze paired B1/F1 and B2/F14 bodies with identical prompts/history/tools/output
caps, Heavy thinking/sampling and proven equivalent cold-cache salts. Each needs
at least **512 actual completed output tokens**; a short or invalid sample fails
without replacement. Compute rates from actual tokens and elapsed/decode seconds,
never SSE chunk counts. Require candidate combined full-request TPS at least
**1.5 times baseline**, combined decode at least **30 TPS**, and neither paired
fixture slower in full-request TPS. Two pairs establish limited feasibility only.

All ordinary cases must settle with exact token-admission/usage parity, valid
role-specific response schemas and complete terminal JSON/SSE/usage framing.
Tool-bearing native fixtures additionally require valid arguments, separated
reasoning and exactly one action; tool-less roles follow their frozen schemas.
No prose fallback, grammar suppression or MTP-off retry.
F15 alone may remain UNKNOWN/cancelled with usage unavailable. Before its sole F16
recovery, require six healthy/idle GET observations at 20-second start intervals,
within 300 seconds. F16 must settle valid and return to healthy idle. Preserve F15
as unresolved; idle does not settle it. Any other unresolved/invalid response stops.

The [upstream XGrammar issue](https://github.com/vllm-project/vllm/issues/53181)
remains a known compatibility limit; the fast-v3 termination patch does not resolve
every speculative JSON path. Judge pairs and the bounded context fixture do not
prove all labels, full-context quality or stability. The old qualification remains
historical evidence for its original deployment.

## Artifact pilot, then the actual H4/H5 gates

Only after qualification, speed, numerical/source/package review, required CI and
fresh exact pins/readiness pass, run **one** pilot from the existing completed H4
research packet through the unchanged seed/provenance loader and direct writer
runner. Use the existing `output/report.md` contract and host claims/artifact checks.
Keep Heavy thinking on; no new research, critic or judge calls. This gives no H4 credit.

Enforce **12 model requests, 12 tools, 20 minutes, USD 0, one attempt and zero
replacements** with broker, runner and shared abort limits. Deny a thirteenth call
before execution. Make the first-draft deadline visible and truthful: by the earlier
of **four completed model turns or five minutes**, preserve a substantive report
draft with its actual bytes, hash and timestamp. Stop if absent. Empty directories,
temporary analysis, headings and placeholders fail. Root verifies the frozen draft's
substance; file size or a model assertion cannot accept it.

Final success requires existing full artifact/claims checks within 20 minutes and
root review of supported findings, citations and limitations, with no subsequent
model calls or edits. At most 20,000 completed output tokens is a success threshold,
not an enforced cumulative cap; the twelve per-call ceilings reserve 196,608 tokens.
This pilot changes time/progress constraints and cannot isolate serving as a cause.
Failure ends continuation and grants no thinking-off fallback or replacement pilot.

One owner decision may conditionally grant **three fresh full H4 loops**, local
research then deck then split, after all preceding gates pass. Restore every normal
Heavy research/critic/repair/selection/entailment requirement. Stop on first failure,
zero replacements. Preserve all six prior attempts and unresolved receipts.

Create a versioned new-qualification admission route, not the existing unchanged-
serving bridge. Bind the new image/weights/serving manifest, helper configuration,
token policy, all eight role identities, current runtime/protocol/clean CI, physical
ownership, complete history and new owner decision. Retain tokenizer/template code
only with exact hash/renderer proof and fresh request parity. Preserve old evidence;
do not weaken its equality checks or relabel new identities as unchanged.

Existing conditional H5 may follow only actual three-loop H4 and usable split-semantic
acceptance, compatible reviewed bindings, current readiness and independent blind
scoring. Keep **USD 0.60 all-history H4 split**, and **18 H5 rows / USD 21.60 total /
USD 3 cloud row / USD 0.60 split row**. Fresh H5 inputs/candidates/gold stay isolated.
No repeated Claude calibration, replacement or cutoff extension is granted. Every
new qualification/pilot dispatch and new H4-loop/H5-row admission must precede
**November 2, 2026, 10:00 UTC / 18:00 Asia/Shanghai**. Preserve existing bounds
and late-closing rules for admitted rows; an admitted batch grants no later row
starts after the cutoff.

References: [current migration](PHASE4_FLASH_NEXT_MIGRATION_V1.md),
[serving contract](FLASH_NEXT_VLLM_SERVICE_REQUIREMENTS.md),
[draft-first policy](PHASE4_WRITER_COMPLETION_V1.md), and the append-only build log.
