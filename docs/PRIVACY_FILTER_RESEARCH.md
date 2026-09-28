# Local privacy filtering for SOAR

Date checked: 2026-09-11. Status: **Local deployment implemented; confirmation incomplete.**
The initial research below preceded installation. OPF and configured local Presidio
now run on the laptop under network denial, on synthetic data only. The corrected
development pass completed all 240 detector cases and was independently scored;
the sealed confirmation attempt stopped before inference. All sixty confirmation
assignments remain unrun. Published measurements in the source-comparison
sections below remain the authors' results, separate from SOAR's local trial.

The laptop is observed as 32 GiB RAM. In the corrected development pass OPF handled
60 inputs in 61.214 seconds including first load, with median 372.6 ms, p95 4.023 s
and peak resident memory 4,111,204,352 bytes (3.83 GiB). Configured EN/ZH Presidio
completed the same 60 inputs in 3.943 seconds and peaked at 738,951,168 bytes.
These are bounded synthetic runtime measurements, not accuracy or production
throughput claims. The first pass failed because Presidio's email recognizer tried
to refresh suffix data; the network block prevented it. The failed run is retained,
and the corrected run uses the bundled offline suffix snapshot. No real private
user content was uploaded to a filter, model demo or cloud service.

## Recommendation

The development comparison selected **OPF alone as an advisory span detector** for
sealed confirmation. OPF plus the tested rules had identical coverage on these
sixty cases, so the union showed no incremental benefit here. This supersedes the
initial OPF-plus-rules candidate recommendation; existing credential and provenance
enforcement remains a separate host responsibility. No candidate qualified to
approve disclosures automatically.

| Corrected development configuration | Sensitive-character coverage | Missed mandatory canaries | Literal-mask utility failures |
| --- | ---: | ---: | ---: |
| Direct rule subset | 10.77% | 9 / 12 | 0 |
| OPF | 84.38% | 5 / 12 | 3 |
| Configured local EN/ZH Presidio | 50.90% | 9 / 12 | 7 |
| OPF plus rule subset | 84.38% | 5 / 12 | 3 |

Every configuration completed all sixty development cases. OPF matched 47 of 76
exact typed spans; character coverage is a different metric and must not be called
exact-span recall. Six identity-reference utility checks per configuration remain
unevaluated because no replacement/restoration map exists. These synthetic results
do not estimate production prevalence or establish a general detector ranking.
Aggregate identity:
`354778749e454fe725e46e8239a17d21adc6ce847bbc65433b013d7ba36b1354`;
selected operating identity:
`a894605f5bae78f9ed125bf6417a51440b914b9334b78eb560f0aa73550c41ab`.

The detector proposes sensitive spans and a redacted packet. The host's provenance
and permission checks decide whether that exact packet may leave. A clean scan
never overrides a private label. This distinction is necessary for the
[privacy-first agent design](plans/MVP_PRIVACY_FIRST_AGENT_V1.md).

## Candidates and verified source claims

