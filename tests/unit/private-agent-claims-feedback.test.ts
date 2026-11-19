import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLAIMS_MAX, CLAIMS_SENTENCE_MAX_CHARS, claimsLedgerCheck } from "../../src/main/private-agent/claims";
import { CLAIMS_LEDGER_CODE_TEXT, claimsLedgerFeedback } from "../../src/main/private-agent/claims-feedback";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0)) done(); });

const SOURCE = "The harbour wall was raised by two metres in 2019 after the storm surge.\nThe council approved a second phase in 2021.\n";
const report = (body: string, sections = ["Conflicting evidence", "Unanswered questions"]) =>
  `# Report\n\n${body}\n\n${sections.map(title => `## ${title}\n\nNone.\n`).join("\n")}`;
const claim = (id: string, sentence: string, quote = "raised by two metres in 2019") => ({ id, sentence, sourceId: "input/source.md", quote });
/** The real ledger check on a temporary workspace, read into feedback as the runner reads it (its exit status is the verdict). */
function checked(ledger: unknown, reportText: string) {
  const root = mkdtempSync(join(tmpdir(), "soar-claims-feedback-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "input")); mkdirSync(join(root, "output"));
  writeFileSync(join(root, "input", "source.md"), SOURCE);
  writeFileSync(join(root, "output", "report.md"), reportText);
  if (ledger !== undefined) writeFileSync(join(root, "output", "claims.json"), JSON.stringify(ledger));
  const check = claimsLedgerCheck({ reportPath: "output/report.md", sources: [{ id: "input/source.md", path: "input/source.md" }], root });
  const run = spawnSync("python3", ["-I", "-c", check.python], { encoding: "utf8" });
  return claimsLedgerFeedback(run.stdout, run.status === 0);
}

describe("claims-ledger feedback (E2's bound ends: the model saw only which check failed)", () => {
  it("says nothing more than passed for a ledger the check accepts", () => {
    expect(checked({ version: 1, claims: [claim("C1", "The wall was raised in 2019.")] }, report("The wall was raised in 2019 [C1]."))).toEqual({ passed: true });
  });

  it("names the entry an over-long sentence stopped the check at, with the limit, as in r3 writer-2-2's claim 11", () => {
    const claims = [...Array.from({ length: 10 }, (_, i) => claim(`C${i + 1}`, `Claim ${i + 1} about the wall.`)), claim("C11", "x".repeat(CLAIMS_SENTENCE_MAX_CHARS + 1))];
    const cited = claims.map(row => `[${row.id}]`).join(" ");
    expect(checked({ version: 1, claims }, report(`Findings ${cited}.`))).toEqual({ passed: false, stoppedBy: "claim_sentence", stoppedAtEntry: 11,
      codes: { claim_sentence: `Each claim's sentence must be a non-empty string of at most ${CLAIMS_SENTENCE_MAX_CHARS} characters.` } });
  });

  it("lists unverified quotes, citations without a claim, claims never cited and missing sections, and copies no text", () => {
    const claims = [claim("C1", "SENTENCE-ONE"), claim("C2", "SENTENCE-TWO", "QUOTE lowered by ten metres"), claim("C3", "SENTENCE-THREE")];
    const feedback = checked({ version: 1, claims }, report("First [C1]. Second [C2]. Third [C40].", ["Conflicting evidence"]));
    expect(feedback).toEqual({ passed: false, failedClaims: [{ id: "C2", code: "quote_not_found" }], citedWithoutClaim: ["C40"], claimsNotCited: ["C3"],
      missingSections: ["Unanswered questions"], codes: { quote_not_found: CLAIMS_LEDGER_CODE_TEXT.quote_not_found } });
    expect(JSON.stringify(feedback)).not.toMatch(/SENTENCE|QUOTE|lowered|raised|line /u);
  });

  it("says the ledger is missing when the check cannot read it, without naming an entry", () => {
    expect(checked(undefined, report("Nothing cited."))).toEqual({ passed: false, stoppedBy: "invalid_file", codes: { invalid_file: CLAIMS_LEDGER_CODE_TEXT.invalid_file } });
  });

  it("keeps only well-formed ids, codes and the host's section titles, bounds every list, and follows the host's verdict", () => {
    expect(claimsLedgerFeedback("Traceback (most recent call last):", false)).toEqual({ passed: false, resultUnreadable: true });
    expect(claimsLedgerFeedback('{"passed":true,"claims":[]}', false)).toEqual({ passed: false });
    const hostile = { passed: false, code: "Not A Code", claims: [{ id: "C1; rm", found: false, code: "quote_not_found" }, { id: "C2", found: false, code: "Quote Not Found" },
      ...Array.from({ length: 50 }, (_, i) => ({ id: `C${i + 3}`, found: false, code: "unknown_source" }))],
    report: { citations: { unknown: Array.from({ length: 60 }, (_, i) => `C${i + 100}`).concat(["X1"]), missing: [7, "C0001"] }, sections: { "Some other heading": false, "Conflicting evidence": "no" } } };
    const feedback = claimsLedgerFeedback(JSON.stringify(hostile));
    expect(feedback.stoppedBy).toBeUndefined();
    expect(feedback.failedClaims).toHaveLength(CLAIMS_MAX);
    expect(feedback.failedClaims!.every(row => /^C[0-9]{1,3}$/u.test(row.id) && row.code === "unknown_source")).toBe(true);
    expect(feedback.citedWithoutClaim).toHaveLength(CLAIMS_MAX);
    expect(feedback).not.toHaveProperty("claimsNotCited");
    expect(feedback).not.toHaveProperty("missingSections");
    expect(feedback.codes).toEqual({ unknown_source: CLAIMS_LEDGER_CODE_TEXT.unknown_source });
  });
});
