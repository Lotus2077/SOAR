import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { digest } from "../../src/main/private-agent/contracts";
import { DOCUMENT_REVIEW_APPLIER_PATH, DOCUMENT_REVIEW_APPLIER_SHA256, DOCUMENT_REVIEW_ARTIFACTS, DOCUMENT_REVIEW_CHECK_ID, DOCUMENT_REVIEW_EDITS_PATH,
  documentReviewApplierFile, documentReviewCheck, documentReviewInstructions, withDocumentReview } from "../../src/main/private-agent/document-review";
import { DOCUMENT_REVIEW_FLAGS_PATH } from "../../src/main/private-agent/document-review-flags";
import { checkCommand } from "../../src/main/private-agent/runner";
import { PRIVATE_SANDBOX_LIMITS } from "../../src/main/private-agent/sandbox";
import type { SessionPhase } from "../../src/main/private-agent/session";
import { FLAGS_EDITS, FLAGS_EXPECTED, flagsDocumentXml } from "../helpers/document-review-fixtures";

const phase = (files: string[]): SessionPhase => ({ files: files.map(path => ({ path, bytes: Buffer.from(`bytes of ${path}`) })), checks: [{ id: "base_check", python: "pass" }],
  contract: { version: 1, goal: "Review the agreement.", requiredArtifacts: [{ path: "output/summary.md", description: "Summary" }], requiredChecks: ["base_check"],
    maxModelCalls: 10, maxToolCalls: 10, maxElapsedMs: 60_000 } });
const python = (code: string, input = "") => execFileSync("python3", ["-I", "-c", code], { input, timeout: 60_000 }).toString("utf8").trim();
/** CI has no lxml: this stub lets the applier and the check import, as long as nothing they run calls lxml. */
const STUB_LXML = "import sys, types\nlxml = types.ModuleType('lxml'); lxml.etree = types.SimpleNamespace(); sys.modules['lxml'] = lxml\n";
const OUTPUT_NAMES = DOCUMENT_REVIEW_ARTIFACTS.map(artifact => artifact.path).filter(path => path.startsWith("output/")).map(path => path.slice("output/".length));

