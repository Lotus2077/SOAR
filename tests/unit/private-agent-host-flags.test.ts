import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  return { store, events, checkpoints, run };
}
/** A research run's event, with `text` as its claims report at `path`. */
const report = (text: string, path = "output/report.md") =>
  hostFlagsEvent(harness({ artifacts: [path, CLAIMS_LEDGER_PATH] }).run({ [path]: text, [CLAIMS_LEDGER_PATH]: "[]" }))!;
const hits = (text: string) => report(text).report!.hits;
const absence = (line: number, rule: string, cited = false) => ({ line, rule, class: "absence", cited });

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
    });
    it("blanks fenced code and HTML comments line for line, strips tags, and keeps the line numbers", () => {
      const text = ["```", "None of the sources quantify the cost.", "```", "<!-- None of the sources", "quantify the cost. -->", "<p>No source provides <b>efficiency</b> figures.</p>",
        "~~~", "No source provides it.", "~~~", "There is <!-- a --> no evidence of a recall."].join("\n");
      expect(hits(text)).toEqual([absence(6, "A5"), absence(10, "A6")]);
      expect(report("<p>None of the sources quantify the cost.</p>", "output/report.HTML").report).toEqual({ format: "html", scanned: true, textCut: false,
        hits: [absence(1, "A1")], truncated: false });
    });
    it("normalizes curly quotes and compatibility characters before matching", () => {
      expect(hits("These reports don’t specify a date.")).toEqual([absence(1, "A2")]);
      expect(hits("Ｎｏｎｅ of the sources quantify the cost.")).toEqual([absence(1, "A1")]);
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
      const cut = report(`None of the sources quantify the cost.\n${"é".repeat(600_000)}\nNone of the sources mention 2025.`).report!;
      expect(cut).toEqual({ format: "markdown", scanned: true, textCut: true, hits: [absence(1, "A1")], truncated: false });
      expect(report(`${"a".repeat(1024 * 1024 - 40)}\nNone of the sources quantify it.`).report).toMatchObject({ textCut: false, hits: [absence(2, "A1")] });
    });
    it("stays well inside a generous bound on adversarial shapes at 1 MiB", () => {
      const shapes = { tags: "<".repeat(1 << 20), unclosed: `<${"a".repeat((1 << 20) - 1)}`, comments: "<!--".repeat(1 << 18), expansion: "ﷺ".repeat(350_000),
        words: `${"word ".repeat(200_000)}none of the sources`, lines: "a\n".repeat(1 << 19), sentences: "A. ".repeat(349_525), blocks: "a\n\n".repeat(349_525),
        rules: "No source the the no evidence there is no ".repeat(24_966) };
      for (const [name, text] of Object.entries(shapes)) {
        const started = performance.now(), scan = report(text).report!;
        expect(scan.scanned, name).toBe(true); expect(performance.now() - started, name).toBeLessThan(10_000);
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
        review: { valid: true, errors: [], read: flags.read, numeric: [{ table: 1, row: 2, paragraph: 5, inSource: true, inClean: true, addressed: false }],
          edits: [{ id: "E2", codes: ["negation_flipped"] }], clauses: [{ paragraphs: [7, 8], inSource: true, inClean: false, addressed: true }] } });
      expect(JSON.stringify(event)).not.toContain("USD");
      const failed = { ...flags, numeric: { flags: [], truncated: false, error: "IndexError" } };
      expect(review({ [DOCUMENT_REVIEW_FLAGS_PATH]: JSON.stringify(failed) }).review).toMatchObject({ valid: true, errors: ["IndexError"], numeric: [] });
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
    it("runs both parts for a phase that requires both checks", () => {
      const event = hostFlagsEvent(harness({ checks: [CLAIMS_LEDGER_CHECK_ID, HOST_FLAGS_REVIEW_CHECK_ID] }).run({ "output/report.md": "None of the sources quantify the cost.",
        [DOCUMENT_REVIEW_FLAGS_PATH]: JSON.stringify(flags) }))!;
      expect(event.rules).toEqual({ absence: 1, review: 1 }); expect(event.counts).toEqual({ reportAbsence: 1, reportAbsenceUncited: 1, reportBounded: 0, ...flags.counts });
    });
  });

  describe("the report path, the event and its recording", () => {
    it("names the claims report as withClaimsLedger always has: the first .md artifact, else the first artifact", () => {
      const path = (...paths: string[]) => claimsReportPath({ requiredArtifacts: paths.map(item => ({ path: item })) });
      expect(path("output/memo.md", "output/table.csv")).toBe("output/memo.md"); expect(path("output/table.csv", "output/memo.md")).toBe("output/memo.md");
      // The desktop's contract (general-tasks controller.ts): the target, then the ledger. Every desktop task names its target.
      expect(path("output/brief.docx", CLAIMS_LEDGER_PATH)).toBe("output/brief.docx"); expect(path("output/notes.txt", CLAIMS_LEDGER_PATH)).toBe("output/notes.txt");
      expect(path("output/report.md", CLAIMS_LEDGER_PATH)).toBe("output/report.md");
      // A contract that lists the ledger first still names the report; with no .md at all, the first artifact, as before.
      expect(path(CLAIMS_LEDGER_PATH, "output/report.md")).toBe("output/report.md"); expect(path(CLAIMS_LEDGER_PATH, "output/calculate.py")).toBe(CLAIMS_LEDGER_PATH);
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
