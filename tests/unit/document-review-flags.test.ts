import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { REVIEW_FLAGS_PY, documentReviewApplierFile } from "../../src/main/private-agent/document-review";
import { DOCUMENT_REVIEW_FLAG_COUNTS, DOCUMENT_REVIEW_FLAG_LIST_MAX, DOCUMENT_REVIEW_FLAG_RULES, DOCUMENT_REVIEW_FLAG_UNITS, DOCUMENT_REVIEW_FLAG_VALUES_MAX, DOCUMENT_REVIEW_FLAGS_VERSION,
  DocumentReviewFlagsSchema } from "../../src/main/private-agent/document-review-flags";

type Unit = { kind: "prose" } | { kind: "cell"; table: number; row: number; col: number };
type Edit = { id: string; action: "replace" | "delete" | "insert_after" | "comment"; paragraph: number; start: number; end: number; newText?: string };
const DRIVER = `${REVIEW_FLAGS_PY}\nimport sys\nargs = json.loads(sys.stdin.buffer.read().decode("utf-8"))\n` +
  `sys.stdout.buffer.write(review_flags_json(review_flags_or_error(lambda: (args["units"], args["source"], args["clean"], args["edits"]))))\n`;
/** The rules under python3 -I, exactly as the applier calls them and with the bytes it writes, on synthetic paragraphs. */
function flags(units: Unit[], source: string[], clean: string[] = source, edits: Edit[] = [], options: { args?: string[]; env?: NodeJS.ProcessEnv } = {}) {
  const bytes = execFileSync("python3", [...(options.args ?? ["-I"]), "-c", DRIVER], { input: Buffer.from(JSON.stringify({ units, source, clean, edits }), "utf8"),
    ...(options.env ? { env: options.env } : {}), timeout: 20_000 });
  return { bytes, value: DocumentReviewFlagsSchema.parse(JSON.parse(bytes.toString("utf8"))) };
}
const prose = (n: number): Unit[] => Array.from({ length: n }, () => ({ kind: "prose" as const }));
const cell = (table: number, row: number, col: number): Unit => ({ kind: "cell", table, row, col });
/** A header row and one fee row, then the given prose paragraphs (numbered from 5). */
const feeTable = (label: string, value: string, header = "Fee (USD)") => ({ units: [cell(1, 1, 1), cell(1, 1, 2), cell(1, 2, 1), cell(1, 2, 2)], texts: ["Item", header, label, value] });
const python = (code: string, input = "") => execFileSync("python3", ["-I", "-c", code], { input }).toString("utf8").trim();

