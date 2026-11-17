import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { documentReviewApplierFile } from "../../src/main/private-agent/document-review";
import {
  E6_AGREEMENT_TEXTS as TEXTS, E6_GOOD_CLEAN as GOOD_CLEAN, E6_GOOD_EDITS as GOOD, E6_HARM_CLEAN as HARM_CLEAN, E6_HARM_EDITS as HARM,
  e6AgreementGold as gold, e6Edit as edit,
} from "../helpers/e6-score-fixtures";

/**
 * E6's planted-defect scorer (BL-20261117-1106-e6-planted-defect-scorer-design; docs/experiments/e6-gold-format.md). Every document,
 * plan and gold file here is synthetic and written by this test: no E6 task, gold or document is read.
 */
const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "e6-score.py");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
function scratch() { const dir = realpathSync(mkdtempSync(join(tmpdir(), "soar-e6-score-"))); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** The scorer's exit code and output; json is null when it printed something else (--list, --version). */
function scorer(...args: string[]) {
  const result = spawnSync("python3", ["-I", SCRIPT, ...args], { encoding: "utf8" });
  let json: any = null;
  try { json = JSON.parse(result.stdout); } catch { /* not one JSON value */ }
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr };
}

/** A .docx holding only the main document part (all the scorer opens), with fixed zip timestamps so equal bodies give equal bytes. */
const ZIP_PY = String.raw`import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as archive:
    archive.writestr(zipfile.ZipInfo("[Content_Types].xml", (2020, 1, 1, 0, 0, 0)), "<Types/>")
    archive.writestr(zipfile.ZipInfo("word/document.xml", (2020, 1, 1, 0, 0, 0)), sys.stdin.buffer.read())
`;
function docx(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
  const made = spawnSync("python3", ["-I", "-c", ZIP_PY, path], { input: xml });
  expect(made.status, String(made.stderr)).toBe(0);
  return path;
}
const esc = (text: string) => text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
const row = (cells: string[]) => `<w:tr>${cells.map(cell => `<w:tc>${p(cell)}</w:tc>`).join("")}</w:tr>`;

/** The synthetic agreement's body (tests/helpers/e6-score-fixtures.ts), with some paragraphs' text replaced. */
function agreement(changes: Readonly<Record<number, string>> = {}, texts: readonly string[] = TEXTS) {
  const at = (n: number) => changes[n] ?? texts[n - 1]!;
  return p(at(1)) + p(at(2)) + `<w:tbl>${[3, 5, 7, 9].map(n => row([at(n), at(n + 1)])).join("")}</w:tbl>`
    + texts.slice(10).map((_, i) => p(at(i + 11))).join("");
}

interface RunInput { edits?: readonly object[] | string | null; clean?: Readonly<Record<number, string>> | string | null; flags?: object | string | null; source?: string }
/** A run directory as the driver leaves one, with the candidate files the scorer reads; null leaves a file out. */
function run(root: string, name: string, input: RunInput = {}) {
  const dir = join(root, name), candidate = join(dir, "candidate");
  docx(join(candidate, "input", "agreement.docx"), input.source ?? agreement());
  mkdirSync(join(candidate, "review"), { recursive: true }); mkdirSync(join(candidate, "output"), { recursive: true });
  if (input.edits !== null) {
    writeFileSync(join(candidate, "review", "edits.json"), typeof input.edits === "string" ? input.edits : JSON.stringify({ version: 1, edits: input.edits ?? [edit("E1", "comment", "9. Signatures.", "Fine.")] }));
  }
  if (input.clean !== null) {
    if (typeof input.clean === "string") writeFileSync(join(candidate, "output", "clean.docx"), input.clean);
    else docx(join(candidate, "output", "clean.docx"), agreement(input.clean ?? {}));
  }
  if (input.flags !== null) {
    writeFileSync(join(candidate, "output", "review-flags.json"), typeof input.flags === "string" ? input.flags : JSON.stringify(input.flags ?? { version: 1, counts: { inversionEdits: 0 }, edits: { flags: [], truncated: false } }));
  }
  return dir;
}
/** A scratch root with the gold written against the agreement's bytes. */
function setup(mutate: (g: Record<string, any>) => void = () => {}) {
  const root = scratch(), source = docx(join(root, "source.docx"), agreement());
  const g = gold(sha(readFileSync(source))); mutate(g);
  const goldPath = join(root, "gold.json"); writeFileSync(goldPath, JSON.stringify(g));
  return { root, source, goldPath };
}

