import { describe, expect, it, vi } from "vitest";
import { BrokerError, type PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET, normalizeQuoteText, locateQuote, parseJsonReply, researchProtocolSha256, researchSourceText, runResearchPipeline, stripUnknownCitations, type ResearchDiagnostic, type ResearchStageCounts } from "../../src/main/private-agent/research-pipeline";
import { validateReadyResearchPacket } from "../../src/main/private-agent/research-coverage";
import { ResearchPlanAttemptSchema } from "../../src/main/private-agent/research-plan";
import { researchV4Reply, researchV4Sources, RESEARCH_V4_TEST_BRIEF } from "../helpers/research-v4-fixture";

type Stage = "index" | "plan" | "extract" | "synthesise";
type Script = (stage: Stage, input: any, sequence: number, system: string) => string | { content: string; truncated: boolean } | Error;
function models(script?: Script) {
  const calls: { stage: Stage; input: any; body: any; purpose: string }[] = [];
  const request = vi.fn(async (input: { body: string; purpose: string }, settle: (bytes: Buffer) => number) => {
    const body = JSON.parse(input.body), system = body.messages[0].content as string, user = body.messages[1].content as string;
    const stage: Stage = system.startsWith("You index") ? "index" : system.startsWith("You plan") ? "plan" : system.startsWith("You extract") ? "extract" : "synthesise";
    const parsed = JSON.parse(user), output = script ? script(stage, parsed, calls.filter(c => c.stage === stage).length, system) : researchV4Reply(system, user);
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
  /**
   * The keys a stage row may carry: those ResearchStageCounts declares, plus the eight index counts summarizeIndexEntries has
   * always assigned onto the index row. A row with any other key would ship into summary.json (whose stage rows are passthrough
   * in the ready validator), the seed and the registry, so a new key is a conscious change here; and every value is a count, a
   * fixed code (stage, denied), the usage counts or the schema-validated plan attempts, never text.
   */
  const DOCUMENTED_STAGE_KEYS = new Set(["stage", "calls", "invalidReplies", "denied", "usage", "truncatedReplies", "sourcesIndexed", "sourcesSkipped", "batchesSkipped", "questions", "planAttempts",
    "pairsPlanned", "pairsExtracted", "quotesVerified", "quotesInPacket", "quotesLeftByCap", "quotesDropped", "conflictsNoted", "conflictsInPacket", "packetBytes", "citationsStripped", "argumentBytes",
    "initialCalls", "repairCalls", "sourcesListed", "sourcesModelComplete", "sourcesLiteralFallback", "unresolvedModelSummaries", "chunksPlanned", "chunksComplete",
    "sourcesModelRepaired", "sourcesModelUnattempted", "invalidJsonReplies", "invalidSchemaReplies", "unexpectedRows", "duplicateExpectedIds", "missingSources", "emptyGists"]);
  const hashOnlyStageRow = (stage: ResearchStageCounts) => {
    for (const [key, value] of Object.entries(stage)) {
      expect(DOCUMENTED_STAGE_KEYS.has(key)).toBe(true);
      if (key === "stage" || key === "denied") expect(value).toMatch(/^[a-z_]+$/u);
      else if (key === "usage") expect(Object.values(value as object).every(n => typeof n === "number")).toBe(true);
      else if (key === "planAttempts") for (const attempt of value as unknown[]) expect(() => ResearchPlanAttemptSchema.parse(attempt)).not.toThrow();
      else expect(typeof value).toBe("number");
    }
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
  it("keeps the frozen research protocol unchanged: the sink is no part of it (the value at backlog item 4's base commit)", () => {
    expect(researchProtocolSha256()).toBe("3453710315d7226ea4d6195ec7401d000f86c5b0d9afa9839a801d5c6d391262");
  });
});
