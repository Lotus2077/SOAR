"""Version 1 model-generated checks: parse on the host, execute only in Docker.

These checks are fallible model output, separate from trusted public visible
checks. A successful execution receipt is never semantic acceptance. AST checks
establish a countable unittest shape, not a Python security sandbox. Callers own
Docker isolation, source binding, time/output limits and provider accounting.
"""

import ast
from dataclasses import dataclass
import hashlib
import json


PLANNER_CHECKS_SCHEMA_VERSION = 1
MAX_PLAN_BYTES = 4000
MAX_SOURCE_BYTES = 6000
MAX_RESPONSE_BYTES = 16384
MAX_TESTS = 12
MAX_RESULT_DETAIL_BYTES = 2048
CHECK_KIND = "model_generated_python_unittest"
RESULT_PREFIX = "SOAR_MODEL_GENERATED_CHECKS_V1="

PLANNER_CHECKS_EXAMPLE_SOURCE = '''import unittest

class PublicRequirements(unittest.TestCase):
    def test_public_behavior(self):
        self.fail("Replace this example with assertions for the public repository task")
'''

PLANNER_CHECKS_FORMAT = """Return exactly one JSON object, without fences or extra keys:
{"plan":"concise implementation plan","checks":{"source":"Python unittest source","expectedTests":1}}
The plan is at most 4000 UTF-8 bytes, source at most 6000 UTF-8 bytes, and the
entire response at most 16384 UTF-8 bytes. expectedTests is an integer from 1 to
12 matching the number of explicit test_* methods. Use import unittest and
top-level classes inheriting directly from unittest.TestCase. Use synchronous
undecorated test methods with only self. Imports, literal fixture constants and
helper functions are allowed. Do not use decorators, skips, expected failures,
subTest, dynamic test generation, inherited test cases, load_tests, suite hooks,
or unittest.main. Do not execute code at module level except imports/definitions.
No NUL characters. The host executes the source later in isolated Docker only.

The configured visible check is a separate command run by the host. It is not a
template for checks.source. Do not copy its sys.path changes, runner invocation,
or if __name__ == "__main__" guard. The host already provides the import roots
and discovers the tests. Put fixture construction and other executable setup in
setUp or test_* methods, not module-level assignments or class bodies. Each test
class must have exactly one base, unittest.TestCase, with no class keywords or
decorators.

This complete JSON example illustrates the declaration and response shape only.
Replace its failing placeholder with meaningful assertions derived from the
public task and repository; do not submit the illustrative test unchanged:
""" + json.dumps({"plan": "Implement the requested public behavior and preserve existing behavior.",
                  "checks": {"source": PLANNER_CHECKS_EXAMPLE_SOURCE, "expectedTests": 1}})

PLANNER_CHECKS_SYSTEM = """Plan the supplied public repository task and write a small
executable regression suite using only the public task and supplied repository
source. Cover the requested behavior and relevant existing behavior. Do not use
hidden checks, reference patches or private evaluator information. These are
model-generated checks, not trusted acceptance tests. Do not claim they passed;
no execution has occurred. Avoid clocks, network access and external services.
""" + PLANNER_CHECKS_FORMAT


class PlannerChecksError(Exception):
    """Fixed diagnostic code; source, prompts and provider text are never echoed."""

    def __init__(self, code):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class GeneratedChecks:
    schema_version: int
    kind: str
    source: str
    expected_tests: int
    sha256: str
    test_ids: tuple[str, ...]


@dataclass(frozen=True)
class PlannerCheckPlan:
    plan: str
    checks: GeneratedChecks


def _fail(code):
    raise PlannerChecksError(code)


def _text(value, cap, code, *, nonblank=True):
    if not isinstance(value, str):
        _fail(code)
    try:
        size = len(value.encode("utf-8"))
    except UnicodeError:
        _fail(code)
    if size > cap or "\x00" in value or (nonblank and not value.strip()):
        _fail(code)
    return value


