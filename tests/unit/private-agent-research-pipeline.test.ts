import { describe, expect, it, vi } from "vitest";
import { BrokerError, type PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { EXTRACT_SYSTEM, RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET, SYNTHESIS_SYSTEM, normalizeQuoteText, locateQuote, parseJsonReply, researchExtractionUserContent, researchProtocolSha256, researchSourceText, runResearchPipeline, stripUnknownCitations, type ResearchDiagnostic, type ResearchStageCounts } from "../../src/main/private-agent/research-pipeline";
import { planResearchIndexBatches, researchWordCount } from "../../src/main/private-agent/research-admission";
import { inventoryResearchSources, validateReadyResearchPacket } from "../../src/main/private-agent/research-coverage";
import { ResearchPlanAttemptSchema } from "../../src/main/private-agent/research-plan";
import { RESEARCH_PROTOCOL_SHA256 } from "../helpers/research-protocol-pin";
import { assertResearchUserLayout, parseResearchUserContent, researchV4Reply, researchV4Sources, RESEARCH_V4_TEST_BRIEF } from "../helpers/research-v4-fixture";
import { F2_SHAPE_KIB, inventedCorpus, previewBoundarySource } from "../helpers/research-corpus";

type Stage = "index" | "plan" | "extract" | "synthesise";
type Script = (stage: Stage, input: any, sequence: number, system: string) => string | { content: string; truncated: boolean } | Error;
function models(script?: Script) {
  const calls: { stage: Stage; input: any; body: any; purpose: string }[] = [];
  const request = vi.fn(async (input: { body: string; purpose: string }, settle: (bytes: Buffer) => number) => {
    const body = JSON.parse(input.body), system = body.messages[0].content as string, user = body.messages[1].content as string;
    const stage: Stage = system.startsWith("You index") ? "index" : system.startsWith("You plan") ? "plan" : system.startsWith("You extract") ? "extract" : "synthesise";
    assertResearchUserLayout(system, user);
    const parsed = parseResearchUserContent(user), output = script ? script(stage, parsed, calls.filter(c => c.stage === stage).length, system) : researchV4Reply(system, user);
    if (output instanceof Error) throw output;
    calls.push({ stage, input: parsed, body, purpose: input.purpose });
    const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: typeof output === "string" ? output : output.content }, finish_reason: typeof output === "string" || !output.truncated ? "stop" : "length" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    return { bytes, receipt: { feeMicrousd: settle(bytes) } };
  });
  const config = { destinationId: "owned", model: "Synthetic", maxOutputTokens: 16384, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium" as const };
  const make = () => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, "job", "reader");
  return { models: { reader: make(), planner: make(), synthesiser: make() }, calls, request };
}
const happy = (_stage: Stage, input: any, _n: number, system: string) => researchV4Reply(system, JSON.stringify(input));
const run = (m: ReturnType<typeof models>, extra: Partial<Parameters<typeof runResearchPipeline>[0]> = {}, events: ResearchStageCounts[] = []) => runResearchPipeline({ brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(), models: m.models, signal: new AbortController().signal, record: e => events.push(e), ...extra });
const parsed = (outcome: Awaited<ReturnType<typeof runResearchPipeline>>, path: string) => JSON.parse(outcome.files.find(f => f.path === path)!.bytes.toString());
/**
 * The keys a stage row may carry: those ResearchStageCounts declares, plus the eight index counts summarizeIndexEntries has
 * always assigned onto the index row. A row with any other key would ship into summary.json (whose stage rows are passthrough
 * in the ready validator), the seed and the registry, so a new key is a conscious change here; and every value is a count, a
 * fixed code (stage, denied), the usage counts or the schema-validated plan attempts, never text.
 */
const DOCUMENTED_STAGE_KEYS = new Set(["stage", "calls", "invalidReplies", "denied", "usage", "truncatedReplies", "sourcesIndexed", "sourcesSkipped", "batchesSkipped", "questions", "planAttempts",
  "pairsPlanned", "pairsExtracted", "quotesVerified", "quotesInPacket", "quotesLeftByCap", "quotesDropped", "conflictsNoted", "conflictsInPacket", "packetBytes", "citationsStripped", "argumentBytes",
  "initialCalls", "repairCalls", "sourcesListed", "sourcesModelComplete", "sourcesLiteralFallback", "unresolvedModelSummaries", "chunksPlanned", "chunksComplete",
  "sourcesModelRepaired", "sourcesModelUnattempted", "invalidJsonReplies", "invalidSchemaReplies", "unexpectedRows", "duplicateExpectedIds", "missingSources", "emptyGists",
  // 7b.1 (BL-20261109-0334): the synthesis length cap, recorded and never enforced; all counts.
  "lengthCapWords", "briefWordLimit", "argumentWords",
  // 7a.1 (BL-20261109-0447): what a kept extraction reply lost or had corrected, and the accepted argument's rewritten headings; all counts.
  "conflictsDropped", "notesDropped", "questionsDowngraded", "questionsUpgraded", "headingsNormalised", "quotesMerged"]);
const hashOnlyStageRow = (stage: ResearchStageCounts) => {
  for (const [key, value] of Object.entries(stage)) {
    expect(DOCUMENTED_STAGE_KEYS.has(key)).toBe(true);
    if (key === "stage" || key === "denied") expect(value).toMatch(/^[a-z_]+$/u);
    else if (key === "usage") expect(Object.values(value as object).every(n => typeof n === "number")).toBe(true);
    else if (key === "planAttempts") for (const attempt of value as unknown[]) expect(() => ResearchPlanAttemptSchema.parse(attempt)).not.toThrow();
    else expect(typeof value).toBe("number");
  }
};

describe("research v4 existing source/quote utilities", () => {
  it("retains NFKC whitespace matching and global line locators", () => {
    expect(normalizeQuoteText(" １８\u00a0  apples\n remain ")).toBe("18 apples remain");
    expect(locateQuote("# Orchard\nTwelve healthy trees\nremain in autumn.\n", "trees remain")).toEqual({ locator: "lines 2-3" });
    expect(locateQuote("A source", "absent words")).toBeUndefined();
  });
  it("rejects nontext sources and malformed UTF8", () => {
    for (const source of [{ path: "a.pdf", bytes: Buffer.from("plain") }, { path: "a.docx", bytes: Buffer.from("plain") }, { path: "a.txt", bytes: Buffer.from([255]) }, { path: "a.txt", bytes: Buffer.from("a\0b") }]) expect(researchSourceText(source)).toBeUndefined();
    expect(parseJsonReply("Reply: {\"a\":1}")).toEqual({ a: 1 });
    expect(stripUnknownCitations("Known [E1], unknown [E2].", new Set(["E1"]))).toEqual({ text: "Known [E1], unknown.", stripped: 1 });
  });
  it("binds v4 policy and the exact research budget", () => {
    expect(researchProtocolSha256()).toMatch(/^[a-f0-9]{64}$/u);
    expect(researchProtocolSha256({ ...RESEARCH_PIPELINE_BUDGET, extractionCalls: 2 })).not.toBe(researchProtocolSha256());
  });
});

