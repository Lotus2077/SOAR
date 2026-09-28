"""Host-only planner artifact tests. Generated source is never executed here."""

import ast
from dataclasses import FrozenInstanceError, replace
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("planner_checks", ROOT / "runtime/patch-worker/planner_checks.py")
planner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(planner)

SOURCE = '''import unittest
class PublicBehavior(unittest.TestCase):
    def test_behavior(self):
        self.assertEqual(2 + 2, 4)
'''


def response(source=SOURCE, count=1, plan="Implement the public task."):
    return json.dumps({"plan": plan, "checks": {"source": source, "expectedTests": count}}, ensure_ascii=False)


PLANNER_REJECTION_SENTINEL = 'private-planner-rejection-sentinel'


def invalid_planner_responses():
    """Seven real parser violations, each inside a valid outer response body."""
    source = SOURCE + '\n# ' + PLANNER_REJECTION_SENTINEL + '\n'
    extra_key = json.loads(response(source))
    extra_key['unexpected'] = PLANNER_REJECTION_SENTINEL
    return (
        ('planner_checks_response', '```json\n' + response(source) + '\n```'),
        ('planner_checks_schema', json.dumps(extra_key)),
        ('planner_checks_plan', response(source, plan=PLANNER_REJECTION_SENTINEL + 'x' * planner.MAX_PLAN_BYTES)),
        ('planner_checks_source', response(source + '#' + 'x' * planner.MAX_SOURCE_BYTES)),
        ('planner_checks_count', response(source, count=2)),
        ('planner_checks_syntax', response(source + '\ndef broken(:\n')),
        ('planner_checks_declarations', response(source + '\nunittest.main()\n')),
    )


def receipt(checks, **updates):
    value = {"schemaVersion": 1, "kind": planner.CHECK_KIND, "sourceSha256": checks.sha256,
             "expectedTests": checks.expected_tests, "discoveredTests": checks.expected_tests,
             "testsRun": checks.expected_tests, "passed": checks.expected_tests, "failures": 0,
             "errors": 0, "skipped": 0, "expectedFailures": 0, "unexpectedSuccesses": 0,
             "completed": True, "status": "passed", "detail": ""}
    value.update(updates)
    return planner.RESULT_PREFIX + json.dumps(value)


