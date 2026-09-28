"""Local span detection only. A complete scan never grants disclosure authority.

Offsets are Unicode codepoints, with an explicit UTF-16 projection for JS callers.
The OPF backend requires an already provisioned local checkpoint; no lazy download.
"""
from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import time
from typing import Callable

LABELS = frozenset({"person", "address", "email", "phone", "account_number",
                    "private_url", "private_date", "secret"})
OPF_LABELS = {"private_person": "person", "private_address": "address",
              "private_email": "email", "private_phone": "phone",
              "account_number": "account_number", "private_url": "private_url",
              "private_date": "private_date", "secret": "secret"}
PRESIDIO_LABELS = {"PERSON": "person", "EMAIL_ADDRESS": "email", "PHONE_NUMBER": "phone",
                   "CREDIT_CARD": "account_number", "IBAN_CODE": "account_number",
                   "US_BANK_NUMBER": "account_number", "US_SSN": "account_number",
                   "US_DRIVER_LICENSE": "account_number", "US_PASSPORT": "account_number",
                   "CRYPTO": "account_number", "LOCATION": "address",
                   "DATE_TIME": "private_date", "URL": "private_url", "IP_ADDRESS": "private_url",
                   "SECRET": "secret", "PRIVATE_PATH": "private_url"}
ZH_CONTEXT = ["姓名", "地址", "邮箱", "邮件", "电话", "手机", "账户", "账号", "卡号", "生日", "日期", "网址", "链接"]
MAX_BYTES = 32768
MAX_TOKENS = 8192

# Deliberately the direct pattern subset of cloud-egress-policy.ts, not its
# provenance, normalized-value, known-value, or permission decision machinery.
RULES = (
    ("secret", r"(?<![A-Za-z0-9_-])sk-(?:or-v1-)?[A-Za-z0-9_-]{20,}"),
    ("secret", r"gh[pousr]_[A-Za-z0-9]{36,}"),
    ("secret", r"github_pat_[A-Za-z0-9_]{20,}"),
    ("secret", r"(?:AKIA|ASIA)[A-Z0-9]{16}"),
    ("secret", r"-----BEGIN (?:[A-Z0-9][A-Z0-9 -]{0,47} )?PRIVATE KEY-----"),
    ("private_url", r"(?:/Users/|/home/)[^\s\"'<>]+"),
)


class ScanError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_sha(value: object) -> str:
    return sha(json.dumps(value, sort_keys=True, ensure_ascii=False,
                          separators=(",", ":")).encode("utf-8"))


def validate_text(text: str) -> bytes:
    if not isinstance(text, str):
        raise ScanError("invalid_text")
    try:
        data = text.encode("utf-8", errors="strict")
    except UnicodeError:
        raise ScanError("invalid_unicode") from None
    if "\x00" in text:
        raise ScanError("invalid_text")
    if len(data) > MAX_BYTES:
        raise ScanError("input_byte_limit")
    return data