describe("document review (PR-I)", { timeout: 60_000 }, () => {
  it("adds the pinned applier, the plan and outputs, the instructions and the fidelity check for the one source document", () => {
    const reviewed = withDocumentReview(phase(["input/agreement.docx", "input/notes.txt"]));
    expect(reviewed.files.map(file => file.path)).toEqual(["input/agreement.docx", "input/notes.txt", DOCUMENT_REVIEW_APPLIER_PATH]);
    expect(digest(reviewed.files.at(-1)!.bytes)).toBe(DOCUMENT_REVIEW_APPLIER_SHA256);
    expect(reviewed.contract.requiredArtifacts.map(artifact => artifact.path)).toEqual(["output/summary.md", ...DOCUMENT_REVIEW_ARTIFACTS.map(artifact => artifact.path)]);
    // Backlog item 7(d): the host flags are the sixth output (BL-20261109-0354).
    expect(DOCUMENT_REVIEW_ARTIFACTS.map(artifact => artifact.path)).toEqual(["review/edits.json", "output/redline.docx", "output/clean.docx", "output/issues.xlsx",
      "output/hygiene.json", "output/review-flags.json"]);
    expect(reviewed.contract.goal).toContain("output/review-flags.json (host flags for the owner's attention; a flag never fails the review)");
    expect(reviewed.contract.requiredChecks).toEqual(["base_check", DOCUMENT_REVIEW_CHECK_ID]);
    expect(reviewed.contract.goal).toContain(`python3 -I ${DOCUMENT_REVIEW_APPLIER_PATH} 'input/agreement.docx' ${DOCUMENT_REVIEW_EDITS_PATH} output`);
    const python = reviewed.checks.at(-1)!.python;
    const params = JSON.parse(Buffer.from(python.match(/json\.loads\(base64\.b64decode\("([A-Za-z0-9+/=]+)"\)\)/u)![1]!, "base64").toString("utf8"));
    expect(params).toEqual({ source: "input/agreement.docx", sourceSha256: digest(Buffer.from("bytes of input/agreement.docx")), applierSha256: DOCUMENT_REVIEW_APPLIER_SHA256 });
    // The applier rides in the check once, compressed, and is exactly the workspace copy.
    const embedded = inflateSync(Buffer.from(python.match(/zlib\.decompress\(base64\.b64decode\("([A-Za-z0-9+/=]+)"\)\)/u)![1]!, "base64"));
    expect(digest(embedded)).toBe(DOCUMENT_REVIEW_APPLIER_SHA256); expect(python).not.toContain("__");
  });
  it("refuses a phase without exactly one source document, a nested or foreign source path, or a reserved path already in use", () => {
    expect(() => withDocumentReview(phase(["input/notes.txt"]))).toThrow("document_review_source_invalid");
    expect(() => withDocumentReview(phase(["input/a.docx", "input/b.docx"]))).toThrow("document_review_source_invalid");
    expect(() => withDocumentReview(phase(["input/a.docx", DOCUMENT_REVIEW_APPLIER_PATH]))).toThrow("document_review_path_taken");
    expect(() => withDocumentReview(phase(["input/a.docx", "output/redline.docx"]))).toThrow("document_review_path_taken");
    expect(() => withDocumentReview(phase(["input/a.docx", "output/review-flags.json"]))).toThrow("document_review_path_taken");
    // Any second .docx under input/, nested or not, makes the source ambiguous; a nested one alone is not a source.
    expect(() => withDocumentReview(phase(["input/agreement.docx", "input/exhibits/schedule.docx"]))).toThrow("document_review_source_invalid");
    expect(() => withDocumentReview(phase(["input/exhibits/schedule.docx"]))).toThrow("document_review_source_invalid");
    expect(withDocumentReview(phase(["input/MSA.DOCX"])).contract.requiredChecks).toContain(DOCUMENT_REVIEW_CHECK_ID);
    // The added artifacts and goal text must fit the job contract, refused before any caller writes state.
    const crowded = phase(["input/a.docx"]);
    crowded.contract.requiredArtifacts = Array.from({ length: 26 }, (_, i) => ({ path: `output/a${i}.md`, description: "x" }));
    expect(() => withDocumentReview(crowded)).toThrow("document_review_contract_limits");
    // With six review outputs under the contract's cap of 30, a task keeps at most 24 artifacts of its own.
    crowded.contract.requiredArtifacts = crowded.contract.requiredArtifacts.slice(0, 25);
    expect(() => withDocumentReview(crowded)).toThrow("document_review_contract_limits");
    crowded.contract.requiredArtifacts = crowded.contract.requiredArtifacts.slice(0, 24);
    expect(withDocumentReview(crowded).contract.requiredArtifacts).toHaveLength(30);
    for (const sourcePath of ["input/../a.docx", "input/sub/a.docx", "output/a.docx", "input/a.doc", "input/a\nb.docx"]) {
      expect(() => documentReviewCheck({ sourcePath, sourceSha256: "a".repeat(64) })).toThrow("document_review_source_invalid");
    }
    expect(() => documentReviewCheck({ sourcePath: "input/a.docx", sourceSha256: "nothex" })).toThrow("document_review_source_invalid");
  });
  it("ships Python that parses, and an applier that matches its published hash", () => {
    // Python 3.9 syntax: this repository's Macs run python3 3.9, the image 3.11 and CI a newer python3 (3.12 or later).
    const parse = (source: string) => execFileSync("python3", ["-I", "-c", "import ast, sys; ast.parse(sys.stdin.read(), feature_version=(3, 9))"], { input: source, timeout: 30_000 });
    expect(() => parse(documentReviewApplierFile().bytes.toString("utf8"))).not.toThrow();
    expect(() => parse(documentReviewCheck({ sourcePath: "input/a.docx", sourceSha256: "a".repeat(64) }).python)).not.toThrow();
    // Python 3.12 and later parse PEP 701 f-strings even under feature_version=(3, 9), so f-strings are refused by node type.
    const fStrings = (source: string) => python("import ast, sys\nprint(sum(isinstance(n, ast.JoinedStr) for n in ast.walk(ast.parse(sys.stdin.read()))))", source);
    expect(fStrings(documentReviewApplierFile().bytes.toString("utf8"))).toBe("0");
    expect(fStrings(documentReviewCheck({ sourcePath: "input/a.docx", sourceSha256: "a".repeat(64) }).python)).toBe("0");
    expect(documentReviewInstructions("input/a.docx")).toContain(`--list 'input/a.docx'`);
    // File names reach the shell quoted.
    expect(documentReviewInstructions("input/Smith & Co's MSA.docx")).toContain(`--list 'input/Smith & Co'\\''s MSA.docx'`);
  });
  it("keeps the whole check command well under the sandbox's command cap, even for the longest source path", () => {
    const longest = `input/${"x".repeat(195)}.docx`;
    const bytes = Buffer.byteLength(checkCommand(documentReviewCheck({ sourcePath: longest, sourceSha256: "a".repeat(64) })));
    expect(bytes).toBeLessThan(PRIVATE_SANDBOX_LIMITS.commandBytes - 24 * 1024);
  });
  // Backlog item 7(d) (BL-20261109-0354): the flags file is an output like the others.
  it("requires, compares and has the applier write exactly the outputs the artifact list names", () => {
    expect(OUTPUT_NAMES).toEqual(["redline.docx", "clean.docx", "issues.xlsx", "hygiene.json", "review-flags.json"]);
    const check = python("import ast, json, sys\ntree = ast.parse(sys.stdin.read())\n" +
      "outputs = [e.value for node in tree.body if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'OUTPUTS' for t in node.targets) for e in node.value.elts]\n" +
      "def compares(loop):\n    return any(isinstance(n, ast.BinOp) and isinstance(n.left, ast.Constant) and n.left.value == 'output/' and isinstance(n.right, ast.Name) and n.right.id == loop.target.id for n in ast.walk(loop))\n" +
      "loops = [[e.value for e in node.iter.elts] for node in ast.walk(tree) if isinstance(node, ast.For) and isinstance(node.iter, ast.Tuple) and isinstance(node.target, ast.Name) and compares(node)]\n" +
      "print(json.dumps({'outputs': outputs, 'loops': loops}))", documentReviewCheck({ sourcePath: "input/a.docx", sourceSha256: "a".repeat(64) }).python);
    expect(JSON.parse(check)).toEqual({ outputs: OUTPUT_NAMES.map(name => `output/${name}`), loops: [OUTPUT_NAMES] });
    const written = python("import ast, json, sys\nrun = next(node for node in ast.parse(sys.stdin.read()).body if isinstance(node, ast.FunctionDef) and node.name == 'run')\n" +
      "print(json.dumps([[k.value for k in node.value.keys] for node in ast.walk(run) if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'outputs' for t in node.targets)]))",
    documentReviewApplierFile().bytes.toString("utf8"));
    expect(JSON.parse(written)).toEqual([OUTPUT_NAMES]);
  });
  it("feeds the host flags the source and clean views and reports their summary on stdout (pinned, since only the Docker suite runs run())", () => {
    const wiring = python("import ast, json, sys\nrun = next(node for node in ast.parse(sys.stdin.read()).body if isinstance(node, ast.FunctionDef) and node.name == 'run')\n" +
      "call = next(node for node in ast.walk(run) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'review_flags_or_error')\n" +
      "returned = next(node.value for node in ast.walk(run) if isinstance(node, ast.Return) and isinstance(node.value, ast.Dict))\n" +
      "print(json.dumps({'inputs': [ast.unparse(e) for e in call.args[0].body.elts], 'flags': [ast.unparse(v) for k, v in zip(returned.keys, returned.values) if k.value == 'flags']}))",
    documentReviewApplierFile().bytes.toString("utf8"));
    expect(JSON.parse(wiring)).toEqual({ inputs: ["units_for_flags(document, paragraphs)", "masked_texts(paragraphs)", "masked_texts(body_paragraphs(clean_doc))", "edits_for_flags(located)"],
      flags: ["flags_summary(flags)"] });
  });
  it("fails a workspace without the flags file as artifact_missing before it re-runs the applier (CI-runnable with a stub lxml)", () => {
    const root = mkdtempSync(join(tmpdir(), "soar-review-check-"));
    try {
      const source = Buffer.from("not a real docx");
      for (const dir of ["input", "review", "output"]) mkdirSync(join(root, dir));
      writeFileSync(join(root, "input/a.docx"), source);
      writeFileSync(join(root, DOCUMENT_REVIEW_APPLIER_PATH), documentReviewApplierFile().bytes);
      writeFileSync(join(root, DOCUMENT_REVIEW_EDITS_PATH), "{}");
      for (const name of OUTPUT_NAMES) if (`output/${name}` !== DOCUMENT_REVIEW_FLAGS_PATH) writeFileSync(join(root, "output", name), "x");
      const check = () => spawnSync("python3", ["-I", "-c", `${STUB_LXML}exec(compile(sys.stdin.read(), "check", "exec"))\n`],
        { cwd: root, input: documentReviewCheck({ sourcePath: "input/a.docx", sourceSha256: digest(source) }).python, timeout: 60_000 });
      const missing = check();
      expect(missing.status).toBe(1);
      expect(JSON.parse(missing.stdout.toString("utf8"))).toEqual({ passed: false, failures: [{ code: "artifact_missing", path: DOCUMENT_REVIEW_FLAGS_PATH }] });
      // With the file present, step 1 passes and the check re-runs the applier, which cannot apply this plan here.
      writeFileSync(join(root, DOCUMENT_REVIEW_FLAGS_PATH), "x");
      const present = check();
      expect(present.status).toBe(1);
      expect((JSON.parse(present.stdout.toString("utf8")) as { failures: { code: string }[] }).failures.map(failure => failure.code)).toEqual(["applier_refused_plan"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("builds the host flags' input from the body: tables numbered in order, nested ones apart, text boxes skipped, fields masked, hidden text read", () => {
    // Enough of lxml's tree API, over the standard library's ElementTree, for the applier's read-only body functions; CI has no lxml.
    const tree = "import json, sys, types\nimport xml.etree.ElementTree as ET\nclass Node:\n" +
      "    def __init__(self, element, parent=None):\n        self.tag, self.text, self.attrib, self.parent = element.tag, element.text, dict(element.attrib), parent\n" +
      "        self.children = [Node(child, self) for child in element]\n    def __iter__(self):\n        return iter(self.children)\n" +
      "    def get(self, key, default=None):\n        return self.attrib.get(key, default)\n" +
      "    def iter(self, tag=None):\n        if tag is None or self.tag == tag:\n            yield self\n        for child in self.children:\n            yield from child.iter(tag)\n" +
      "    def iterancestors(self):\n        node = self.parent\n        while node is not None:\n            yield node\n            node = node.parent\n" +
      "    def find(self, tag):\n        return next((child for child in self.children if child.tag == tag), None)\n" +
      "lxml = types.ModuleType('lxml'); lxml.etree = types.SimpleNamespace(QName=lambda node: types.SimpleNamespace(localname=node.tag.split('}')[-1])); sys.modules['lxml'] = lxml\n" +
      "data = json.loads(sys.stdin.read())\nns = {'__name__': 'applier'}\nexec(compile(data['applier'], 'applier', 'exec'), ns)\n" +
      "document = Node(ET.fromstring(data['document']))\nparagraphs = ns['body_paragraphs'](document)\n" +
      "located, texts = ns['locate'](data['edits'], paragraphs, ns['field_depths'](paragraphs))\n" +
      "units, source = ns['units_for_flags'](document, paragraphs), ns['masked_texts'](paragraphs)\n" +
      "# No edit touches a field here, so the clean view is the masked source with the plan applied.\n" +
      "flags = ns['review_flags_or_error'](lambda: (units, source, ns['expected_texts'](located, source), ns['edits_for_flags'](located)))\n" +
      "failed = {'counts': {'numericSource': 0}, 'numeric': {'error': 'KeyError'}, 'edits': {}, 'clauses': {'error': 'IndexError'}, 'error': 'ValueError'}\n" +
      "print(json.dumps({'units': units, 'source': source, 'edits': ns['edits_for_flags'](located), 'flags': flags, 'summary': ns['flags_summary'](flags), 'failed': ns['flags_summary'](failed)}))";
    const built = JSON.parse(python(tree, JSON.stringify({ applier: documentReviewApplierFile().bytes.toString("utf8"), document: flagsDocumentXml(), edits: FLAGS_EDITS }))) as {
      units: object[]; source: string[]; edits: object[]; flags: Record<string, { flags?: unknown[]; error?: string }>; summary: Record<string, number | string>;
      failed: Record<string, number | string> };
    const prose = { kind: "prose" }, cell = (table: number, row: number, col: number) => ({ kind: "cell", table, row, col });
    expect(built.units).toEqual([prose, cell(1, 1, 1), cell(1, 1, 2), cell(1, 2, 1), cell(1, 2, 2), prose, prose, prose, prose, cell(2, 1, 1), cell(2, 1, 2), cell(2, 2, 1),
      cell(3, 1, 1), cell(3, 1, 2), cell(3, 2, 1), cell(3, 2, 2), cell(2, 2, 1), cell(2, 2, 2), cell(2, 3, 1), cell(2, 3, 2), prose, prose, prose]);
    expect([built.source[8], built.source[20], built.source[22]]).toEqual(["5. A draft fee table is kept in this box: \ufffc", "6. The deposit amount is USD 20.",
      `8. The late payment fee is set in ${"\u0000".repeat(6)}.`]);
    // The located edits, 1-based, at their offsets in their own paragraph's text.
    expect(built.edits).toEqual([{ id: "E1", action: "comment", paragraph: 6, start: "2. The late payment fee is ".length, end: "2. The late payment fee is USD 75".length, newText: "" },
      { id: "E2", action: "replace", paragraph: 8, start: "4. The Supplier ".length, end: "4. The Supplier shall not be liable".length, newText: "shall be liable" }]);
    expect(built.flags.error).toBeUndefined();
    expect([built.flags.numeric!.flags, built.flags.edits!.flags, built.flags.clauses!.flags]).toEqual([FLAGS_EXPECTED.numeric, FLAGS_EXPECTED.edits, FLAGS_EXPECTED.clauses]);
    expect(built.flags.read).toEqual(FLAGS_EXPECTED.read);
    // The applier's stdout summary: the counts, then the step's error and each failed rule's, which the integration suite requires to be absent.
    expect(built.summary).toEqual(FLAGS_EXPECTED.counts);
    expect(built.failed).toEqual({ numericSource: 0, error: "ValueError", numericError: "KeyError", clausesError: "IndexError" });
  });
  it("refuses a plan id that matches only before a trailing newline", () => {
    const code = `${STUB_LXML}import json\nns = {"__name__": "applier"}\nexec(compile(sys.stdin.read(), "applier", "exec"), ns)\n` +
      "def attempt(ids):\n    edits = [{'id': i, 'anchor': 'a', 'action': 'comment', 'rationale': 'r', 'severity': 'low'} for i in ids]\n" +
      "    try:\n        ns['load_plan'](json.dumps({'version': 1, 'edits': edits}).encode('utf-8'))\n        return 'ok'\n" +
      "    except ns['PlanError'] as error:\n        return [[e['id'], e['code']] for e in error.errors]\n" +
      "print(json.dumps([attempt(ids) for ids in (['E1', 'E01', 'E999'], ['E1\\n'], ['E1000'], ['e1'], ['E1', 'E1'])]))";
    expect(JSON.parse(python(code, documentReviewApplierFile().bytes.toString("utf8")))).toEqual(["ok", [["E1\n", "id_invalid_or_duplicate"]],
      [["E1000", "id_invalid_or_duplicate"]], [["e1", "id_invalid_or_duplicate"]], [["E1", "id_invalid_or_duplicate"]]]);
  });
});
