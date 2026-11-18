import { describe, expect, it } from "vitest";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { RESEARCH_TOLERANCE_POLICY } from "../../src/main/private-agent/research-contract";
import { RESEARCH_SYNTHESIS_DROP_REASONS, correctSynthesisEvidenceIds, synthesisCorrectionCounts, validateReadyResearchPacket } from "../../src/main/private-agent/research-coverage";
import { RESEARCH_FILES, researchWriteInstructions, runResearchPipeline, type ResearchDiagnostic } from "../../src/main/private-agent/research-pipeline";
import { buildLocalScreenModelConfig } from "../../scripts/private-agent-local-screen";
import { RESEARCH_V4_TEST_BRIEF, parseResearchUserContent, researchV4TaggedReply, researchV4TaggedSources } from "../helpers/research-v4-fixture";

/**
 * The synthesis evidence-id tolerance (RESEARCH_TOLERANCE_POLICY.synthesis.evidenceIds, the E0 card's Amendment 7 addendum). An id a
 * synthesis reply lists under a question is dropped from that list, instead of refusing the reply, when it is not citable (a: for the
 * stage, no packet quote's) or its quote is not tagged for that question (b); a findings or conflict question the drops leave with none
 * becomes unresolved. Coverage version 6 discloses both by reason, the synthesise row counts both by kind, and the packet validator
 * binds the disclosure. Every stage here runs on researchV4TaggedSources(): Q1 has alpha's quote, and Q2 beta's and gamma's.
 */
type Reply = string | { content: string; truncated: boolean };
type Tagged = { q1: string; q2a: string; q2b: string };
const SECTIONS = "\n\n## Conflicting evidence\nNone.\n\n## Unanswered questions\nNone.";
const row = (questionId: string, disposition: string, evidenceIds: string[]) => ({ questionId, disposition, evidenceIds });
const reply = (t: Tagged, q1: object, q2: object, argument = `A bounded finding [${t.q1}].${SECTIONS}`) => JSON.stringify({ version: 1, argument, questions: [q1, q2] });

/** The pipeline with the tagged corpus; `synth(attempt, ids)` answers each synthesis call, given the packet's ids by their question tags. */
async function run(synth: (attempt: number, t: Tagged) => Reply) {
  const diagnostics: ResearchDiagnostic[] = [];
  let synthesisCalls = 0;
  const request = async (input: { body: string; purpose: string }, settle: (bytes: Buffer) => number) => {
    const body = JSON.parse(input.body), system = body.messages[0].content as string, user = body.messages[1].content as string;
    let output: Reply;
    if (system.startsWith("You write")) {
      const quotes = parseResearchUserContent(user).evidence.quotes as { id: string; questionIds: string[] }[];
      const tagged = (q: string) => quotes.filter(quote => quote.questionIds.includes(q)).map(quote => quote.id);
      output = synth(synthesisCalls++, { q1: tagged("Q1")[0]!, q2a: tagged("Q2")[0]!, q2b: tagged("Q2")[1]! });
    } else output = researchV4TaggedReply(system, user);
    const content = typeof output === "string" ? output : output.content, truncated = typeof output !== "string" && output.truncated;
    const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content }, finish_reason: truncated ? "length" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    return { bytes, receipt: { feeMicrousd: settle(bytes) } };
  };
  const config = buildLocalScreenModelConfig({ vllm: { model: "Synthetic" } as never, streamingEnabled: true }, COORDINATOR_PROFILES.heavy, true);
  const make = () => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, "synthesis-tolerance-job", "reader");
  const outcome = await runResearchPipeline({ brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4TaggedSources(), models: { reader: make(), planner: make(), synthesiser: make() },
    signal: new AbortController().signal, record: () => undefined, diagnostics: { retain: entry => { diagnostics.push(entry); } } });
  const json = (path: string) => JSON.parse(outcome.files.find(f => f.path === path)!.bytes.toString("utf8"));
  const evidence = json(RESEARCH_FILES.evidence) as { quotes: { id: string; questionIds: string[] }[] };
  const tagged = (q: string) => evidence.quotes.filter(quote => quote.questionIds.includes(q)).map(quote => quote.id);
  return { outcome, diagnostics, coverage: json(RESEARCH_FILES.coverage), row: json(RESEARCH_FILES.summary).stages[3], ids: { q1: tagged("Q1")[0]!, q2a: tagged("Q2")[0]!, q2b: tagged("Q2")[1]! } };
}
/** A copy of the packet's files with one JSON file edited, written back in canonical form as the pipeline writes it. */
function edited(files: readonly { path: string; bytes: Buffer }[], edits: Partial<Record<string, (value: any) => void>>) {
  return files.map(file => {
    const edit = edits[file.path];
    if (!edit) return { path: file.path, bytes: Buffer.from(file.bytes) };
    const value = JSON.parse(file.bytes.toString("utf8")); edit(value);
    return { path: file.path, bytes: Buffer.from(`${canonical(value)}\n`) };
  });
}
const validates = (files: readonly { path: string; bytes: Buffer }[]) => validateReadyResearchPacket(files, { brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4TaggedSources() });

