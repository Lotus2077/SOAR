import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { CLAIMS_LEDGER_CHECK_ID, CLAIMS_LEDGER_PATH } from "../../src/main/private-agent/claims";
import { digest } from "../../src/main/private-agent/contracts";
import { DOCUMENT_REVIEW_CHECK_ID } from "../../src/main/private-agent/document-review";
import { DOCUMENT_REVIEW_FLAGS_PATH, type DocumentReviewFlags } from "../../src/main/private-agent/document-review-flags";
import { HOST_FLAGS_REVIEW_CHECK_ID, HostFlagsEventSchema, claimsReportPath, hostFlagsEvent, recordHostFlags } from "../../src/main/private-agent/host-flags";
import { RESEARCH_FILES } from "../../src/main/private-agent/research-contract";
import type { PrivateAgentStore } from "../../src/main/private-agent/store";
import { researchV4Reply } from "../helpers/research-v4-fixture";
import { researchV4Packet } from "../helpers/research-v4-packet";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const done of cleanups.splice(0).reverse()) done(); });

/** A task's checkpoint store, a small in-memory stand-in for the ledger, and the pass's input around them. */
function harness(options: { checks?: string[]; artifacts?: string[]; files?: { path: string; bytes: Buffer }[]; dispatches?: { purpose: string; status: string }[];
  events?: Record<string, unknown>[] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "soar-host-flags-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const checkpoints = new PrivateCheckpointStore(root, "job-1"), events = [...(options.events ?? [])];
  const store = { events: () => events, dispatches: () => options.dispatches ?? [], atomic: <T>(fn: () => T) => fn(),
    append: (_jobId: string, event: Record<string, unknown>) => { events.push(event); return events.length; } } as unknown as PrivateAgentStore;
  const phase = { contract: { requiredChecks: options.checks ?? [CLAIMS_LEDGER_CHECK_ID],
    requiredArtifacts: (options.artifacts ?? ["output/report.md", CLAIMS_LEDGER_PATH]).map(path => ({ path })) }, files: options.files ?? [] };
  const run = (outputs: Record<string, Buffer | string>) => ({ store, jobId: "job-1", contextId: "private", checkpoints, phase,
    finalSnapshot: checkpoints.save(Object.entries(outputs).map(([path, bytes]) => ({ path, bytes: Buffer.from(bytes) }))) });
  return { root, store, events, checkpoints, run };
}
/** A research run's event, with `text` as its claims report at `path`. */
const report = (text: string, path = "output/report.md") =>
  hostFlagsEvent(harness({ artifacts: [path, CLAIMS_LEDGER_PATH] }).run({ [path]: text, [CLAIMS_LEDGER_PATH]: "[]" }))!;
const hits = (text: string) => report(text).report!.hits;
const absence = (line: number, rule: string, cited = false) => ({ line, rule, class: "absence", cited });
const bounded = (line: number, rule: string, cited = false) => ({ line, rule, class: "bounded", cited });
const argumentHits = (text: string) => hostFlagsEvent(harness({ files: [{ path: RESEARCH_FILES.argument, bytes: Buffer.from(text) }] }).run({}))!.argument!.hits;

describe("backlog item 7(d), part B: the host flags pass (BL-20261110-1153)", () => {
  describe("absence rules v1", () => {
    it.each([
      ["A1", ["None of the sources quantify the cost.", "Neither of the documents covers 2025."], ["None of the authors agreed.", "Not one of the samples failed."]],
      ["A2", ["The sources do not mention the warranty.", "These two reports don't specify a date."], ["The sources do not agree on the date.", "The sources do mention the warranty."]],
      ["A3", ["The corpus contains no evidence of historical additions.", "These files have no figures for 2024."], ["The corpus contains some evidence of additions.", "No corpus was given."]],
      ["A4", ["The documents lack any cost data.", "These sources fail to quantify the risk."], ["The team lacks cost data.", "The report fails a test."]],
      ["A5", ["No source provides efficiency figures.", "No retained document actually states the date."], ["No one provides figures.", "Every source provides figures."]],
      ["A6", ["There is no evidence of a recall.", "There were no figures for that year."], ["There is no conflict between the sources.", "There is evidence of a recall."]],
      ["A7", ["No data on emissions is available.", "No figures for the plant were provided."], ["Data on emissions is available.", "No one was provided a copy."]],
      ["A8", ["The cost is not mentioned anywhere.", "Its owner is not specified in the sources."], ["The cost is mentioned in the sources.", "It is not mentioned here."]],
      ["A9", ["Nowhere in the sources is a date given.", "A price appears nowhere within the documents."], ["Nowhere else is it cheaper.", "It appears everywhere in the sources."]],
      ["A10", ["The date is absent from the sources.", "A figure is missing in these documents."], ["The date is absent today.", "A page is missing from the binder."]],
    ] as const)("%s flags its positives and none of its negatives", (rule, positives, negatives) => {
      for (const sentence of positives) expect(hits(sentence), sentence).toEqual([absence(1, rule)]);
      for (const sentence of negatives) expect(hits(sentence).filter(hit => hit.rule === rule), sentence).toEqual([]);
    });
    it("leaves the backlog's negatives unflagged, classes the run's own extraction as bounded, and reads a claim citation as cited", () => {
      for (const sentence of ["The sources do not agree on the date.", "There is no conflict between the sources.",
        "A lack of extracted evidence does not establish absence in the corpus."]) expect(hits(sentence), sentence).toEqual([]);
      expect(hits("No verified evidence was found in the extracted packet.")).toEqual([{ line: 1, rule: "A7", class: "bounded", cited: false }]);
      expect(hits("None of the sources quantify the cost [C2].")).toEqual([absence(1, "A1", true)]);
      // Citations are case-sensitive, in the claims check's form.
      expect(hits("None of the sources quantify the cost [c2].")).toEqual([absence(1, "A1")]);
      const event = report("None of the sources quantify the cost [C1]. There is no evidence of a recall. No verified evidence was found in the extracted packet.");
      expect(event.counts).toEqual({ reportAbsence: 2, reportAbsenceUncited: 1, reportBounded: 1 }); expect(event.rules).toEqual({ absence: 1 });
    });
    it("reads wrapped, bulleted, heading, table-row and second-line claims, each on its own line, and never lends a citation across a block", () => {
      const text = ["# Findings", "Capacity rose [C1].", "- None of the sources mention 2025 prices.", "| No source provides efficiency figures. |", "", "The analysis",
        "notes that none of the", "sources quantify the cost.", "> There is no evidence of a recall.", "## None of the sources cover 2025", "Prices rose [C3].",
        "| Neither of the documents covers 2024 |", "Costs fell [C4].", "Prices rose [C5].", "None of the sources mention 2023."].join("\n");
      expect(hits(text)).toEqual([absence(3, "A1"), absence(4, "A5"), absence(7, "A1"), absence(9, "A6"), absence(10, "A1"), absence(12, "A1"), absence(15, "A1")]);
      // A bullet's wrapped line is still the bullet's, so its citation counts.
      expect(hits("- None of the sources mention\n  2025 prices [C2].")).toEqual([absence(1, "A1", true)]);
      // An indented or tab-indented continuation, and a hard break's trailing spaces, still fold to one space.
      expect(hits("- The sources do not\n  mention the warranty.")).toEqual([absence(1, "A2")]);
      expect(hits("The analysis notes that none of the\n   sources quantify the cost.")).toEqual([absence(1, "A1")]);
      expect(hits("The analysis notes that none of the  \nsources quantify the cost.")).toEqual([absence(1, "A1")]);
      expect(hits("- No source\n\tprovides efficiency figures.")).toEqual([absence(1, "A5")]);
    });
    it("blanks fenced code and HTML comments line for line, strips tags, and keeps the line numbers", () => {
      const text = ["```", "None of the sources quantify the cost.", "```", "<!-- None of the sources", "quantify the cost. -->", "<p>No source provides <b>efficiency</b> figures.</p>",
        "~~~", "No source provides it.", "~~~", "There is <!-- a --> no evidence of a recall."].join("\n");
      expect(hits(text)).toEqual([absence(6, "A5"), absence(10, "A6")]);
      expect(report("<p>None of the sources quantify the cost.</p>", "output/report.HTML").report).toEqual({ format: "html", scanned: true, textCut: false,
        hits: [absence(1, "A1")], truncated: false });
      // A fence line inside an open comment neither opens nor closes a fence.
      expect(hits(["<!-- draft", "```", "old", "-->", "None of the sources quantify the cost.", "```", "code", "```", "No source provides efficiency figures."].join("\n")))
        .toEqual([absence(5, "A1"), absence(9, "A5")]);
    });
    it("strips tags across lines, ends a sentence at a block-level tag, and reads any other tag as a space", () => {
      const html = (text: string) => report(text, "output/report.html").report!.hits;
      expect(html("<h2>Unanswered questions</h2>\n<ul>\n<li>Prices rose in 2024 [C1]</li>\n<li>None of the sources quantify the cost</li>\n</ul>")).toEqual([absence(4, "A1")]);
      expect(html("<p>Prices rose [C1].</p><p>None of the sources quantify the cost.</p>")).toEqual([absence(1, "A1")]);
      expect(html("<tr><td>Cost</td><td>No source provides efficiency figures</td></tr>")).toEqual([absence(1, "A5")]);
      expect(html("<img\n alt=\"None of the sources quantify the cost.\">\n<p>There is no evidence of a recall.</p>")).toEqual([absence(3, "A6")]);
      expect(html("None of the<br>sources quantify the cost [C2].")).toEqual([absence(1, "A1", true)]);
      // Not a tag: a less-than sign before a space or a digit.
      expect(html("Growth was < 5% and <5% elsewhere; none of the sources quantify the cost.")).toEqual([absence(1, "A1")]);
    });
    // The mutation review of a0c005b: every word of each rule's lists, each gap's bounds, the rule order and one hit per sentence.
    it("matches every word of each rule's lists, within each gap's bounds, first rule only", () => {
      const each = (rule: string, sentences: string[]) => { for (const sentence of sentences) expect(hits(sentence), sentence).toEqual([absence(1, rule)]); };
      expect(hits("There is no evidence that none of the sources mention 2025.")).toEqual([absence(1, "A1")]);
      each("A1", ["Not one of the sources mentions it.", ...["corpora", "file", "page", "pages", "material", "materials", "record", "records", "studies", "study", "literature",
        "dataset", "datasets", "text", "texts", "article", "articles", "filing", "filings", "reference", "references"].map(word => `None of the ${word} mention it.`)]);
      each("A2", ["The two retained sources do not mention the date.", "All sources do not mention the date.", "Any source does not mention the date.",
        "This study did not mention the date.", "Those reports can not mention the date.", "The sources could not mention the date.",
        ...["address", "discuss", "report", "provide", "state", "cover", "quantify", "describe", "contain", "include", "document", "give", "list", "identify"]
          .map(verb => `The sources do not ${verb} the date.`)]);
      each("A3", ["The retained documents contain no date.", ...["provides", "provide", "offers", "offer", "includes", "include", "gives", "give", "has", "mentions", "mention",
        "reports", "report"].map(verb => `The sources ${verb} no date.`)]);
      each("A4", ["The retained sources lack a date.", "The sources omit the date.", "The source omits the date.", "The sources are silent on the date.",
        "This study is silent on the date.", ...["mention", "address", "report", "provide", "specify", "discuss", "state", "cover"].map(verb => `The sources fail to ${verb} the date.`)]);
      each("A5", ["No source in the corpus states the date.", ...["mentions", "mention", "addresses", "discusses", "reports", "specifies", "specify", "documents", "covers",
        "quantifies", "quantify", "describes", "contains", "includes"].map(verb => `No source ${verb} the date.`)]);
      each("A6", ["There is no direct evidence of a recall.", "There are no figures for 2024.", "There was no evidence of a recall.", ...["information", "data", "statistics",
        "mention", "record", "records", "documentation", "discussion", "indication", "estimate", "estimates"].map(noun => `There is no ${noun} of a recall.`)]);
      each("A7", ["No data for the plant in that year is available.", "No reliable public data on emissions is available.", ...["information", "statistics", "mention", "detail",
        "details", "estimate", "estimates"].map(noun => `No ${noun} on emissions is available.`), ...["given", "reported", "cited", "included", "present"].map(verb => `No figures are ${verb}.`)]);
      each("A8", ["The cost is not mentioned in the retained sources.", "The costs are not mentioned anywhere.", "The cost was not mentioned anywhere.",
        "The costs were not mentioned anywhere.", ...["addressed", "discussed", "reported", "documented", "covered", "stated", "quantified", "described", "provided", "included",
        "available"].map(word => `The cost is not ${word} anywhere.`), "The cost is not mentioned by any source.", "The cost is not mentioned within these documents.",
        "The cost is not mentioned across those sources."]);
      each("A9", ["Nowhere in the retained sources is a date given.", "The date appears not anywhere in the sources.", "Nowhere across the sources is a date given.",
        "Nowhere in any source is a date given.", "Nowhere in these documents is a date given."]);
      each("A10", ["The date is absent from the retained sources.", "The date is absent from all sources.", "The date is missing in any source."]);
      for (const sentence of ["The two old retained sources do not mention the date.", "None of the textbooks were late.", "The corpus contains notes on 2024.",
        "The report does not mention the warranty.",
        // A v1 recall limit, recorded in the Implemented entry: A2 reads "can not" but not "can't" or "cannot", as the design entry writes it.
        "The sources can't mention the date.", "The sources cannot mention the date."]) expect(hits(sentence), sentence).toEqual([]);
    });
    it("classes each bounded phrase in any case, and reads every citation width but no lookalike", () => {
      for (const sentence of ["None of the sources mention 2025 in the packet.", "None of the sources mention 2025 in the retained evidence.",
        "None of the sources mention 2025 among the verified quotes.", "None of the sources mention 2025 in the verified evidence.",
        "The run did not find it: none of the sources mention 2025.", "The search did not find it: none of the sources mention 2025.",
        "The retrieval did not find it: none of the sources mention 2025.", "The review did not find it: none of the sources mention 2025.",
        "This review did not find it: none of the sources mention 2025.", "None of the sources mention 2025 after extraction.",
        "None of the sources mention 2025 in the extracted text."]) expect(hits(sentence), sentence).toEqual([bounded(1, "A1")]);
      expect(hits("None of the sources quantify the cost [C100].")).toEqual([absence(1, "A1", true)]);
      expect(argumentHits("None of the sources mention 2025 [E480].")).toEqual([absence(1, "A1", true)]);
      expect(argumentHits("None of the sources mention ACE12.")).toEqual([absence(1, "A1")]);
    });
    it("ends blocks and sentences exactly where the rules say, and numbers lines past every fold", () => {
      expect(hits("Prices rose [C1]\n* None of the sources mention 2025.\n+ None of the sources mention 2024.")).toEqual([absence(2, "A1"), absence(3, "A1")]);
      // "1. None" already ends a sentence at the marker's own period, so a ")" marker or a lowercase item tells the block apart.
      expect(hits("Prices rose [C1]\n1) None of the sources mention 2025.")).toEqual([absence(2, "A1")]);
      expect(hits("Prices rose [C1]\n2. none of the sources mention 2024.")).toEqual([absence(2, "A1")]);
      expect(hits("Prices rose [C1]\n  - None of the sources mention 2025.")).toEqual([absence(2, "A1")]);
      // Spaces and tabs are trimmed; any other leading whitespace before a marker still starts a block.
      expect(hits("Prices rose [C1]\n\f- None of the sources mention 2025.")).toEqual([absence(2, "A1")]);
      expect(hits("Did prices rise [C1]? None of the sources mention 2025! None of the sources mention 2024.")).toEqual([absence(1, "A1"), absence(1, "A1")]);
      for (const next of ['"None of the sources mention 2025."', "'None of the sources mention 2025.'", "(None of the sources mention 2025.)", "[None of the sources mention 2025.]",
        "2025 is absent from the sources."]) expect(hits(`Prices rose [C1]. ${next}`), next).toEqual([absence(1, next.startsWith("2025") ? "A10" : "A1")]);
      expect(hits("Prices rose [C1].  \nNone of the sources mention 2025.")).toEqual([absence(2, "A1")]);
      expect(hits("Prices rose.\nCosts fell.\nMargins held.\nYet no\nsource provides efficiency figures.")).toEqual([absence(4, "A5")]);
    });
    it("finds a fence at up to three spaces of indent, blanks its lines, carries a comment across lines, and reads <!--> as an empty comment", () => {
      expect(hits("    ```\nNone of the sources quantify the cost.")).toEqual([absence(2, "A1")]);
      expect(hits("  ```\nNone of the sources quantify the cost.\n  ```")).toEqual([]);
      expect(hits("Prices rose [C1]\n```\n```\nNone of the sources mention 2025.")).toEqual([absence(4, "A1")]);
      expect(hits("<!--\nNone of the sources quantify the cost.\n-->")).toEqual([]);
      expect(hits("<!-->\nNone of the sources quantify the cost.")).toEqual([absence(2, "A1")]);
      expect(hits("<!--->\nNone of the sources quantify the cost.")).toEqual([absence(2, "A1")]);
      expect(hits("<!-- a -- b -->None of the sources quantify the cost.")).toEqual([absence(1, "A1")]);
      expect(hits("None of the <em>sources</em> quantify the cost.")).toEqual([absence(1, "A1")]);
      expect(hits("Prices rose [C1]. \u201cNone of the sources mention 2025.\u201d")).toEqual([absence(1, "A1")]);
      expect(hits("Prices rose [C1]. \u2018None of the sources mention 2025.\u2019")).toEqual([absence(1, "A1")]);
      expect(hits("None of the\tsources quantify the cost.")).toEqual([absence(1, "A1")]);
    });
    it("normalizes curly quotes and compatibility characters before matching", () => {
      expect(hits("These reports don\u2019t specify a date.")).toEqual([absence(1, "A2")]);
      expect(hits("\uff2e\uff4f\uff4e\uff45 of the sources quantify the cost.")).toEqual([absence(1, "A1")]);
    });
    it("keeps 40 hits in line order, counts all of them, and says the list was cut", () => {
      const event = report(Array.from({ length: 41 }, (_, i) => `None of the sources mention item ${i}.`).join("\n\n"));
      expect(event.report!.hits).toHaveLength(40); expect(event.report!.hits.map(hit => hit.line)).toEqual(Array.from({ length: 40 }, (_, i) => 2 * i + 1));
      expect(event.report!.truncated).toBe(true); expect(event.counts).toEqual({ reportAbsence: 41, reportAbsenceUncited: 41, reportBounded: 0 });
      expect(report(Array.from({ length: 40 }, () => "None of the sources mention it.").join("\n\n")).report!.truncated).toBe(false);
    });
  });

  describe("formats and bounds", () => {
    it("leaves Word and PDF content unscanned whatever the extension's case, decides the rest by extension, and says a report is missing", () => {
      expect(report("PK\x03\x04 None of the sources quantify the cost.", "output/Report.DOCX").report).toEqual({ format: "docx", scanned: false, reason: "format_not_scanned",
        textCut: false, hits: [], truncated: false });
      expect(report("%PDF-1.7 None of the sources quantify the cost.", "output/report.md").report).toMatchObject({ format: "pdf", scanned: false, reason: "format_not_scanned" });
      // Content without the ZIP signature is not a Word file, whatever its name: it is read as text.
      expect(report("None of the sources quantify the cost.", "output/notes.docx").report).toMatchObject({ format: "text", scanned: true, hits: [absence(1, "A1")] });
      expect(report("x", "output/notes.MARKDOWN").report!.format).toBe("markdown"); expect(report("x", "output/page.htm").report!.format).toBe("html");
      const missing = hostFlagsEvent(harness().run({ [CLAIMS_LEDGER_PATH]: "[]" }))!;
      expect(missing.report).toEqual({ format: "markdown", scanned: false, reason: "missing", textCut: false, hits: [], truncated: false });
      // No rule ran, so none is named and nothing reads as a zero count.
      expect(missing.rules).toEqual({}); expect(missing.counts).toEqual({});
      // An argument scanned without a report still names the rules.
      const argued = hostFlagsEvent(harness({ files: [{ path: RESEARCH_FILES.argument, bytes: Buffer.from("None of the sources mention 2025.") }] }).run({}))!;
      expect(argued.rules).toEqual({ absence: 1 }); expect(argued.counts).toEqual({ argumentAbsence: 1, argumentAbsenceUncited: 1, argumentBounded: 0 });
    });
    it("scans the first MiB only, cut at a character boundary", () => {
      const cut = report(`None of the sources quantify the cost.\n${"\u00e9".repeat(600_000)}\nNone of the sources mention 2025.`).report!;
      expect(cut).toEqual({ format: "markdown", scanned: true, textCut: true, hits: [absence(1, "A1")], truncated: false });
      expect(report(`${"a".repeat(1024 * 1024 - 40)}\nNone of the sources quantify it.`).report).toMatchObject({ textCut: false, hits: [absence(2, "A1")] });
      // The cap also counts characters after NFKC: 60,000 of U+FDFA (180,000 bytes) normalize to 1,080,000 characters.
      expect(report(`${"\ufdfa".repeat(60_000)}\nNone of the sources quantify the cost.`).report).toMatchObject({ scanned: true, textCut: true, hits: [] });
      // Exactly 1 MiB of bytes, and exactly 1 Mi characters, are read whole; one byte more is cut.
      expect(report("a".repeat(1 << 20)).report!.textCut).toBe(false); expect(report(`${"\u00e9".repeat(1 << 19)}x`).report!.textCut).toBe(true);
      expect(report(`None of the sources quantify the cost.\n${"a".repeat(1 << 20)}`).report).toMatchObject({ textCut: true, hits: [absence(1, "A1")] });
      expect(report(`${"a".repeat((1 << 20) - 18)}\nNone of the stud\uff59`).report).toMatchObject({ textCut: true, hits: [] });
      // The character cap cuts the line it falls in once, counting each line's newline, and reads nothing after it.
      expect(report(`None of the sources quantify the cost.${"\ufdfa".repeat(58_252)}a.${"\ufdfa".repeat(10)}\nNone of the sources mention 2025.`).report)
        .toMatchObject({ textCut: true, hits: [absence(1, "A1")] });
      expect(report(`aaaa${"\ufdfa".repeat(58_253)}\nNone of the corpus`).report).toMatchObject({ textCut: true, hits: [] });
      // Only the full four-byte ZIP signature is Word content.
      expect(report("PK\x03\x05 None of the sources quantify the cost.", "output/notes.txt").report).toMatchObject({ format: "text", scanned: true });
      // An argument that is not scanned names no rule and counts nothing.
      const pdf = hostFlagsEvent(harness({ files: [{ path: RESEARCH_FILES.argument, bytes: Buffer.from("%PDF-1.7 None of the sources mention 2025.") }] }).run({}))!;
      expect(pdf.argument).toMatchObject({ format: "pdf", scanned: false }); expect(pdf.rules).toEqual({}); expect(pdf.counts).toEqual({});
    });
    it("stays well inside a generous bound on adversarial shapes at 1 MiB, in a child process that a regression cannot hang", () => {
      // One child runs every shape under a hard timeout, so a step that turns quadratic fails here instead of hanging the suite: a synchronous
      // scan cannot be interrupted by the test's own timeout. NFKC's canonical reordering is quadratic in a run of non-starters, so the three
      // mark shapes took minutes before runs were cut at 30.
      const shapes = `{ tags: "<".repeat(1 << 20), unclosed: "<" + "a".repeat((1 << 20) - 1), comments: "<!--".repeat(1 << 18), expansion: "\\ufdfa".repeat(350000),
        words: "word ".repeat(200000) + "none of the sources", lines: "a\\n".repeat(1 << 19), sentences: "A. ".repeat(349525), blocks: "a\\n\\n".repeat(349525),
        rules: "No source the the no evidence there is no ".repeat(24966), hits: "None of the sources mention it. ".repeat(32768), bullets: "- a\\n".repeat(262144),
        marks: "a" + "\\u0316\\u0301".repeat(262143), halfwidth: "\\uff9e\\u0334".repeat(209715), tibetan: "\\u0f73".repeat(349525), tagStarts: "<a ".repeat(349525),
        tagSpan: "<a" + " x".repeat(524287), tagLines: "<p\\n".repeat(349525), blockTags: "<li>a</li>".repeat(104857) }`;
      const code = `import { mkdtempSync, rmSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
        import { PrivateCheckpointStore } from "./src/main/private-agent/checkpoints.ts"; import { hostFlagsEvent } from "./src/main/private-agent/host-flags.ts";
        const root = mkdtempSync(join(tmpdir(), "soar-host-flags-shapes-")), checkpoints = new PrivateCheckpointStore(root, "job-1");
        const store = { events: () => [], dispatches: () => [], atomic: fn => fn(), append: () => 0 };
        const phase = { contract: { requiredChecks: ["research_claims_ledger"], requiredArtifacts: [{ path: "output/report.md" }] }, files: [] };
        try {
          for (const [name, text] of Object.entries(${shapes})) {
            const finalSnapshot = checkpoints.save([{ path: "output/report.md", bytes: Buffer.from(text) }]), started = performance.now();
            const event = hostFlagsEvent({ store, jobId: "job-1", contextId: "p", checkpoints, finalSnapshot, phase });
            console.log(JSON.stringify({ name, bytes: Buffer.byteLength(text), ms: performance.now() - started, scanned: event.report.scanned }));
          }
        } finally { rmSync(root, { recursive: true, force: true }); }`;
      const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: process.cwd(), encoding: "utf8", timeout: 150_000 });
      expect(child.signal, "the shapes did not finish within 150 s").toBeNull(); expect(child.status, child.stderr).toBe(0);
      const results = child.stdout.trim().split("\n").map(line => JSON.parse(line) as { name: string; bytes: number; ms: number; scanned: boolean });
      expect(results).toHaveLength(18);
      for (const result of results) {
        expect(result.bytes, result.name).toBeGreaterThan(1_000_000); expect(result.bytes, result.name).toBeLessThanOrEqual(1_050_000);
        expect(result.scanned, result.name).toBe(true); expect(result.ms, result.name).toBeLessThan(10_000);
      }
    }, 180_000);
  });

  describe("misses and the single-unit brief", () => {
    /** The pipeline's own packet. `gaps` adds a question no chunk evidences, a fabricated quote the pipeline drops (so one extraction is retried) and two
     * absence sentences in the argument. */
    const packet = async (brief?: string, gaps = false) => {
      let fabricated = false;
      const reply = (system: string, user: string) => {
        const value = JSON.parse(researchV4Reply(system, user)) as Record<string, any>;
        if (!gaps) return JSON.stringify(value);
        if (system.startsWith("You plan")) value.questions.push({ ...value.questions[0], id: "Q2", text: "What do the observations leave open?" });
        if (system.startsWith("You extract")) {
          value.questions = value.questions.map((question: { questionId: string }) => question.questionId === "Q2" ? { questionId: "Q2", status: "no_verified_evidence" } : question);
          value.quotes = value.quotes.map((quote: Record<string, unknown>) => ({ ...quote, questionIds: ["Q1"] }));
          if (!fabricated) { fabricated = true; value.quotes.push({ quote: "A sentence that no source contains anywhere.", questionIds: ["Q1"], note: "" }); }
        }
        if (system.startsWith("You write")) value.argument += "\n\nNone of the sources mention 2025 prices. None of the sources quantify the cost [E1].";
        return JSON.stringify(value);
      };
      return (await researchV4Packet(brief, undefined, reply)).files;
    };
    it("counts what the packet and the ledger record, names the packet, scans the argument, and flags the single-unit brief", async () => {
      const files = await packet(undefined, true), coverage = files.find(file => file.path === RESEARCH_FILES.coverage)!;
      const argument = files.find(file => file.path === RESEARCH_FILES.argument)!.bytes.toString("utf8").split("\n");
      const h = harness({ files, dispatches: [{ purpose: "public source retrieval", status: "failed" }, { purpose: "public source retrieval", status: "settled" },
        { purpose: "public source retrieval", status: "unknown" }, { purpose: "research plan", status: "failed" }],
      events: [{ type: "tool_finished", output: JSON.stringify({ completed: false, error: "public_fetch_limit_reached" }) }, { type: "tool_finished", output: "not json" },
        { type: "tool_finished", output: JSON.stringify({ error: "path_invalid" }) }, { type: "tool_finished", output: { error: "public_fetch_limit_reached" } },
        { type: "tool_started", output: JSON.stringify({ error: "public_fetch_limit_reached" }) }] });
      const event = hostFlagsEvent(h.run({ "output/report.md": "Prices fell [C1].", [CLAIMS_LEDGER_PATH]: "[]" }))!;
      expect(event.misses).toEqual({ briefUnits: 1, questionsWithoutEvidence: 1, unresolvedQuestions: 1, noEvidenceOutcomes: 2, extractionRetries: 1, droppedQuotes: 1,
        fetchFailures: 1, fetchLimitRefusals: 1 });
      expect(event.packet).toEqual({ coverageSha256: digest(coverage.bytes) });
      const at = argument.findIndex(line => line.includes("None of the sources mention 2025")) + 1;
      expect(event.argument).toEqual({ format: "markdown", scanned: true, textCut: false, hits: [absence(at, "A1"), absence(at, "A1", true)], truncated: false });
      expect(event.counts).toEqual({ reportAbsence: 0, reportAbsenceUncited: 0, reportBounded: 0, argumentAbsence: 2, argumentAbsenceUncited: 1, argumentBounded: 0,
        briefSingleUnit: 1 });
    }, 30_000);
    it("records no misses for the plain fixture packet beyond its single unit, and no single-unit flag for a numbered brief", async () => {
      const plain = hostFlagsEvent(harness({ files: await packet() }).run({ "output/report.md": "x" }))!;
      expect(plain.misses).toEqual({ briefUnits: 1, questionsWithoutEvidence: 0, unresolvedQuestions: 0, noEvidenceOutcomes: 0, extractionRetries: 0, droppedQuotes: 0,
        fetchFailures: 0, fetchLimitRefusals: 0 });
      expect(plain.counts.briefSingleUnit).toBe(1); expect(plain.argument!.hits).toEqual([]);
      const numbered = hostFlagsEvent(harness({ files: await packet("1. Describe the alpha observations.\n2. Describe the beta observations.\n") }).run({ "output/report.md": "x" }))!;
      expect(numbered.misses!.briefUnits).toBe(2); expect(numbered.counts.briefSingleUnit).toBe(0);
    }, 30_000);
    it("records none of the section's parts when its ledger read fails after the packet was read", async () => {
      const h = harness({ files: await packet() });
      vi.spyOn(h.store, "dispatches").mockImplementation(() => { throw new Error("database locked"); });
      const event = hostFlagsEvent(h.run({ "output/report.md": "x" }))!;
      expect(event.errors).toEqual(["misses_failed"]); expect(event).not.toHaveProperty("misses"); expect(event).not.toHaveProperty("packet");
      expect(event.counts).not.toHaveProperty("briefSingleUnit"); expect(event.argument).toMatchObject({ scanned: true });
    }, 30_000);
    it("records only the ledger's misses without a packet, and a failed section by its code alone", () => {
      const plain = hostFlagsEvent(harness().run({ "output/report.md": "x" }))!;
      expect(plain.misses).toEqual({ fetchFailures: 0, fetchLimitRefusals: 0 }); expect(plain).not.toHaveProperty("packet"); expect(plain.counts).not.toHaveProperty("briefSingleUnit");
      for (const bytes of ["{not json", JSON.stringify({ version: 1 })]) {
        const broken = hostFlagsEvent(harness({ files: [{ path: RESEARCH_FILES.coverage, bytes: Buffer.from(bytes) }] }).run({ "output/report.md": "None of the sources quantify the cost." }))!;
        expect(broken.errors).toEqual(["misses_failed"]); expect(broken).not.toHaveProperty("misses"); expect(broken).not.toHaveProperty("packet");
        expect(broken.counts).toEqual({ reportAbsence: 1, reportAbsenceUncited: 1, reportBounded: 0 }); expect(JSON.stringify(broken)).not.toMatch(/Unexpected|Invalid|expected|token/u);
      }
    });
  });

  describe("the document-review summary", () => {
    const flags: DocumentReviewFlags = { version: 1, rules: { inversion: 1, numeric: 1 },
      counts: { inversionEdits: 1, inversionIntroduced: 0, inversionSource: 1, inversionUnaddressed: 1, numericIntroduced: 0, numericResolved: 0, numericSource: 1, numericUnaddressed: 1 },
      read: { comparisonsCapped: false, figuresCapped: false, labelsCapped: false, paragraphsClipped: 0, rowsCapped: false, sentencesCapped: false, termsCapped: true },
      numeric: { flags: [{ table: 1, row: 2, paragraph: 5, inSource: true, inClean: true, addressedBy: [], source: { row: ["50 USD"], prose: ["75 USD"] },
        clean: { row: ["50 USD"], prose: ["75 USD"] } }], truncated: false },
      edits: { flags: [{ id: "E2", codes: ["negation_flipped"] }], truncated: false },
      clauses: { flags: [{ paragraphs: [7, 8], inSource: true, inClean: false, addressedBy: ["E2"] }], truncated: false } };
    const review = (outputs: Record<string, string>) => hostFlagsEvent(harness({ checks: [HOST_FLAGS_REVIEW_CHECK_ID], artifacts: ["output/redline.docx"] }).run(outputs))!;
    it("keeps the review check's id equal to the applier module's, without loading it", () => {
      expect(HOST_FLAGS_REVIEW_CHECK_ID).toBe(DOCUMENT_REVIEW_CHECK_ID);
    });
    it("records positions, ids, caps and counts from a valid file, never its values", () => {
      const event = review({ [DOCUMENT_REVIEW_FLAGS_PATH]: `${JSON.stringify(flags, null, 1)}\n` });
      expect(event).toEqual({ type: "host_flags", contextId: "private", version: 1, rules: { review: 1 }, counts: flags.counts,
        review: { valid: true, read: flags.read, numeric: [{ table: 1, row: 2, paragraph: 5, inSource: true, inClean: true, addressed: false }],
          edits: [{ id: "E2", codes: ["negation_flipped"] }], clauses: [{ paragraphs: [7, 8], inSource: true, inClean: false, addressed: true }] } });
      expect(JSON.stringify(event)).not.toContain("USD");
      // The event's own schema admits only the closed set of edit codes.
      expect(HostFlagsEventSchema.safeParse({ ...event, review: { ...event.review, edits: [{ id: "E2", codes: ["Acme pays Beta"] }] } }).success).toBe(false);
    });
    it("names the step or the rule that failed, and leaves a failed part's list and counts out, so absent never reads as zero", () => {
      // As the applier writes them: a failed rule's list empty and its counts zero; a failed step's all of them, and nothing read.
      const numericFailed = review({ [DOCUMENT_REVIEW_FLAGS_PATH]: JSON.stringify({ ...flags, numeric: { flags: [], truncated: false, error: "IndexError" },
        counts: { ...flags.counts, numericIntroduced: 0, numericResolved: 0, numericSource: 0, numericUnaddressed: 0 } }) });
      expect(numericFailed.review).toEqual({ valid: true, errors: { numeric: "IndexError" }, read: flags.read, edits: [{ id: "E2", codes: ["negation_flipped"] }],
        clauses: [{ paragraphs: [7, 8], inSource: true, inClean: false, addressed: true }] });
      expect(numericFailed.counts).toEqual({ inversionEdits: 1, inversionIntroduced: 0, inversionSource: 1, inversionUnaddressed: 1 });
      const clausesFailed = review({ [DOCUMENT_REVIEW_FLAGS_PATH]: JSON.stringify({ ...flags, clauses: { flags: [], truncated: false, error: "IndexError" },
        counts: { ...flags.counts, inversionIntroduced: 0, inversionSource: 0, inversionUnaddressed: 0 } }) });
      expect(clausesFailed.review).toEqual({ valid: true, errors: { clauses: "IndexError" }, read: flags.read,
        numeric: [{ table: 1, row: 2, paragraph: 5, inSource: true, inClean: true, addressed: false }], edits: [{ id: "E2", codes: ["negation_flipped"] }] });
      expect(clausesFailed.counts).toEqual({ inversionEdits: 1, numericIntroduced: 0, numericResolved: 0, numericSource: 1, numericUnaddressed: 1 });
      const editsFailed = review({ [DOCUMENT_REVIEW_FLAGS_PATH]: JSON.stringify({ ...flags, edits: { flags: [], truncated: false, error: "KeyError" },
        counts: { ...flags.counts, inversionEdits: 0 } }) });
      expect(editsFailed.review).toMatchObject({ errors: { edits: "KeyError" } }); expect(editsFailed.review).not.toHaveProperty("edits");
      expect(editsFailed.counts).not.toHaveProperty("inversionEdits"); expect(editsFailed.counts).toHaveProperty("inversionSource", 1);
      const zero = Object.fromEntries(Object.keys(flags.counts).map(name => [name, 0]));
      const read = { comparisonsCapped: false, figuresCapped: false, labelsCapped: false, paragraphsClipped: 0, rowsCapped: false, sentencesCapped: false, termsCapped: false };
      const stepFailed = review({ [DOCUMENT_REVIEW_FLAGS_PATH]: JSON.stringify({ version: 1, rules: flags.rules, counts: zero, read, numeric: { flags: [], truncated: false },
        edits: { flags: [], truncated: false }, clauses: { flags: [], truncated: false }, error: "ValueError" }) });
      expect(stepFailed).toEqual({ type: "host_flags", contextId: "private", version: 1, rules: { review: 1 }, counts: {}, review: { valid: true, errors: { step: "ValueError" } } });
    });
    it("copies whether each flag was addressed, where it holds, and every code", () => {
      const reviewOf = (file: unknown) => review({ [DOCUMENT_REVIEW_FLAGS_PATH]: JSON.stringify(file) }).review;
      expect(reviewOf({ ...flags, numeric: { flags: [{ ...flags.numeric.flags[0], addressedBy: ["E2"] }], truncated: false } })).toMatchObject({ numeric: [{ addressed: true }] });
      expect(reviewOf({ ...flags, clauses: { flags: [{ ...flags.clauses.flags[0], addressedBy: [] }], truncated: false } })).toMatchObject({ clauses: [{ addressed: false }] });
      expect(reviewOf({ ...flags, numeric: { flags: [{ ...flags.numeric.flags[0], inClean: false, clean: null }], truncated: false } }))
        .toMatchObject({ numeric: [{ inSource: true, inClean: false }] });
      expect(reviewOf({ ...flags, edits: { flags: [{ id: "E2", codes: ["negation_flipped", "modality_changed"] }], truncated: false } }))
        .toMatchObject({ edits: [{ id: "E2", codes: ["negation_flipped", "modality_changed"] }] });
      expect(reviewOf({ ...flags, edits: { flags: [], truncated: false, error: "KeyError" }, clauses: { flags: [], truncated: false, error: "ValueError" },
        counts: { ...flags.counts, inversionEdits: 0, inversionIntroduced: 0, inversionSource: 0, inversionUnaddressed: 0 } }))
        .toMatchObject({ valid: true, errors: { edits: "KeyError", clauses: "ValueError" } });
      // The review rules ran whatever the file holds.
      expect(review({}).rules).toEqual({ review: 1 });
    });
    it("records a missing, an invalid and an oversized file, and never loads the oversized one", () => {
      expect(review({}).review).toEqual({ valid: false, reason: "missing" });
      expect(review({ [DOCUMENT_REVIEW_FLAGS_PATH]: JSON.stringify({ ...flags, version: 2 }) }).review).toEqual({ valid: false, reason: "invalid" });
      expect(review({ [DOCUMENT_REVIEW_FLAGS_PATH]: "{not json" }).review).toEqual({ valid: false, reason: "invalid" });
      const h = harness({ checks: [HOST_FLAGS_REVIEW_CHECK_ID] }), input = h.run({ [DOCUMENT_REVIEW_FLAGS_PATH]: JSON.stringify(flags).padEnd(512 * 1024 + 1) });
      const load = vi.spyOn(h.checkpoints, "load");
      expect(hostFlagsEvent(input)!.review).toEqual({ valid: false, reason: "too_large" }); expect(load).not.toHaveBeenCalled();
      // Exactly 512 KiB is read.
      expect(review({ [DOCUMENT_REVIEW_FLAGS_PATH]: JSON.stringify(flags).padEnd(512 * 1024) }).review).toMatchObject({ valid: true });
    });
    it("records a damaged flags blob as a failed section, never as an invalid file", () => {
      const h = harness({ checks: [HOST_FLAGS_REVIEW_CHECK_ID] }), input = h.run({ [DOCUMENT_REVIEW_FLAGS_PATH]: JSON.stringify(flags) }), entry = input.finalSnapshot[0]!;
      writeFileSync(join(h.root, "job-1", entry.sha256), Buffer.alloc(entry.bytes, 0x20));
      expect(hostFlagsEvent(input)).toEqual({ type: "host_flags", contextId: "private", version: 1, rules: { review: 1 }, counts: {}, errors: ["review_failed"] });
    });
    it("runs both parts for a phase that requires both checks", () => {
      const event = hostFlagsEvent(harness({ checks: [CLAIMS_LEDGER_CHECK_ID, HOST_FLAGS_REVIEW_CHECK_ID] }).run({ "output/report.md": "None of the sources quantify the cost.",
        [DOCUMENT_REVIEW_FLAGS_PATH]: JSON.stringify(flags) }))!;
      expect(event.rules).toEqual({ absence: 1, review: 1 }); expect(event.counts).toEqual({ reportAbsence: 1, reportAbsenceUncited: 1, reportBounded: 0, ...flags.counts });
    });
  });

  describe("the report path, the event and its recording", () => {
    it("records a failed section by its code alone and keeps the other sections", () => {
      const argument = [{ path: RESEARCH_FILES.argument, bytes: Buffer.from("None of the sources mention 2025.") }];
      const h = harness({ files: argument }), input = h.run({ "output/report.md": "None of the sources quantify the cost.", [CLAIMS_LEDGER_PATH]: "[]" });
      const entry = input.finalSnapshot.find(item => item.path === "output/report.md")!;
      writeFileSync(join(h.root, "job-1", entry.sha256), Buffer.alloc(entry.bytes, 0x20));
      const damaged = hostFlagsEvent(input)!;
      expect(damaged).toMatchObject({ rules: { absence: 1 }, errors: ["report_failed"], argument: { scanned: true }, counts: { argumentAbsence: 1 } });
      expect(damaged).not.toHaveProperty("report"); expect(damaged.counts).not.toHaveProperty("reportAbsence");
      // With the report missing, the first normalization is the argument's, so its scan is the one that fails.
      const missing = harness({ files: argument }).run({});
      vi.spyOn(String.prototype, "normalize").mockImplementationOnce(() => { throw new Error("normalize failed"); });
      const event = hostFlagsEvent(missing)!;
      expect(event.errors).toEqual(["argument_failed"]); expect(event).not.toHaveProperty("argument"); expect(event.report).toMatchObject({ reason: "missing" });
      expect(event.rules).toEqual({}); expect(event.misses).toEqual({ fetchFailures: 0, fetchLimitRefusals: 0 });
    });
    it("does no work for a context already recorded, and its schema refuses anything it would not write", () => {
      const h = harness(), input = h.run({ "output/report.md": "None of the sources quantify the cost.", [CLAIMS_LEDGER_PATH]: "[]" });
      recordHostFlags(input); expect(h.events).toHaveLength(1);
      const load = vi.spyOn(h.checkpoints, "load"), atomic = vi.spyOn(h.store, "atomic");
      recordHostFlags(input); expect(load).not.toHaveBeenCalled(); expect(atomic).not.toHaveBeenCalled(); expect(h.events).toHaveLength(1);
      const event = report("x");
      for (const changed of [{ ...event, extra: 1 }, { ...event, errors: [] }, { ...event, rules: { absence: 2 } }])
        expect(HostFlagsEventSchema.safeParse(changed).success, JSON.stringify(changed).slice(0, 80)).toBe(false);
      expect(() => hostFlagsEvent({ ...input, contextId: "c".repeat(101) })).toThrow();
    });
    it("names the claims report as withClaimsLedger always has: the first .md artifact, else the first artifact", () => {
      const path = (...paths: string[]) => claimsReportPath({ requiredArtifacts: paths.map(item => ({ path: item })) });
      expect(path("output/memo.md", "output/table.csv")).toBe("output/memo.md"); expect(path("output/table.csv", "output/memo.md")).toBe("output/memo.md");
      // The desktop's contract (general-tasks controller.ts): the target, then the ledger. Every desktop task names its target.
      expect(path("output/brief.docx", CLAIMS_LEDGER_PATH)).toBe("output/brief.docx"); expect(path("output/notes.txt", CLAIMS_LEDGER_PATH)).toBe("output/notes.txt");
      expect(path("output/report.md", CLAIMS_LEDGER_PATH)).toBe("output/report.md");
      // A contract that lists the ledger first still names the report; with no .md at all, the first artifact, as before.
      expect(path(CLAIMS_LEDGER_PATH, "output/report.md")).toBe("output/report.md"); expect(path(CLAIMS_LEDGER_PATH, "output/calculate.py")).toBe(CLAIMS_LEDGER_PATH);
      // The first .md, and only a lowercase extension, exactly as before: the rule feeds every claims phase's identity.
      expect(path("output/a.md", "output/b.md")).toBe("output/a.md"); expect(path("output/table.csv", "output/REPORT.MD")).toBe("output/table.csv");
    });
    it("records no event for a phase with neither check, and no report text in the one it records", () => {
      expect(hostFlagsEvent(harness({ checks: ["structure"] }).run({ "output/report.md": "None of the sources quantify the cost." }))).toBeUndefined();
      const event = report("# Zeppelin\nNone of the sources quantify the zeppelin cost.");
      expect(HostFlagsEventSchema.parse(event)).toEqual(event); expect(JSON.stringify(event)).not.toMatch(/zeppelin|quantify|sources/iu);
    });
    it("records once per context, never throws, and records nothing when the append fails, so a later run retries", () => {
      const h = harness(), input = h.run({ "output/report.md": "None of the sources quantify the cost.", [CLAIMS_LEDGER_PATH]: "[]" });
      const append = vi.spyOn(h.store, "append").mockImplementationOnce(() => { throw new Error("store unavailable"); });
      expect(() => recordHostFlags(input)).not.toThrow(); expect(h.events).toEqual([]);
      recordHostFlags(input); recordHostFlags(input);
      expect(h.events).toEqual([hostFlagsEvent(input)]); expect(append).toHaveBeenCalledTimes(2);
      // Another context of the same job still records its own; one recorded by another host inside the transaction is not appended twice.
      recordHostFlags({ ...input, contextId: "other" }); expect(h.events.map(event => event.contextId)).toEqual(["private", "other"]);
      vi.spyOn(h.store, "atomic").mockImplementationOnce(fn => { h.events.push({ type: "host_flags", contextId: "third" }); return fn(); });
      recordHostFlags({ ...input, contextId: "third" }); expect(h.events.filter(event => event.contextId === "third")).toHaveLength(1);
      // A failing read, a failing transaction and a contract the pass cannot read are swallowed too, and record nothing.
      vi.spyOn(h.store, "events").mockImplementationOnce(() => { throw new Error("database locked"); });
      expect(() => recordHostFlags({ ...input, contextId: "fourth" })).not.toThrow();
      vi.spyOn(h.store, "atomic").mockImplementationOnce(() => { throw new Error("busy"); });
      expect(() => recordHostFlags({ ...input, contextId: "fourth" })).not.toThrow();
      expect(h.events.some(event => event.contextId === "fourth")).toBe(false);
    });
  });
});