def _unique(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError("duplicate")
        obj[key] = value
    return obj


def _invalid_constant(_value):
    raise ValueError("nonfinite")


def _json(raw, code):
    if isinstance(raw, bytes):
        if len(raw) > MAX_RESPONSE_BYTES:
            _fail(code)
        try:
            raw = raw.decode("utf-8", errors="strict")
        except UnicodeError:
            _fail(code)
    raw = _text(raw, MAX_RESPONSE_BYTES, code)
    try:
        return json.loads(raw, object_pairs_hook=_unique, parse_constant=_invalid_constant)
    except (ValueError, RecursionError):
        _fail(code)


def _literal_statement(node):
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
        return True
    if isinstance(node, (ast.Assign, ast.AnnAssign)):
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not all(isinstance(target, ast.Name) and not target.id.startswith("__") for target in targets):
            return False
        try:
            ast.literal_eval(node.value)
            return True
        except (ValueError, TypeError, RecursionError):
            return False
    return False


def _declared_tests(source):
    try:
        tree = ast.parse(source, filename="model_generated_checks.py", mode="exec")
    except (SyntaxError, ValueError, RecursionError):
        _fail("planner_checks_syntax")
    # This deliberately small declaration contract makes static counts exact.
    forbidden = {"load_tests", "setUpModule", "tearDownModule", "skipTest", "SkipTest", "skip", "skipIf", "skipUnless",
                 "expectedFailure", "subTest", "exec", "eval", "setattr", "delattr", "type"}
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.Yield, ast.YieldFrom)):
            _fail("planner_checks_declarations")
        if isinstance(node, ast.Name) and (node.id in forbidden or node.id.startswith("__unittest")):
            _fail("planner_checks_declarations")
        if isinstance(node, ast.Attribute) and (node.attr in forbidden or node.attr.startswith("__unittest")):
            _fail("planner_checks_declarations")
    classes, identities, names = [], [], set()
    has_unittest = False
    for node in tree.body:
        bound = []
        if isinstance(node, (ast.ClassDef, ast.FunctionDef)):
            bound = [node.name]
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            bound = [alias.asname or alias.name.split('.')[0] for alias in node.names]
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            bound = [target.id for target in targets if isinstance(target, ast.Name)]
        if any(name in names for name in bound) or len(set(bound)) != len(bound):
            _fail("planner_checks_declarations")
        names.update(bound)
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            if any(alias.name == "*" for alias in node.names):
                _fail("planner_checks_declarations")
            if isinstance(node, ast.Import):
                has_unittest |= any(alias.name == "unittest" and alias.asname is None for alias in node.names)
            continue
        if _literal_statement(node):
            continue
        if isinstance(node, ast.FunctionDef):
            if node.decorator_list or node.name in forbidden or node.name.startswith("test") or node.name.startswith("__"):
                _fail("planner_checks_declarations")
            continue
        if not isinstance(node, ast.ClassDef) or node.decorator_list or node.keywords or len(node.bases) != 1:
            _fail("planner_checks_declarations")
        base = node.bases[0]
        if not (isinstance(base, ast.Attribute) and isinstance(base.value, ast.Name)
                and base.value.id == "unittest" and base.attr == "TestCase"):
            _fail("planner_checks_declarations")
        methods, count = set(), 0
        for member in node.body:
            if _literal_statement(member):
                if isinstance(member, (ast.Assign, ast.AnnAssign)):
                    targets = member.targets if isinstance(member, ast.Assign) else [member.target]
                    if any(target.id.startswith('test') or target.id in methods for target in targets):
                        _fail("planner_checks_declarations")
                    methods.update(target.id for target in targets)
                continue
            if not isinstance(member, ast.FunctionDef) or member.decorator_list or member.name in methods:
                _fail("planner_checks_declarations")
            methods.add(member.name)
            if member.name.startswith("__") or member.name in {"run", "debug", "countTestCases", "id", "setUpClass", "tearDownClass"}:
                _fail("planner_checks_declarations")
            if member.name.startswith("test"):
                args = member.args
                if (not member.name.startswith("test_") or len(args.args) != 1 or args.args[0].arg != "self"
                        or args.posonlyargs or args.kwonlyargs or args.vararg or args.kwarg or args.defaults):
                    _fail("planner_checks_declarations")
                identities.append(node.name + "." + member.name)
                count += 1
        if not count:
            _fail("planner_checks_declarations")
        classes.append(node)
    # Reject nested/conditional class or test declarations, including helpers
    # that would dynamically introduce tests when imported or called.
    allowed_methods = {id(member) for cls in classes for member in cls.body if isinstance(member, ast.FunctionDef)}
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node not in classes:
            _fail("planner_checks_declarations")
        if isinstance(node, ast.FunctionDef) and node.name.startswith("test") and id(node) not in allowed_methods:
            _fail("planner_checks_declarations")
    if not has_unittest or not 1 <= len(identities) <= MAX_TESTS:
        _fail("planner_checks_count")
    return tuple(sorted(identities))


