import { describe, expect, it, vi } from "vitest";
import { BrokerError, type PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { EXTRACT_SYSTEM, RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET, SYNTHESIS_SYSTEM, normalizeQuoteText, locateQuote, parseJsonReply, researchExtractionUserContent, researchProtocolSha256, researchSourceText, runResearchPipeline, stripUnknownCitations, type ResearchDiagnostic, type ResearchStageCounts } from "../../src/main/private-agent/research-pipeline";
import { planResearchIndexBatches, researchWordCount } from "../../src/main/private-agent/research-admission";
import { validateReadyResearchPacket } from "../../src/main/private-agent/research-coverage";
import { ResearchPlanAttemptSchema } from "../../src/main/private-agent/research-plan";
import { RESEARCH_PROTOCOL_SHA256 } from "../helpers/research-protocol-pin";
import { assertResearchUserLayout, parseResearchUserContent, researchV4Reply, researchV4Sources, RESEARCH_V4_TEST_BRIEF } from "../helpers/research-v4-fixture";

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
  "lengthCapWords", "briefWordLimit", "argumentWords"]);
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
  it("refuses out-of-source quotes and uses a settled repair without a blind transport replay", async () => {
    const m = models((stage, input, n, system) => { const reply = JSON.parse(happy(stage, input, n, system)); if (stage === "extract" && n === 0) reply.quotes[0].quote = "Invented evidence that never occurred in the supplied source."; return JSON.stringify(reply); });
    expect((await run(m)).status).toBe("completed"); expect(m.calls.filter(c => c.stage === "extract")).toHaveLength(3);
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
  /** Every stage rejects a reply once (bad JSON index, an oversize lookFor list, a truncated first chunk, an invented quote in the second, a synthesis with an unknown citation and a missing heading); the repairs are clean. */
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
    expect(result.summary.stages.map(s => [s.stage, s.calls, s.invalidReplies, s.truncatedReplies])).toEqual([["index", 2, 1, 0], ["plan", 2, 1, undefined], ["extract", 4, 2, 1], ["synthesise", 2, 1, undefined]]);  // the index row's zero comes from summarizeIndexEntries, as before
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
    // Newlines, and a U+2028 that JSON.stringify leaves raw, in the brief and in a source: canonical() escapes the newlines only.
    const brief = "Context line.\n1. Explain the orchard. \n2. Explain the meadow and its limits.\n";
    const sources = researchV4Sources(); sources[1] = { ...sources[1]!, bytes: Buffer.from("# Synthetic beta\nThe meadow recorded seven healthy trees  during the spring survey.\n") };
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
    expect(extracts.some(c => (c.body.messages[1].content as string).includes(" "))).toBe(true);
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
    const brief = "Describe the supplied synthetic observations and their limitations in at most 12 words.", events: ResearchStageCounts[] = [];
    const m = models(), result = await run(m, { brief }, events); expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(m.calls.find(c => c.stage === "synthesise")!.input.lengthCap).toEqual({ words: 12 });
    const row = result.summary.stages[3]!; expect(row).toMatchObject({ lengthCapWords: 12, briefWordLimit: 12 }); expect(row.argumentWords).toBeGreaterThan(12);
    for (const stage of [...events, ...result.summary.stages]) hashOnlyStageRow(stage);
    // A stated limit above the ceiling is clamped to it: the brief's limit wins only up to what the role allows.
    const above = models(); await run(above, { brief: "Describe the supplied synthetic observations in no more than 3,000 words." });
    expect(above.calls.find(c => c.stage === "synthesise")!.input.lengthCap).toEqual({ words: 1200 });
  });
});
