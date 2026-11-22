import importlib.util
from pathlib import Path
import json
import subprocess
import sys
import unittest
from unittest.mock import Mock

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/e5_proxy_judge.py"
spec = importlib.util.spec_from_file_location("e5_proxy_judge", SCRIPT)
rule = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rule)


def issued(**overrides):
    row = {"judgeRuleVersion": rule.RULE_VERSION, "decision": "accept", "cause": "none",
           "materialFalseClaim": False, "claimEvidence": "The stated scope matches the supplied brief.",
           "claimRationale": "The qualification preserves the scope of the available evidence.",
           "reviewMinutes": 5, "editMinutes": 2, "minutesSaved": 10, "assessment": "Shorten one heading."}
    return {**row, **overrides}


class JudgmentTests(unittest.TestCase):
    def test_same_rule_governs_every_role_without_disclosing_assignment(self):
        checked = issued(decision="reject", cause="content_wrong_or_missing", materialFalseClaim=True)
        for role in rule.ROLES:
            with self.subTest(role=role):
                callback = Mock(return_value=checked)
                packet = {"criteria.txt": "Requirements", "deliverable.html": "<h1>Draft</h1>"}
                if role != "sourcing":
                    packet["need.txt"] = "Public need"
                result = rule.judge(callback, phase="private-condition-03", role=role, documents=packet)
                self.assertIs(result, checked)
                phase, prompt, schema, materials = callback.call_args.args
                self.assertEqual(phase, "private-condition-03")
                self.assertNotIn(phase, prompt)
                self.assertIn(rule.SHARED_RULE, prompt)
                self.assertIn("status the evidence establishes as unknown", prompt)
                self.assertIn("confirming that status could change the decision", prompt)
                self.assertEqual(schema, rule.decision_schema())
                self.assertIs(materials, packet)

    def test_contradiction_is_held_even_with_zero_edit_minutes(self):
        for role in rule.ROLES:
            row = issued(materialFalseClaim=True, editMinutes=0)
            packet = {"criteria.txt": "notes", "deliverable.html": "<p>export</p>"}
            if role != "sourcing":
                packet["need.txt"] = "public request"
            callback = Mock(return_value=row)
            with self.assertRaisesRegex(rule.JudgmentError, "requires_content_rejection"):
                rule.judge(callback, phase="assignment", role=role, documents=packet)
            self.assertEqual(row["decision"], "accept")
            callback.assert_called_once()
        with self.assertRaisesRegex(rule.JudgmentError, "requires_content_rejection"):
            rule.validate_judgment(issued(materialFalseClaim=True, decision="reject", cause="too_much_editing"))

    def test_other_usability_rules_and_evidence_remain_required(self):
        self.assertEqual(rule.validate_judgment(issued(editMinutes=10), 1), (15, 2))
        self.assertEqual(rule.validate_judgment(issued(decision="reject", cause="format_or_fidelity")), (7, 1))
        for bad in ({"editMinutes": 11}, {"cause": "other"}, {"claimEvidence": " "}, {"claimRationale": ""},
                    {"materialFalseClaim": 1}, {"reviewMinutes": True}, {"judgeRuleVersion": "older"}):
            with self.subTest(bad=bad), self.assertRaises(rule.JudgmentError):
                rule.validate_judgment(issued(**bad))
        with self.assertRaises(rule.JudgmentError):
            rule.validate_judgment(issued(), 2)
        with self.assertRaises(rule.JudgmentError):
            rule.judge(Mock(), phase="assignment", role="blind", documents={})

    def test_cli_refuses_duplicate_and_contradictory_claim_without_echoing_evidence(self):
        row = issued(materialFalseClaim=True, claimEvidence="private marker must not appear")
        for data in (json.dumps(row), '{"decision":"accept","decision":"reject"}'):
            run = subprocess.run([sys.executable, "-I", str(SCRIPT), "validate"], input=data, text=True,
                                 capture_output=True, check=False)
            self.assertEqual(run.returncode, 2)
            self.assertEqual(json.loads(run.stderr)["status"], "held")
            self.assertNotIn("private marker", run.stderr)
            self.assertFalse(run.stdout)
        run = subprocess.run([sys.executable, "-I", str(SCRIPT), "validate", "--other-interventions", "1"],
                             input=json.dumps(issued()), text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(run.stdout)["interventions"], 2)


if __name__ == "__main__":
    unittest.main()