describe("research v4 actual serialized stages", () => {
  it("builds a complete source-bound seven-file packet through the real model serializer", async () => {
    const m = models(), events: ResearchStageCounts[] = [], result = await run(m, {}, events);
    expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    const packet = validateReadyResearchPacket(result.files, { brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(), protocolSha256: researchProtocolSha256(), budget: RESEARCH_PIPELINE_BUDGET });
    expect(packet.coverage).toMatchObject({ status: "ready", semanticAcceptance: "not_evaluated", corpusAbsenceEstablished: false });
    expect(packet.coverage.chunks).toHaveLength(2); expect(packet.evidence.quotes).toHaveLength(2);
    expect(m.calls.map(c => c.stage)).toEqual(["index", "plan", "extract", "extract", "synthesise"]);
    expect(m.calls.map(c => c.body.max_tokens)).toEqual([1536, 8192, 2048, 2048, 8192]);
    expect(m.calls.filter(c => c.stage === "extract").every(c => c.input.brief === RESEARCH_V4_TEST_BRIEF && c.input.plan.questions.length === 1 && c.input.units.length === 1)).toBe(true);
    expect(m.calls[0]!.body.chat_template_kwargs.enable_thinking).toBe(false); expect(m.calls[1]!.body.reasoning_effort).toBe("medium");
    expect(JSON.stringify(events)).not.toContain("orchard"); expect(packet.summary.version).toBe(4);
  });
  it("preflights mandatory count and readability before ANY research dispatch", async () => {
    const m = models(); expect(await run(m, { budget: { ...RESEARCH_PIPELINE_BUDGET, extractionCalls: 1 } })).toMatchObject({ status: "incomplete", reason: "research_mandatory_budget_exceeded" }); expect(m.request).not.toHaveBeenCalled();
    const bad = models(); expect(await run(bad, { sources: [...researchV4Sources(), { id: "bad", path: "bad.pdf", bytes: Buffer.from("unreadable") }] })).toMatchObject({ reason: "research_source_unreadable" }); expect(bad.request).not.toHaveBeenCalled();
  });
  it("rejects wrong budget keys even when the object still has four keys", async () => {
    const m = models(); const budget = { indexCalls: 24, extractionCalls: 40, plannerCalls: 2, unexpected: 2 } as unknown as typeof RESEARCH_PIPELINE_BUDGET;
    expect((await run(m, { budget })).reason).toBe("research_budget_invalid"); expect(m.request).not.toHaveBeenCalled();
  });
  it("preserves conflict-cap omissions and refuses a selectively incomplete ready packet", async () => {
    const sources = Array.from({ length: 5 }, (_, i) => ({ id: `input/conflict-${i}`, path: `input/conflict-${i}`, bytes: Buffer.from(`The synthetic survey recorded twelve trees in location ${i}.`) }));
    const m = models((stage, input, n, system) => { const reply = JSON.parse(happy(stage, input, n, system)); if (stage === "extract") reply.conflicts = Array.from({ length: 4 }, (_, i) => ({ questionIds: ["Q1"], note: `Unverified conflict ${n}-${i}` })); return JSON.stringify(reply); });
    const result = await run(m, { sources }); expect(result.reason).toBe("research_conflict_cap_omission");
    expect(parsed(result, RESEARCH_FILES.coverage).conflictOmissions).toHaveLength(4); expect(m.calls.some(c => c.stage === "synthesise")).toBe(false);
  });
  it("reads a source the planner omitted, against every original brief span", async () => {
    const m = models((stage, input, n, system) => { const reply = JSON.parse(happy(stage, input, n, system)); if (stage === "plan") reply.questions[0].sourceIds = [researchV4Sources()[0]!.id]; return JSON.stringify(reply); });
    const brief = "Context remains exact.\n1. Explain the orchard.\n2. Explain the meadow and uncertainties.\n";
    const result = await run(m, { brief }); expect(result.status).toBe("completed");
    expect(m.calls.filter(c => c.stage === "extract").map(c => c.input.source.id)).toEqual(researchV4Sources().map(s => s.id));
    expect(m.calls.filter(c => c.stage === "extract").every(c => c.input.brief === brief && c.input.units.length === 3)).toBe(true);
  });
  it("repairs omitted brief units rather than accepting a nonempty plan", async () => {
    const m = models((stage, input, n, system) => { const reply = JSON.parse(happy(stage, input, n, system)); if (stage === "plan" && n === 0) reply.questions[0].requirementIds = []; return JSON.stringify(reply); });
    expect((await run(m)).status).toBe("completed"); expect(m.calls.filter(c => c.stage === "plan")).toHaveLength(2);
  });
  it("indexes all batches before repairing and preserves honest literal fallback", async () => {
    const sources = Array.from({ length: 4 }, (_, i) => ({ id: `input/${i}.md`, path: `input/${i}.md`, bytes: Buffer.from(`# Source ${i}\nThe synthetic survey found twelve healthy trees in sector ${i}.`) }));
    const m = models((stage, input, n, system) => stage === "index" ? JSON.stringify({ sources: input.sources.map((s: any) => ({ sourceId: s.id, title: "title alone" })) }) : happy(stage, input, n, system));
    const result = await run(m, { sources }); expect(result.status).toBe("completed");
    expect(m.calls.filter(c => c.stage === "index").map(c => c.input.sources.map((s: any) => s.id))).toEqual([["input/0.md", "input/1.md", "input/2.md"], ["input/3.md"], ["input/0.md", "input/1.md", "input/2.md"], ["input/3.md"]]);
    expect(result.summary.stages[0]).toMatchObject({ sourcesIndexed: 0, sourcesListed: 4, sourcesLiteralFallback: 4, repairCalls: 2 });
  });
  it("performs the full extraction sweep before a bounded failed-chunk correction", async () => {
    const m = models((stage, input, n, system) => stage === "extract" && n === 0 ? "bad JSON" : happy(stage, input, n, system));
    const result = await run(m); expect(result.status).toBe("completed");
    expect(m.calls.filter(c => c.stage === "extract").map(c => c.input.source.id)).toEqual([researchV4Sources()[0]!.id, researchV4Sources()[1]!.id, researchV4Sources()[0]!.id]);
    expect(result.summary.stages[2]).toMatchObject({ initialCalls: 2, repairCalls: 1, invalidReplies: 1 });
  });
  it("retains failure when repair capacity is exhausted instead of synthesizing partial coverage", async () => {
    const m = models((stage, input, n, system) => stage === "extract" && n === 0 ? "bad JSON" : happy(stage, input, n, system));
    const result = await run(m, { budget: { ...RESEARCH_PIPELINE_BUDGET, extractionCalls: 2 } }); expect(result).toMatchObject({ status: "incomplete", reason: "research_extraction_incomplete" });
    expect(m.calls.some(c => c.stage === "synthesise")).toBe(false); expect(parsed(result, RESEARCH_FILES.coverage).chunks[0].status).toBe("invalid");
  });
  it("repairs a chunk whose only quote for a found question is out of source (BL-20261110-0726) and never replays a denied transport", async () => {
    const m = models((stage, input, n, system) => { const reply = JSON.parse(happy(stage, input, n, system)); if (stage === "extract" && n === 0) reply.quotes[0].quote = "Invented evidence that never occurred in the supplied source."; return JSON.stringify(reply); });
    // The invented quote was the found question's only quote: the attempt is held and the chunk repaired, as before 7a.1 (3 calls).
    // 18655e5 kept it with the question downgraded (2 calls). The dropped quote is counted; the held attempt's downgrade is not.
    const kept = await run(m); expect(kept.status).toBe("completed"); expect(m.calls.filter(c => c.stage === "extract")).toHaveLength(3);
    expect(kept.summary.stages[2]).toMatchObject({ calls: 3, invalidReplies: 1, repairCalls: 1, quotesDropped: 1, questionsDowngraded: 0 });
    const denied = models((stage, input, n, system) => stage === "extract" ? new BrokerError("synthetic_destination_private_data_denied") : happy(stage, input, n, system));
    const failure = await run(denied); expect(failure).toMatchObject({ reason: "research_request_denied" }); expect(failure.summary.stages[2]).toMatchObject({ calls: 0, denied: "synthetic_destination_private_data_denied" }); expect(denied.request).toHaveBeenCalledTimes(3);
  });
  it("repairs parseable truncated extraction and synthesis rather than accepting their visible text", async () => {
    const m = models((stage, input, n, system) => ({ content: happy(stage, input, n, system), truncated: (stage === "extract" || stage === "synthesise") && n === 0 }));
    const result = await run(m); expect(result.status).toBe("completed"); expect(result.summary.stages[2]).toMatchObject({ calls: 3, truncatedReplies: 1 }); expect(result.summary.stages[3]).toMatchObject({ calls: 2, truncatedReplies: 1 });
  });
  it("retains nonempty truncated synthesis as a failure when both attempts truncate", async () => {
    const m = models((stage, input, n, system) => ({ content: happy(stage, input, n, system), truncated: stage === "synthesise" }));
    const result = await run(m); expect(result).toMatchObject({ reason: "research_synthesis_invalid", status: "incomplete" }); expect(result.files.some(f => f.path === RESEARCH_FILES.argument)).toBe(false);
  });
  it("rejects unknown citations and missing required sections without stripping an unsupported claim", async () => {
    for (const defect of ["citation", "section"]) {
      const m = models((stage, input, n, system) => { const reply = JSON.parse(happy(stage, input, n, system)); if (stage === "synthesise") reply.argument = defect === "citation" ? reply.argument + " Extra [E999]." : "Nonempty narrative [E1]."; return JSON.stringify(reply); });
      expect((await run(m)).reason).toBe("research_synthesis_invalid"); expect(m.calls.filter(c => c.stage === "synthesise")).toHaveLength(2);
    }
  });
  it("never calls all-zero extraction semantic success", async () => {
    const m = models((stage, input, n, system) => stage === "extract" ? JSON.stringify({ questions: input.plan.questions.map((q: any) => ({ questionId: q.id, status: "no_verified_evidence" })), quotes: [], conflicts: [] }) : happy(stage, input, n, system));
    const result = await run(m); expect(result.reason).toBe("research_no_evidence"); expect(parsed(result, RESEARCH_FILES.coverage).corpusAbsenceEstablished).toBe(false);
  });
  it("deduplicates one quote used for several questions without claiming semantic acceptance", async () => {
    const m = models((stage, input, n, system) => { const reply = JSON.parse(happy(stage, input, n, system)); if (stage === "plan") reply.questions.push({ ...reply.questions[0], id: "Q2", text: "A second aspect of the same brief" }); return JSON.stringify(reply); });
    const result = await run(m); expect(result.status).toBe("completed"); const evidence = parsed(result, RESEARCH_FILES.evidence); expect(evidence.quotes).toHaveLength(2); expect(evidence.quotes[0].questionIds).toEqual(["Q1", "Q2"]);
    expect(parsed(result, RESEARCH_FILES.coverage).semanticAcceptance).toBe("not_evaluated");
  });
  it("refuses packet-cap omissions instead of handing a selectively trimmed packet to the writer", async () => {
    const corpus = Array.from({ length: 20 }, (_, i) => ({ id: `input/source-${String(i).padStart(2, "0")}.md`, path: `input/source-${i}.md`, bytes: Buffer.from(Array.from({ length: 12 }, (_, j) => `Source ${i} row ${j} ${"describes a synthetic observation with bounded uncertainty. ".repeat(4)}`).join("\n")) }));
    const m = models((stage, input, n, system) => stage === "extract" ? JSON.stringify({ questions: input.plan.questions.map((q: any) => ({ questionId: q.id, status: "evidence_found" })), quotes: input.chunk.text.split("\n").map((quote: string) => ({ quote, questionIds: ["Q1"], note: "x".repeat(200) })), conflicts: [] }) : happy(stage, input, n, system));
    const result = await run(m, { sources: corpus }); expect(result.reason).toBe("research_packet_cap_omission"); expect(parsed(result, RESEARCH_FILES.coverage).omissions.length).toBeGreaterThan(0); expect(m.calls.some(c => c.stage === "synthesise")).toBe(false);
  });
  it("does not start a stage call that the deadline could cut when the model says so, and consults the guard only with a deadline (finding A8)", async () => {
    const m = models(), events: ResearchStageCounts[] = [];
    // The fixture broker has no clock accessors, so every role's guard is stubbed: the planner refuses, the others admit.
    for (const model of [m.models.reader, m.models.synthesiser]) vi.spyOn(model, "deadlineRefuses").mockReturnValue(false);
    const guard = vi.spyOn(m.models.planner, "deadlineRefuses").mockReturnValue(true);
    const outcome = await run(m, { deadlineMs: performance.now() + 60_000 }, events);
    expect(outcome).toMatchObject({ status: "incomplete", reason: "research_request_denied" });
    expect(events.map(e => [e.stage, e.calls, e.denied])).toEqual([["index", 1, undefined], ["plan", 0, "deadline_before_request"]]);
    expect(m.calls.map(c => c.stage)).toEqual(["index"]);
    expect(guard).toHaveBeenCalledTimes(1); expect(guard.mock.calls[0]![0]).toBeLessThanOrEqual(60_000);
    // Without a deadline the guard is never consulted, so a fixture broker without the accessors runs the whole pipeline.
    const plain = models(); const spy = vi.spyOn(plain.models.planner, "deadlineRefuses");
    expect((await run(plain)).status).toBe("completed"); expect(spy).not.toHaveBeenCalled();
  });
  it("stops cancellation without a request", async () => { const controller = new AbortController(); controller.abort(); const m = models(); expect((await run(m, { signal: controller.signal })).reason).toBe("research_cancelled"); expect(m.request).not.toHaveBeenCalled(); });
});