const NONE = { clause_contradiction: 0, missing_section: 0, numeric: 0, reference_definition: 0, table_arithmetic: 0, total: 0 };
const PLANTED = { clause_contradiction: 1, missing_section: 1, numeric: 1, reference_definition: 1, table_arithmetic: 1, total: 5 };

describe("E6's planted-defect scorer", () => {
  it("states its version", () => {
    expect(scorer("--version")).toMatchObject({ status: 0, stdout: "e6-score 1\n" });
  });

  it("scores each run by the card's three rules and reports counts only", () => {
    const { root, goldPath } = setup();
    // Rule C1 codes the fix of the planted contradiction (E4, on its span) in the good plan; in the harm plan it codes an edit on a
    // control (E2) and an unplaced one (E6), neither on a planted span.
    const good = run(root, "r-good", { edits: GOOD, clean: GOOD_CLEAN,
      flags: { version: 1, counts: { inversionEdits: 1 }, edits: { flags: [{ codes: ["negation_removed"], id: "E4" }], truncated: false } } });
    const harm = run(root, "r-harm", { edits: HARM, clean: HARM_CLEAN, flags: { version: 1, counts: { inversionEdits: 2 },
      edits: { flags: [{ codes: ["negation_removed"], id: "E2" }, { codes: ["negation_added"], id: "E6" }], truncated: false } } });
    const out = scorer("--gold", goldPath, `a=${good}`, `b=${harm}`);
    expect(out.status, out.stdout).toBe(0);
    expect(out.json.gold).toEqual({ sha256: sha(readFileSync(goldPath)), planted: PLANTED, controls: 2 });
    expect(out.json.scorer).toEqual({ name: "e6-score", version: 1, sha256: sha(readFileSync(SCRIPT)) });
    expect(out.json.candidates).toEqual([
      // A fix on each span that meets its clean condition, a comment on the comment-only defect, and an insertion in the region.
      { label: "a", status: "scored", addressed: { ...NONE, clause_contradiction: 1, missing_section: 1, numeric: 1, reference_definition: 1, table_arithmetic: 1, total: 5 },
        controlsChanged: 0, edits: 5, editsUnplaced: 0, flags: "recorded", inversionEdits: 1, inversionEditsOnPlants: 1 },
      // A comment on a defect that needs a fix is not enough; an edit beside a span is not on it; the rationale meets the missing
      // section's condition; a replace that keeps a control's condition changes nothing, one that breaks it changes the control.
      { label: "b", status: "scored", addressed: { ...NONE, missing_section: 1, total: 1 }, controlsChanged: 1, edits: 7, editsUnplaced: 2,
        flags: "recorded", inversionEdits: 2, inversionEditsOnPlants: 0 },
    ]);
    // The same inputs give the same bytes, and no word of any file reaches the output.
    expect(scorer("--gold", goldPath, `a=${good}`, `b=${harm}`).stdout).toBe(out.stdout);
    for (const word of ["services", "agreement", "client", "supplier", "liable", "termination", "warrant", "disclaimer", "notices", "signatures",
      "invoices", "governing", "12,500", "11,500", "14,500", "13,500"]) expect(out.stdout.toLowerCase()).not.toContain(word);
  });

  it("counts a fix only where the clean copy meets the condition on its own terms", () => {
    const { root, goldPath } = setup();
    // The numeric defect fixed in the table instead of the prose: the other branch of its condition.
    const table = run(root, "r-table", { edits: [edit("E1", "replace", "11,500", "Match the prose.", "12,500")], clean: { 6: "12,500" } });
    // A total changed to a figure that only contains the right one: "word" keeps 13,500 from matching inside 113,500.
    const inside = run(root, "r-inside", { edits: [edit("E1", "replace", "14,500", "Sum.", "113,500")], clean: { 10: "113,500" } });
    // Lookalikes, case and whitespace fold before matching: a curly-quoted, upper-case rationale with a no-break space still meets the test.
    const folded = run(root, "r-folded", { edits: [edit("E1", "comment", "9. Signatures.", "No “GOVERNING  Law” clause.")] });
    // A literal never matches inside a longer word when "word" is true.
    const word = run(root, "r-word", { edits: [edit("E1", "comment", "9. Signatures.", "Ungoverning lawful text.")] });
    // An edit outside the missing section's region does not address it, whatever its text.
    const outside = run(root, "r-outside", { edits: [edit("E1", "comment", "4. Payment.", "Governing law is missing.")] });
    // An anchor that ends where the span starts touches it without overlapping it, even when the clean copy holds the fix.
    const touch = run(root, "r-touch", { edits: [edit("E1", "replace", "Client shall pay ", "Shorter.", "Client pays ")],
      clean: { 2: "1. Fees. The Client pays a fee of 11,500 per month." } });
    // A literal matches within the new text or within the rationale, never across the two.
    const join2 = run(root, "r-join", { edits: [edit("E1", "insert_after", "9. Signatures.", "law applies.", " Under governing")] });
    // Every member of an "all" must hold: prose that keeps the old figure beside the new one does not meet the condition.
    const both = run(root, "r-both", { edits: [edit("E1", "replace", "a fee of 12,500", "Corrected.", "a fee of 11,500 (formerly 12,500)")],
      clean: { 2: "1. Fees. The Client shall pay a fee of 11,500 (formerly 12,500) per month." } });
    // "word" holds on the right of a match too: 13,500 does not match the start of 13,5000.
    const right = run(root, "r-right", { edits: [edit("E1", "replace", "14,500", "Sum.", "13,5000")], clean: { 10: "13,5000" } });
    // An overlap of one character counts, at either end of a span.
    const fixed = { 2: "1. Fees. The Client shall pay a fee of 11,500 per month." };
    const edgeStart = run(root, "r-edge-start", { edits: [edit("E1", "comment", "shall pay a", "Figure.")], clean: fixed });
    const edgeEnd = run(root, "r-edge-end", { edits: [edit("E1", "comment", "0 per month", "Figure.")], clean: fixed });
    const out = scorer("--gold", goldPath, `t=${table}`, `i=${inside}`, `f=${folded}`, `w=${word}`, `o=${outside}`, `x=${touch}`, `j=${join2}`,
      `b=${both}`, `r=${right}`, `s=${edgeStart}`, `e=${edgeEnd}`);
    expect(out.status, out.stdout).toBe(0);
    expect(out.json.candidates.map((c: any) => c.addressed)).toEqual([
      { ...NONE, numeric: 1, total: 1 }, NONE, { ...NONE, missing_section: 1, total: 1 }, NONE, NONE, NONE, NONE,
      NONE, NONE, { ...NONE, numeric: 1, total: 1 }, { ...NONE, numeric: 1, total: 1 }]);
  });

  it("folds the applier's lookalikes and composes accents before matching", () => {
    const { root, goldPath } = setup(g => { g.defects[4].edit = { all: [{ contains: "client's data", word: true }, { contains: "caf\u00e9", word: true }] }; });
    // A curly apostrophe folds to the literal's straight one, and a decomposed accent composes to the literal's single code point.
    const dir = run(root, "r-fold", { edits: [edit("E1", "comment", "9. Signatures.", "The Client\u2019s data and the cafe\u0301 clause are missing.")] });
    expect(scorer("--gold", goldPath, `f=${dir}`).json.candidates[0].addressed).toEqual({ ...NONE, missing_section: 1, total: 1 });
  });

  it("counts a control changed by a replace, a delete or an insertion on its span, and never by a comment", () => {
    const { root, goldPath } = setup();
    const replaced = run(root, "r-replace", { edits: [edit("E1", "replace", "shall not be liable", "Simpler.", "shall be liable")],
      clean: { 11: "2. Liability. The Supplier shall be liable for indirect losses." } });
    const deleted = run(root, "r-delete", { edits: [edit("E1", "delete", "shall not ", "Simpler.")],
      clean: { 11: "2. Liability. The Supplier be liable for indirect losses." } });
    const inserted = run(root, "r-insert", { edits: [edit("E1", "insert_after", "shall not", "Stronger.", " always")],
      clean: { 11: "2. Liability. The Supplier shall not always be liable for indirect losses." } });
    // The clean text fails the control's condition, but the only edit on its span is a comment.
    const commented = run(root, "r-comment", { edits: [edit("E1", "comment", "within 30 days", "Short.")], clean: { 13: "4. Payment. Invoices are due promptly." } });
    const out = scorer("--gold", goldPath, `r=${replaced}`, `d=${deleted}`, `i=${inserted}`, `c=${commented}`);
    expect(out.status, out.stdout).toBe(0);
    expect(out.json.candidates.map((c: any) => c.controlsChanged)).toEqual([1, 1, 1, 0]);
  });

  it("reads a literal inside a word when \"word\" is false", () => {
    const { root, goldPath } = setup(g => { g.defects[4].edit = { contains: "jurisdict", word: false }; });
    const dir = run(root, "r-loose", { edits: [edit("E1", "comment", "9. Signatures.", "No jurisdiction clause.")] });
    expect(scorer("--gold", goldPath, `l=${dir}`).json.candidates[0].addressed).toEqual({ ...NONE, missing_section: 1, total: 1 });
  });

  it("counts C1's coded edits on planted spans only when the flags file lists every coded edit", () => {
    const { root, goldPath } = setup();
    const coded = (count: number, ids: string[], truncated = false) =>
      ({ version: 1, counts: { inversionEdits: count }, edits: { flags: ids.map(id => ({ codes: ["negation_removed"], id })), truncated } });
    const runs = {
      // The applier lists at most 40 coded edits; a cut list cannot say which of the 41 sit on a planted span.
      cut: run(root, "r-cut", { edits: GOOD, clean: GOOD_CLEAN, flags: coded(41, Array.from({ length: 40 }, (_, i) => `E${i + 1}`), true) }),
      // A list that disagrees with the count, or none at all, says nothing either.
      short: run(root, "r-short", { edits: GOOD, clean: GOOD_CLEAN, flags: coded(2, ["E4"]) }),
      bare: run(root, "r-bare", { edits: GOOD, clean: GOOD_CLEAN, flags: { version: 1, counts: { inversionEdits: 1 } } }),
      // Every edit of the good plan coded: four sit on planted spans (E1, E2, E3, E4); E5 is an insertion outside every span.
      all: run(root, "r-all", { edits: GOOD, clean: GOOD_CLEAN, flags: coded(5, ["E1", "E2", "E3", "E4", "E5"]) }),
    };
    const out = scorer("--gold", goldPath, ...Object.entries(runs).map(([label, dir]) => `${label}=${dir}`));
    expect(out.status, out.stdout).toBe(0);
    expect(out.json.candidates.map((c: any) => [c.label, c.inversionEdits, c.inversionEditsOnPlants])).toEqual([
      ["cut", 41, null], ["short", 2, null], ["bare", 1, null], ["all", 5, 4]]);
  });

  it("gives a run it cannot read a status without counts, and reads C1's count only as recorded", () => {
    const { root, goldPath } = setup();
    const runs = {
      missing: join(root, "never-ran"),
      noPlan: run(root, "r-no-plan", { edits: null }),
      badPlan: run(root, "r-bad-plan", { edits: JSON.stringify({ version: 2, edits: [] }) }),
      dupIds: run(root, "r-dup-ids", { edits: [edit("E1", "comment", "9. Signatures.", "a"), edit("E1", "comment", "4. Payment.", "b")] }),
      noClean: run(root, "r-no-clean", { clean: null, flags: null }),
      notZip: run(root, "r-not-zip", { clean: "not a zip", flags: { version: 1, counts: { inversionEdits: 0 }, error: "ValueError" } }),
      shorter: run(root, "r-shorter", { flags: "{" }),
      // Rule C1 alone failed: the applier's flag_rule records the error under "edits" and leaves the count at zero.
      c1Failed: run(root, "r-c1-failed", { clean: null, flags: { version: 1, counts: { inversionEdits: 0 }, edits: { error: "ValueError", flags: [], truncated: false } } }),
      negative: run(root, "r-negative", { clean: null, flags: { version: 1, counts: { inversionEdits: -1 } } }),
    };
    // A clean copy with one paragraph fewer than the source cannot be read against it.
    docx(join(runs.shorter, "candidate", "output", "clean.docx"), agreement({}, TEXTS.slice(0, 17)));
    const out = scorer("--gold", goldPath, ...Object.entries(runs).map(([label, dir]) => `${label}=${dir}`));
    expect(out.status, out.stdout).toBe(0);
    expect(out.json.candidates).toEqual([
      { label: "missing", status: "candidate_missing", flags: "missing", inversionEdits: null },
      { label: "noPlan", status: "plan_missing", flags: "recorded", inversionEdits: 0 },
      { label: "badPlan", status: "plan_invalid", reason: "plan_shape_invalid", flags: "recorded", inversionEdits: 0 },
      { label: "dupIds", status: "plan_invalid", reason: "id_invalid_or_duplicate", flags: "recorded", inversionEdits: 0 },
      { label: "noClean", status: "clean_missing", flags: "missing", inversionEdits: null },
      // A flags file that records an error carries the applier's fallback zeros, which are not a measurement.
      { label: "notZip", status: "clean_invalid", reason: "docx_unreadable", flags: "error", inversionEdits: null },
      { label: "shorter", status: "clean_invalid", reason: "paragraphs_differ", flags: "invalid", inversionEdits: null },
      { label: "c1Failed", status: "clean_missing", flags: "error", inversionEdits: null },
      { label: "negative", status: "clean_missing", flags: "invalid", inversionEdits: null },
    ]);
  });

  it("gives a run whose own source is missing, ambiguous or another document a status without counts, and scores the others", () => {
    const { root, goldPath } = setup();
    const other = run(root, "r-other", { source: agreement({ 1: "Another Agreement" }) });
    const none = run(root, "r-none"); rmSync(join(none, "candidate", "input"), { recursive: true });
    const two = run(root, "r-two"); docx(join(two, "candidate", "input", "deeper", "copy.docx"), agreement());
    const good = run(root, "r-good", { edits: GOOD, clean: GOOD_CLEAN });
    // None of the first three sources is the gold's, so the gold is bound to the last run's source.
    const out = scorer("--gold", goldPath, `o=${other}`, `n=${none}`, `t=${two}`, `g=${good}`);
    expect(out.status, out.stdout).toBe(0);
    expect(out.json.candidates.slice(0, 3)).toEqual([
      { label: "o", status: "source_mismatch", flags: "recorded", inversionEdits: 0 },
      { label: "n", status: "source_missing", flags: "recorded", inversionEdits: 0 },
      { label: "t", status: "source_ambiguous", flags: "recorded", inversionEdits: 0 },
    ]);
    expect(out.json.candidates[3]).toMatchObject({ label: "g", status: "scored", addressed: { total: 5 } });
  });

  it("refuses arguments it cannot read", () => {
    const { root, goldPath } = setup();
    const good = run(root, "r-good", { edits: GOOD, clean: GOOD_CLEAN });
    expect(scorer("--gold", goldPath, `a=${good}`, `a=${good}`).json.errors).toEqual([{ code: "label_duplicate", label: "a" }]);
    expect(scorer("--gold", goldPath, `bad label=${good}`).json.errors[0].code).toBe("run_argument_invalid");
    expect(scorer("--gold", goldPath).json.errors[0].code).toBe("usage_invalid");
  });

  it("checks a gold file against its source for the authoring session, printing counts and its sha256, never text", () => {
    const { source, goldPath } = setup();
    const out = scorer("--check-gold", goldPath, source);
    expect(out.status, out.stdout).toBe(0);
    expect(out.json).toEqual({ ok: true, sha256: sha(readFileSync(goldPath)), planted: PLANTED, controls: 2,
      scorer: { name: "e6-score", version: 1, sha256: sha(readFileSync(SCRIPT)) } });
  });

  it("refuses a gold file that does not fit the format or its source", () => {
    const cases: [string, (g: Record<string, any>) => void, object][] = [
      ["an unknown key", g => { g.defects[2].comment_only = true; }, { code: "gold_shape_invalid", at: "defects[2]" }],
      ["another format", g => { g.format = "soar-e6-gold-draft"; }, { code: "gold_format_unsupported" }],
      ["a boolean version", g => { g.version = true; }, { code: "gold_format_unsupported" }],
      ["a repeated id", g => { g.defects[1].id = "D1"; }, { code: "gold_id_duplicate", item: "D1" }],
      ["a word as an id", g => { g.defects[0].id = "fee_total"; }, { code: "gold_id_invalid", at: "defects[0]" }],
      ["a control named as a defect", g => { g.controls[0].id = "D9"; }, { code: "gold_id_invalid", at: "controls[0]" }],
      ["a quote that repeats only by overlapping", g => { g.defects[1].spans[0] = { paragraph: 8, quote: "00" }; },
        { code: "gold_quote_not_unique", item: "D2", span: 0, count: 2 }],
      ["an unknown class", g => { g.defects[0].class = "style"; }, { code: "gold_class_invalid", at: "defects[0]" }],
      ["a clean condition beside commentOnly", g => { g.defects[2].clean = { paragraphs: [12, 12], lacks: "Section 7", word: true }; }, { code: "gold_shape_invalid", at: "defects[2]" }],
      ["a missing section with spans", g => { g.defects[4].spans = [{ paragraph: 17, quote: "Notices" }]; }, { code: "gold_shape_invalid", at: "defects[4]" }],
      ["a paragraph past the end", g => { g.defects[1].spans[0].paragraph = 19; }, { code: "gold_paragraph_invalid", at: "defects[1].spans[0].paragraph" }],
      ["a reversed range", g => { g.controls[1].clean.paragraphs = [13, 12]; }, { code: "gold_paragraph_invalid", at: "controls[1].clean.paragraphs" }],
      ["a literal of whitespace", g => { g.controls[1].clean.contains = "  "; }, { code: "gold_text_invalid", at: "controls[1].clean.contains" }],
      ["a test without word", g => { delete g.controls[1].clean.word; }, { code: "gold_shape_invalid", at: "controls[1].clean" }],
      ["a condition five deep", g => { g.controls[1].clean = { all: [{ any: [{ all: [{ any: [g.controls[1].clean] }] }] }] }; }, { code: "gold_condition_too_deep" }],
      ["a quote found twice", g => { g.defects[1].spans[0].quote = "0"; }, { code: "gold_quote_not_unique", item: "D2", span: 0, count: 2 }],
      ["a quote not found", g => { g.defects[1].spans[0].quote = "14,600"; }, { code: "gold_quote_not_found", item: "D2", span: 0, count: 0 }],
      ["a defect whose condition already holds", g => { g.defects[1].clean.contains = "14,500"; }, { code: "gold_defect_condition_holds_on_source", item: "D2" }],
      ["a control whose condition fails", g => { g.controls[0].clean.contains = "shall be liable"; }, { code: "gold_control_condition_fails_on_source", item: "K1" }],
      ["a control on a defect's span", g => { g.controls[0].spans = [{ paragraph: 2, quote: "12,500 per month" }]; g.controls[0].clean = { paragraphs: [2, 2], contains: "per month", word: true }; },
        { code: "gold_control_overlaps_defect", item: "K1", defect: "D1" }],
      ["another source", g => { g.source.sha256 = "0".repeat(64); }, { code: "source_sha256_differs" }],
      ["another paragraph count", g => { g.source.paragraphs = 17; g.defects[4].region.last = 17; }, { code: "source_paragraphs_differ", source: 18, gold: 17 }],
    ];
    for (const [name, mutate, error] of cases) {
      const { source, goldPath } = setup(mutate);
      const out = scorer("--check-gold", goldPath, source);
      expect(out.status, name).toBe(2);
      expect(out.json.errors[0], name).toMatchObject(error);
    }
    const { root, source } = setup();
    const raw = (name: string, text: string) => { const path = join(root, name); writeFileSync(path, text); return scorer("--check-gold", path, source).json.errors[0].code; };
    expect(raw("dup.json", '{"format": "soar-e6-gold", "format": "soar-e6-gold"}')).toBe("gold_json_invalid");
    expect(raw("nan.json", '{"format": NaN}')).toBe("gold_json_invalid");
  });

  it("refuses a source with Word fields or tracked changes, whose text the standard library cannot place as the applier does", () => {
    for (const [extra, code] of [
      ['<w:p><w:fldSimple w:instr=" REF s7 "><w:r><w:t>Section 7</w:t></w:r></w:fldSimple></w:p>', "source_has_fields"],
      ['<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>REF s7</w:instrText></w:r></w:p>', "source_has_fields"],
      ['<w:p><w:ins><w:r><w:t>added</w:t></w:r></w:ins></w:p>', "source_has_tracked_changes"],
    ]) {
      const root = scratch(), source = docx(join(root, "source.docx"), agreement() + extra!);
      const g = gold(sha(readFileSync(source))); g.source.paragraphs = 19;
      writeFileSync(join(root, "gold.json"), JSON.stringify(g));
      expect(scorer("--check-gold", join(root, "gold.json"), source).json.errors[0].code).toBe(code);
    }
  });

  it("lists paragraphs as the applier numbers and shows them: table cells in, text boxes out, its marks for tabs, breaks and objects", () => {
    const root = scratch(), source = docx(join(root, "listing.docx"), LISTING);
    const out = scorer("--list", source);
    expect(out.status, out.stdout).toBe(0);
    expect(out.stdout.trimEnd().split("\n").map(line => JSON.parse(line))).toEqual(LISTED.map((text, i) => ({ paragraph: i + 1, text })));
    writeFileSync(join(root, "not.docx"), "plain text");
    expect(scorer("--list", join(root, "not.docx")).json).toEqual({ ok: false, errors: [{ code: "source_unreadable" }] });
  });

  it("keeps the applier's constants and its plain view: the ported text equals the applier's own view_text on every paragraph", () => {
    const root = scratch(), applier = join(root, "applier.py"), xml = join(root, "document.xml");
    writeFileSync(applier, documentReviewApplierFile().bytes);
    writeFileSync(xml, `<w:document xmlns:w="${W}"><w:body>${LISTING}${agreement()}</w:body></w:document>`);
    const result = spawnSync("python3", ["-I", "-c", PIN_PY, applier, SCRIPT, xml], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const pinned = JSON.parse(result.stdout);
    expect(pinned.constants).toEqual(Object.fromEntries(PINNED.map(name => [name, true])));
    expect(pinned.viewText).toHaveLength(LISTED.length + TEXTS.length);
    expect(pinned.viewText.every(Boolean)).toBe(true);
    // The plan's shape rules and the anchor search are the applier's own: each plan gets the same outcome and first code from both.
    expect(pinned.loadPlan).toHaveLength(24);
    expect(pinned.loadPlan.every(Boolean)).toBe(true);
    expect(pinned.findAll).toHaveLength(6);
    expect(pinned.findAll.every(Boolean)).toBe(true);
  });
});

/** Structures the plain view must handle; LISTED is the text of each paragraph in order. */
const LISTING = [
  "<w:p><w:r><w:t>One</w:t><w:tab/><w:t>two</w:t><w:br/><w:t>three</w:t></w:r></w:p>",
  "<w:p><w:r><w:t>a</w:t><w:cr/><w:t>b</w:t><w:ptab/><w:t>c</w:t></w:r></w:p>",
  "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>nested</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>",
  '<w:p><w:r><w:t xml:space="preserve">box </w:t><w:pict><w:txbxContent><w:p><w:r><w:t>inside</w:t></w:r></w:p></w:txbxContent></w:pict></w:r>'
    + "<w:r><w:txbxContent><w:p><w:r><w:t>also inside</w:t></w:r></w:p></w:txbxContent></w:r></w:p>",
  '<w:p><w:r><w:t>sym</w:t><w:sym w:char="F04A"/><w:noBreakHyphen/><w:softHyphen/></w:r></w:p>',
  "<w:p><w:ins><w:r><w:delText>gone</w:delText><w:t>new</w:t></w:r></w:ins><w:del><w:r><w:delText>old</w:delText></w:r></w:del></w:p>",
  "<w:p><w:hyperlink><w:r><w:t>link</w:t></w:r></w:hyperlink><w:r><w:instrText>REF x</w:instrText></w:r></w:p>",
  "<w:p/>",
].join("");
const LISTED = ["One\ttwo\nthree", "a\nb\tc", "cell", "nested", "box ￼", "sym￼‑­", "newold", "link", ""];

/** The applier's constants the scorer copies; each must equal the applier's own value. */
const PINNED = ["OBJECTS", "LOOKALIKES", "ACTIONS", "SEVERITIES", "REVISION_TAGS", "ID_RE", "INVALID_RE", "MAX_EDITS", "MAX_SOURCE_BYTES", "MAX_PART_BYTES",
  "MAX_PLAN_BYTES"];
/**
 * Runs without lxml (CI has none): the applier's constants and its view_text function are taken from its source by the ast module and
 * executed alone, view_text with the scorer's element helpers, and compared with the scorer's on every paragraph of a document.
 */
const PIN_PY = String.raw`import ast, importlib.util, json, re, sys
import xml.etree.ElementTree as ET
applier_path, scorer_path, xml_path = sys.argv[1:4]
spec = importlib.util.spec_from_file_location("e6_score", scorer_path)
scorer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scorer)
tree = ast.parse(open(applier_path, encoding="utf-8").read())
names = ${JSON.stringify(PINNED)}
applier = {"re": re}
for name in names:
    nodes = [n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in n.targets)]
    assert len(nodes) == 1, name
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "applier", "exec"), applier)
def value(v):
    return [v.pattern, v.flags] if isinstance(v, re.Pattern) else v
constants = dict((name, value(applier[name]) == value(getattr(scorer, name))) for name in names)
functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "view_text"]
assert len(functions) == 1
ported = {"local": scorer.local, "OBJECTS": applier["OBJECTS"]}
exec(compile(ast.Module(body=functions, type_ignores=[]), "applier", "exec"), ported)
body = ET.fromstring(open(xml_path, "rb").read()).find(scorer.w("body"))
view = [ported["view_text"](paragraph, "plain") == scorer.view_text(paragraph) for paragraph in scorer.body_paragraphs(body)]
applier["json"] = json
for name in ("PlanError", "load_plan", "find_all"):
    nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name == name]
    assert len(nodes) == 1, name
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "applier", "exec"), applier)
valid = {"id": "E1", "anchor": "a", "action": "comment", "rationale": "r", "severity": "low"}
def edit(**changes):
    value = dict(valid)
    value.update(changes)
    return value
def plan(edits, **top):
    data = {"version": 1, "edits": edits}
    data.update(top)
    return json.dumps(data).encode("utf-8")
plans = [b"not json", b"[]", plan([valid], version=2), plan([valid], version=True), plan([valid], extra=1), plan([]),
         plan([edit(id="E%d" % n) for n in range(1, 202)]), plan([1]), plan([edit(action="rewrite")]), plan([edit(extra=1)]),
         plan([edit(action="replace")]), plan([edit(action="replace", newText="n")]), plan([edit(action="insert_after", newText="n")]),
         plan([edit(action="delete")]), plan([edit(id="X1")]), plan([edit(), edit()]), plan([edit(anchor="")]), plan([edit(anchor="a\nb")]),
         plan([edit(anchor="a" * 1001)]), plan([edit(rationale="r" * 1001)]), plan([edit(action="replace", newText="n" * 4001)]),
         plan([edit(severity="urgent")]), plan([edit(anchor="\ufffc")]), plan([edit(id=7)])]
def outcome(load, error_type, code_of, raw):
    try:
        return ["ok", len(load(raw))]
    except error_type as error:
        return ["error", code_of(error)]
load_plan = [outcome(applier["load_plan"], applier["PlanError"], lambda e: e.errors[0]["code"], raw)
             == outcome(scorer.load_plan, scorer.Unusable, lambda e: e.code, raw) for raw in plans]
texts = ["aaa", "xaay", "", "a"]
find_all = [applier["find_all"](texts, anchor) == scorer.find_all(texts, anchor) for anchor in ("aa", "a", "x", "zz", "aaa", "y")]
print(json.dumps({"constants": constants, "viewText": view, "loadPlan": load_plan, "findAll": find_all}))
`;