def validate_spans(text: str, spans: list[dict]) -> list[dict]:
    result = []
    for span in spans:
        if not isinstance(span, dict) or set(span) - {"start", "end", "label", "text"}:
            raise ScanError("invalid_span")
        start, end, label = span.get("start"), span.get("end"), span.get("label")
        if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
            raise ScanError("invalid_offset")
        if label not in LABELS:
            raise ScanError("unknown_label")
        if "text" in span and span["text"] != text[start:end]:
            raise ScanError("span_text_mismatch")
        result.append({"start": start, "end": end, "label": label,
                       "startUtf16": len(text[:start].encode("utf-16-le")) // 2,
                       "endUtf16": len(text[:end].encode("utf-16-le")) // 2})
    # Keep distinct overlapping labels for diagnostics; masking uses the union.
    return [dict(zip(("start", "end", "label", "startUtf16", "endUtf16"), key))
            for key in sorted({tuple(s[k] for k in ("start", "end", "label", "startUtf16", "endUtf16"))
                               for s in result})]


def rule_spans(text: str) -> list[dict]:
    return [{"start": match.start(), "end": match.end(), "label": label}
            for label, pattern in RULES for match in re.finditer(pattern, text)]


def masked_text(text: str, spans: list[dict]) -> str:
    """Length-preserving diagnostic mask; no identity-restoration claim."""
    chars = list(text)
    for span in spans:
        for index in range(span["start"], span["end"]):
            chars[index] = "█"
    return "".join(chars)


def configure_offline_suffixes() -> None:
    # Presidio's email recognizer calls this public function directly. Replace
    # its default refreshing/caching instance with the pinned bundled snapshot.
    import tldextract
    tldextract.extract = tldextract.TLDExtract(cache_dir=None, suffix_list_urls=(),
                                             fallback_to_snapshot=True)


class Detector:
    def __init__(self, kind: str, *, checkpoint: str | None = None,
                 english_model: str | None = None, chinese_model: str | None = None,
                 opf_factory: Callable | None = None):
        if kind not in {"rules", "opf", "presidio_local_en_zh"}:
            raise ScanError("unknown_detector")
        self.kind = kind
        self.config = {"schemaVersion": 1, "detector": kind, "maxBytes": MAX_BYTES,
                       "maxTokens": MAX_TOKENS, "device": "cpu", "threads": 4,
                       "rules": RULES, "decode": "viterbi", "trimWhitespace": True,
                       "presidioEntityMap": PRESIDIO_LABELS, "presidioThreshold": 0.5,
                       "zhContext": ZH_CONTEXT, "mixedLanguagePasses": ["en", "zh"],
                       "publicSuffixSource": "bundled_no_refresh_no_cache"}
        self.model = None
        if kind == "opf":
            if checkpoint is None or not Path(checkpoint).is_dir():
                raise ScanError("checkpoint_required")
            for name in ("config.json", "model.safetensors", "viterbi_calibration.json"):
                if not (Path(checkpoint) / name).is_file():
                    raise ScanError("checkpoint_incomplete")
            if opf_factory is None:
                import torch
                from opf import OPF
                torch.set_num_threads(4)
                torch.set_num_interop_threads(1)
                opf_factory = OPF
            self.model = opf_factory(model=checkpoint, device="cpu", decode_mode="viterbi",
                                     trim_whitespace=True, context_window_length=MAX_TOKENS)
        elif kind == "presidio_local_en_zh":
            if any(model is None or not Path(model).is_dir() for model in (english_model, chinese_model)):
                raise ScanError("local_nlp_models_required")
            configure_offline_suffixes()
            from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer, RecognizerRegistry
            from presidio_analyzer.predefined_recognizers import SpacyRecognizer
            from presidio_analyzer.nlp_engine import SpacyNlpEngine
            engine = SpacyNlpEngine(models=[{"lang_code": "en", "model_name": english_model},
                                           {"lang_code": "zh", "model_name": chinese_model}])
            engine.load()
            registry = RecognizerRegistry(supported_languages=["en", "zh"])
            registry.load_predefined_recognizers(languages=["en", "zh"], nlp_engine=engine)
            # Share generic pattern/checksum mechanisms with the Chinese NLP pass,
            # retaining their original logic and adding explicit Chinese context.
            for recognizer in list(registry.recognizers):
                if recognizer.supported_language == "en" and not isinstance(recognizer, SpacyRecognizer):
                    translated = copy.deepcopy(recognizer)
                    translated.supported_language = "zh"
                    translated.context = list(translated.context or []) + ZH_CONTEXT
                    if hasattr(translated, "supported_regions"):
                        translated.supported_regions = tuple(sorted(set(translated.supported_regions) | {"CN"}))
                    registry.add_recognizer(translated)
            for language in ("en", "zh"):
                for index, (label, pattern) in enumerate(RULES):
                    registry.add_recognizer(PatternRecognizer(
                        supported_entity="SECRET" if label == "secret" else "PRIVATE_PATH",
                        patterns=[Pattern(name=f"soar-{index}", regex=pattern, score=1.0)],
                        supported_language=language))
            self.model = AnalyzerEngine(registry=registry, nlp_engine=engine,
                                        supported_languages=["en", "zh"], log_decision_process=False)

    def scan(self, text: str, language: str) -> dict:
        started = time.monotonic()
        data = validate_text(text)
        if language not in {"en", "zh", "mixed"}:
            raise ScanError("invalid_language")
        # Never propagate library prints or exception text into the protocol.
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                if self.kind == "rules":
                    spans = rule_spans(text)
                elif self.kind == "opf":
                    runtime = self.model.get_runtime()
                    if len(runtime.encoding.encode(text, disallowed_special=())) > MAX_TOKENS:
                        raise ScanError("input_token_limit")
                    raw = self.model.redact(text)
                    if raw.warning is not None or raw.text != text or raw.summary.get("decoded_mismatch"):
                        raise ScanError("tokenizer_roundtrip_mismatch")
                    spans = [{"start": s.start, "end": s.end,
                              "label": OPF_LABELS.get(s.label, "unknown"), "text": s.text}
                             for s in raw.detected_spans]
                else:
                    raw = [span for lang in (["en", "zh"] if language == "mixed" else [language])
                           for span in self.model.analyze(text=text, language=lang,
                               entities=list(PRESIDIO_LABELS), score_threshold=0.5,
                               return_decision_process=False)]
                    spans = [{"start": s.start, "end": s.end,
                              "label": PRESIDIO_LABELS[s.entity_type]} for s in raw]
            spans = validate_spans(text, spans)
        except ScanError:
            raise
        except Exception:
            raise ScanError("detector_error") from None
        return {"schemaVersion": 1, "detector": self.kind,
                "configurationSha256": canonical_sha(self.config), "inputSha256": sha(data),
                "status": "complete", "complete": True, "offsetUnit": "unicode_codepoint", "spans": spans,
                "elapsedMs": round((time.monotonic() - started) * 1000, 3),
                "canAuthorizeDisclosure": False}


def union_receipt(text: str, left: dict, right: dict) -> dict:
    expected = sha(validate_text(text))
    if any(r.get("status") != "complete" or r.get("complete") is not True or r.get("inputSha256") != expected
           or r.get("canAuthorizeDisclosure") is not False for r in (left, right)):
        raise ScanError("union_incomplete")
    spans = validate_spans(text, [{k: s[k] for k in ("start", "end", "label")}
                                  for r in (left, right) for s in r["spans"]])
    return {"schemaVersion": 1, "detector": "opf_plus_rules", "status": "complete",
            "inputSha256": expected, "offsetUnit": "unicode_codepoint", "spans": spans,
            "configurationSha256": canonical_sha([left["configurationSha256"], right["configurationSha256"]]),
            "elapsedMs": left["elapsedMs"] + right["elapsedMs"],
            "reusesOpfPrediction": True, "canAuthorizeDisclosure": False}
