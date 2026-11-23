import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/e5-proxy-website.py"
spec = importlib.util.spec_from_file_location("website_intake", SCRIPT)
website = importlib.util.module_from_spec(spec)
spec.loader.exec_module(website)


class WebsiteIntakeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.candidate = {"family": "website", "sourceSha256": "f" * 64, "need": "Sort a fixed invoice list.",
                          "syntheticInput": "Fictional entries with amounts and sheet references."}

    def test_prepare_stages_the_separate_note_through_the_native_entry(self):
        spec = self.root / "source.json"
        spec.write_text(json.dumps(self.candidate))
        args = types.SimpleNamespace(mode="views", candidate=spec, original_text="original",
                                     policy="policy", source_review="review")
        def native(command):
            self.assertEqual(command[:4], [sys.executable, "-IB", str(self.root / "live.py"), "prepare"])
            staged = json.loads(Path(command[4]).read_bytes())
            self.assertEqual(command[5:], ["original", "policy", "review"])
            self.assertEqual({k: v for k, v in staged.items() if k != "syntheticInput"},
                             {k: v for k, v in self.candidate.items() if k != "syntheticInput"})
            self.assertTrue(staged["syntheticInput"].startswith(self.candidate["syntheticInput"] + "\n\n"))
            self.assertIn(website.FORMATS["views"], staged["syntheticInput"])
            return types.SimpleNamespace(returncode=0)
        with patch.object(website.subprocess, "run", side_effect=native):
            self.assertEqual(website.prepare(self.root, args), 0)
        self.assertEqual(json.loads(spec.read_bytes()), self.candidate)
        args.mode = "requires-active"
        with patch.object(website.subprocess, "run") as child:
            with self.assertRaisesRegex(website.Hold, "website_requires_active_behavior"):
                website.prepare(self.root, args)
            child.assert_not_called()

    def test_precomputed_request_must_reach_worker_and_plain_pages_still_fit(self):
        candidate = website.prepared_candidate(self.candidate, "views")
        self.assertFalse(website.format_reached_worker(candidate, "Static HTML and no scripts."))
        self.assertTrue(website.format_reached_worker(candidate, "Use fragment navigation and CSS :target, without forms."))
        plain = website.prepared_candidate(self.candidate, "page")
        self.assertTrue(website.format_reached_worker(plain, "Use plain paragraphs without form controls."))
        with self.assertRaisesRegex(website.Hold, "author_limit"):
            website.prepared_candidate({**self.candidate, "syntheticInput": "é" * 2750}, "page")

    def test_desktop_gate_uses_frozen_worker_documents_and_signals_an_omission_before_click(self):
        op = self.root / "operator"
        op.mkdir()
        material = self.root / "role/intake"
        material.mkdir(parents=True)
        (op / "candidate.json").write_text(json.dumps(website.prepared_candidate(self.candidate, "views")))
        # A full instruction seen only by the judge must never satisfy the worker check.
        (material / "acceptance.txt").write_text(website.FORMATS["views"])
        (material / "input.txt").write_text("A short fictional invoice extract.")
        native = types.SimpleNamespace(AREA=self.root, Hold=ValueError, phase_gate=Mock(),
            checked_root=lambda root: root, get_job=lambda root: root / "never-started",
            rec=lambda path: json.loads(path.read_bytes()), once=Mock(),
            ops={"when": lambda: types.SimpleNamespace(isoformat=lambda: "fixture-time")})
        old_path = sys.path[:]
        self.addCleanup(sys.path.__setitem__, slice(None), old_path)
        with patch.dict(sys.modules, weekly_live=native), patch.object(website.subprocess, "run", return_value=types.SimpleNamespace(returncode=0)) as run:
            for expected, text in [(False, "Use simple HTML without scripts."), (True, website.FORMATS["views"])]:
                (material / "brief.txt").write_text(text)
                frozen = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in material.iterdir()}
                (op / "proxy-intake-freeze.json").write_text(json.dumps({"files": frozen}))
                if expected:
                    self.assertEqual(website.desktop(self.root, self.root), 0)
                    run.assert_called_once_with([sys.executable, "-IB", str(self.root / "live.py"), "desktop", str(self.root)])
                else:
                    with self.assertRaisesRegex(website.Hold, "needs_coordinator_review"):
                        website.desktop(self.root, self.root)
                    native.once.assert_not_called()
                    digest = hashlib.sha256((op / "proxy-intake-freeze.json").read_bytes()).hexdigest()
                    with self.assertRaisesRegex(website.Hold, "freeze_changed"):
                        website.desktop(self.root, self.root, equivalent="stale")
                    with self.assertRaisesRegex(website.Hold, "website_brief_omits_format"):
                        website.desktop(self.root, self.root, incompatible=digest)
                    self.assertEqual(native.once.call_args.args[0], op / "desktop-stop.json")
                    run.assert_not_called()
                    self.assertEqual(website.desktop(self.root, self.root, equivalent=digest), 0)
                    self.assertEqual(native.once.call_args.args[0], op / "website-format-review.json")
                    run.reset_mock()

    @unittest.skipUnless(os.environ.get("E5_V4_PACKAGE"), "requires the pinned, host-installed v4 operator")
    def test_installed_prepare_frozen_author_and_worker_inputs(self):
        # Isolate host records and replace only calendar/budget decisions and the author reply.
        # The pinned candidate reader, exact source binding, two staging scans and freeze run for real.
        package = Path(os.environ["E5_V4_PACKAGE"]).resolve(strict=True)
        website.checked_package(package)
        old_path = sys.path[:]
        self.addCleanup(sys.path.__setitem__, slice(None), old_path)
        sys.path.insert(0, str(package))
        import weekly_live as v4
        now = datetime(2030, 3, 18, tzinfo=timezone.utc)
        week = now.date().isoformat()
        post = b"A fictional operator wants to sort a small local invoice list."
        post_hash = hashlib.sha256(post).hexdigest()
        self.root = self.root.resolve()
        spec = self.root / "candidate.json"
        fields = dict(sourceKey="offline-invoice", sourceSha256=post_hash, sourceHashBasis="fixture text",
                      postedUtc=week, readUtc=week, url="https://superuser.com/questions/100", community="fixture",
                      persona="Fictional studio lead", targetRank=1, jobSlug="offline-invoice")
        spec.write_text(json.dumps(website.prepared_candidate({**self.candidate, **fields}, "views")))
        original = self.root / "original"
        original.write_bytes(post)
        policy = self.root / "policy.json"
        policy.write_text(json.dumps({"ownerNames": ["Fixture Alias"], "endpointHosts": ["fixture.invalid"]}))
        review = self.root / "review.json"
        review.write_text(json.dumps(dict(sourceSha256=post_hash, readUtc=week, checkedAtUtc=now.isoformat(),
            anonymousPublicAccess=True, identifyingDetailsAbsent=True, confidentialMaterialAbsent=True,
            professionalRoleAndNeedSupported=True)))
        policy.chmod(0o600)
        review.chmod(0o600)
        area = self.root / "evidence"
        with patch.multiple(v4, AREA=area, STATE=area / "state", WORK=self.root / "work",
                            week_gate=Mock(return_value=(week, [], {}, [], None)),
                            plan_next=Mock(return_value={"calendarPosition": 1})), \
             patch.dict(v4.ops, when=lambda: now, budget_and_price=lambda *a: 0):
            job = v4.make_source(spec, original, policy, review)
        self.assertEqual(v4.rec(job / "operator/source.json")["sourceSha256"], post_hash)
        scanned = (job / "role/verified-source/need.txt").read_text()
        self.assertIn(website.FORMATS["views"], scanned)
        sys.path.insert(0, str(package / "transport"))
        with patch.dict(os.environ, E5_WORK_ROOT=str(job)):
            import proxy_agent as proxy
        def author_reply(phase, prompt, schema, inputs):
            self.assertEqual((phase, inputs["need.txt"]), ("author", scanned))
            return {"brief": "Produce the requested fictional invoice page. " + website.FORMATS["views"],
                    "input": "Fictional invoice table with synthetic amounts.", "acceptance": "Sort every requested view."}
        frozen = proxy.author(types.SimpleNamespace(turn=author_reply), scanned, "website")
        full = [job / "role/intake" / name for name in ("brief.txt", "input.txt")]
        self.assertTrue(all(frozen[p.name] == hashlib.sha256(p.read_bytes()).hexdigest() for p in full))
        self.assertTrue(website.format_reached_worker(v4.rec(job / "operator/candidate.json"),
                                                       "\n".join(p.read_text() for p in full)))
