import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RESEARCH_TOLERANCE_POLICY } from "../../src/main/private-agent/research-contract";
import { normalizeResearchHeadings } from "../../src/main/private-agent/research-pipeline";

const ROOT = resolve(__dirname, "..", "..");
const CR = String.fromCharCode(13), LS = String.fromCharCode(0x2028), NEL = String.fromCharCode(0x85), BOM = String.fromCharCode(0xfeff), FENCE = "```";
const EXACT = "Finding [E1].\n\n## Conflicting evidence\nNone was extracted.\n\n## Unanswered questions\nNone remain.";
const present = (text: string) => ["Conflicting evidence", "Unanswered questions"].map(title => new RegExp(`^## ${title}\\s*$`, "mu").test(text));
/**
 * claims.ts's own rule, run under python3 -I on files: each case is written as UTF-8 and read back with the call claims.ts
 * uses (Path.read_text, universal newlines), then fenced code and HTML comments are removed and section_present runs per line.
 */
function claimsPresent(cases: string[]): boolean[][] {
  const directory = mkdtempSync(join(tmpdir(), "soar-claims-rule-"));
  try {
    const paths = cases.map((text, i) => { const path = join(directory, `case-${i}.md`); writeFileSync(path, text, "utf8"); return path; });
    const script = ["import json, re, sys", "from pathlib import Path",
      "def section_present(lines, title):",
      "    return any(re.sub(r'[*_:\\s]+$', '', re.sub(r'^[#*_\\s]+', '', line)).lower() == title.lower() for line in lines)",
      "def present(path):",
      "    report = Path(path).read_text(encoding='utf-8', errors='replace')",
      "    body = re.sub(r'(?s)<!--.*?-->', '', re.sub(r'(?ms)^[ \\t]*```.*?^[ \\t]*```[ \\t]*$', '', report))",
      "    return [section_present(body.split('\\n'), title) for title in ('Conflicting evidence', 'Unanswered questions')]",
      "print(json.dumps([present(path) for path in json.load(sys.stdin)]))"].join("\n");
    return JSON.parse(execFileSync("python3", ["-I", "-c", script], { input: JSON.stringify(paths), encoding: "utf8", env: { PATH: process.env.PATH ?? "" } }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("7a.1: section headings normalised by claims.ts's rule (finding D5)", () => {
  it("rewrites variant headings to the exact forms, removes a Setext underline with its title, and counts each heading", () => {
    const cases: [string, string, number][] = [
      ["ATX level and colon, bold", EXACT.replace("## Conflicting evidence", "### conflicting evidence:").replace("## Unanswered questions", "**Unanswered questions**"), 2],
      ["upper case and underscores", EXACT.replace("## Conflicting evidence", "# CONFLICTING EVIDENCE").replace("## Unanswered questions", "__Unanswered Questions__"), 2],
      ["Setext", EXACT.replace("## Conflicting evidence", "Conflicting evidence\n--------------------").replace("## Unanswered questions", "Unanswered questions\n  ===="), 2],
      ["a bullet, as claims.ts counts it", EXACT.replace("## Conflicting evidence", "* Conflicting evidence"), 1],

      ["a trailing NEL, whitespace to Python", EXACT.replace("## Conflicting evidence", `## Conflicting evidence${NEL}`), 1],
    ];
    for (const [label, text, rewritten] of cases) expect([label, normalizeResearchHeadings(text)]).toEqual([label, { text: EXACT, rewritten }]);
  });
  it("keeps a thematic break under a bullet title, which is no Setext underline", () => {
    expect(normalizeResearchHeadings("* Conflicting evidence\n---\nText.")).toEqual({ text: "## Conflicting evidence\n---\nText.", rewritten: 1 });
  });
  it("leaves an exact heading, its trailing whitespace and a thematic break under it byte for byte", () => {
    for (const text of [EXACT, EXACT.replace("## Conflicting evidence", "## Conflicting evidence  \t"), EXACT.replace("## Conflicting evidence\n", "## Conflicting evidence\n---\n"),
      EXACT.replaceAll("\n", `${CR}\n`)]) expect(normalizeResearchHeadings(text)).toEqual({ text, rewritten: 0 });
  });
  it("keeps carriage returns on rewritten CRLF lines and removes a CRLF Setext underline", () => {
    const crlf = (text: string) => text.replaceAll("\n", `${CR}\n`);
    const text = crlf(EXACT.replace("## Conflicting evidence", "### Conflicting evidence:").replace("## Unanswered questions", "Unanswered questions\n-----"));
    expect(normalizeResearchHeadings(text)).toEqual({ text: crlf(EXACT), rewritten: 2 });
    // A removed underline's own separator follows the heading: CRLF title, LF underline gives an LF; LF title, CRLF underline a CRLF.
    expect(normalizeResearchHeadings(`Conflicting evidence${CR}\n---\nBody`)).toEqual({ text: "## Conflicting evidence\nBody", rewritten: 1 });
    expect(normalizeResearchHeadings(`Conflicting evidence\n===${CR}\nNone.`)).toEqual({ text: `## Conflicting evidence${CR}\nNone.`, rewritten: 1 });
  });
  it("ends lines at a lone CR too, as claims.ts reads the report, keeping every separator", () => {
    expect(normalizeResearchHeadings(`Intro${CR}**Unanswered questions**${CR}more`)).toEqual({ text: `Intro${CR}## Unanswered questions${CR}more`, rewritten: 1 });
    // "foo" then a closing fence line: the fence opened on the first line closes there, so the title after it is outside any fence.
    expect(normalizeResearchHeadings(`${FENCE}\nfoo${CR}${FENCE}\n**Unanswered questions**\n${FENCE}`)).toEqual({ text: `${FENCE}\nfoo${CR}${FENCE}\n## Unanswered questions\n${FENCE}`, rewritten: 1 });
  });
  it("rewrites every variant of a title it finds", () => {
    const text = `${EXACT}\n\n### conflicting evidence\nMore.`;
    expect(normalizeResearchHeadings(text)).toEqual({ text: `${EXACT}\n\n## Conflicting evidence\nMore.`, rewritten: 1 });
  });
  it("never touches fenced code, an HTML comment, a line a comment touches, a prose line or a byte-order mark", () => {
    for (const text of [`${FENCE}\n### conflicting evidence\n${FENCE}`, `${FENCE}python\nUnanswered questions\n  ${FENCE}  `, "<!--\nConflicting evidence\n-->",
      "## Conflicting evidence <!-- note -->", "<!-- note -->Conflicting evidence", "Conflicting evidence was weighed.", `${BOM}Conflicting evidence`,
      `${FENCE}${CR}\n### unanswered questions${CR}\n${FENCE}${CR}\n`, `${LS}## Conflicting evidence`]) expect([text, normalizeResearchHeadings(text)]).toEqual([text, { text, rewritten: 0 }]);
    // Fenced code goes first, as in claims.ts: a comment opener inside a fence opens nothing.
    expect(normalizeResearchHeadings(`${FENCE}\n<!--\n${FENCE}\n**Unanswered questions**\n-->`)).toEqual({ text: `${FENCE}\n<!--\n${FENCE}\n## Unanswered questions\n-->`, rewritten: 1 });
  });
  it("agrees with claims.ts's own rule, run in Python, except where a comment shares a heading's line", () => {
    const cases = [EXACT, EXACT.replace("## Conflicting evidence", "### conflicting evidence:"), EXACT.replace("## Unanswered questions", "Unanswered questions\n==="),
      EXACT.replace("## Conflicting evidence", `## Conflicting evidence${NEL}`), EXACT.replace("## Conflicting evidence", `${BOM}Conflicting evidence`),
      EXACT.replace("## Conflicting evidence", "* Conflicting evidence"), EXACT.replace("## Conflicting evidence", "Conflicting evidence was weighed."),
      EXACT.replace("## Unanswered questions", `${FENCE}\n### unanswered questions\n${FENCE}`), EXACT.replace("## Unanswered questions", "<!--\nUnanswered questions\n-->"),
      `${FENCE}\n<!--\n${FENCE}\n**Unanswered questions**\n-->\nConflicting evidence`, `${FENCE}\nfoo${CR}${FENCE}\n**Unanswered questions**\n${FENCE}\n## Conflicting evidence`,
      `Intro${CR}**Unanswered questions**${CR}Conflicting evidence${CR}`, `${FENCE}${CR}\n### unanswered questions${CR}\n${FENCE}${CR}\nConflicting evidence`, `${LS}## Conflicting evidence\nUnanswered questions`,
      EXACT.replaceAll("\n", `${CR}\n`).replace("## Conflicting evidence", "Conflicting evidence"), `Conflicting Evidence\n${FENCE}\n## Unanswered questions\n${FENCE}`];
    const python = claimsPresent(cases);
    // The coverage check, which 7a.1 leaves unchanged, still accepts an exact heading inside a fence; claims.ts does not.
    const fencedExact = (text: string) => text.includes(`${FENCE}\n## `);
    for (const [i, text] of cases.entries()) {
      const pipeline = present(normalizeResearchHeadings(text).text);
      expect([i, pipeline]).toEqual([i, fencedExact(text) ? python[i]!.map((value, t) => value || present(text)[t]!) : python[i]]);
    }
    // The stated deviation: a line a comment touches is left as it is, though claims.ts tests what remains of it.
    const partial = ["## Conflicting evidence <!-- note -->", "<!-- note -->Unanswered questions"];
    expect(claimsPresent(partial)).toEqual([[true, false], [false, true]]);
    expect(partial.map(text => present(normalizeResearchHeadings(text).text))).toEqual([[false, false], [false, false]]);
  });
  it("uses Python's whitespace class: the policy's class holds exactly the code points str.isspace() accepts", () => {
    const python = JSON.parse(execFileSync("python3", ["-I", "-c", "import json; print(json.dumps([c for c in range(0x110000) if chr(c).isspace()]))"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } })) as number[];
    const pattern = new RegExp(`^[${RESEARCH_TOLERANCE_POLICY.synthesisHeadings.whitespace}]$`, "u"), ours: number[] = [];
    for (let c = 0; c < 0x110000; c++) if (!(c >= 0xd800 && c <= 0xdfff) && pattern.test(String.fromCodePoint(c))) ours.push(c);
    expect(ours).toEqual(python);
  });
  it("still mirrors claims.ts's rule as written there", () => {
    const claims = readFileSync(resolve(ROOT, "src/main/private-agent/claims.ts"), "utf8");
    expect(claims).toContain("return any(re.sub(r'[*_:\\\\s]+$','',re.sub(r'^[#*_\\\\s]+','',line)).lower()==title.lower() for line in lines)");
    expect(claims).toContain("body=re.sub(r'(?s)<!--.*?-->','',re.sub(r'(?ms)^[ \\\\t]*\\`\\`\\`.*?^[ \\\\t]*\\`\\`\\`[ \\\\t]*$','',report)); lines=body.split('\\\\n')");
    expect(claims).toContain("report_file.read_text(encoding='utf-8',errors='replace')");
  });
  it("normalises a 128 KiB adversarial argument in linear time", () => {
    for (const text of [`${FENCE}x\n`.repeat(26214), "<!--".repeat(32768), "<!-- a -->\n".repeat(11915), "Conflicting evidence\n".repeat(6241), `${FENCE}\n`.repeat(32768),
      `a${"_".repeat(131070)}.`, `a${" ".repeat(131070)}.`, `a${":".repeat(131070)}.`, `${"#".repeat(131070)}a`, `${CR}`.repeat(131072)]) {
      const started = performance.now(); normalizeResearchHeadings(text); expect(performance.now() - started).toBeLessThan(1000);
    }
  });
});