def parse_planner_response(raw: str | bytes) -> PlannerCheckPlan:
    """Parse visible planner JSON after the caller settles provider usage."""
    obj = _json(raw, "planner_checks_response")
    if not isinstance(obj, dict) or set(obj) != {"plan", "checks"}:
        _fail("planner_checks_schema")
    plan = _text(obj["plan"], MAX_PLAN_BYTES, "planner_checks_plan")
    checks = obj["checks"]
    if not isinstance(checks, dict) or set(checks) != {"source", "expectedTests"}:
        _fail("planner_checks_schema")
    source = _text(checks["source"], MAX_SOURCE_BYTES, "planner_checks_source")
    count = checks["expectedTests"]
    if type(count) is not int or not 1 <= count <= MAX_TESTS:
        _fail("planner_checks_count")
    identities = _declared_tests(source)
    if len(identities) != count:
        _fail("planner_checks_count")
    return PlannerCheckPlan(plan, GeneratedChecks(PLANNER_CHECKS_SCHEMA_VERSION, CHECK_KIND,
                            source, count, hashlib.sha256(source.encode("utf-8")).hexdigest(), identities))


def _validate_artifact(checks):
    if (not isinstance(checks, GeneratedChecks) or type(checks.schema_version) is not int
            or checks.schema_version != PLANNER_CHECKS_SCHEMA_VERSION or checks.kind != CHECK_KIND
            or type(checks.expected_tests) is not int or not 1 <= checks.expected_tests <= MAX_TESTS):
        _fail("planner_checks_artifact")
    source = _text(checks.source, MAX_SOURCE_BYTES, "planner_checks_artifact")
    identities = _declared_tests(source)
    if (checks.sha256 != hashlib.sha256(source.encode('utf-8')).hexdigest()
            or checks.test_ids != identities or checks.expected_tests != len(identities)):
        _fail("planner_checks_artifact")


def build_check_wrapper(checks: GeneratedChecks) -> str:
    """Return executable text only. Never run this wrapper on the host.

    Execute with the caller's existing isolated Docker harness. A missing receipt,
    timeout, truncated output, nonmatching process status or changed source fails
    closed. Counts are runner observations, not proof that model assertions are
    complete or correct, nor protection against deliberately hostile Python.
    """
    _validate_artifact(checks)
    config = repr({"source": checks.source, "sha256": checks.sha256,
                   "expectedTests": checks.expected_tests, "testIds": checks.test_ids})
    return _WRAPPER.replace("__SOAR_CONFIG__", config)