class PlannerChecksTests(unittest.TestCase):
    def test_prompt_example_is_parseable_and_cannot_be_a_passing_placeholder(self):
        # Parse only: model-generated Python never executes on the host.
        raw = planner.PLANNER_CHECKS_FORMAT.rsplit('\n', 1)[-1]
        result = planner.parse_planner_response(raw)
        self.assertEqual(result.checks.source, planner.PLANNER_CHECKS_EXAMPLE_SOURCE)
        self.assertEqual(result.checks.test_ids, ('PublicRequirements.test_public_behavior',))
        method = ast.parse(result.checks.source).body[1].body[0]
        self.assertEqual(len(method.body), 1)
        call = method.body[0].value
        self.assertIsInstance(call, ast.Call)
        self.assertEqual(ast.dump(call.func), "Attribute(value=Name(id='self', ctx=Load()), attr='fail', ctx=Load())")

    def test_prompt_example_rejects_host_wrappers_and_ambiguous_class_declarations(self):
        source = planner.PLANNER_CHECKS_EXAMPLE_SOURCE
        variants = [
            source + '\nif __name__ == "__main__": unittest.main()\n',
            'import sys\nsys.path[:0] = ["/workspace/src"]\n' + source,
            source + '\nfixture = object()\n',
            source.replace('class PublicRequirements', '@decorator\nclass PublicRequirements'),
            source.replace('(unittest.TestCase)', '(unittest.TestCase, metaclass=Meta)'),
            source.replace('(unittest.TestCase)', ''),
            source.replace('(unittest.TestCase)', '(unittest.TestCase, Other)'),
        ]
        for index, variant in enumerate(variants):
            with self.subTest(index=index), self.assertRaises(planner.PlannerChecksError) as caught:
                planner.parse_planner_response(response(variant))
            self.assertEqual(caught.exception.code, 'planner_checks_declarations')

    def assert_rejected(self, fn, *args):
        with self.assertRaises(planner.PlannerChecksError) as caught:
            fn(*args)
        self.assertTrue(caught.exception.code.startswith("planner_checks_"))
        self.assertEqual(str(caught.exception), caught.exception.code)
        self.assertNotIn("private-source-sentinel", str(caught.exception))

    def test_seven_distinct_rejections_have_exact_safe_codes(self):
        fixtures = invalid_planner_responses()
        self.assertEqual(len(fixtures), 7)
        self.assertEqual(len({code for code, _ in fixtures}), 7)
        for expected, raw in fixtures:
            with self.subTest(expected=expected):
                self.assertIn(PLANNER_REJECTION_SENTINEL, raw)
                self.assertTrue(raw.strip())
                self.assertLessEqual(len(raw.encode('utf-8')), planner.MAX_RESPONSE_BYTES)
                with self.assertRaises(planner.PlannerChecksError) as caught:
                    planner.parse_planner_response(raw)
                self.assertEqual(caught.exception.code, expected)
                self.assertEqual(str(caught.exception), expected)
                self.assertNotIn(PLANNER_REJECTION_SENTINEL, str(caught.exception))

    def test_exact_source_hash_and_explicit_kind_are_frozen(self):
        result = planner.parse_planner_response(response().encode())
        self.assertEqual(result.plan, "Implement the public task.")
        self.assertEqual(result.checks.source, SOURCE)
        self.assertEqual(result.checks.sha256, hashlib.sha256(SOURCE.encode()).hexdigest())
        self.assertEqual(result.checks.schema_version, 1)
        self.assertEqual(result.checks.kind, "model_generated_python_unittest")
        self.assertEqual(result.checks.test_ids, ("PublicBehavior.test_behavior",))
        with self.assertRaises(FrozenInstanceError):
            result.checks.source = "changed"

    def test_host_parser_and_wrapper_builder_do_not_import_or_execute_source(self):
        source = SOURCE.replace("import unittest", "import unittest\nimport module_that_does_not_exist_host_sentinel")
        source = source.replace("self.assertEqual(2 + 2, 4)", "raise RuntimeError('private-source-sentinel')")
        parsed = planner.parse_planner_response(response(source))
        wrapper = planner.build_check_wrapper(parsed.checks)
        tree = ast.parse(wrapper)
        config = next(node.value for node in tree.body if isinstance(node, ast.Assign)
                      and any(isinstance(target, ast.Name) and target.id == 'C' for target in node.targets))
        self.assertEqual(ast.literal_eval(config)['source'], source)
        self.assertEqual(wrapper, planner.build_check_wrapper(parsed.checks))

    def test_actual_utf8_byte_limits_are_inclusive(self):
        plan = "中" * 1333 + "x"
        self.assertEqual(len(plan.encode()), planner.MAX_PLAN_BYTES)
        planner.parse_planner_response(response(plan=plan))
        self.assert_rejected(planner.parse_planner_response, response(plan=plan + "x"))
        source = SOURCE + "#" + "x" * (planner.MAX_SOURCE_BYTES - len(SOURCE.encode()) - 1)
        planner.parse_planner_response(response(source))
        self.assert_rejected(planner.parse_planner_response, response(source + "x"))
        raw = response()
        padded = raw + " " * (planner.MAX_RESPONSE_BYTES - len(raw.encode()))
        planner.parse_planner_response(padded)
        self.assert_rejected(planner.parse_planner_response, padded + " ")

    def test_unicode_source_bytes_are_not_character_counts(self):
        source = SOURCE + "#" + "中" * 1900
        planner.parse_planner_response(response(source))
        self.assert_rejected(planner.parse_planner_response, response(source + "中" * 200))

    def test_malformed_utf8_surrogates_nul_and_non_json_are_rejected(self):
        for raw in (b'\xff', b'\xef\xbb\xbf' + response().encode(), response(plan="\ud800"),
                    response(plan="\x00"), response(SOURCE + "#\x00"), "```json\n" + response() + "\n```",
                    response() + "false", "\x00" + response(), None, {}, ""):
            with self.subTest(raw_type=type(raw).__name__):
                self.assert_rejected(planner.parse_planner_response, raw)

    def test_schema_keys_duplicates_and_nonfinite_values_are_rejected(self):
        base = json.loads(response())
        for value in ({}, [], {**base, 'schemaVersion': 1}, {**base, 'plan': 7},
                      {**base, 'checks': {**base['checks'], 'trusted': True}},
                      {**base, 'checks': {'source': SOURCE}}, {**base, 'checks': []}):
            self.assert_rejected(planner.parse_planner_response, json.dumps(value))
        self.assert_rejected(planner.parse_planner_response, response().replace('"plan":', '"plan":"duplicate", "plan":'))
        self.assert_rejected(planner.parse_planner_response, response().replace('"expectedTests": 1', '"expectedTests": 1, "expectedTests": 1'))
        self.assert_rejected(planner.parse_planner_response, response().replace('"expectedTests": 1', '"expectedTests": NaN'))

    def test_test_count_requires_integer_one_through_twelve(self):
        for count in (True, False, 0, -1, 13, 1.0, "1", None, 2):
            self.assert_rejected(planner.parse_planner_response, response(count=count))
        source = 'import unittest\nclass Cases(unittest.TestCase):\n' + ''.join(
            f'    def test_{i}(self):\n        self.assertEqual({i}, {i})\n' for i in range(12))
        self.assertEqual(planner.parse_planner_response(response(source, 12)).checks.expected_tests, 12)
        self.assert_rejected(planner.parse_planner_response, response(source + '    def test_extra(self): pass\n', 12))

    def test_zero_tests_and_invalid_syntax_are_rejected(self):
        for source in ('import unittest', 'import unittest\nclass Empty(unittest.TestCase):\n    pass',
                       SOURCE.replace('test_behavior', 'helper_behavior'), 'class bad(: private-source-sentinel'):
            self.assert_rejected(planner.parse_planner_response, response(source))

    def test_multiple_explicit_classes_constants_and_helpers_are_supported(self):
        source = SOURCE + '''
VALUE = (1, 2)
def helper(value):
    return value + 1
class Other(unittest.TestCase):
    def setUp(self):
        self.value = VALUE[0]
    def test_value(self):
        self.assertEqual(helper(self.value), 2)
'''
        self.assertEqual(planner.parse_planner_response(response(source, 2)).checks.test_ids,
                         ('Other.test_value', 'PublicBehavior.test_behavior'))

    def test_skips_expected_failures_and_subtests_are_rejected_statically(self):
        sources = [SOURCE.replace('class PublicBehavior', '@unittest.skip("reason")\nclass PublicBehavior'),
                   SOURCE.replace('    def test_', '    @unittest.expectedFailure\n    def test_'),
                   SOURCE.replace('self.assertEqual(2 + 2, 4)', 'self.skipTest("reason")'),
                   SOURCE.replace('self.assertEqual(2 + 2, 4)', 'raise unittest.SkipTest("reason")'),
                   SOURCE.replace('self.assertEqual(2 + 2, 4)', 'with self.subTest(x=1): pass'),
                   SOURCE.replace('    def test_', '    @unittest.skipIf(False, "reason")\n    def test_')]
        for index, source in enumerate(sources):
            with self.subTest(case=index):
                self.assert_rejected(planner.parse_planner_response, response(source))

    def test_dynamic_and_ambiguous_discovery_is_rejected(self):
        sources = [SOURCE + '\ndef load_tests(loader, tests, pattern): return tests\n',
                   SOURCE + '\ndef setUpModule(): pass\n',
                   SOURCE + '\nunittest.main()\n', SOURCE + '\nPublicBehavior = 1\n',
                   SOURCE + '\n' + SOURCE, SOURCE.replace('(unittest.TestCase)', '(Other)'),
                   SOURCE.replace('def test_behavior', 'async def test_behavior'),
                   SOURCE.replace('self.assertEqual(2 + 2, 4)', 'yield 1'),
                   SOURCE.replace('    def test_', '    @staticmethod\n    def test_'),
                   SOURCE.replace('    def test_', '    if True:\n        def test_'),
                   SOURCE + '\nsetattr(PublicBehavior, "test_other", lambda self: None)\n',
                   SOURCE + '\ndef helper():\n    class Nested(unittest.TestCase):\n        def test_nested(self): pass\n',
                   SOURCE.replace('import unittest', 'from unittest import *'),
                   SOURCE.replace('self.assertEqual(2 + 2, 4)', 'exec("pass")'),
                   SOURCE.replace('    def test_behavior', '    def run'),
                   SOURCE + '\n    def test_behavior(self): pass\n',
                   SOURCE + '\n    test_behavior = None\n']
        for index, source in enumerate(sources):
            with self.subTest(case=index):
                self.assert_rejected(planner.parse_planner_response, response(source))

    def test_builder_rejects_changed_artifact_binding(self):
        checks = planner.parse_planner_response(response()).checks
        for changed in (replace(checks, sha256='0' * 64), replace(checks, kind='trusted_public'),
                        replace(checks, schema_version=2), replace(checks, schema_version=True),
                        replace(checks, test_ids=('Other.test_x',)),
                        replace(checks, source=checks.source + '\n')):
            self.assert_rejected(planner.build_check_wrapper, changed)

    def test_complete_success_receipt_is_bound_to_source_and_process_exit(self):
        checks = planner.parse_planner_response(response()).checks
        actual = planner.parse_check_result(receipt(checks).encode(), 0, checks)
        self.assertEqual(actual['status'], 'passed')
        self.assertEqual(actual['kind'], planner.CHECK_KIND)
        self.assertNotIn('accepted', actual)

    def test_failed_skipped_and_expected_failure_execution_never_passes(self):
        checks = planner.parse_planner_response(response()).checks
        for outcome in ('failures', 'errors', 'skipped', 'expectedFailures', 'unexpectedSuccesses'):
            failed = receipt(checks, passed=0, status='failed', **{outcome: 1})
            self.assertEqual(planner.parse_check_result(failed, 1, checks)['status'], 'failed')
            self.assert_rejected(planner.parse_check_result, failed, 0, checks)

    def test_incomplete_zero_and_interrupted_suites_are_invalid(self):
        checks = planner.parse_planner_response(response()).checks
        zero = receipt(checks, discoveredTests=0, testsRun=0, passed=0, completed=False, status='invalid')
        self.assertEqual(planner.parse_check_result(zero, 2, checks)['status'], 'invalid')
        self.assert_rejected(planner.parse_check_result, zero, 0, checks)
        partial = receipt(checks, testsRun=0, passed=0, completed=False, status='invalid')
        self.assertEqual(planner.parse_check_result(partial, 2, checks)['status'], 'invalid')
        self.assert_rejected(planner.parse_check_result, receipt(checks), 124, checks)

    def test_receipt_forgery_drift_malformed_and_truncated_output_fail_closed(self):
        checks = planner.parse_planner_response(response()).checks
        for updates in ({'sourceSha256': '0' * 64}, {'kind': 'trusted_public'}, {'expectedTests': True},
                        {'passed': True}, {'testsRun': 0}, {'discoveredTests': 0}, {'completed': 1},
                        {'status': 'accepted'}, {'extra': 'private-source-sentinel'}, {'detail': '\x00'},
                        {'detail': 'x' * 2049}, {'schemaVersion': True}, {'errors': -1}):
            self.assert_rejected(planner.parse_check_result, receipt(checks, **updates), 0, checks)
        raw = receipt(checks)
        for output in ('', raw[:-1], raw + raw, 'fake prefix\n' + raw, raw + ' trailing', b'\xff'):
            self.assert_rejected(planner.parse_check_result, output, 0, checks)
        self.assert_rejected(planner.parse_check_result, raw, False, checks)


if __name__ == '__main__':
    unittest.main()