| Candidate | Primary-source capabilities | SOAR use and limitations |
| --- | --- | --- |
| [OpenAI Privacy Filter](https://huggingface.co/openai/privacy-filter) | Apache-2.0; local bidirectional token classifier; 1.5B total / 50M active parameters; advertised 128K-token input; eight span categories: account numbers, addresses, email, people, phone, private URLs, private dates and secrets | First learned detector to test. Primarily English; fixed taxonomy and domain/language errors. Does not establish confidentiality of business strategy or proprietary source. |
| [Presidio](https://github.com/data-privacy-stack/presidio) | MIT; customizable detection with NER, regex, checksums and custom recognizers; Python/container deployment; text and other data modules | Candidate for organization-specific IDs and reproducible replacement rules. Detection remains fallible. The former Microsoft repository redirects to data-privacy-stack; pin the selected release and its NLP assets. |
| [Gitleaks](https://github.com/gitleaks/gitleaks) | Local repository, file and stdin secret scanning, custom rules and redacted reporting | Complement for coding credentials, not general PII/context understanding. Current README says feature-complete with future security patches only; benchmark before choosing a new integration. |
| Existing SOAR [egress scanner](../src/main/cloud-egress-policy.ts) | Host consent/provenance binding and known-secret/path checks | Keep as an existing deterministic baseline. It does not yet govern the coding transport or classify derived private context. |

OpenAI's model card explicitly distinguishes redaction assistance from anonymization
or a safety guarantee. Its trained labels cannot be changed by a runtime prompt;
changing that policy requires fine-tuning. The implementation uses banded attention,
so advertised input length should not be read as proof of long-range semantic
privacy understanding. These facts favor a local trial, not automatic release.
[Model documentation](https://huggingface.co/openai/privacy-filter).

## Evidence relevant to Chinese and long sessions

The OpenAI technical card reports these different evaluation sets:

| Evaluation | Mandarin examples | Recall | Precision |
| --- | ---: | ---: | ---: |
| Synthetic multilingual data, Table 7 | 971 | 0.921 | 0.913 |
| Category-clue-before-PII data, Table 8 | 1,191 | 0.786 | 0.926 |

These are not estimates for SOAR business documents. The card also finds degraded
recall when an alias definition is far from the sensitive value. Therefore test
Chinese, mixed-language text and cross-turn references explicitly; do not infer
protection from the context-window size. [Technical model card, Tables 7–8 and
section 7.5.3](https://cdn.openai.com/pdf/c66281ed-b638-456a-8ce1-97e9f5264a90/OpenAI-Privacy-Filter-Model-Card.pdf).

Presidio's multilingual mechanisms require matching NLP models and recognizers;
its extensibility is not a measured Chinese guarantee. A custom recognizer for an
internal identifier is useful when its format is known; a secret strategy expressed
in ordinary prose still needs source-level restrictions. [Presidio overview](https://github.com/data-privacy-stack/presidio).

## Integration details that affect privacy and quality

**Placement decision:** the owner permits OPF on the laptop if needed. Make a
laptop-local detector the first deployment candidate: the app and disclosure broker
can inspect outbound packets there without consuming the main GPU's generation
capacity. Keep the agent model on the dedicated machine. Both machines must be
inside the explicitly verified trust boundary; a laptop scan cannot protect an
untrusted GPU server that has already received raw inputs.

The current host is arm64. The initial sandboxed capacity probe was denied; the
later permitted observation and CPU calibration established the RAM and bounded
measurements reported above. Production responsiveness and concurrent workload
effects remain unmeasured. No MPS, WebGPU or quantized configuration was qualified.
Pin any such change separately and retest detection quality. Moving OPF to the
owned GPU remains an alternative if measured laptop limits require it.

Verified assets are now provisioned locally. The calibration scans with network
disabled and without privileged access to unrelated laptop files. Sealed confirmation
stopped in full-file validation before input loading or inference. Its original
one-hour watchdog terminated the exact owned process with SIGTERM; no worker began,
no confirmation result was scored and no retry was launched. All sixty confirmation
assignments remain unrun. Development inference timing excludes that later preflight
stall; the stall's underlying cause remains unestablished. It is an incomplete
calibration attempt, not a measured inference failure or confirmation-quality result.

A subsequent public-runtime-only diagnostic also remained incomplete. Four bounded
readers matched 9,515 of 28,116 frozen files (3,093,363,425 bytes) in 593.729 seconds;
18,601 files remain unvalidated. Initial inventory enumeration matched, but no final
inventory closure completed. The owned process group closed without additional
signals. Small dependency-file reads dominated the delay; a large checkpoint read
was fast. A later metadata-only probe did not establish the storage cause. These
are partial file-integrity results, not detector or confirmation results. No sealed
input, gold or detector was accessed by this diagnostic, and no confirmation retry
followed. Closure identity:
`b28130d2e3a164b025c7c8bd17e876709b376ca3feee86383b3da618819e7188`.

The official OPF implementation supports CPU/GPU operation. Its package requires
Python >=3.10 and uses PyTorch, safetensors, tiktoken and Hugging Face Hub. The CLI
can automatically download a missing checkpoint. Provision pinned assets separately,
then use a fixed local checkpoint and deny runtime networking. Dedicated-GPU
contention remains unmeasured; active parameter count alone is not a VRAM
requirement. Use an isolated detector process so a
failed scan cannot bypass the broker. [Official implementation](https://github.com/openai/privacy-filter),
[package manifest](https://github.com/openai/privacy-filter/blob/main/pyproject.toml).

The documented OPF JSON output contains original `text`, raw detected-span `text`
and `redacted_text`. Prediction exports can also contain original text. Its output
must go directly to a restricted local parser, not the ordinary activity log,
telemetry, crash reporter or cloud trace. Reject tokenizer round-trip mismatch
warnings, invalid offsets or incomplete processing for outgoing use. Verify offset
units across Python and TypeScript using Chinese, emoji and combining characters.
Never reconstruct a mask from display strings alone. [Output schemas](https://github.com/openai/privacy-filter/blob/main/OUTPUT_SCHEMAS.md).

For evaluation, OPF distinguishes category-aware (`typed`) from span-only (`untyped`)
comparison; presentation-only `redacted` output is not a gold-label evaluation mode.
Use both span coverage and per-category diagnostics so a taxonomy mismatch cannot
hide a missed sensitive region. [Evaluation modes](https://github.com/openai/privacy-filter/blob/main/EVAL_AND_OUTPUT_MODES.md).

For a Gitleaks baseline, use a fixed host-owned configuration; candidate repositories
cannot provide allowlists, inline suppression or ignore files that control outbound
admission. Treat skipped/oversized files as incomplete scans. Inspect logs with
full redaction enabled. Decoding/archive traversal are bounded options, not complete
coverage of arbitrary obfuscation. [Scanner options](https://github.com/gitleaks/gitleaks).

SOAR should retain original values for local calculations and final local synthesis.
Masking dates, account references or names can break matching and change a task's
answer. Use per-task placeholders with a private mapping only when needed for a
permitted cloud packet; prevent cross-task correlation and validate relationships
after restoration. Over-redaction is a quality defect to measure, not an acceptable
way to obtain impressive recall by deleting everything.

## Small calibration before integration

This is a proposed offline experiment, not a new paid allowance or a production
selection. Use the existing test/runtime tooling and each detector's own evaluator
where suitable; do not create a new general benchmark platform.

1. Create **120 synthetic text cases**, split into 60 development and 60 sealed
   confirmation cases. Each split has 20 English, 20 Chinese and 20 mixed-language
   cases. Independently annotate exact spans and source confidentiality before
   detector output is examined. Include names/addresses/accounts, novel credential
   formats, code and logs, JSON/Markdown/CSV, encoded/split values, long-distance
   aliases, clean public facts, and confidential business facts without PII.
2. Compare existing deterministic rules, OPF, configured Presidio, and a union of
   OPF with deterministic rules. Score code-secret scanning separately where useful.
   Pin checkpoints, runtime, decoder operating point and recognizers; tune only on
   the development split. Reuse identical inputs and record failures/over-limit cases.
3. Measure sensitive-character coverage, exact-span precision/recall by language
   and class, missed mandatory secret canaries, unnecessary masking, full-scan
   completion, peak memory and elapsed time. Inspect final masked packets for
   remaining semantic disclosure; do not call a business-confidential paragraph
   safe because it has no PII tags.
4. Run frozen downstream fact/matching/calculation checks on the proposed packets
   using synthetic values. Identify task-critical distortions, collapsed identities
   or broken references. Report these separately from detector recall.
5. Freeze one configuration before opening the confirmation split. A missed mandatory
   canary, malformed/partial scan or new critical distortion prevents promoting that
   configuration to unattended packet preparation. Report the failing categories;
   do not tune and rerun the same confirmation set. Zero observed misses in this
   small sample is not a zero-leakage guarantee.

Promote the smallest candidate that improves coverage without new critical failures
against the deterministic baseline on the targeted languages. An uncertain result
keeps human packet review and source restrictions in place. Fine-tuning or a new
detector is a later response to measured gaps, not a prerequisite to implementing
the non-bypassable boundary.

The separate transport qualification must prove that packets without permission
never leave even when **every detector returns a false negative**. It must also
show useful allowed operations succeed. This prevents a detector benchmark or
blanket blocking from being mistaken for a useful private agent.