const NC = "not_citable", NT = "not_tagged_for_question";
const drop = (questionId: string, reason: string, evidenceIds: string[]) => ({ questionId, reason, evidenceIds });
const rowCounts = (notCitable: number, notTagged: number, downgraded: number) =>
  ({ evidenceIdsDroppedNotCitable: notCitable, evidenceIdsDroppedNotTagged: notTagged, questionsDowngraded: downgraded });

describe("the synthesis evidence-id tolerance", () => {
  it("keeps a reply that lists a quote under a question it is not tagged for (b), dropping that id from that list and disclosing it", async () => {
    const r = await run((_, t) => reply(t, row("Q1", "findings", [t.q1, t.q2a]), row("Q2", "unresolved", [])));
    expect([r.ids.q1, r.ids.q2a, r.ids.q2b].every(Boolean)).toBe(true);
    expect(r.outcome.status).toBe("completed");
    expect(r.row).toMatchObject({ calls: 1, invalidReplies: 0, ...rowCounts(0, 1, 0), synthesisAttempts: [expect.objectContaining({ accepted: true })] });
    expect(r.row.fallback).toBeUndefined();
    expect(r.coverage.version).toBe(6);
    expect(r.coverage.synthesis).toMatchObject({ status: "complete", questions: [row("Q1", "findings", [r.ids.q1]), row("Q2", "unresolved", [])],
      corrections: { dropped: [drop("Q1", NT, [r.ids.q2a])], downgraded: [] } });
    expect(r.diagnostics.filter(d => d.stage === "synthesise")).toEqual([]);
    expect(() => validates(r.outcome.files)).not.toThrow();
  });

  it("drops an id no packet quote has (a), and downgrades a findings or conflict question the drops leave with none, while an unresolved one only loses ids", async () => {
    const a = await run((_, t) => reply(t, row("Q1", "findings", [t.q1, "E999"]), row("Q2", "findings", [t.q2a, t.q2b])));
    expect(a.outcome.status).toBe("completed");
    expect(a.coverage.synthesis.corrections).toEqual({ dropped: [drop("Q1", NC, ["E999"])], downgraded: [] });
    expect(a.row).toMatchObject(rowCounts(1, 0, 0));
    // Both kinds in one reply: Q1 loses its only ids, one of each kind, and was findings; Q2, a conflict, keeps one of its two.
    const both = await run((_, t) => reply(t, row("Q1", "findings", ["E999", t.q2a]), row("Q2", "conflict", [t.q1, t.q2a])));
    expect(both.outcome.status).toBe("completed");
    expect(both.coverage.synthesis.questions).toEqual([row("Q1", "unresolved", []), row("Q2", "conflict", [both.ids.q2a])]);
    expect(both.coverage.synthesis.corrections).toEqual({ dropped: [drop("Q1", NC, ["E999"]), drop("Q1", NT, [both.ids.q2a]), drop("Q2", NT, [both.ids.q1])],
      downgraded: [{ questionId: "Q1", from: "findings" }] });
    expect(both.row).toMatchObject(rowCounts(1, 2, 1));
    // A conflict left with no id is downgraded too; an unresolved question keeps its disposition and the ids that pass.
    const conflict = await run((_, t) => reply(t, row("Q1", "conflict", [t.q2b]), row("Q2", "unresolved", [t.q1, t.q2a])));
    expect(conflict.coverage.synthesis.questions).toEqual([row("Q1", "unresolved", []), row("Q2", "unresolved", [conflict.ids.q2a])]);
    expect(conflict.coverage.synthesis.corrections.downgraded).toEqual([{ questionId: "Q1", from: "conflict" }]);
    expect(conflict.row).toMatchObject(rowCounts(0, 2, 1));
    for (const r of [a, both, conflict]) expect(() => validates(r.outcome.files)).not.toThrow();
  });

  it("writes no corrections for a reply it keeps whole, and the row's counts as zero", async () => {
    const r = await run((_, t) => reply(t, row("Q1", "findings", [t.q1]), row("Q2", "findings", [t.q2b])));
    expect(r.outcome.status).toBe("completed");
    expect(r.coverage.synthesis.corrections).toBeUndefined();
    expect(r.row).toMatchObject(rowCounts(0, 0, 0));
  });

  it("refuses as before what it does not cover, and never names an offending id as a reason", async () => {
    const cases: [string, (t: Tagged) => Reply, string[]][] = [
      ["truncated", () => ({ content: "", truncated: true }), ["truncated"]],
      ["not JSON", () => "not a synthesis", ["invalid_json"]],
      ["schema", () => JSON.stringify({ version: 2, argument: "x", questions: [] }), ["schema_invalid_value", "schema_too_small"]],
      ["an offending id twice", t => reply(t, row("Q1", "findings", ["E999", "E999"]), row("Q2", "findings", [t.q2a])), ["duplicate_evidence_id"]],
      ["a tagged id twice", t => reply(t, row("Q1", "findings", [t.q1, t.q1]), row("Q2", "findings", [t.q2a])), ["duplicate_evidence_id"]],
      ["a findings question the reply left empty", t => reply(t, row("Q1", "findings", []), row("Q2", "findings", [t.q2a])), ["disposition_without_evidence"]],
      ["a missing heading beside an offending id", t => reply(t, row("Q1", "findings", [t.q2a]), row("Q2", "findings", [t.q2a]), `A finding [${t.q1}].\n\n## Conflicting evidence\nNone.`),
        ["unanswered_questions_heading_missing"]],
      ["an argument citing an id no quote has", t => reply(t, row("Q1", "findings", [t.q1]), row("Q2", "findings", [t.q2a]), `A finding [E999].${SECTIONS}`), ["unknown_citation"]],
      ["a question set without Q2", t => JSON.stringify({ version: 1, argument: `A finding [${t.q1}].${SECTIONS}`, questions: [row("Q1", "findings", [t.q1, "E999"])] }), ["question_set_mismatch"]],
    ];
    for (const [name, make, codes] of cases) {
      const r = await run((_, t) => make(t));
      expect([name, r.outcome.status, r.row.fallback, r.row.invalidReplies]).toEqual([name, "completed", "skeleton", 2]);
      expect([name, r.coverage.synthesis.status, r.coverage.synthesis.corrections, r.row]).toEqual([name, "skeleton", undefined, expect.objectContaining(rowCounts(0, 0, 0))]);
      const reasons = r.diagnostics.find(d => d.stage === "synthesise" && d.ordinal === 1)!.reasons.map(reason => reason.code);
      expect([name, [...new Set(reasons)].sort()]).toEqual([name, codes]);
      expect(reasons).not.toContain("unknown_evidence_id");
    }
  }, 60_000);

  it("keeps a corrected repair attempt after a refused first one, counting the repair's own drops", async () => {
    const r = await run((attempt, t) => attempt === 0 ? { content: "", truncated: true } : reply(t, row("Q1", "findings", [t.q1, t.q2b]), row("Q2", "findings", [t.q2a, t.q1])));
    expect(r.outcome.status).toBe("completed");
    expect(r.row).toMatchObject({ calls: 2, invalidReplies: 1, truncatedReplies: 1, ...rowCounts(0, 2, 0) });
    expect(r.row.synthesisAttempts.map((a: { accepted: boolean }) => a.accepted)).toEqual([false, true]);
    expect(r.coverage.synthesis.corrections).toEqual({ dropped: [drop("Q1", NT, [r.ids.q2b]), drop("Q2", NT, [r.ids.q1])], downgraded: [] });
  });

  it("is the policy's rule, and the writer is told what a correction means", () => {
    expect(RESEARCH_TOLERANCE_POLICY.version).toBe(2);
    expect(RESEARCH_TOLERANCE_POLICY.synthesis.evidenceIds).toEqual({ drop: ["not_citable", "not_tagged_for_question"], emptiedFindingsOrConflict: "downgraded_to_unresolved",
      stillRefused: ["duplicate_evidence_id", "disposition_without_evidence"], argument: "unchanged", disclosed: ["coverage_synthesis_corrections", "synthesise_row_counts"] });
    expect([...RESEARCH_SYNTHESIS_DROP_REASONS]).toEqual(RESEARCH_TOLERANCE_POLICY.synthesis.evidenceIds.drop);
    const writer = researchWriteInstructions();
    expect(writer).toContain("synthesis lists corrections, the host removed those evidence IDs from the questions that listed them");
    expect(writer).toContain("a not_tagged_for_question ID names a quote not tagged for that question, and a not_citable ID names no quote the synthesis was given to cite");
    expect(writer).toContain("never treat a removed ID's quote as support for that question");
    // The function both judges share: an id passes only when citable and tagged for its question; a list that loses nothing comes back as given.
    const quotes = [{ id: "E1", questionIds: ["Q1"] }, { id: "E2", questionIds: ["Q1", "Q2"] }];
    const given = [row("Q1", "findings", ["E1", "E2"]), row("Q2", "conflict", ["E2"])] as Parameters<typeof correctSynthesisEvidenceIds>[0];
    const whole = correctSynthesisEvidenceIds(given, new Set(["E1", "E2"]), quotes);
    expect(whole.corrections).toBeUndefined(); expect(whole.questions[0]).toBe(given[0]);
    expect(synthesisCorrectionCounts(whole.corrections)).toEqual(rowCounts(0, 0, 0));
    // E2 is tagged for both questions but not citable (an assist's packet that did not carry it): dropped from both lists as not citable.
    const uncarried = correctSynthesisEvidenceIds(given, new Set(["E1"]), quotes);
    expect(uncarried).toEqual({ questions: [row("Q1", "findings", ["E1"]), row("Q2", "unresolved", [])],
      corrections: { dropped: [drop("Q1", NC, ["E2"]), drop("Q2", NC, ["E2"])], downgraded: [{ questionId: "Q2", from: "conflict" }] } });
    expect(synthesisCorrectionCounts(uncarried.corrections)).toEqual(rowCounts(2, 0, 1));
    // One question, both kinds: E9 is no citable id, and E1 is citable but tagged for Q1 only; the not-citable entry comes first.
    const mixed = correctSynthesisEvidenceIds([row("Q2", "findings", ["E1", "E9", "E2"])] as Parameters<typeof correctSynthesisEvidenceIds>[0], new Set(["E1", "E2"]), quotes);
    expect(mixed).toEqual({ questions: [row("Q2", "findings", ["E2"])], corrections: { dropped: [drop("Q2", NC, ["E9"]), drop("Q2", NT, ["E1"])], downgraded: [] } });
    expect(synthesisCorrectionCounts(mixed.corrections)).toEqual(rowCounts(1, 1, 0));
  });

  it("binds the disclosure in the packet validator: the corrections a model synthesis kept, by reason, and the synthesise row's counts, or the packet is refused", async () => {
    // Q1 drops q2a (b) and keeps q1; Q2 is unresolved, with no ids from the reply and none dropped.
    const r = await run((_, t) => reply(t, row("Q1", "findings", [t.q1, t.q2a]), row("Q2", "unresolved", [])));
    // Q1 drops E999 (a) and q2a (b) and is downgraded from findings; Q2, a conflict, drops q1 (b) and keeps q2a.
    const both = await run((_, t) => reply(t, row("Q1", "findings", ["E999", t.q2a]), row("Q2", "conflict", [t.q1, t.q2a])));
    // Q1, a conflict, drops q2b and is downgraded; Q2, unresolved, drops q1 and keeps q2a.
    const conflict = await run((_, t) => reply(t, row("Q1", "conflict", [t.q2b]), row("Q2", "unresolved", [t.q1, t.q2a])));
    const plain = await run((_, t) => reply(t, row("Q1", "findings", [t.q1]), row("Q2", "findings", [t.q2a])));
    const skeleton = await run(() => "not a synthesis");
    const C = RESEARCH_FILES.coverage, S = RESEARCH_FILES.summary;
    const counts = (notCitable: number, notTagged: number, downgraded?: number) => (summary: any) => {
      Object.assign(summary.stages[3], { evidenceIdsDroppedNotCitable: notCitable, evidenceIdsDroppedNotTagged: notTagged });
      if (downgraded === undefined) delete summary.stages[3].questionsDowngraded; else summary.stages[3].questionsDowngraded = downgraded; };
    const uncounted = (summary: any) => { for (const key of Object.keys(rowCounts(0, 0, 0))) delete summary.stages[3][key]; };
    for (const ok of [r, both, conflict, plain, skeleton]) expect(() => validates(ok.outcome.files)).not.toThrow();
    // A version 5 packet, written before the tolerance, records no counts and still reads.
    expect(() => validates(edited(plain.outcome.files, { [C]: c => { c.version = 5; }, [S]: uncounted }))).not.toThrow();
    const cases: [string, readonly { path: string; bytes: Buffer }[]][] = [
      ["corrections on a version 5 coverage", edited(both.outcome.files, { [C]: c => { c.version = 5; }, [S]: uncounted })],
      ["counts on a version 5 coverage", edited(plain.outcome.files, { [C]: c => { c.version = 5; } })],
      ["a not_tagged_for_question id that is a quote tagged for its question", edited(both.outcome.files, { [C]: c => { c.synthesis.corrections.dropped[2].evidenceIds.push(both.ids.q2b); }, [S]: counts(1, 3, 1) })],
      ["a not_tagged_for_question id that is no packet quote", edited(both.outcome.files, { [C]: c => { c.synthesis.corrections.dropped[2].evidenceIds.push("E997"); }, [S]: counts(1, 3, 1) })],
      ["a not_citable id that is a packet quote, on the stage's reply", edited(both.outcome.files, { [C]: c => { c.synthesis.corrections.dropped[0].evidenceIds.push(both.ids.q2b); }, [S]: counts(2, 2, 1) })],
      ["a dropped id its question still lists", edited(both.outcome.files, { [C]: c => { c.synthesis.corrections.dropped[2].evidenceIds.push(both.ids.q2a); }, [S]: counts(1, 3, 1) })],
      ["a dropped id named twice for one question", edited(both.outcome.files, { [C]: c => { c.synthesis.corrections.dropped[0].evidenceIds.push("E999"); }, [S]: counts(2, 2, 1) })],
      ["a question and reason named twice", edited(both.outcome.files, { [C]: c => { c.synthesis.corrections.dropped.push(drop("Q1", NC, ["E997"])); }, [S]: counts(2, 2, 1) })],
      ["a question the plan does not ask", edited(both.outcome.files, { [C]: c => { c.synthesis.corrections.dropped.push(drop("Q7", NC, ["E997"])); }, [S]: counts(2, 2, 1) })],
      ["a downgraded question that is still a conflict with its id", edited(both.outcome.files, { [C]: c => { c.synthesis.corrections.downgraded.push({ questionId: "Q2", from: "conflict" }); }, [S]: counts(1, 2, 2) })],
      ["a downgraded question named twice", edited(both.outcome.files, { [C]: c => { c.synthesis.corrections.downgraded.push({ questionId: "Q1", from: "findings" }); }, [S]: counts(1, 2, 2) })],
      ["a downgraded question that lost no id", edited(r.outcome.files, { [C]: c => { c.synthesis.corrections.downgraded.push({ questionId: "Q2", from: "findings" }); }, [S]: counts(0, 1, 1) })],
      ["a downgraded question that keeps an id", edited(conflict.outcome.files, { [C]: c => { c.synthesis.corrections.downgraded.push({ questionId: "Q2", from: "findings" }); }, [S]: counts(0, 2, 2) })],
      ["corrections on the host skeleton", edited(skeleton.outcome.files, { [C]: c => { c.synthesis.corrections = { dropped: [drop("Q1", NC, ["E999"])], downgraded: [] }; }, [S]: counts(1, 0, 0) })],
      ["a not_citable count that is not the disclosure's", edited(both.outcome.files, { [S]: counts(2, 2, 1) })],
      ["a not_tagged_for_question count that is not the disclosure's", edited(both.outcome.files, { [S]: counts(1, 3, 1) })],
      ["a downgraded count that is not the disclosure's", edited(both.outcome.files, { [S]: counts(1, 2, 0) })],
      ["a count missing at version 6", edited(both.outcome.files, { [S]: counts(1, 2) })],
      ["counts without a disclosure", edited(plain.outcome.files, { [S]: counts(1, 0, 0) })],
    ];
    for (const [name, files] of cases) expect(() => validates(files), name).toThrow("research_packet_synthesis_corrections");
  }, 60_000);
});
