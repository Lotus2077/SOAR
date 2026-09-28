# Local privacy detector calibration

This module proposes spans. It **cannot authorize disclosure**. The calibration
uses synthetic text, no hosted scanning, no user credentials, and no private
source material. The host provenance/permission boundary remains separate.

`adapter.py` normalizes Unicode-codepoint spans and also supplies UTF-16 offsets.
It rejects invalid text, oversized inputs, tokenizer round-trip mismatches and
invalid spans. It suppresses library output and returns fixed error codes.
`calibrate.py` supervises one inference process at a time with a macOS
`sandbox-exec` profile denying network access, an additional Python network guard,
an explicit environment, four compute threads, 300 seconds per case and 3,600
seconds per entire corpus pass. It checks sampled RSS plus reported high-water RSS
against 12 GiB; this is a stop threshold, not an OS allocation limit. Cases are
limited to 32 KiB / 8,192 tokens, without truncation. Missing/failed results remain
in the corpus. Failed workers are not restarted. Output directories are create-only.

The compared configurations are:

- `rules`: the direct SOAR credential-header/path pattern subset. It is not the
  existing egress policy's provenance, consent, normalized-value or known-value logic.
- `opf`: the original CPU/BF16 OPF model, default Viterbi calibration and whitespace
  trimming. No tuning or quantization is implicitly applied.
- `presidio_local_en_zh`: pinned English and Chinese spaCy NER plus predefined
  and direct SOAR recognizers. Generic recognizers are reused with Chinese context;
  mixed text gets both language passes. Generic LOCATION/DATE_TIME/URL labels map
  coarsely to address/private_date/private_url: public/private distinctions remain
  a measured limitation, not a claimed semantic equivalence.
  Email suffix validation uses the pinned package's bundled suffix snapshot with
  no refresh URLs or disk cache; OS network denial remains enforced separately.
- `opf_plus_rules`: the union of those exact OPF/rule predictions, with no extra
  inference and no upgrade of incomplete input receipts.

Only span and literal-mask quality is measured here. The length-preserving mask
is diagnostic: it has no identity-restoration map and cannot establish reference
utility, confidentiality of non-PII business facts, or anonymization.

## Reproduction

Use Python 3.12 on macOS arm64. Dependencies, sources, weights, corpus, gold and
results belong under ignored `.soar/privacy-filter/`. The hash lock is for this
platform and is not a portable GPU deployment recipe.

```sh
python3.12 -m venv .soar/privacy-filter/venv
.soar/privacy-filter/venv/bin/python -m pip --isolated download \
  --only-binary=:all: --require-hashes --index-url https://pypi.org/simple \
  --dest .soar/privacy-filter/provision/wheels \
  -r runtime/privacy-filter/requirements.macos-arm64-py312.lock
```

Inspect wheel metadata, entrypoints and `.pth` files before installing. This trial
uses only binary wheels; it does not execute source-package build scripts. Install
the inspected lock offline with `pip --isolated install --no-index --find-links
.soar/privacy-filter/provision/wheels --require-hashes -r
runtime/privacy-filter/requirements.macos-arm64-py312.lock`.

Provision these public assets separately, verify every checksum and inspect source
before import. Do not use OPF's automatic checkpoint download during inference:

| Asset | Immutable binding |
| --- | --- |
| [Official OPF source](https://github.com/openai/privacy-filter) | commit `f7f00ca7fb869683eb732c010299d901457f19c3`; codeload tar SHA-256 `c79c613e3600bfee1357fb37528d439e703484f590552ffe9ef79a8050ccbe39` |
| [OPF checkpoint](https://huggingface.co/openai/privacy-filter) | revision `7ffa9a043d54d1be65afb281eddf0ffbe629385b`, files in `original/`; model SHA-256 `9c262cbe68a0c8a50590a648ef8341a2b7d3be1fa11dfb79893fe0b03ce57b5c` |
| [English spaCy model](https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0) | `en_core_web_sm-3.8.0-py3-none-any.whl`, SHA-256 `1932429db727d4bff3deed6b34cfc05df17794f4a52eeb26cf8928f7c1a0fb85` |
| [Chinese spaCy model](https://github.com/explosion/spacy-models/releases/tag/zh_core_web_sm-3.8.0) | `zh_core_web_sm-3.8.0-py3-none-any.whl`, SHA-256 `7de3bd267176b9b2a8defb6997c1cd296da16c57b5e712f72ea44a51755421c8` |
| [o200k_base tokenizer](https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken) | SHA-256 `446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d` |

Expected local layout is `assets/opf-source`, `assets/checkpoint` (flattened
`original/`), `assets/english-model` and `assets/chinese-model` (the wheels' actual model directories), and
`assets/tiktoken-cache`. The tokenizer cache key is SHA-1 of its public URL. Retain
asset inventories, wheel inspection, import failures/corrections and transfer
receipts under `provision/` before freezing; write later results outside that tree.

Freeze only after independently annotated development and sealed confirmation
corpora exist. `prepare.py` binds the actual runtime, source, model, package and
tokenizer bytes and exact eligible file inventory. Bytecode is included; runtime
uses `PYTHONDONTWRITEBYTECODE=1` and unexpected files or changes fail validation.

```sh
PYTHONDONTWRITEBYTECODE=1 .soar/privacy-filter/venv/bin/python \
  runtime/privacy-filter/prepare.py --root .soar/privacy-filter \
  --output .soar/privacy-filter/development-freeze.json
```

Then invoke the frozen harness with the exact SHA-256 printed by preparation and
the independently supplied input-file SHA-256:

```sh
PYTHONDONTWRITEBYTECODE=1 .soar/privacy-filter/venv/bin/python \
  runtime/privacy-filter/calibrate.py \
  --freeze .soar/privacy-filter/development-freeze.json \
  --expected-freeze-sha256 FROZEN_FILE_SHA256 \
  --inputs .soar/privacy-filter/evaluation/development/inputs.jsonl \
  --expected-input-sha256 INPUT_FILE_SHA256 \
  --output .soar/privacy-filter/results/development-v1
```

The caller must be permitted to install the child sandbox profile. Do not remove
that profile to work around a nested-sandbox failure. The independent evaluator
owns gold scoring and sealed-confirmation execution after the final configuration
freeze. No confirmation content is an input to development tuning.