describe("backlog item 4: the label-keyed diagnostics sink", () => {
  const MARK = { index: "INDEX_MARKER_TEXT", plan: "PLAN_MARKER_TEXT", extract: "EXTRACT_MARKER_TEXT", synthesise: "SYNTHESIS_MARKER_TEXT" };
  /** Every stage rejects a reply once (bad JSON index, an oversize lookFor list, a truncated first chunk, an invented quote in the second, whose held reply is repaired (BL-20261110-0726), a synthesis with an unknown citation and a missing heading); the repairs are clean. */
  const faulty: Script = (stage, input, n, system) => {
    if (stage === "index" && n === 0) return `not json ${MARK.index}`;
    if (stage === "plan" && n === 0) { const reply = JSON.parse(happy(stage, input, n, system)); reply.questions[0].lookFor = Array(7).fill("hint"); reply.deliverableNotes = MARK.plan; return JSON.stringify(reply); }
    if (stage === "extract" && n === 0) return { content: happy(stage, input, n, system).replace("Synthetic source statement", MARK.extract), truncated: true };
    if (stage === "extract" && n === 1) { const reply = JSON.parse(happy(stage, input, n, system)); reply.quotes[0].quote = `Invented ${MARK.extract} that never occurred in the source.`; return JSON.stringify(reply); }
    if (stage === "synthesise" && n === 0) { const reply = JSON.parse(happy(stage, input, n, system)); reply.argument = `Narrative ${MARK.synthesise} [E999].\n\n## Unanswered questions\nNone.`; return JSON.stringify(reply); }
    return happy(stage, input, n, system);
  };
  it("hands every rejected or truncated reply of the four stages to the sink with its content, hash and fixed reasons, while every event and file stays hash-only", async () => {
    const retained: ResearchDiagnostic[] = [], events: ResearchStageCounts[] = [];
    const m = models(faulty), result = await run(m, { diagnostics: { retain: entry => retained.push(entry) } }, events);
    expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    // The second chunk's reply, whose only quote was invented, is held and its chunk repaired (BL-20261110-0726): the reply is
    // reported as rejected, under its own ordinal, once the repair has superseded it.
    expect(retained.map(e => e.disposition)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(retained.map(e => [e.stage, e.ordinal, e.purpose, e.truncated])).toEqual([["index", 1, "research source index", false], ["plan", 1, "research plan", false],
      ["extract", 1, "research evidence extraction", true], ["extract", 2, "research evidence extraction", false], ["synthesise", 1, "research synthesis", false]]);
    for (const entry of retained) {
      expect(entry.replyContentSha256).toBe(digest(entry.content)); expect(entry.replyBytes).toBe(Buffer.byteLength(entry.content));
      expect(entry.content).toContain(MARK[entry.stage]); expect(entry.reasons.length).toBeGreaterThan(0);
      expect(JSON.stringify(entry.reasons)).not.toContain("MARKER");
    }
    expect(retained[0]!.reasons).toEqual([{ code: "invalid_json", path: ["sources", 0] }, { code: "invalid_json", path: ["sources", 1] }]);
    expect(retained[1]!.reasons).toEqual([{ code: "schema_size", path: ["questions", 0, "lookFor"], expected: "array", maximum: 6 }]);
    expect(retained[2]!.reasons).toEqual([{ code: "truncated", path: [] }]);
    expect(retained[3]!.reasons).toEqual([{ code: "quote_not_located", path: ["quotes", 0, "quote"] }, { code: "evidence_found_without_quote", path: ["questions", 0] }]);
    expect(retained[4]!.reasons).toEqual([{ code: "unknown_citation", path: ["argument"], count: 1 }, { code: "conflicting_evidence_heading_missing", path: ["argument"] }]);
    // Hash-only everywhere else: the stage events, the summary and every packet file carry no reply text and no key outside the documented set.
    const persisted = [JSON.stringify(events), JSON.stringify(result.summary), ...result.files.map(f => f.bytes.toString("utf8"))];
    for (const text of persisted) for (const marker of Object.values(MARK)) expect(text).not.toContain(marker);
    for (const stage of [...events, ...result.summary.stages]) hashOnlyStageRow(stage);
    expect(result.summary.stages.map(s => [s.stage, s.calls, s.invalidReplies, s.truncatedReplies])).toEqual([["index", 2, 1, 0], ["plan", 2, 1, undefined], ["extract", 4, 2, 1], ["synthesise", 2, 1, undefined]]);  // the index row's zero comes from summarizeIndexEntries, as before; the second chunk's held reply is repaired and counted invalid
    validateReadyResearchPacket(result.files, { brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(), protocolSha256: researchProtocolSha256(), budget: RESEARCH_PIPELINE_BUDGET });
  });
  it("retains nothing on a clean run or a denied call, and produces byte-identical files and summary with and without a sink", async () => {
    const retain = vi.fn();
    expect((await run(models(), { diagnostics: { retain } })).status).toBe("completed"); expect(retain).not.toHaveBeenCalled();
    const denied = models((stage, input, n, system) => stage === "plan" ? new BrokerError("request_timeout") : happy(stage, input, n, system));
    expect((await run(denied, { diagnostics: { retain } })).reason).toBe("research_request_denied"); expect(retain).not.toHaveBeenCalled();
    const withSink = await run(models(faulty), { diagnostics: { retain: () => {} } }), without = await run(models(faulty));
    expect(withSink.files.map(f => f.path)).toEqual(without.files.map(f => f.path));
    for (const [i, file] of withSink.files.entries()) expect(file.bytes.equals(without.files[i]!.bytes)).toBe(true);
    expect(canonical(withSink.summary)).toBe(canonical(without.summary));
  });
  it("names the reasons for an invalid extraction and synthesis schema, a question-set mismatch and a repeated question id without copying model text", async () => {
    const retained: ResearchDiagnostic[] = [];
    const m = models((stage, input, n, system) => {
      if (stage === "extract" && n === 0) return JSON.stringify({ questions: [{ questionId: "Q1", status: "evidence_found" }], quotes: [{ quote: 42, questionIds: ["Q1"], SECRET_KEY_NAME: "x" }], conflicts: [] });
      if (stage === "extract" && n === 1) { const reply = JSON.parse(happy(stage, input, n, system)); reply.questions = [{ questionId: "Q7", status: "no_verified_evidence" }]; reply.quotes = []; reply.conflicts = [{ questionIds: ["Q1", "Q1"], note: "n" }]; return JSON.stringify(reply); }
      if (stage === "synthesise" && n === 0) return JSON.stringify({ version: 1, argument: "x", questions: [{ questionId: "Q1", disposition: "findings", evidenceIds: ["E1", "E1", "E9"] }, { questionId: "Q1", disposition: "conflict", evidenceIds: [] }] });
      return happy(stage, input, n, system);
    });
    expect((await run(m, { diagnostics: { retain: entry => retained.push(entry) } })).status).toBe("completed");
    expect(retained.map(e => [e.stage, e.ordinal])).toEqual([["extract", 1], ["extract", 2], ["synthesise", 1]]);
    expect(retained[0]!.reasons).toEqual([{ code: "schema_invalid_type", path: ["quotes", 0, "quote"] }, { code: "schema_unrecognized_keys", path: ["quotes", 0] }]);
    expect(JSON.stringify(retained[0]!.reasons)).not.toContain("SECRET_KEY_NAME");
    expect(retained[1]!.reasons).toEqual([{ code: "question_set_mismatch", path: ["questions"] }, { code: "duplicate_question_id", path: ["conflicts", 0, "questionIds"] }]);
    expect(retained[2]!.reasons).toEqual([{ code: "question_set_mismatch", path: ["questions"] }, { code: "duplicate_evidence_id", path: ["questions", 0, "evidenceIds"] }, { code: "unknown_evidence_id", path: ["questions", 0, "evidenceIds"] },
      { code: "disposition_without_evidence", path: ["questions", 1, "evidenceIds"] }, { code: "conflicting_evidence_heading_missing", path: ["argument"] }, { code: "unanswered_questions_heading_missing", path: ["argument"] }]);
  });
  it("pins the frozen research protocol through the shared pin; the sink is no part of it", () => {
    expect(researchProtocolSha256()).toBe(RESEARCH_PROTOCOL_SHA256);
  });
});

describe("backlog item 7(b), part 1: request shapes (BL-20261109-0334)", () => {
  const sized = (count: number, bytes: number, label: string) => Array.from({ length: count }, (_, i) => {
    const id = `input/${label}-${String(i).padStart(2, "0")}.md`, line = (j: number) => `Source ${i} line ${j} records a synthetic observation for the survey.`;
    const lines: string[] = []; let size = 0;
    for (let j = 0; size < bytes; j++) { lines.push(line(j)); size += Buffer.byteLength(line(j)) + 1; }
    return { id, path: id, bytes: Buffer.from(lines.join("\n")) };
  });
  it("sends every extraction request, initial and repair, as one byte-identical stable-packet line, a newline and the chunk line (D9)", async () => {
    // Newlines, and a U+2028 and a U+2029 that JSON.stringify leaves raw, in the brief and in a source: canonical() escapes the newlines only.
    const brief = "Context line.\n1. Explain the orchard.\u2028\n2. Explain the meadow\u2029 and its limits.\n";
    const sources = researchV4Sources(); sources[1] = { ...sources[1]!, bytes: Buffer.from("# Synthetic beta\nThe meadow recorded seven healthy trees\u2028 during the spring survey.\n") };
    // The first chunk's reply is invalid, so the run ends with that chunk's repair: initial, initial, repair across two sources.
    const m = models((stage, input, n, system) => stage === "extract" && n === 0 ? "bad JSON" : happy(stage, input, n, system));
    const result = await run(m, { brief, sources }); expect(result.status).toBe("completed");
    const extracts = m.calls.filter(c => c.stage === "extract");
    expect(extracts.map(c => [c.input.source.id, c.input.repairReason === null])).toEqual([[sources[0]!.id, true], [sources[1]!.id, true], [sources[0]!.id, false]]);
    const plan = parsed(result, RESEARCH_FILES.plan), units = parsed(result, RESEARCH_FILES.coverage).units;
    const stableLine = canonical({ brief, plan, units });
    for (const call of extracts) {
      const content = call.body.messages[1].content as string, lines = content.split("\n");
      expect(call.body.messages[0].content).toBe(EXTRACT_SYSTEM);
      expect(lines).toHaveLength(2); expect(String(call.input.chunk.text)).toContain("\n");
      expect(lines[0]).toBe(stableLine); expect(Object.keys(JSON.parse(lines[0]!))).toEqual(["brief", "plan", "units"]);
      const perChunk = JSON.parse(lines[1]!);
      expect(Object.keys(perChunk)).toEqual(["chunk", "repairReason", "source"]);
      expect(lines[0]).not.toContain(call.input.chunk.id); expect(lines[0]).not.toContain(JSON.stringify(call.input.chunk.text).slice(1, 40));
      expect(content).toBe(researchExtractionUserContent({ brief, units, plan, ...perChunk }));
    }
    for (const separator of ["\u2028", "\u2029"]) expect(extracts.every(c => (c.body.messages[1].content as string).split("\n")[0]!.includes(separator))).toBe(true);
    expect(extracts.some(c => (c.body.messages[1].content as string).split("\n")[1]!.includes("\u2028"))).toBe(true);
    // Every other stage still sends one canonical object, byte-identical to canonical() of what it parsed.
    for (const call of m.calls.filter(c => c.stage !== "extract")) expect(call.body.messages[1].content).toBe(canonical(call.input));
  });
  it("leaves the index and plan request bytes as they were before 7b.1, and pins the extraction bytes it sends", async () => {
    const m = models(); expect((await run(m)).status).toBe("completed");
    const digests = m.calls.map(c => [c.stage, digest(c.body.messages[1].content as string)]);
    // Index and plan: captured at main 2982ca7, before 7b.1, with this fixture and these sources; 7b.1 leaves them unchanged.
    expect(digests.slice(0, 2)).toEqual([["index", "d10e662b830fa5c23d1318424c62726a17b63536995c01ca0d45970386fcc15e"], ["plan", "db70bd30a913d4433bb9e89cff8e3fc24e8a030d89eae13d4d478ee072e1b927"]]);
    // Extraction: 7b.1's layout (at 2982ca7 these were 176f81fb… and a8419157…).
    expect(digests.slice(2, 4)).toEqual([["extract", "cf7b50ba8c99f4383dbb40dacce86f4a50fb8ddf43bf142c2a5ed8ba39ecf4c6"], ["extract", "9ff9b72f9d3d634203af95455834ea44db057af9c74f789268bbfbbfed847f77"]]);
    expect(Object.keys(m.calls[0]!.input)).toEqual(["repair", "sources"]); expect(Object.keys(m.calls[0]!.input.sources[0])).toEqual(["bytes", "id", "previewTruncated", "text"]);
    expect(Object.keys(m.calls[1]!.input)).toEqual(["authoritativeSchema", "brief", "extractionCallBudget", "mandatorySourceChunks", "repair", "sourceIndex", "units"]);
  });
  it("still ends a stage as a denied call when a repair payload cannot be encoded: a NUL a reply carried into the plan repair", async () => {
    const events: ResearchStageCounts[] = [];
    const m = models((stage, input, n, system) => stage === "plan" && n === 0 ? "{\u0000 not a plan" : happy(stage, input, n, system));
    const result = await run(m, {}, events);
    expect(result).toMatchObject({ status: "incomplete", reason: "research_request_denied" });
    expect(events.map(e => [e.stage, e.calls, e.denied])).toEqual([["index", 1, undefined], ["plan", 1, "private_agent_invalid_text"]]);
    expect(m.calls.map(c => c.stage)).toEqual(["index", "plan"]);
    expect(result.files.map(f => f.path).sort()).toEqual([RESEARCH_FILES.coverage, RESEARCH_FILES.index, RESEARCH_FILES.summary].sort());
  });
  it("batches index requests by preview size: thirty 30 KiB sources are admitted with ten requests of three (D8)", async () => {
    const corpus = sized(30, 30 * 1024, "mid");
    // Each source exceeds 20 KiB, so the earlier rule (full bytes against 20 KiB) gave every one its own batch: 30 > 24, refused.
    expect(corpus.every(s => s.bytes.length > 20 * 1024)).toBe(true);
    const m = models(), result = await run(m, { sources: corpus }); expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    const index = m.calls.filter(c => c.stage === "index");
    expect(index.map(c => c.input.sources.length)).toEqual(Array(10).fill(3));
    expect(index.flatMap(c => c.input.sources.map((s: { id: string }) => s.id))).toEqual(corpus.map(s => s.id));
    for (const call of index) for (const source of call.input.sources) { expect(source.previewTruncated).toBe(true); expect(Buffer.byteLength(source.text)).toBeLessThanOrEqual(20 * 1024); }
    expect(result.summary.stages[0]).toMatchObject({ calls: 10, initialCalls: 10, repairCalls: 0 }); expect(m.calls.filter(c => c.stage === "extract")).toHaveLength(30);
  });
  it("refuses more than 40 chunks before any request, now the only refusal under the default budget: 41 sources of 21 KiB, and sixty of 100 KiB", async () => {
    const small = sized(41, 21 * 1024, "over");
    expect(planResearchIndexBatches(small)).toHaveLength(14);
    const first = models(); expect(await run(first, { sources: small })).toMatchObject({ status: "incomplete", reason: "research_mandatory_budget_exceeded" }); expect(first.request).not.toHaveBeenCalled();
    const large = sized(60, 100 * 1024, "large");
    expect(planResearchIndexBatches(large)).toHaveLength(20);
    const second = models(); expect(await run(second, { sources: large })).toMatchObject({ status: "incomplete", reason: "research_mandatory_budget_exceeded" }); expect(second.request).not.toHaveBeenCalled();
  });
  it("keeps today's 1,200-word request while the synthesis role thinks and no limit is stated, on both attempts, and records it (D13)", async () => {
    const m = models((stage, input, n, system) => stage === "synthesise" && n === 0 ? "bad JSON" : happy(stage, input, n, system));
    const result = await run(m); expect(result.status).toBe("completed");
    expect(SYNTHESIS_SYSTEM).toContain('"argument":"complete Markdown, at most lengthCap.words words"'); expect(SYNTHESIS_SYSTEM).not.toContain("1200");
    const syntheses = m.calls.filter(c => c.stage === "synthesise"); expect(syntheses).toHaveLength(2);
    for (const call of syntheses) { expect(call.body.messages[0].content).toBe(SYNTHESIS_SYSTEM); expect(call.input.lengthCap).toEqual({ words: 1200 }); }
    const argument = result.files.find(f => f.path === RESEARCH_FILES.argument)!.bytes.toString("utf8"), row = result.summary.stages[3]!;
    expect(row).toMatchObject({ lengthCapWords: 1200, argumentWords: researchWordCount(argument) }); expect(row.argumentWords).toBeGreaterThan(0); expect("briefWordLimit" in row).toBe(false);
  });
  it("lets a word limit stated in the brief win below the ceiling, records it hash-only, and never rejects an argument longer than the cap", async () => {
    const brief = "Describe the supplied synthetic observations and their limitations in at most 150 words.", events: ResearchStageCounts[] = [];
    // The scripted argument runs to about 300 words, twice the stated cap, and is still accepted: the cap is a request, never a check.
    const long = (stage: Stage, input: any, n: number, system: string) => {
      const reply = JSON.parse(happy(stage, input, n, system)); if (stage === "synthesise") reply.argument = `${"The supplied source states a bounded synthetic finding [E1]. ".repeat(33)}${reply.argument}`; return JSON.stringify(reply);
    };
    const m = models(long), result = await run(m, { brief }, events); expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(m.calls.find(c => c.stage === "synthesise")!.input.lengthCap).toEqual({ words: 150 });
    const row = result.summary.stages[3]!; expect(row).toMatchObject({ lengthCapWords: 150, briefWordLimit: 150 }); expect(row.argumentWords).toBeGreaterThan(300);
    for (const stage of [...events, ...result.summary.stages]) hashOnlyStageRow(stage);
    // A stated limit above the ceiling is clamped to it, and one below the 100-word floor is a part's length: the default applies.
    for (const [stated, words] of [["in no more than 3,000 words", 1200], ["with a title of at most 12 words", 1200]] as const) {
      const other = models(); await run(other, { brief: `Describe the supplied synthetic observations ${stated}.` });
      expect([stated, other.calls.find(c => c.stage === "synthesise")!.input.lengthCap]).toEqual([stated, { words }]);
    }
  });
  it("keeps today's 1,200 words on both attempts when the brief limits only a part under a heading or in a parenthesis (correction BL-20261110-0625)", async () => {
    // At 5401d0f this brief sent lengthCap {words: 200} on both attempts and recorded briefWordLimit 200 as if it capped the report.
    const brief = "1. Describe the supplied synthetic observations.\n2. Name their limitations.\n3. Executive summary: no more than 200 words.\n", events: ResearchStageCounts[] = [];
    const m = models((stage, input, n, system) => stage === "synthesise" && n === 0 ? "not a synthesis" : happy(stage, input, n, system)), result = await run(m, { brief }, events);
    expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(m.calls.filter(c => c.stage === "synthesise").map(c => c.input.lengthCap)).toEqual([{ words: 1200 }, { words: 1200 }]);
    expect(result.summary.stages[3]).toMatchObject({ lengthCapWords: 1200 }); expect("briefWordLimit" in result.summary.stages[3]!).toBe(false);
    const other = models(); await run(other, { brief: "Describe the supplied synthetic observations. Abstract (max. 150 words)." });
    expect(other.calls.find(c => c.stage === "synthesise")!.input.lengthCap).toEqual({ words: 1200 });
  });
});

describe("backlog item 7(a), part 1: per-quote tolerance and heading normalisation", () => {
  const NUL = String.fromCharCode(0);
  const good = (input: any) => String(input.chunk.text).split("\n").find((line: string) => !line.startsWith("#") && line.length >= 12)!;
  const extractReply = (input: any, edit: (reply: any) => void) => { const reply = JSON.parse(researchV4Reply("You extract", JSON.stringify(input))); edit(reply); return JSON.stringify(reply); };
  const twoQuestions = (stage: Stage, input: any, n: number, system: string) => { const reply = JSON.parse(happy(stage, input, n, system)); if (stage === "plan") reply.questions.push({ ...reply.questions[0], id: "Q2", text: "A second aspect of the same brief" }); return JSON.stringify(reply); };
  it("drops only the quotes it cannot verify and keeps the chunk complete without a repair (D2)", async () => {
    const retained: ResearchDiagnostic[] = [], events: ResearchStageCounts[] = [];
    const m = models((stage, input, n, system) => stage === "extract" && n === 0 ? extractReply(input, reply => {
      const kept = reply.quotes[0];
      reply.quotes = [kept, { ...kept, quote: "Invented evidence that never occurred in the supplied source." }, { ...kept, questionIds: ["Q9"] }, { ...kept, questionIds: ["Q1", "Q1"] }, { ...kept, quote: "too short" }];
    }) : happy(stage, input, n, system));
    const result = await run(m, { diagnostics: { retain: entry => retained.push(entry) } }, events);
    expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(m.calls.filter(c => c.stage === "extract")).toHaveLength(2);
    expect(result.summary.stages[2]).toMatchObject({ calls: 2, invalidReplies: 0, quotesDropped: 4, quotesVerified: 2, chunksComplete: 2 });
    expect(parsed(result, RESEARCH_FILES.evidence).quotes.map((q: any) => q.quote)).toEqual([good({ chunk: { text: researchV4Sources()[0]!.bytes.toString() } }), good({ chunk: { text: researchV4Sources()[1]!.bytes.toString() } })]);
    expect(retained.map(e => [e.stage, e.ordinal, e.disposition])).toEqual([["extract", 1, "accepted_with_drops"]]);
    expect(retained[0]!.reasons).toEqual([{ code: "quote_not_located", path: ["quotes", 1, "quote"] }, { code: "unknown_question_id", path: ["quotes", 2, "questionIds"] },
      { code: "duplicate_question_id", path: ["quotes", 3, "questionIds"] }, { code: "quote_length", path: ["quotes", 4, "quote"], minimum: 12, maximum: 300 }]);
    for (const stage of [...events, ...result.summary.stages]) hashOnlyStageRow(stage);
  });
  it("drops and counts conflicts with a repeated or unknown question id", async () => {
    const m = models((stage, input, n, system) => stage === "extract" && n === 0 ? extractReply(input, reply => {
      reply.conflicts = [{ questionIds: ["Q1"], note: "kept conflict" }, { questionIds: ["Q9"], note: "unknown" }, { questionIds: ["Q1", "Q1"], note: "repeated" }];
    }) : happy(stage, input, n, system));
    const result = await run(m); expect(result.status).toBe("completed"); expect(m.calls.filter(c => c.stage === "extract")).toHaveLength(2);
    expect(result.summary.stages[2]).toMatchObject({ invalidReplies: 0, conflictsDropped: 2, conflictsNoted: 1 });
    expect(parsed(result, RESEARCH_FILES.evidence).conflicts.map((c: any) => c.note)).toEqual(["kept conflict"]);
  });
  it("derives each question's outcome from its verified quotes, downgrading and upgrading a contradicted status without a repair", async () => {
    const m = models((stage, input, n, system) => {
      if (stage !== "extract") return twoQuestions(stage, input, n, system);
      return extractReply(input, reply => {
        const quote = good(input);
        // Q2 is claimed found with no quote at all: downgraded without a repair. (A found question whose quotes were all dropped is
        // held and repaired instead; see the BL-20261110-0726 test below.)
        if (n === 0) { reply.questions = [{ questionId: "Q1", status: "evidence_found" }, { questionId: "Q2", status: "evidence_found" }];
          reply.quotes = [{ quote, questionIds: ["Q1"] }]; }
        else { reply.questions = [{ questionId: "Q1", status: "no_verified_evidence" }, { questionId: "Q2", status: "no_verified_evidence" }]; reply.quotes = [{ quote, questionIds: ["Q1"] }]; }
      });
    });
    const result = await run(m); expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(m.calls.filter(c => c.stage === "extract")).toHaveLength(2);
    expect(result.summary.stages[2]).toMatchObject({ invalidReplies: 0, quotesDropped: 0, questionsDowngraded: 1, questionsUpgraded: 1 });
    expect(parsed(result, RESEARCH_FILES.coverage).chunks.map((c: any) => c.questions.map((q: any) => [q.questionId, q.status]))).toEqual([
      [["Q1", "evidence_retained"], ["Q2", "no_verified_evidence"]], [["Q1", "evidence_retained"], ["Q2", "no_verified_evidence"]]]);
  });
  it("holds a first attempt that dropped every quote of a found question: repaired after every other repair while the budget lasts, kept otherwise (BL-20261110-0726)", async () => {
    const invented = "Invented evidence that never occurred in the supplied source.";
    // The reviewers' R1: every chunk's first reply carries one unlocatable quote and an honest reply is available for a repair.
    // 18655e5 ended research_no_evidence after 2 calls; 5401d0f completed with 4 calls, 2 repairs and 2 verified quotes.
    const paraphrase = (target: (n: number, input: any) => boolean) => models((stage, input, n, system) => {
      const reply = JSON.parse(happy(stage, input, n, system)); if (stage === "extract" && target(n, input)) reply.quotes[0].quote = invented; return JSON.stringify(reply);
    });
    const r1 = paraphrase(n => n < 2), all = await run(r1);
    expect(all).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(all.summary.stages[2]).toMatchObject({ calls: 4, initialCalls: 2, repairCalls: 2, invalidReplies: 2, quotesDropped: 2, questionsDowngraded: 0, quotesVerified: 2 });
    expect(parsed(all, RESEARCH_FILES.coverage).chunks.map((c: any) => c.attempts.map((a: any) => a.status))).toEqual([["invalid", "complete"], ["invalid", "complete"]]);
    // R2: only the first chunk's reply is unlocatable; both sources' evidence reaches the packet (18655e5 kept only beta's).
    const r2 = await run(paraphrase(n => n === 0));
    expect(r2.summary.stages[2]).toMatchObject({ calls: 3, repairCalls: 1, quotesVerified: 2 });
    expect(new Set(parsed(r2, RESEARCH_FILES.evidence).quotes.map((q: any) => q.sourceId)).size).toBe(2);
    // No budget left for the repair: the held attempt is kept as 18655e5 kept it, its downgrade counted and its attempt complete.
    const tight = await run(paraphrase(n => n === 0), { budget: { ...RESEARCH_PIPELINE_BUDGET, extractionCalls: 2 } });
    expect(tight).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(tight.summary.stages[2]).toMatchObject({ calls: 2, repairCalls: 0, invalidReplies: 0, questionsDowngraded: 1 });
    expect(parsed(tight, RESEARCH_FILES.coverage).chunks.map((c: any) => c.attempts.map((a: any) => a.status))).toEqual([["complete"], ["complete"]]);
    // A genuinely invalid chunk is repaired first: with one repair left it goes to the invalid chunk, and the held one is kept.
    const priority = models((stage, input, n, system) => {
      if (stage !== "extract") return happy(stage, input, n, system);
      if (n === 0) { const reply = JSON.parse(happy(stage, input, n, system)); reply.quotes[0].quote = invented; return JSON.stringify(reply); }
      return n === 1 ? "not an extraction" : happy(stage, input, n, system);
    });
    const first = await run(priority, { budget: { ...RESEARCH_PIPELINE_BUDGET, extractionCalls: 3 } });
    expect(first).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(priority.calls.filter(c => c.stage === "extract").map(c => c.input.chunk.id)).toEqual([...inventoryResearchSources(researchV4Sources()).chunks.map(c => c.id), inventoryResearchSources(researchV4Sources()).chunks[1]!.id]);
    expect(first.summary.stages[2]).toMatchObject({ calls: 3, repairCalls: 1, invalidReplies: 1, questionsDowngraded: 1 });
    // A repair attempt that again loses every quote is kept with its drops: no third call.
    const again = paraphrase(() => true), twice = await run(again);
    expect(twice).toMatchObject({ status: "incomplete", reason: "research_no_evidence" });
    expect(twice.summary.stages[2]).toMatchObject({ calls: 4, repairCalls: 2, invalidReplies: 2, questionsDowngraded: 2 });
  });
  it("counts and retains a held chunk's failed repair (BL-20261110-0900)", async () => {
    const invented = "Invented evidence that never occurred in the supplied source.";
    // Chunk 0's first reply loses its only quote and is held; chunk 1 is honest; chunk 0's repair is not an extraction, or truncated.
    // At bd876d9 the repair was neither counted nor retained: invalidReplies 1, and only ordinal 1 reached the sink.
    for (const [repairReply, status] of [["not an extraction", "invalid"], [undefined, "truncated"]] as const) {
      const m = models((stage, input, n, system) => {
        if (stage !== "extract") return happy(stage, input, n, system);
        if (n === 0) { const reply = JSON.parse(happy(stage, input, n, system)); reply.quotes[0].quote = invented; return JSON.stringify(reply); }
        return n === 1 ? happy(stage, input, n, system) : repairReply ?? { content: happy(stage, input, n, system), truncated: true };
      });
      const retained: ResearchDiagnostic[] = [], result = await run(m, { diagnostics: { retain: entry => retained.push(entry) } });
      expect([status, result.reason]).toEqual([status, "research_extraction_incomplete"]);
      expect(result.summary.stages[2]).toMatchObject({ calls: 3, repairCalls: 1, invalidReplies: 2, ...(status === "truncated" ? { truncatedReplies: 1 } : {}) });
      expect(parsed(result, RESEARCH_FILES.coverage).chunks.map((c: any) => c.attempts.map((a: any) => a.status))).toEqual([["invalid", status], ["complete"]]);
      expect(retained.filter(e => e.stage === "extract").map(e => e.ordinal)).toEqual([3, 1]);
    }
  });
  it("settles a held attempt when a later call is denied or cancelled, and holds only a found question's lost quotes (BL-20261110-0900)", async () => {
    const invented = "Invented evidence that never occurred in the supplied source.";
    const unlocatable = (input: any, n: number, system: string) => { const reply = JSON.parse(happy("extract", input, n, system)); reply.quotes[0].quote = invented; return JSON.stringify(reply); };
    const sinkRows = (retained: ResearchDiagnostic[]) => retained.filter(e => e.stage === "extract").map(e => [e.ordinal, e.disposition]);
    const attempts = (result: Awaited<ReturnType<typeof runResearchPipeline>>) => parsed(result, RESEARCH_FILES.coverage).chunks[0].attempts.map((a: any) => a.status);
    // A first-pass denial while chunk 0 is held: the held attempt is rejected, counted and retained without a disposition.
    const firstPass = models((stage, input, n, system) => stage !== "extract" ? happy(stage, input, n, system) : n === 0 ? unlocatable(input, n, system) : new BrokerError("synthetic_destination_private_data_denied"));
    const deniedSink: ResearchDiagnostic[] = [], denied = await run(firstPass, { diagnostics: { retain: entry => deniedSink.push(entry) } });
    expect(denied.reason).toBe("research_request_denied");
    expect(denied.summary.stages[2]).toMatchObject({ calls: 1, invalidReplies: 1, questionsDowngraded: 0 });
    expect(sinkRows(deniedSink)).toEqual([[1, undefined]]); expect(attempts(denied)).toEqual(["invalid"]);
    // The same when the signal is aborted during call 0.
    const controller = new AbortController();
    const aborting = models((stage, input, n, system) => { if (stage === "extract" && n === 0) { controller.abort(); return unlocatable(input, n, system); } return happy(stage, input, n, system); });
    const cancelledSink: ResearchDiagnostic[] = [], cancelled = await run(aborting, { signal: controller.signal, diagnostics: { retain: entry => cancelledSink.push(entry) } });
    expect(cancelled.reason).toBe("research_cancelled");
    expect(cancelled.summary.stages[2]).toMatchObject({ calls: 1, invalidReplies: 1, questionsDowngraded: 0 });
    expect(sinkRows(cancelledSink)).toEqual([[1, undefined]]); expect(attempts(cancelled)).toEqual(["invalid"]);
    // A denial on the held chunk's repair call: the held attempt is rejected; the denied call is not counted.
    const repairPass = models((stage, input, n, system) => stage !== "extract" ? happy(stage, input, n, system) : n === 0 ? unlocatable(input, n, system)
      : n === 1 ? happy(stage, input, n, system) : new BrokerError("synthetic_destination_private_data_denied"));
    const repairSink: ResearchDiagnostic[] = [], repairDenied = await run(repairPass, { diagnostics: { retain: entry => repairSink.push(entry) } });
    expect(repairDenied.reason).toBe("research_request_denied");
    expect(repairDenied.summary.stages[2]).toMatchObject({ calls: 2, invalidReplies: 1, questionsDowngraded: 0 });
    expect(sinkRows(repairSink)).toEqual([[1, undefined]]); expect(attempts(repairDenied)).toEqual(["invalid"]);
    // No budget for the repair: the held attempt is kept, and it reaches the sink once, as accepted with drops.
    const tight = models((stage, input, n, system) => stage === "extract" && n === 0 ? unlocatable(input, n, system) : happy(stage, input, n, system));
    const tightSink: ResearchDiagnostic[] = [], kept = await run(tight, { budget: { ...RESEARCH_PIPELINE_BUDGET, extractionCalls: 2 }, diagnostics: { retain: entry => tightSink.push(entry) } });
    expect(kept.status).toBe("completed"); expect(sinkRows(tightSink)).toEqual([[1, "accepted_with_drops"]]);
    // A question the reply marked no_verified_evidence is never held: its dropped quote costs no repair.
    const qualifier = models((stage, input, n, system) => {
      if (stage !== "extract" || n !== 0) return happy(stage, input, n, system);
      const reply = JSON.parse(happy(stage, input, n, system)); reply.quotes[0].quote = invented; reply.questions[0].status = "no_verified_evidence"; return JSON.stringify(reply);
    });
    const unheld = await run(qualifier);
    expect(unheld.status).toBe("completed"); expect(qualifier.calls.filter(c => c.stage === "extract")).toHaveLength(2);
    expect(unheld.summary.stages[2]).toMatchObject({ calls: 2, invalidReplies: 0, repairCalls: 0, quotesDropped: 1, questionsDowngraded: 0 });
    // BL-20261110-1100: a dropped quote counts against every question it names. An invented quote naming both questions, and a verified quote for one of them
    // only, leave the other with no quote, so the first attempt is held and repaired (the "Q2" survivor catches a rule that records only the last id).
    for (const survivor of ["Q1", "Q2"]) {
      const shared = models((stage, input, n, system) => stage !== "extract" ? twoQuestions(stage, input, n, system) : n !== 0 ? happy(stage, input, n, system)
        : extractReply(input, reply => { reply.quotes = [{ quote: invented, questionIds: ["Q1", "Q2"] }, { quote: good(input), questionIds: [survivor] }]; }));
      const both = await run(shared);
      expect(both.status).toBe("completed"); expect(attempts(both)).toEqual(["invalid", "complete"]);
      expect(both.summary.stages[2]).toMatchObject({ calls: 3, repairCalls: 1, invalidReplies: 1, quotesDropped: 1, questionsDowngraded: 0 });
    }
  });
  it("holds a first attempt when one of two found questions lost every quote, though the other kept one (BL-20261110-1100)", async () => {
    const m = models((stage, input, n, system) => stage === "extract" && n === 0
      ? extractReply(input, reply => { reply.quotes = [{ quote: "Invented evidence that never occurred in the supplied source.", questionIds: ["Q1"] }, { quote: good(input), questionIds: ["Q2"] }]; })
      : twoQuestions(stage, input, n, system));
    const result = await run(m);
    expect(result.summary.stages[2]).toMatchObject({ calls: 3, repairCalls: 1, invalidReplies: 1, questionsDowngraded: 0 });
    expect(parsed(result, RESEARCH_FILES.coverage).chunks[0].attempts.map((a: any) => a.status)).toEqual(["invalid", "complete"]);
  });
  it("still repairs a reply that is schema-invalid, names the wrong questions or needs follow-up", async () => {
    const faults: ((reply: any) => void)[] = [reply => { reply.quotes[0].quote = 42; }, reply => { reply.questions = [{ questionId: "Q7", status: "no_verified_evidence" }]; reply.quotes = []; },
      reply => { reply.questions[0].status = "needs_followup"; }];
    for (const fault of faults) {
      const m = models((stage, input, n, system) => stage === "extract" && n === 0 ? extractReply(input, fault) : happy(stage, input, n, system));
      const result = await run(m); expect(result.status).toBe("completed");
      expect(result.summary.stages[2]).toMatchObject({ calls: 3, invalidReplies: 1, repairCalls: 1 });
    }
  });
  it("drops a note the packet cannot encode instead of losing the stage: the quote stays, the conflict goes", async () => {
    const m = models((stage, input, n, system) => stage === "extract" && n === 0 ? extractReply(input, reply => {
      reply.quotes[0].note = `bad ${NUL} note`; reply.conflicts = [{ questionIds: ["Q1"], note: `bad ${NUL} conflict` }];
    }) : happy(stage, input, n, system));
    const retained: ResearchDiagnostic[] = [], result = await run(m, { diagnostics: { retain: entry => retained.push(entry) } });
    expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(result.summary.stages[2]).toMatchObject({ invalidReplies: 0, notesDropped: 1, conflictsDropped: 1, quotesVerified: 2 });
    expect(retained.map(e => [e.disposition, e.reasons])).toEqual([["accepted_with_drops", [{ code: "note_unencodable", path: ["quotes", 0, "note"] }, { code: "note_unencodable", path: ["conflicts", 0, "note"] }]]]);
    const evidence = parsed(result, RESEARCH_FILES.evidence); expect(evidence.quotes[0].note).toBe(""); expect(evidence.conflicts).toEqual([]);
  });
  const withHeadings = (argument: (base: string) => string) => (stage: Stage, input: any, n: number, system: string) => {
    const reply = JSON.parse(happy(stage, input, n, system)); if (stage === "synthesise") reply.argument = argument(reply.argument); return JSON.stringify(reply);
  };
  const swap = (base: string, conflicting: string, unanswered: string) => base.replace("## Conflicting evidence", conflicting).replace("## Unanswered questions", unanswered);
  it("rewrites variant section headings to the exact forms claims.ts's rule accepts, counts each rewrite, and keeps one synthesis call (D5)", async () => {
    const variants: [string, (base: string) => string, number][] = [
      ["ATX level and colon, bold", base => swap(base, "### conflicting evidence:", "**Unanswered questions**"), 2],
      ["upper case, underscores", base => swap(base, "# CONFLICTING EVIDENCE", "__Unanswered Questions__"), 2],
      ["Setext underlines", base => swap(base, "Conflicting evidence\n--------------------", "Unanswered questions\n===="), 2],
      ["one exact, one variant", base => swap(base, "## Conflicting evidence", "## Unanswered questions:"), 1],
      ["already exact", base => base, 0],
    ];
    const exactArgument = (await run(models())).files.find(f => f.path === RESEARCH_FILES.argument)!.bytes.toString("utf8");
    for (const [label, argument, rewrites] of variants) {
      const m = models(withHeadings(argument)), result = await run(m);
      expect([label, result.status, m.calls.filter(c => c.stage === "synthesise").length]).toEqual([label, "completed", 1]);
      // Every variant normalises to the fixture's exact argument, byte for byte.
      expect([label, result.files.find(f => f.path === RESEARCH_FILES.argument)!.bytes.toString("utf8")]).toEqual([label, exactArgument]);
      expect([label, result.summary.stages[3]!.headingsNormalised]).toEqual([label, rewrites]);
      validateReadyResearchPacket(result.files, { brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(), protocolSha256: researchProtocolSha256(), budget: RESEARCH_PIPELINE_BUDGET });
    }
  });
  it("never rewrites a heading inside fenced code or an HTML comment, or a prose line that only starts with the title, and still rejects a missing section", async () => {
    const cases: [string, (base: string) => string][] = [
      ["fenced", base => swap(base, "## Conflicting evidence", "```\n### unanswered questions\n```")],
      ["comment", base => swap(base, "## Conflicting evidence", "<!--\nUnanswered questions\n-->")],
      ["prose", base => swap(base, "## Conflicting evidence", "Unanswered questions remain open.")],
    ];
    for (const [label, argument] of cases) {
      const m = models(withHeadings(argument)), result = await run(m);
      expect([label, result.reason, m.calls.filter(c => c.stage === "synthesise").length]).toEqual([label, "research_synthesis_invalid", 2]);
    }
  });

  it("drops a quote that splits an astral character of the chunk, which canonical() could not encode", async () => {
    const tree = String.fromCodePoint(0x1f333), split = String.fromCharCode(0xd83c), sources = researchV4Sources();
    sources[0] = { ...sources[0]!, bytes: Buffer.from(`# Synthetic alpha\nThe orchard recorded twelve healthy trees ${tree} during the autumn survey.\n`) };
    const retained: ResearchDiagnostic[] = [];
    const m = models((stage, input, n, system) => stage === "extract" && n === 0 ? extractReply(input, reply => {
      reply.quotes.push({ ...reply.quotes[0], quote: `The orchard recorded twelve healthy trees ${split}` });
    }) : happy(stage, input, n, system));
    const result = await run(m, { sources, diagnostics: { retain: entry => retained.push(entry) } });
    expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(result.summary.stages[2]).toMatchObject({ calls: 2, invalidReplies: 0, quotesDropped: 1, quotesVerified: 2 });
    expect(retained.flatMap(e => e.reasons)).toEqual([{ code: "quote_unencodable", path: ["quotes", 1, "quote"] }]);
    expect(parsed(result, RESEARCH_FILES.evidence).quotes[0].quote).toContain(tree);
  });
  it("rejects an argument canonical() could not encode, so the writer's presentation never meets it, and repairs it", async () => {
    const retained: ResearchDiagnostic[] = [];
    const bad = models((stage, input, n, system) => { const reply = JSON.parse(happy(stage, input, n, system)); if (stage === "synthesise" && n === 0) reply.argument += ` ${NUL}`; return JSON.stringify(reply); });
    const result = await run(bad, { diagnostics: { retain: entry => retained.push(entry) } });
    expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" }); expect(bad.calls.filter(c => c.stage === "synthesise")).toHaveLength(2);
    expect(retained.map(e => [e.stage, e.reasons])).toEqual([["synthesise", [{ code: "argument_unencodable", path: ["argument"] }]]]);
    expect(result.files.find(f => f.path === RESEARCH_FILES.argument)!.bytes.includes(0)).toBe(false);
  });
  it("lets only a chunk's complete attempt contribute: a needs-follow-up reply adds no quote, conflict, outcome or correction count", async () => {
    // Three questions; the first reply marks Q1 needs_followup and carries what a kept reply would count: a downgrade (Q2), an
    // upgrade (Q3, tagged on a verified quote), a cleared note, a dropped conflict and a conflict that would be kept.
    const threeQuestions = (stage: Stage, input: any, n: number, system: string) => {
      const reply = JSON.parse(happy(stage, input, n, system));
      if (stage === "plan") for (const id of ["Q2", "Q3"]) reply.questions.push({ ...reply.questions[0], id, text: `Aspect ${id} of the same brief` });
      return JSON.stringify(reply);
    };
    const m = models((stage, input, n, system) => stage === "extract" && n === 0 ? extractReply(input, reply => {
      reply.questions = [{ questionId: "Q1", status: "needs_followup" }, { questionId: "Q2", status: "evidence_found" }, { questionId: "Q3", status: "no_verified_evidence" }];
      reply.quotes = [{ quote: good(input), questionIds: ["Q1", "Q3"], note: `bad ${NUL} note` }, { quote: "Invented evidence that never occurred in the supplied source.", questionIds: ["Q2"] }];
      reply.conflicts = [{ questionIds: ["Q1"], note: "first attempt conflict" }, { questionIds: ["Q9"], note: "unknown" }];
    }) : threeQuestions(stage, input, n, system));
    const result = await run(m); expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    // quotesDropped keeps its meaning: it still counts the failing quote of the needs-follow-up reply, as before 7a.1.
    expect(result.summary.stages[2]).toMatchObject({ calls: 3, invalidReplies: 1, repairCalls: 1, quotesDropped: 1, conflictsDropped: 0, notesDropped: 0,
      questionsDowngraded: 0, questionsUpgraded: 0, conflictsNoted: 0, quotesVerified: 2, quotesMerged: 0 });
    expect(parsed(result, RESEARCH_FILES.evidence).conflicts).toEqual([]);
    // That reply's attempt is needs_followup, not invalid, so its repair says so (before 7a.1 the failing quote made it invalid).
    expect(m.calls.filter(c => c.stage === "extract").map(c => c.input.repairReason)).toEqual([null, null, "previous_needs_followup; return compact COMPLETE JSON for every question"]);
    expect(parsed(result, RESEARCH_FILES.coverage).chunks[0].attempts.map((a: any) => a.status)).toEqual(["needs_followup", "complete"]);
  });
  it("counts a quote merged into an identical one from an overlapping chunk apart from the drops", async () => {
    const lines = Array.from({ length: 1100 }, (_, i) => `Line ${String(i).padStart(4, "0")} records a distinct synthetic observation for the survey.`);
    const source = { id: "input/long.md", path: "input/long.md", bytes: Buffer.from(lines.join("\n")) }, chunks = inventoryResearchSources([source]).chunks;
    expect(chunks).toHaveLength(2);
    const shared = lines.find(line => { const at = source.bytes.indexOf(line); return at >= chunks[1]!.startByte && at + Buffer.byteLength(line) <= chunks[0]!.endByte; })!;
    const m = models((stage, input, n, system) => stage === "extract" ? extractReply(input, reply => { reply.quotes = [{ quote: shared, questionIds: ["Q1"] }]; }) : happy(stage, input, n, system));
    const result = await run(m, { sources: [source] }); expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(result.summary.stages[2]).toMatchObject({ quotesVerified: 1, quotesDropped: 1, quotesMerged: 1 });
    expect(parsed(result, RESEARCH_FILES.evidence).quotes[0].chunkIds).toEqual([chunks[0]!.id, chunks[1]!.id]);
  });
});

describe("E1 recoverability: the reading stage's recoveries and pinned limits at the pipeline (S3, S7)", () => {
  // S3 as bad content: each stage receives invalid JSON twice. The bad-body half runs on the real broker in
  // tests/unit/private-agent-research-recoverability.test.ts.
  it("invalid JSON twice at the index: the batch's sources fall back to their literal cards, and the stage still reaches a ready packet", async () => {
    const m = models((stage, input, n, system) => stage === "index" ? `not json ${n}` : happy(stage, input, n, system)), result = await run(m);
    expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(m.calls.map(c => c.stage)).toEqual(["index", "index", "plan", "extract", "extract", "synthesise"]);
    expect(m.calls.filter(c => c.stage === "index").map(c => c.input.repair)).toEqual([false, true]);
    expect(result.summary.stages[0]).toMatchObject({ calls: 2, invalidReplies: 2, initialCalls: 1, repairCalls: 1, invalidJsonReplies: 2, sourcesIndexed: 0, sourcesLiteralFallback: 2 });
    expect(parsed(result, RESEARCH_FILES.index).sources.map((s: any) => [s.modelStatus, s.metadataOrigin, s.modelAttempts])).toEqual([["unresolved", "host_literal", 2], ["unresolved", "host_literal", 2]]);
    validateReadyResearchPacket(result.files, { brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(), protocolSha256: researchProtocolSha256(), budget: RESEARCH_PIPELINE_BUDGET });
  });
  it("invalid JSON twice at extraction: the chunk's one repair fails too, so it stays invalid and the stage ends research_extraction_incomplete before any synthesis", async () => {
    const first = inventoryResearchSources(researchV4Sources()).chunks[0]!.id;
    const m = models((stage, input, n, system) => stage === "extract" && input.chunk.id === first ? `not json ${n}` : happy(stage, input, n, system)), result = await run(m);
    expect(result).toMatchObject({ status: "incomplete", reason: "research_extraction_incomplete" });
    expect(m.calls.filter(c => c.stage === "extract").map(c => [c.input.chunk.id === first, c.input.repairReason === null])).toEqual([[true, true], [false, true], [true, false]]);
    expect(m.calls.some(c => c.stage === "synthesise")).toBe(false); expect(result.summary.stages.map(s => s.stage)).toEqual(["index", "plan", "extract"]);
    expect(result.summary.stages[2]).toMatchObject({ calls: 3, invalidReplies: 2, initialCalls: 2, repairCalls: 1, chunksComplete: 1 });
    expect(parsed(result, RESEARCH_FILES.coverage).chunks.map((c: any) => [c.status, c.attempts.map((a: any) => a.status)])).toEqual([["invalid", ["invalid", "invalid"]], ["complete", ["complete"]]]);
    expect(result.files.some(f => f.path === RESEARCH_FILES.argument)).toBe(false);
  });
  it.each([["plan", "research_plan_invalid", ["index"]], ["synthesise", "research_synthesis_invalid", ["index", "plan", "extract", "extract"]]] as const)(
    "pins a limitation item 7c flips: invalid JSON twice at the %s ends the stage as %s, with no host fallback", async (stage, reason, before) => {
      const m = models((s, input, n, system) => s === stage ? `not json ${n}` : happy(s, input, n, system)), result = await run(m);
      expect(result).toMatchObject({ status: "incomplete", reason });
      expect(m.calls.map(c => c.stage)).toEqual([...before, stage, stage]);
      expect(result.summary.stages.at(-1)).toMatchObject({ stage, calls: 2, invalidReplies: 2 });
      expect(result.files.some(f => f.path === (stage === "plan" ? RESEARCH_FILES.plan : RESEARCH_FILES.argument))).toBe(false);
    });

  // S7: corpora at E3's scale, with invented sizes (tests/helpers/research-corpus.ts). These prove admission and completion at that scale,
  // not a retry: gate clause 2's cases are the split arm's 529 case (private-agent-research-recoverability.test.ts) and E1-T3's retried calls.
  const totalBytes = (sources: { bytes: Buffer }[]) => sources.reduce((sum, source) => sum + source.bytes.length, 0);
  const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
  it.each([["an f2-shaped corpus of 21 sources", "f2", F2_SHAPE_KIB, 7, false],
    ["a web-shaped corpus of 25 sources over 20 KiB (refused at admission before 7b.1, D8)", "web", Array<number>(24).fill(20.5), 9, true]] as const)(
    "%s, about 512 KiB of invented text, reaches a ready packet: each batch indexed once and each chunk extracted once (S7)", async (_name, label, sizes, batches, boundary) => {
      // The web-shaped corpus's 25th source is the boundary source: its 20 KiB preview limit falls inside an em dash.
      const sources = [...inventedCorpus(label, sizes), ...(boundary ? [previewBoundarySource(`input/${label}-boundary.md`)] : [])];
      expect(totalBytes(sources)).toBeGreaterThan(500 * 1024); expect(totalBytes(sources)).toBeLessThan(520 * 1024);
      expect(Math.max(...sources.map(s => s.bytes.length))).toBeLessThan(64 * 1024);
      const m = models(), result = await run(m, { sources });
      expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
      expect(result.summary.stages.map(s => [s.stage, s.calls, s.invalidReplies])).toEqual([["index", batches, 0], ["plan", 1, 0], ["extract", sources.length, 0], ["synthesise", 1, 0]]);
      const previews = m.calls.filter(c => c.stage === "index").flatMap(c => c.input.sources as { id: string; bytes: number; previewTruncated: boolean; text: string }[]);
      expect(previews.map(p => p.id)).toEqual(sources.map(s => s.id));
      // Each preview is at most 20 KiB and a prefix of its source, never a replacement character; the boundary source's stops one byte short.
      for (const p of previews) {
        expect(Buffer.byteLength(p.text)).toBeLessThanOrEqual(20 * 1024); expect(p.text).not.toContain(REPLACEMENT_CHARACTER);
        expect(sources.find(s => s.id === p.id)!.bytes.toString("utf8").startsWith(p.text)).toBe(true);
      }
      if (boundary) { const cut = previews.find(p => p.id === `input/${label}-boundary.md`)!; expect([Buffer.byteLength(cut.text), cut.previewTruncated]).toEqual([20 * 1024 - 1, true]); }
      expect(m.calls.filter(c => c.stage === "extract").map(c => c.input.source.id)).toEqual(sources.map(s => s.id));
      const packet = validateReadyResearchPacket(result.files, { brief: RESEARCH_V4_TEST_BRIEF, sources, protocolSha256: researchProtocolSha256(), budget: RESEARCH_PIPELINE_BUDGET });
      expect(packet.evidence.quotes).toHaveLength(sources.length);
    });
  it("pins D8's 40-chunk ceiling, which no PR in this program lifts: 40 pages (about 511 KiB) complete and 41 pages (about 515 KiB) are refused before any request", async () => {
    // 7b.1 removed the batch refusal (25 or more sources over 20 KiB, above), so the extraction budget's 40 calls are the ceiling that remains.
    // The 7(b) mapping: card-derived ceilings (7b.3) only tighten admission, and raising this one needs item 12's own web request pool.
    const admitted = inventedCorpus("page", Array<number>(40).fill(12.75)), refused = inventedCorpus("page", Array<number>(41).fill(12.5));
    for (const sources of [admitted, refused]) {
      expect(totalBytes(sources)).toBeGreaterThan(500 * 1024); expect(totalBytes(sources)).toBeLessThan(520 * 1024); expect(planResearchIndexBatches(sources)).toHaveLength(14);
    }
    expect([inventoryResearchSources(admitted).chunks.length, inventoryResearchSources(refused).chunks.length]).toEqual([40, 41]);
    const fits = models(), done = await run(fits, { sources: admitted });
    expect(done).toMatchObject({ status: "completed", reason: "research_packet_ready" }); expect(fits.calls.filter(c => c.stage === "extract")).toHaveLength(40);
    const m = models(), events: ResearchStageCounts[] = [], result = await run(m, { sources: refused }, events);
    expect(result).toMatchObject({ status: "incomplete", reason: "research_mandatory_budget_exceeded" });
    expect(m.request).not.toHaveBeenCalled(); expect(events).toEqual([]);
    expect(result.files.map(f => f.path).sort()).toEqual([RESEARCH_FILES.coverage, RESEARCH_FILES.summary].sort());
  });
  it("pins a limitation item 7b.2 flips (D4): dense quotes at f2's scale overflow the 64 KiB packet, and the stage ends research_packet_cap_omission before synthesis", async () => {
    const sources = inventedCorpus("dense", F2_SHAPE_KIB);
    const note = "An invented note restating the quoted row for the planner's question; its relevance and truth still require an independent review.";
    const m = models((stage, input, n, system) => stage !== "extract" ? happy(stage, input, n, system) : JSON.stringify({ questions: input.plan.questions.map((q: any) => ({ questionId: q.id, status: "evidence_found" })),
      quotes: String(input.chunk.text).split("\n").filter((line: string) => !line.startsWith("#")).slice(0, 12).map((quote: string) => ({ quote, questionIds: ["Q1"], note })), conflicts: [] }));
    const result = await run(m, { sources }), row = result.summary.stages[2]!, coverage = parsed(result, RESEARCH_FILES.coverage);
    expect(result).toMatchObject({ status: "incomplete", reason: "research_packet_cap_omission" });
    expect(row).toMatchObject({ stage: "extract", calls: 21, invalidReplies: 0, quotesDropped: 0, quotesVerified: 252 });
    expect(row.quotesLeftByCap).toBeGreaterThan(0); expect(row.quotesInPacket! + row.quotesLeftByCap!).toBe(252); expect(row.packetBytes).toBeLessThanOrEqual(64 * 1024);
    expect(coverage.omissions).toHaveLength(row.quotesLeftByCap!); expect(coverage.omissions.every((o: any) => o.reason === "packet_cap")).toBe(true);
    expect(m.calls.some(c => c.stage === "synthesise")).toBe(false);
  });
});
