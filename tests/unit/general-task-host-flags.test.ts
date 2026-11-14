import { describe, expect, it } from "vitest";
import { hostFlagIssues } from "../../src/main/general-tasks/controller";

/** Backlog item 7(d), part C (BL-20261114-1246-host-flags-surfaces-design): a submission's reported issues from its `host_flags` event. */
const event = (over: Record<string, unknown>) => ({ type: "host_flags", contextId: "p", version: 1, rules: {}, counts: {}, ...over });
const scan = (over: Record<string, unknown> = {}) => ({ format: "markdown", scanned: true, textCut: false, hits: [], truncated: false, ...over });
const hit = (line: number, kind = "absence", cited = false) => ({ line, rule: "A1", class: kind, cited });
const read = { comparisonsCapped: false, figuresCapped: false, labelsCapped: false, paragraphsClipped: 0, rowsCapped: false, sentencesCapped: false, termsCapped: false };

describe("the reported issues of a submission's host flags (backlog item 7(d), part C)", () => {
  it("says the flags were not recorded only where an event was expected, and that an unreadable one could not be read", () => {
    expect(hostFlagIssues([], false)).toEqual([]);
    expect(hostFlagIssues([{ type: "completed" }], true)).toEqual(["The host flags of this submission were not recorded."]);
    expect(hostFlagIssues([event({ version: 2 })], true)).toEqual(["The host flags of this submission could not be read."]);
    // A recorded event with nothing to report gives no line: zero and absent never read the same.
    expect(hostFlagIssues([event({ rules: { absence: 1 }, report: scan(), misses: { fetchFailures: 0, fetchLimitRefusals: 0 }, counts: { reportAbsence: 0, reportAbsenceUncited: 0, reportBounded: 0 } })], true)).toEqual([]);
  });
  it("lists the report's absence claims by line, cited ones included, and never a bounded one", () => {
    const issues = (report: Record<string, unknown>, counts: Record<string, number>) => hostFlagIssues([event({ rules: { absence: 1 }, report: scan(report), counts })], true);
    expect(issues({ hits: [hit(3), hit(9, "absence", true), hit(12, "bounded"), hit(20)] }, { reportAbsence: 3, reportAbsenceUncited: 2, reportBounded: 1 }))
      .toEqual(["3 sentences of the report assert that the sources lack something (absence rules v1), 2 without a claim citation: lines 3, 9 and 20."]);
    expect(issues({ hits: [hit(4)] }, { reportAbsence: 1, reportAbsenceUncited: 1, reportBounded: 0 }))
      .toEqual(["1 sentence of the report asserts that the sources lack something (absence rules v1), 1 without a claim citation: line 4."]);
    expect(issues({ hits: [hit(3), hit(9)], truncated: true, textCut: true }, { reportAbsence: 45, reportAbsenceUncited: 45, reportBounded: 0 })).toEqual([
      "45 sentences of the report assert that the sources lack something (absence rules v1), 45 without a claim citation: lines 3 and 9 among the first 40 hits.",
      "Only the first part of the report was scanned for absence claims."]);
    // Only bounded hits kept, though absence claims were counted past the cut: the count stands without lines.
    expect(issues({ hits: [hit(1, "bounded")], truncated: true }, { reportAbsence: 2, reportAbsenceUncited: 0, reportBounded: 40 }))
      .toEqual(["2 sentences of the report assert that the sources lack something (absence rules v1), 0 without a claim citation."]);
    expect(issues({ hits: [hit(1, "bounded")] }, { reportAbsence: 0, reportAbsenceUncited: 0, reportBounded: 1 })).toEqual([]);
  });
  it("says why a report or an argument was not scanned", () => {
    const unscanned = (name: string, format: string, reason: string) => hostFlagIssues([event({ [name]: scan({ format, scanned: false, reason }) })], true);
    expect(unscanned("report", "docx", "format_not_scanned")).toEqual(["The report is a Word file, so the host did not scan it for absence claims."]);
    expect(unscanned("report", "pdf", "format_not_scanned")).toEqual(["The report is a PDF file, so the host did not scan it for absence claims."]);
    expect(unscanned("report", "markdown", "missing")).toEqual(["The host found no report to scan for absence claims."]);
    expect(unscanned("argument", "pdf", "format_not_scanned")).toEqual(["The research packet's argument is a PDF file, so the host did not scan it for absence claims."]);
    expect(hostFlagIssues([event({ rules: { absence: 1 }, argument: scan({ hits: [hit(5), hit(7, "absence", true)] }), counts: { argumentAbsence: 2, argumentAbsenceUncited: 1, argumentBounded: 0 } })], true))
      .toEqual(["2 sentences of the research packet's argument assert that the sources lack something (absence rules v1), 1 without an evidence id: lines 5 and 7."]);
  });
  it("lists the misses that qualify a deliverable and the single-unit brief, and leaves the rest to the registry", () => {
    expect(hostFlagIssues([event({ misses: { briefUnits: 1, questionsWithoutEvidence: 2, unresolvedQuestions: 1, noEvidenceOutcomes: 4, extractionRetries: 3, droppedQuotes: 5,
      fetchFailures: 1, fetchLimitRefusals: 2 }, counts: { briefSingleUnit: 1 } })], true)).toEqual([
      "2 research questions have no retained evidence.", "1 research question was left unresolved by the synthesis.", "1 public source fetch failed.",
      "2 public source fetches were refused at the fetch limit.", "The brief has a single unit, so the research plan's coverage check was vacuous."]);
    expect(hostFlagIssues([event({ misses: { questionsWithoutEvidence: 1, unresolvedQuestions: 2, fetchFailures: 3, fetchLimitRefusals: 1 }, counts: { briefSingleUnit: 0 } })], true)).toEqual([
      "1 research question has no retained evidence.", "2 research questions were left unresolved by the synthesis.", "3 public source fetches failed.",
      "1 public source fetch was refused at the fetch limit."]);
  });
  it("summarizes a document review by positions and edit ids, names a failed rule or step, and says why a flags file was not read", () => {
    for (const [reason, text] of [["missing", "missing"], ["too_large", "too large to read"], ["invalid", "invalid"]]) {
      expect(hostFlagIssues([event({ rules: { review: 1 }, review: { valid: false, reason } })], false)).toEqual([`The document review's flags file was ${text}, so its flags were not read.`]);
    }
    const flagged = event({ rules: { review: 1 }, review: { valid: true, read, numeric: [{ table: 1, row: 2, paragraph: 5, inSource: true, inClean: true, addressed: false }],
      edits: [{ id: "E2", codes: ["negation_flipped"] }, { id: "E5", codes: ["parties_swapped", "modality_changed"] }],
      clauses: [{ paragraphs: [7, 8], inSource: true, inClean: true, addressed: false }] },
    counts: { numericSource: 1, numericIntroduced: 0, numericResolved: 0, numericUnaddressed: 1, inversionEdits: 2, inversionSource: 40, inversionIntroduced: 1, inversionUnaddressed: 3 } });
    expect(hostFlagIssues([flagged], false)).toEqual([
      "1 figure in the prose disagrees with its table row, 1 left unaddressed by the edits: table 1 row 2 (paragraph 5).",
      "2 edits turn their clauses around: E2 (negation flipped), E5 (parties swapped, modality changed).",
      "41 pairs of clauses are contradictory, 3 left unaddressed by the edits: paragraphs 7 and 8, and 40 more."]);
    expect(hostFlagIssues([event({ rules: { review: 1 }, review: { valid: true, errors: { numeric: "IndexError", clauses: "KeyError" }, read, edits: [{ id: "E1", codes: ["modality_changed"] }] },
      counts: { inversionEdits: 1 } })], false)).toEqual(["The document review's table check failed (IndexError).", "The document review's clause check failed (KeyError).",
      "1 edit turns its clause around: E1 (modality changed)."]);
    expect(hostFlagIssues([event({ rules: { review: 1 }, review: { valid: true, errors: { step: "ValueError" } } })], false))
      .toEqual(["The document review's flag step failed (ValueError), so nothing was flagged."]);
  });
  it("names the sections the host could not compute, after the other lines", () => {
    expect(hostFlagIssues([event({ rules: { absence: 1 }, report: scan({ hits: [hit(2)] }), counts: { reportAbsence: 1, reportAbsenceUncited: 0, reportBounded: 0 },
      errors: ["argument_failed", "misses_failed", "review_failed"] })], true)).toEqual([
      "1 sentence of the report asserts that the sources lack something (absence rules v1), 0 without a claim citation: line 2.",
      "The host could not compute part of its flags: the argument scan, the misses and the review summary."]);
    expect(hostFlagIssues([event({ errors: ["report_failed"] })], true)).toEqual(["The host could not compute part of its flags: the report scan."]);
  });
});