describe("backlog item 7(d): the applier's host flags, rules v1 (BL-20261109-0354)", () => {
  describe("N1, a table against the prose", () => {
    it("flags a prose figure in the row's unit that equals none of the row's values, with the values on each side", () => {
      const t = feeTable("Late payment fee", "50");
      const { value } = flags([...t.units, ...prose(1)], [...t.texts, "The late payment fee is $75 per invoice."]);
      expect(value.numeric.flags).toEqual([{ table: 1, row: 2, paragraph: 5, inSource: true, inClean: true, addressedBy: [],
        source: { row: ["50 USD"], prose: ["75 USD"] }, clean: { row: ["50 USD"], prose: ["75 USD"] } }]);
      expect(value.counts).toMatchObject({ numericSource: 1, numericUnaddressed: 1, numericIntroduced: 0, numericResolved: 0 });
    });
    it("leaves equal values, another unit, an absent label, a numbered label and a scale word alone", () => {
      const t = feeTable("Late payment fee", "50");
      for (const sentence of ["The late payment fee is USD 50.00 per invoice.", "The late payment fee applies after 30 days.", "A fee of $75 applies to returns.",
        "The late payment fees are $75.", "The late payment fee is USD 1.5 million."]) expect(flags([...t.units, ...prose(1)], [...t.texts, sentence]).value.numeric.flags, sentence).toEqual([]);
      const numbered = feeTable("Fee 2", "50");
      expect(flags([...numbered.units, ...prose(1)], [...numbered.texts, "The fee 2 is $75."]).value.numeric.flags).toEqual([]);
    });
    it("reads a bare cell number in its header's single unit, and ignores it under a header with none, two or a scale", () => {
      const days = feeTable("Notice period", "30", "Days");
      expect(flags([...days.units, ...prose(1)], [...days.texts, "The notice period is 45 days."]).value.numeric.flags).toHaveLength(1);
      for (const header of ["Value", "Fee (USD) or days", "Days (thousands)"]) {
        const t = feeTable("Notice period", "30", header);
        expect(flags([...t.units, ...prose(1)], [...t.texts, "The notice period is 45 days."]).value.numeric.flags, header).toEqual([]);
      }
    });
    it("never reads references, dotted clause numbers, list markers or bare years as quantities", () => {
      const t = feeTable("Late payment fee", "$50");
      for (const sentence of ["1. The late payment fee is set out in section 4.", "The late payment fee is in clause 7.2.1 of Schedule 3.",
        "The late payment fee was set in 2024.", "The late payment fee is shown on page 12."]) expect(flags([...t.units, ...prose(1)], [...t.texts, sentence]).value.numeric.flags, sentence).toEqual([]);
    });
    it("records a flag the plan resolved, one it introduced and the edits that touched each", () => {
      const t = feeTable("Late payment fee", "$50"), units = [...t.units, ...prose(2)];
      const source = [...t.texts, "The late payment fee is $75.", "The late payment fee is $50."];
      const clean = [...t.texts, "The late payment fee is $50.", "The late payment fee is $60."];
      const { value } = flags(units, source, clean, [{ id: "E1", action: "replace", paragraph: 5, start: 25, end: 27, newText: "50" },
        { id: "E2", action: "replace", paragraph: 6, start: 25, end: 27, newText: "60" }]);
      expect(value.numeric.flags.map(f => [f.paragraph, f.inSource, f.inClean, f.addressedBy])).toEqual([[5, true, false, ["E1"]], [6, false, true, ["E2"]]]);
      expect(value.counts).toMatchObject({ numericSource: 1, numericResolved: 1, numericIntroduced: 1, numericUnaddressed: 0 });
    });
  });
  describe("C1, an edit that turns its clause around", () => {
    it.each([
      ["The Supplier shall not disclose the data.", 13, 22, "shall", ["negation_flipped"]],
      ["Fees include all taxes.", 5, 12, "exclude", ["polarity_swapped"]],
      ["The Customer must give notice.", 13, 17, "may", ["modality_changed"]],
      ["The Buyer shall pay the Seller within 30 days.", 0, 30, "The Seller shall pay the Buyer", ["parties_swapped"]],
    ] as const)("flags %s", (text, start, end, newText, codes) => {
      expect(flags(prose(1), [text], [text.slice(0, start) + newText + text.slice(end)], [{ id: "E1", action: "replace", paragraph: 1, start, end, newText }]).value.edits.flags)
        .toEqual([{ id: "E1", codes }]);
    });
    it("leaves a neutral edit and a comment alone, and reads the sentence at its raw offsets past a double space", () => {
      const text = "Payment is due.  The Supplier shall pay within 30 days.";
      expect(flags(prose(1), [text], [text.replace("30", "45")], [{ id: "E1", action: "replace", paragraph: 1, start: 47, end: 49, newText: "45" },
        { id: "E2", action: "comment", paragraph: 1, start: 0, end: 15 }]).value.edits.flags).toEqual([]);
      const negated = "Payment is due.  The Supplier shall not pay within 30 days.";
      expect(flags(prose(1), [negated], [negated.replace(" not", "")], [{ id: "E3", action: "delete", paragraph: 1, start: 35, end: 39 }]).value.edits.flags)
        .toEqual([{ id: "E3", codes: ["negation_flipped"] }]);
    });
  });
  describe("C2, clauses of one document that contradict each other", () => {
    it("flags a negation or a polar class apart and never pairs a mutual clause named by its roles", () => {
      const { value } = flags(prose(8), ["The Supplier shall be liable for loss of data caused by negligence.", "The Supplier shall not be liable for loss of data caused by negligence.",
        "The Buyer shall indemnify the Seller for claims arising under this agreement.", "The Seller shall indemnify the Buyer for claims arising under this agreement.",
        "Payments made before the due date are permitted under this agreement.", "Payments made after the due date are prohibited under this agreement.",
        "The Disclosing Party shall return the materials after termination.", "The Receiving Party shall return the materials after termination."]);
      expect(value.clauses.flags.map(f => f.paragraphs)).toEqual([[1, 2], [5, 6]]);
      expect(value.counts).toMatchObject({ inversionSource: 2, inversionUnaddressed: 2, inversionIntroduced: 0 });
    });
  });
  it("cuts every list at 40 with a truncated flag, counts every flag found, and reports the read caps", () => {
    const t = feeTable("Late payment fee", "$50"), sentences = Array.from({ length: 45 }, () => "The late payment fee is $75.");
    const { value } = flags([...t.units, ...prose(45)], [...t.texts, ...sentences]);
    expect(value.numeric).toMatchObject({ truncated: true }); expect(value.numeric.flags).toHaveLength(DOCUMENT_REVIEW_FLAG_LIST_MAX);
    expect(value.counts.numericSource).toBe(45);
    expect(value.read).toEqual({ comparisonsCapped: false, paragraphsClipped: 0, rowsCapped: false, sentencesCapped: false, termsCapped: false });
  });
  it("gives the same bytes in separate processes under any hash seed", () => {
    const t = feeTable("Late payment fee", "$50"), units = [...t.units, ...prose(4)];
    const source = [...t.texts, 'The Company (the "Supplier") and the Client (the "Customer") agree.', "The late payment fee is $75 and the deposit is $10.",
      "The Supplier shall pay the Customer within five days.", "The Customer shall pay the Supplier within five days."];
    const runs = ["0", "1", "2", "4096", "65535"].map(seed => flags(units, source, source, [], { args: ["-s"], env: { PATH: process.env.PATH, PYTHONHASHSEED: seed } }).bytes.toString("hex"));
    expect(new Set(runs).size).toBe(1);
  });
  it("isolates a failing rule to its own list, and returns the fixed record when the whole step fails, so the flags never fail a review", () => {
    // A malformed cell breaks N1 only: its list names the exception, and C1 and C2 still run.
    const isolated = flags([{ kind: "cell" } as unknown as Unit, ...prose(2)], ["x", "The Supplier shall be liable for loss of data caused by negligence.",
      "The Supplier shall not be liable for loss of data caused by negligence."]).value;
    expect(isolated.numeric).toEqual({ flags: [], truncated: false, error: "KeyError" }); expect(isolated.error).toBeUndefined();
    expect(isolated.clauses.flags.map(f => f.paragraphs)).toEqual([[2, 3]]);
    // Inputs that do not line up fail the whole step: every list is empty and every count zero.
    const { value } = flags(prose(2), ["one paragraph"]);
    expect(value).toMatchObject({ error: "ValueError", numeric: { flags: [] }, edits: { flags: [] }, clauses: { flags: [] } });
    expect(Object.values(value.counts).every(count => count === 0)).toBe(true);
    expect(python(`${REVIEW_FLAGS_PY}\nimport sys\ndef boom():\n    raise RuntimeError("unit builder")\nsys.stdout.write(json.dumps(review_flags_or_error(boom)["error"]))`)).toBe('"RuntimeError"');
  });
  it("finishes within its caps in bounded time", () => {
    const units: Unit[] = [], texts: string[] = [];
    for (let row = 1; row <= 201; row++) { units.push(cell(1, row, 1), cell(1, row, 2)); texts.push(row === 1 ? "Item" : `Service charge ${"abcdefghijklmnopqrstuvwxyz"[row % 26]}${row}x`, row === 1 ? "Fee (USD)" : "50"); }
    for (let i = 0; i < 2600; i++) { units.push({ kind: "prose" }); texts.push("The service charge is $75 for the month. Another sentence follows here with words."); }
    const started = Date.now(), { value } = flags(units, texts);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(value.read.sentencesCapped).toBe(true);
  }, 30_000);
  it("is stdlib-only Python 3.9 with its own names, none shared with the applier, and the applier keeps every name it defines", () => {
    const names = (source: string) => JSON.parse(python(`import ast, json, sys\ntree = ast.parse(sys.stdin.read(), feature_version=(3, 9))\nout = []\nfor node in tree.body:\n    if isinstance(node, (ast.FunctionDef, ast.ClassDef)):\n        out.append(node.name)\n    elif isinstance(node, ast.Assign):\n        out.extend(t.id for t in node.targets if isinstance(t, ast.Name))\nprint(json.dumps(out))`, source)) as string[];
    const imports = JSON.parse(python(`import ast, json, sys\ntree = ast.parse(sys.stdin.read())\nprint(json.dumps(sorted({a.name for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names} | {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)} - {None})))`, REVIEW_FLAGS_PY));
    expect(imports).toEqual(["decimal", "json", "re", "unicodedata"]);
    const own = names(REVIEW_FLAGS_PY);
    expect(own.every(name => /^(FLAG_|flag_|review_flags)/u.test(name)), own.join(",")).toBe(true);
    const applier = documentReviewApplierFile().bytes.toString("utf8"), body = applier.slice(0, applier.indexOf(REVIEW_FLAGS_PY));
    expect(applier.indexOf(REVIEW_FLAGS_PY)).toBeGreaterThan(0); expect(applier.slice(applier.indexOf(REVIEW_FLAGS_PY) + REVIEW_FLAGS_PY.length)).toMatch(/^\s*if __name__ == "__main__":/u);
    const applierNames = names(`${body}\n`).filter(name => own.includes(name));
    expect(applierNames).toEqual([]);
    // The concatenated applier imports with a stub lxml, and its own names still mean what the applier defines.
    const probe = `import json, sys, types\nlxml = types.ModuleType("lxml"); lxml.etree = types.SimpleNamespace(); sys.modules["lxml"] = lxml\nns = {"__name__": "applier"}\nexec(compile(sys.stdin.read(), "applier", "exec"), ns)\nprint(json.dumps([ns["NUMBER_RE"].pattern, callable(ns["run"]), callable(ns["review_flags_or_error"])]))`;
    expect(JSON.parse(python(probe, applier))).toEqual(["^[0-9]{1,9}$", true, true]);
    expect(REVIEW_FLAGS_PY).not.toMatch(/\(\?>|[*+?}]\+/u); expect(/^[\x00-\x7f]*$/u.test(REVIEW_FLAGS_PY)).toBe(true);
  });
  it("mirrors its versions, counts and list cap in the TypeScript exports", () => {
    const mirrored = JSON.parse(python(`${REVIEW_FLAGS_PY}\nprint(json.dumps([FLAG_VERSION, FLAG_RULES, sorted(FLAG_COUNTS), FLAG_LIST_MAX, FLAG_VALUES_MAX, sorted(set(FLAG_UNITS.values()) | set(FLAG_CURRENCY.values()))]))`));
    expect(mirrored).toEqual([DOCUMENT_REVIEW_FLAGS_VERSION, { ...DOCUMENT_REVIEW_FLAG_RULES }, [...DOCUMENT_REVIEW_FLAG_COUNTS].sort(), DOCUMENT_REVIEW_FLAG_LIST_MAX,
      DOCUMENT_REVIEW_FLAG_VALUES_MAX, [...DOCUMENT_REVIEW_FLAG_UNITS].sort()]);
  });
});
