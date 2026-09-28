"""Offline adapter contracts; fake model only, no downloads or inference."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock
from contextlib import redirect_stdout

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "runtime/privacy-filter"
sys.path.insert(0, str(RUNTIME))
import adapter
import calibrate


class FakeOpf:
    def __init__(self, **kwargs):
        self.options = kwargs
        self.token_count = 3
        self.warning = None
        self.spans = []
        self.calls = 0
        self.fail = False

    def get_runtime(self):
        return SimpleNamespace(encoding=SimpleNamespace(encode=lambda *args, **kwargs: [0] * self.token_count))

    def redact(self, text):
        self.calls += 1
        print("RAW-SENSITIVE-LIBRARY-TRACE")
        if self.fail:
            raise ValueError("RAW-SENSITIVE-EXCEPTION")
        return SimpleNamespace(text=text, warning=self.warning, summary={"decoded_mismatch": False},
                               detected_spans=self.spans)


class PrivacyFilterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        checkpoint = Path(self.temp.name)
        for name in ("config.json", "model.safetensors", "viterbi_calibration.json"):
            (checkpoint / name).write_text("fixture")
        self.opf = adapter.Detector("opf", checkpoint=str(checkpoint), opf_factory=FakeOpf)

    def test_no_implicit_checkpoint_or_hosted_detector(self):
        for kind in ("hosted", "auto"):
            with self.assertRaises(adapter.ScanError):
                adapter.Detector(kind)
        with self.assertRaises(adapter.ScanError):
            adapter.Detector("opf")
        self.assertEqual(self.opf.model.options["device"], "cpu")
        self.assertEqual(self.opf.model.options["decode_mode"], "viterbi")

    def test_unicode_offsets_roundtrip_for_emoji_chinese_combining_characters(self):
        text = "😀中文 e\u0301 Alice"
        start = text.index("Alice")
        self.opf.model.spans = [SimpleNamespace(start=start, end=len(text), text="Alice", label="private_person")]
        row = self.opf.scan(text, "mixed")
        self.assertEqual(row["spans"][0]["start"], start)
        self.assertEqual(row["spans"][0]["startUtf16"], start + 1)
        self.assertEqual(row["spans"][0]["endUtf16"], len(text) + 1)
        self.assertEqual(adapter.masked_text(text, row["spans"]), "😀中文 e\u0301 █████")
        self.assertIs(row["canAuthorizeDisclosure"], False)

    def test_model_prints_raw_values_and_exceptions_never_escape(self):
        target = io.StringIO()
        with redirect_stdout(target):
            row = self.opf.scan("Private fixture", "en")
        self.assertEqual(target.getvalue(), "")
        self.assertNotIn("Private fixture", json.dumps(row))
        self.opf.model.fail = True
        with self.assertRaises(adapter.ScanError) as exc:
            self.opf.scan("private fixture", "en")
        self.assertEqual(str(exc.exception), "detector_error")

    def test_roundtrip_warning_fails_closed(self):
        self.opf.model.warning = "raw content in library diagnostic"
        with self.assertRaises(adapter.ScanError) as exc:
            self.opf.scan("text", "en")
        self.assertEqual(exc.exception.code, "tokenizer_roundtrip_mismatch")

    def test_invalid_and_oversized_inputs_never_reach_model(self):
        for text in ("\ud800", "a\x00b", "中" * 12000):
            with self.assertRaises(adapter.ScanError):
                self.opf.scan(text, "zh")
        self.opf.model.token_count = adapter.MAX_TOKENS + 1
        with self.assertRaises(adapter.ScanError) as exc:
            self.opf.scan("short but many fixture tokens", "en")
        self.assertEqual(exc.exception.code, "input_token_limit")
        self.assertEqual(self.opf.model.calls, 0)

    def test_invalid_offsets_types_labels_and_mismatched_substring_rejected(self):
        for span in ({"start": -1, "end": 2, "label": "person"},
                     {"start": True, "end": 2, "label": "person"},
                     {"start": 0, "end": 99, "label": "person"},
                     {"start": 0, "end": 2, "label": "new_label"},
                     {"start": 0, "end": 2, "label": "person", "text": "wrong"}):
            with self.assertRaises(adapter.ScanError):
                adapter.validate_spans("abc", [span])

    def test_rules_detect_existing_credential_patterns_without_claiming_general_pii(self):
        token = "sk-" + "A" * 25
        text = "Alice /Users/example/secret.txt " + token
        result = adapter.Detector("rules").scan(text, "en")
        self.assertEqual({s["label"] for s in result["spans"]}, {"secret", "private_url"})
        self.assertNotIn("person", [s["label"] for s in result["spans"]])
        self.assertIs(result["canAuthorizeDisclosure"], False)

    def test_union_requires_both_complete_exact_input_and_never_reinfers(self):
        text = "sk-" + "A" * 25
        rules = adapter.Detector("rules").scan(text, "en")
        opf = self.opf.scan(text, "en")
        joined = adapter.union_receipt(text, opf, rules)
        self.assertEqual(joined["spans"], rules["spans"])
        self.assertEqual(self.opf.model.calls, 1)
        for mutated in ({**opf, "status": "incomplete"}, {**opf, "inputSha256": "0" * 64},
                        {**opf, "complete": False},
                        {**opf, "canAuthorizeDisclosure": True}):
            with self.assertRaises(adapter.ScanError):
                adapter.union_receipt(text, mutated, rules)

    def test_presidio_uses_explicit_language_and_both_passes_for_mixed(self):
        detector = adapter.Detector("rules")
        detector.kind = "presidio_local_en_zh"
        calls = []
        detector.model = SimpleNamespace(analyze=lambda **kwargs: calls.append(kwargs) or [])
        for language, expected in (("en", ["en"]), ("zh", ["zh"]), ("mixed", ["en", "zh"])):
            calls.clear()
            receipt = detector.scan("Synthetic 合成", language)
            self.assertEqual([call["language"] for call in calls], expected)
            self.assertTrue(all(call["return_decision_process"] is False for call in calls))
            self.assertTrue(all(call["score_threshold"] == 0.5 for call in calls))
            self.assertTrue(receipt["complete"])
        with self.assertRaises(adapter.ScanError):
            adapter.Detector("presidio_local_en_zh", english_model=self.temp.name)

    def test_public_suffix_extractor_has_no_remote_urls_or_cache(self):
        fixed = object()
        module = SimpleNamespace(TLDExtract=Mock(return_value=fixed), extract=object())
        with patch.dict(sys.modules, {"tldextract": module}):
            adapter.configure_offline_suffixes()
        module.TLDExtract.assert_called_once_with(cache_dir=None, suffix_list_urls=(),
                                                 fallback_to_snapshot=True)
        self.assertIs(module.extract, fixed)

    def test_corpus_requires_exact_binding_sixty_rows_and_language_balance(self):
        rows = [{"schemaVersion": 1, "id": str(i), "language": ["en", "zh", "mixed"][i // 20], "text": "public"}
                for i in range(60)]
        target = Path(self.temp.name) / "inputs.jsonl"
        raw = ("\n".join(json.dumps(r) for r in rows) + "\n").encode()
        target.write_bytes(raw)
        self.assertEqual(len(calibrate.load_inputs(target, adapter.sha(raw))), 60)
        with self.assertRaises(adapter.ScanError):
            calibrate.load_inputs(target, "0" * 64)
        target.write_bytes(raw + raw.splitlines()[0])
        with self.assertRaises(adapter.ScanError):
            calibrate.load_inputs(target, calibrate.file_sha(target))

    def test_python_network_guard_rejects_send_connect_lookup_and_bind(self):
        for event in ("socket.connect", "socket.getaddrinfo", "socket.sendto", "socket.bind"):
            with self.assertRaises(adapter.ScanError):
                calibrate.deny_python_network(event, ())
        calibrate.deny_python_network("open", ())

    def test_expired_pass_does_not_launch_another_backend(self):
        item = {"id": "fixed", "text": "fixture", "language": "en"}
        with patch.object(calibrate.subprocess, "Popen") as launch:
            rows = calibrate.run_backend(None, {}, [item], "opf", 0)
        launch.assert_not_called()
        self.assertEqual(rows[0]["error"], "pass_deadline")
        self.assertIs(rows[0]["complete"], False)

    def test_freeze_requires_exact_runtime_and_asset_bytes(self):
        tree = Path(self.temp.name) / "runtime"
        tree.mkdir()
        asset = tree / "fixed.py"
        asset.write_text("original")
        frozen = {"limits": {"peakRssBytes": calibrate.MAX_RSS, "caseSeconds": 300,
                              "passSeconds": 3600, "threads": 4},
                  "roots": [str(tree)], "standalone": [],
                  "files": [{"path": str(asset), "sha256": calibrate.file_sha(asset)}]}
        target = Path(self.temp.name) / "freeze.json"
        target.write_text(json.dumps(frozen))
        expected = calibrate.file_sha(target)
        calibrate.validate_freeze(target, expected)
        added = tree / "injected.pyc"
        added.write_bytes(b"added")
        with self.assertRaises(adapter.ScanError) as exc:
            calibrate.validate_freeze(target, expected)
        self.assertEqual(exc.exception.code, "inventory_binding")
        added.unlink()
        asset.write_text("modified")
        with self.assertRaises(adapter.ScanError) as exc:
            calibrate.validate_freeze(target, expected)
        self.assertEqual(exc.exception.code, "asset_binding")

    def test_supervisor_rejects_contradictory_completion_and_unsampled_highwater(self):
        item = {"id": "sample", "text": "public", "language": "en"}
        row = adapter.Detector("rules").scan(item["text"], "en")
        row.update({"id": item["id"], "peakRssBytes": 1024})
        calibrate.validate_worker_receipt(row, item, "rules")
        with self.assertRaises(adapter.ScanError) as exc:
            calibrate.validate_worker_receipt({**row, "complete": False}, item, "rules")
        self.assertEqual(exc.exception.code, "invalid_worker_receipt")
        with self.assertRaises(adapter.ScanError) as exc:
            calibrate.validate_worker_receipt({**row, "peakRssBytes": calibrate.MAX_RSS + 1}, item, "rules")
        self.assertEqual(exc.exception.code, "rss_limit")


if __name__ == "__main__":
    unittest.main()