_WRAPPER = '''# Trusted wrapper v1. Model-generated source executes in Docker only.
import contextlib, io, json, sys, types, unittest
C = __SOAR_CONFIG__
class Capture(io.TextIOBase):
    def __init__(self): self.text = ''
    def write(self, value):
        self.text = (self.text + value[:4096])[-4096:]
        return len(value)
class Observed(unittest.TestResult):
    def __init__(self):
        super().__init__(); self.started = []; self.stopped = []; self.passed = 0
    def startTest(self, test):
        self.started.append(test.id()); super().startTest(test)
    def stopTest(self, test):
        self.stopped.append(test.id()); super().stopTest(test)
    def addSuccess(self, test):
        self.passed += 1; super().addSuccess(test)
capture = Capture()
result = Observed()
discovered = 0
completed = False
detail = ''
try:
    with contextlib.redirect_stdout(capture), contextlib.redirect_stderr(capture):
        module = types.ModuleType('model_generated_checks')
        exec(compile(C['source'], 'model_generated_checks.py', 'exec'), module.__dict__)
        loader = unittest.TestLoader()
        cases = []
        for name in sorted({item.split('.')[0] for item in C['testIds']}):
            cls = module.__dict__[name]
            if not isinstance(cls, type) or cls.__bases__ != (unittest.TestCase,):
                raise ValueError('invalid generated class')
            cases.extend(loader.loadTestsFromTestCase(cls))
        expected = ['model_generated_checks.' + item for item in C['testIds']]
        identities = sorted(test.id() for test in cases)
        discovered = len(identities)
        if loader.errors or identities != expected:
            raise ValueError('generated discovery mismatch')
        unittest.TestSuite(cases).run(result)
        completed = (result.testsRun == C['expectedTests'] and
                     sorted(result.started) == expected and sorted(result.stopped) == expected)
        details = result.failures + result.errors
        detail = '\\n'.join(trace[-2048:] for _, trace in details)[:4096]
except BaseException:
    detail = 'generated check harness did not complete'
detail = detail.replace(chr(0), '?')
successful = (completed and result.wasSuccessful() and not result.skipped and
              not result.expectedFailures and not result.unexpectedSuccesses and
              result.passed == C['expectedTests'])
status = 'passed' if successful else ('failed' if completed else 'invalid')
receipt = {'schemaVersion': 1, 'kind': 'model_generated_python_unittest',
           'sourceSha256': C['sha256'], 'expectedTests': C['expectedTests'],
           'discoveredTests': discovered, 'testsRun': result.testsRun,
           'passed': result.passed, 'failures': len(result.failures), 'errors': len(result.errors),
           'skipped': len(result.skipped), 'expectedFailures': len(result.expectedFailures),
           'unexpectedSuccesses': len(result.unexpectedSuccesses),
           'completed': completed, 'status': status, 'detail': detail.encode('utf-8', 'replace')[:2048].decode('utf-8', 'ignore')}
print('SOAR_MODEL_GENERATED_CHECKS_V1=' + json.dumps(receipt, ensure_ascii=True, separators=(',', ':')))
raise SystemExit({'passed': 0, 'failed': 1, 'invalid': 2}[status])
'''


def parse_check_result(output: str | bytes, returncode: int, checks: GeneratedChecks) -> dict:
    """Validate a complete Docker process result; a failed suite stays failed."""
    _validate_artifact(checks)
    if type(returncode) is not int or returncode not in (0, 1, 2):
        _fail("planner_checks_result")
    if isinstance(output, bytes):
        try:
            output = output.decode("utf-8", errors="strict")
        except UnicodeError:
            _fail("planner_checks_result")
    output = _text(output, MAX_RESPONSE_BYTES, "planner_checks_result")
    if not output.startswith(RESULT_PREFIX) or output.count(RESULT_PREFIX) != 1:
        _fail("planner_checks_result")
    obj = _json(output[len(RESULT_PREFIX):], "planner_checks_result")
    keys = {'schemaVersion', 'kind', 'sourceSha256', 'expectedTests', 'discoveredTests', 'testsRun',
            'passed', 'failures', 'errors', 'skipped', 'expectedFailures', 'unexpectedSuccesses',
            'completed', 'status', 'detail'}
    if not isinstance(obj, dict) or set(obj) != keys:
        _fail("planner_checks_result")
    counts = ('discoveredTests', 'testsRun', 'passed', 'failures', 'errors', 'skipped',
              'expectedFailures', 'unexpectedSuccesses')
    if (type(obj['schemaVersion']) is not int or obj['schemaVersion'] != 1 or obj['kind'] != CHECK_KIND
            or obj['sourceSha256'] != checks.sha256 or type(obj['expectedTests']) is not int
            or obj['expectedTests'] != checks.expected_tests or type(obj['completed']) is not bool
            or any(type(obj[key]) is not int or not 0 <= obj[key] <= MAX_TESTS for key in counts)):
        _fail("planner_checks_result")
    _text(obj['detail'], MAX_RESULT_DETAIL_BYTES, "planner_checks_result", nonblank=False)
    if (obj['passed'] > obj['testsRun'] or obj['testsRun'] > obj['discoveredTests']
            or (obj['completed'] and not obj['discoveredTests'] == obj['testsRun'] == obj['expectedTests'])):
        _fail("planner_checks_result")
    successful = (obj['completed'] and obj['discoveredTests'] == obj['testsRun'] == obj['passed'] == checks.expected_tests
                  and all(obj[key] == 0 for key in ('failures', 'errors', 'skipped', 'expectedFailures', 'unexpectedSuccesses')))
    status = 'passed' if successful else ('failed' if obj['completed'] else 'invalid')
    if obj['status'] != status or returncode != {'passed': 0, 'failed': 1, 'invalid': 2}[status]:
        _fail("planner_checks_result")
    return obj
