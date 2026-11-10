import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BrokerError, type PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { EXTRACT_SYSTEM, RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET, SYNTHESIS_SYSTEM, normalizeQuoteText, locateQuote, parseJsonReply, researchExtractionUserContent, researchProtocolSha256, researchSourceText, runResearchPipeline, stripUnknownCitations, type ResearchDiagnostic, type ResearchStageCounts } from "../../src/main/private-agent/research-pipeline";
import { planResearchIndexBatches, researchWordCount } from "../../src/main/private-agent/research-admission";
import { RESEARCH_FALLBACK_POLICY, hostFallbackPlan, hostSkeletonSynthesis } from "../../src/main/private-agent/research-fallback";
import type { ResearchAssistFiring, ResearchAssistOutcome, ResearchAssistPlanRequest, ResearchAssistSynthesisRequest, ResearchAssists } from "../../src/main/private-agent/research-assist-contract";
import { PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE } from "../../src/main/private-agent/dispatch-purposes";
import { ResearchSynthesisAttemptSchema, inventoryResearchSources, validateReadyResearchPacket } from "../../src/main/private-agent/research-coverage";
import { ResearchPlanAttemptSchema, ResearchPlanSchema } from "../../src/main/private-agent/research-plan";
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
  "lengthCapWords", "briefWordLimit", "argumentWords",
  // 7a.1 (BL-20261109-0447): what a kept extraction reply lost or had corrected, and the accepted argument's rewritten headings; all counts.
  "conflictsDropped", "notesDropped", "questionsDowngraded", "questionsUpgraded", "headingsNormalised", "quotesMerged",
  // 7(c) (BL-20261110-0717): a stage's host fallback (a fixed code) and the synthesis attempts (schema-validated records).
  "fallback", "synthesisAttempts"]);
const hashOnlyStageRow = (stage: ResearchStageCounts) => {
  for (const [key, value] of Object.entries(stage)) {
    expect(DOCUMENTED_STAGE_KEYS.has(key)).toBe(true);
    if (key === "stage" || key === "denied") expect(value).toMatch(/^[a-z_]+$/u);
    else if (key === "fallback") expect(value).toBe(stage.stage === "plan" ? "host_plan" : "skeleton");
    else if (key === "synthesisAttempts") for (const attempt of value as unknown[]) expect(() => ResearchSynthesisAttemptSchema.parse(attempt)).not.toThrow();
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
    expect(JSON.stringify(events)).not.toContain("orchard"); expect(packet.summary.version).toBe(5); expect(packet.coverage.fallbacks).toEqual({ plan: "none", synthesis: "none" });
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
  it("falls back to the host skeleton when both synthesis attempts truncate (7c), keeping neither reply's text", async () => {
    const m = models((stage, input, n, system) => ({ content: happy(stage, input, n, system), truncated: stage === "synthesise" }));
    const result = await run(m); expect(result).toMatchObject({ reason: "research_packet_ready", status: "completed" });
    const argument = result.files.find(f => f.path === RESEARCH_FILES.argument)!.bytes.toString("utf8");
    expect(argument).toBe(hostSkeletonSynthesis(parsed(result, RESEARCH_FILES.plan), parsed(result, RESEARCH_FILES.evidence)).argument);
    expect(argument).not.toContain("bounded synthetic finding");
    expect(result.summary.stages[3]).toMatchObject({ calls: 2, invalidReplies: 2, truncatedReplies: 2, fallback: "skeleton" });
    expect(parsed(result, RESEARCH_FILES.coverage)).toMatchObject({ fallbacks: { plan: "none", synthesis: "skeleton" }, synthesis: { status: "skeleton" } });
  });
  it("rejects unknown citations and missing required sections without stripping an unsupported claim, then falls back to the skeleton (7c)", async () => {
    for (const defect of ["citation", "section"]) {
      const m = models((stage, input, n, system) => { const reply = JSON.parse(happy(stage, input, n, system)); if (stage === "synthesise") reply.argument = defect === "citation" ? reply.argument + " Extra [E999]." : "Nonempty narrative [E1]."; return JSON.stringify(reply); });
      const result = await run(m); expect([defect, result.reason]).toEqual([defect, "research_packet_ready"]); expect(m.calls.filter(c => c.stage === "synthesise")).toHaveLength(2);
      const argument = result.files.find(f => f.path === RESEARCH_FILES.argument)!.bytes.toString("utf8");
      expect(argument).not.toContain("E999"); expect(argument).not.toContain("Nonempty narrative"); expect(result.summary.stages[3]!.fallback).toBe("skeleton");
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
  it("leaves a plan reply it cannot encode out of the repair context (7c), so the repair still runs instead of the stage ending", async () => {
    const m = models((stage, input, n, system) => stage === "plan" && n === 0 ? "{\u0000 not a plan" : happy(stage, input, n, system));
    const result = await run(m); expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(m.calls.filter(c => c.stage === "plan")).toHaveLength(2);
    expect(m.calls.filter(c => c.stage === "plan")[1]!.input.repair.previousReply).toMatchObject({ omissionReason: "previous_reply_not_encodable" });
    expect("content" in m.calls.filter(c => c.stage === "plan")[1]!.input.repair.previousReply).toBe(false);
    expect(result.summary.stages[1]!.planAttempts!.map(a => [a.accepted, a.repairContext])).toEqual([[false, "omitted_unencodable"], [true, "not_used"]]);
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
      // 7c: both rejected attempts now end in the host skeleton rather than an incomplete run.
      expect([label, result.reason, m.calls.filter(c => c.stage === "synthesise").length, result.summary.stages[3]!.fallback]).toEqual([label, "research_packet_ready", 2, "skeleton"]);
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

describe("backlog item 7(c): research v5 slots, the assist hook and the host fallbacks (BL-20261110-0717)", () => {
  const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const aliases = Object.freeze({ S1: "input/corpus/alpha.md", S2: "input/corpus/beta.md" });
  type Kind = "accepted" | "rejected" | "skipped" | "failed" | "refused" | "stop";
  const KINDS: Kind[] = ["accepted", "rejected", "skipped", "failed", "refused", "stop"];
  const MATRIX = KINDS.flatMap(kind => (["local_first", "forced_split"] as const).map(firing => [firing, kind] as const));
  /** A fake hook standing in for item 10's wrapper: each touchpoint answers from its script and keeps a copy of every request it received. */
  function hook(firing: ResearchAssistFiring, plan?: (request: ResearchAssistPlanRequest, n: number) => ResearchAssistOutcome, synthesis?: (request: ResearchAssistSynthesisRequest, n: number) => ResearchAssistOutcome) {
    const seen: { plan: ResearchAssistPlanRequest[]; synthesis: ResearchAssistSynthesisRequest[] } = { plan: [], synthesis: [] };
    const assists: ResearchAssists = { firing,
      ...(plan ? { plan: async (request: ResearchAssistPlanRequest) => { seen.plan.push(structuredClone(request)); return plan(request, seen.plan.length - 1); } } : {}),
      ...(synthesis ? { synthesis: async (request: ResearchAssistSynthesisRequest) => { seen.synthesis.push(structuredClone(request)); return synthesis(request, seen.synthesis.length - 1); } } : {}) };
    return { assists, seen };
  }
  const noReply = (kind: Kind): ResearchAssistOutcome => kind === "stop" ? { kind: "stop", code: "assist_stop_fixture" } : { kind: "no_reply", outcome: kind as "skipped" | "failed" | "refused", code: `assist_${kind}_fixture` };
  /** A plan assist reply names sources by the opaque ids of its packet; `sourceAliases` maps them back. */
  const planBy = (kind: Kind) => (request: ResearchAssistPlanRequest): ResearchAssistOutcome => kind === "accepted"
    ? { kind: "reply", usage, truncated: false, sourceAliases: aliases, content: JSON.stringify({ version: 2, questions: [{ id: "Q1", text: "What does the supplied evidence establish?",
      requirementIds: request.units.map(unit => unit.id), sourceIds: ["S2", "S1"], lookFor: [] }] }) }
    : kind === "rejected" ? { kind: "reply", usage, truncated: false, content: "not a plan from the assist" } : noReply(kind);
  const goodSynthesis = (request: ResearchAssistSynthesisRequest) => researchV4Reply("You write", canonical({ evidence: request.evidence, plan: request.plan }));
  const synthesisBy = (kind: Kind) => (request: ResearchAssistSynthesisRequest): ResearchAssistOutcome => kind === "accepted"
    ? { kind: "reply", usage, truncated: false, evidenceIds: request.evidence.quotes.map(quote => quote.id), content: goodSynthesis(request) }
    : kind === "rejected" ? { kind: "reply", usage, truncated: false, content: "not a synthesis from the assist" } : noReply(kind);
  /** Stage models that reject every reply of one stage, so a local-first assist fires and the fallback is reachable. */
  const rejecting = (target: Stage) => models((stage, input, n, system) => stage === target ? `not a stage ${target} reply` : happy(stage, input, n, system));
  const sink = () => { const entries: ResearchDiagnostic[] = []; return { entries, diagnostics: { retain: (entry: ResearchDiagnostic) => { entries.push(entry); } } }; };
  const copy = (outcome: Awaited<ReturnType<typeof runResearchPipeline>>) => outcome.files.map(file => ({ path: file.path, bytes: Buffer.from(file.bytes) }));
  function edit(files: { path: string; bytes: Buffer }[], path: string, mutate: (value: any) => void) {
    const file = files.find(f => f.path === path)!, value = JSON.parse(file.bytes.toString()); mutate(value); file.bytes = Buffer.from(`${canonical(value)}\n`);
  }

  it.each(MATRIX)("schedules the plan assist under %s when it is %s: calls, attempts, repairs, fallback and the T1 request", async (firing, kind) => {
    const m = rejecting("plan"), h = hook(firing, planBy(kind)), events: ResearchStageCounts[] = [], s = sink();
    const result = await run(m, { assists: h.assists, diagnostics: s.diagnostics }, events);
    const stageRequests = m.calls.filter(c => c.stage === "plan");
    expect(h.seen.plan).toHaveLength(1);
    if (kind === "stop") {
      // The hook's stop ends the stage through denied(), with its code, exactly as a stage model's BrokerError does.
      expect(result).toMatchObject({ status: "incomplete", reason: "research_request_denied" });
      expect(events.at(-1)).toMatchObject({ stage: "plan", denied: "assist_stop_fixture", calls: firing === "forced_split" ? 0 : 2 });
      expect(stageRequests).toHaveLength(firing === "forced_split" ? 0 : 2); expect(m.calls.some(c => c.stage === "extract")).toBe(false);
      return;
    }
    expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    const stage = result.summary.stages[1]!, attempts = stage.planAttempts!, settledAssist = kind === "accepted" || kind === "rejected";
    const stageCount = firing === "forced_split" && kind === "accepted" ? 0 : 2;
    const slots = firing === "forced_split" ? [...(settledAssist ? ["assist"] : []), ...Array<string>(stageCount).fill("stage")] : ["stage", "stage", ...(settledAssist ? ["assist"] : [])];
    expect(stageRequests).toHaveLength(stageCount);
    expect(attempts.map(a => a.slot ?? "stage")).toEqual(slots); expect(attempts.map(a => a.ordinal)).toEqual(slots.map((_, i) => i + 1));
    expect(stage).toMatchObject({ calls: slots.length, invalidReplies: kind === "accepted" ? slots.length - 1 : slots.length });
    expect(stage.fallback).toBe(kind === "accepted" ? undefined : "host_plan");
    // A settled assist is one of the stage's calls, its usage summed with the stage's; a no_reply outcome is counted nowhere.
    expect(stage.usage.inputTokens).toBe(stageCount * 100 + (settledAssist ? usage.inputTokens : 0));
    const coverage = parsed(result, RESEARCH_FILES.coverage), plan = parsed(result, RESEARCH_FILES.plan);
    expect(coverage.version).toBe(2); expect(coverage.fallbacks).toEqual({ plan: kind === "accepted" ? "none" : "host_plan", synthesis: "none" });
    // An accepted assist plan is kept with its aliases translated to the real ids; otherwise the host fallback plan.
    if (kind === "accepted") expect(plan.questions[0].sourceIds).toEqual(["input/corpus/beta.md", "input/corpus/alpha.md"]);
    else expect(plan).toEqual(hostFallbackPlan(coverage.units));
    // Only a stage attempt followed by another stage attempt carries a repair; after an assist the first stage request starts fresh.
    expect(stageRequests.map(c => c.input.repair === null)).toEqual(stageRequests.map((_, i) => i === 0));
    expect(attempts.map(a => a.repairContext)).toEqual(slots.map((slot, i) => slot === "stage" && slots[i + 1] === "stage" ? "included" : "not_used"));
    // T1: the base fields and the earlier attempt records (codes and hashes), never a raw local reply.
    const request = h.seen.plan[0]!;
    expect(Object.keys(request).sort()).toEqual(["brief", "deadlineMs", "extractionCallBudget", "mandatorySourceChunks", "priorAttempts", "sourceIndex", "sourceTexts", "sources", "units"]);
    expect(request.priorAttempts).toEqual(firing === "forced_split" ? [] : attempts.slice(0, 2)); expect(JSON.stringify(request)).not.toContain("not a stage");
    expect(request).toMatchObject({ brief: RESEARCH_V4_TEST_BRIEF, extractionCallBudget: RESEARCH_PIPELINE_BUDGET.extractionCalls, sourceIndex: parsed(result, RESEARCH_FILES.index) });
    // No session deadline: the request carries NaN, which the real wrapper refuses as assist_deadline_missing (the contract requires one).
    expect(request.deadlineMs).toBeNaN();
    expect(request.sourceTexts).toEqual(researchV4Sources().map(source => source.bytes.toString()));
    // A rejected assist reply reaches the sink under its own purpose; the stage's replies under theirs.
    expect(s.entries.filter(e => e.stage === "plan").map(e => [e.ordinal, e.purpose])).toEqual(slots.flatMap((slot, i) => kind === "accepted" && slot === "assist" ? [] : [[i + 1, slot === "assist" ? PLAN_ASSIST_PURPOSE : "research plan"]]));
    hashOnlyStageRow(stage);
  });

  it.each(MATRIX)("schedules the synthesis assist under %s when it is %s: calls, attempts, fallback and the T2 request", async (firing, kind) => {
    const m = rejecting("synthesise"), h = hook(firing, undefined, synthesisBy(kind)), events: ResearchStageCounts[] = [], s = sink();
    const result = await run(m, { assists: h.assists, diagnostics: s.diagnostics }, events);
    const stageRequests = m.calls.filter(c => c.stage === "synthesise");
    expect(h.seen.synthesis).toHaveLength(1); expect(h.seen.plan).toHaveLength(0);
    if (kind === "stop") {
      expect(result).toMatchObject({ status: "incomplete", reason: "research_request_denied" });
      expect(events.at(-1)).toMatchObject({ stage: "synthesise", denied: "assist_stop_fixture", calls: firing === "forced_split" ? 0 : 2 });
      expect(stageRequests).toHaveLength(firing === "forced_split" ? 0 : 2);
      return;
    }
    expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    const stage = result.summary.stages[3]!, attempts = stage.synthesisAttempts!, settledAssist = kind === "accepted" || kind === "rejected";
    const stageCount = firing === "forced_split" && kind === "accepted" ? 0 : 2;
    const slots = firing === "forced_split" ? [...(settledAssist ? ["assist"] : []), ...Array<string>(stageCount).fill("stage")] : ["stage", "stage", ...(settledAssist ? ["assist"] : [])];
    expect(stageRequests).toHaveLength(stageCount);
    expect(attempts.map(a => [a.ordinal, a.slot ?? "stage", a.accepted, a.truncated])).toEqual(slots.map((slot, i) => [i + 1, slot, kind === "accepted" && slot === "assist", false]));
    expect(stage).toMatchObject({ calls: slots.length, invalidReplies: kind === "accepted" ? slots.length - 1 : slots.length });
    expect(stage.fallback).toBe(kind === "accepted" ? undefined : "skeleton");
    const coverage = parsed(result, RESEARCH_FILES.coverage), evidence = parsed(result, RESEARCH_FILES.evidence), plan = parsed(result, RESEARCH_FILES.plan);
    const argument = result.files.find(f => f.path === RESEARCH_FILES.argument)!.bytes.toString();
    expect(coverage.fallbacks).toEqual({ plan: "none", synthesis: kind === "accepted" ? "none" : "skeleton" });
    expect(coverage.synthesis.status).toBe(kind === "accepted" ? "complete" : "skeleton");
    if (kind !== "accepted") { const skeleton = hostSkeletonSynthesis(plan, evidence); expect(argument).toBe(skeleton.argument); expect(coverage.synthesis.questions).toEqual(skeleton.questions); }
    expect(stageRequests.map(c => c.input.repairReason === null)).toEqual(stageRequests.map((_, i) => i === 0));
    // T2: the base fields, the host-validated plan, the packet's evidence and coverage, and no raw local reply.
    const request = h.seen.synthesis[0]!;
    expect(Object.keys(request).sort()).toEqual(["brief", "coverage", "deadlineMs", "evidence", "plan", "retryAfterTruncation", "sourceIndex", "sourceTexts", "sources", "units"]);
    expect(request).toMatchObject({ plan, evidence, retryAfterTruncation: false }); expect(JSON.stringify(request)).not.toContain("not a stage");
    expect(s.entries.filter(e => e.stage === "synthesise").map(e => [e.ordinal, e.purpose])).toEqual(slots.flatMap((slot, i) => kind === "accepted" && slot === "assist" ? [] : [[i + 1, slot === "assist" ? SYNTHESIS_ASSIST_PURPOSE : "research synthesis"]]));
    hashOnlyStageRow(stage);
  });

  it("retries a truncated synthesis assist once, right after it, and never a third time", async () => {
    const truncated: ResearchAssistOutcome = { kind: "reply", usage, truncated: true, content: "{\"version\":1,\"argument\":\"cut" };
    for (const firing of ["local_first", "forced_split"] as const) {
      const m = rejecting("synthesise"), h = hook(firing, undefined, (request, n) => n === 0 ? truncated : synthesisBy("accepted")(request));
      const result = await run(m, { assists: h.assists }); expect(result.status).toBe("completed");
      const stage = result.summary.stages[3]!, slots = firing === "forced_split" ? ["assist", "assist_retry"] : ["stage", "stage", "assist", "assist_retry"];
      expect(h.seen.synthesis.map(r => r.retryAfterTruncation)).toEqual([false, true]);
      expect(stage.synthesisAttempts!.map(a => [a.slot ?? "stage", a.truncated, a.accepted])).toEqual(slots.map((slot, i) => [slot, slot === "assist", i === slots.length - 1]));
      expect(stage).toMatchObject({ calls: slots.length, invalidReplies: slots.length - 1, truncatedReplies: 1 }); expect(stage.fallback).toBeUndefined();
      expect(m.calls.filter(c => c.stage === "synthesise")).toHaveLength(firing === "forced_split" ? 0 : 2);
    }
    // A truncated retry ends the assist: no third assist call; under the forced split the stage attempts follow, then the skeleton.
    const m = rejecting("synthesise"), h = hook("forced_split", undefined, () => truncated), result = await run(m, { assists: h.assists });
    expect(result.status).toBe("completed"); expect(h.seen.synthesis).toHaveLength(2);
    expect(result.summary.stages[3]!.synthesisAttempts!.map(a => a.slot ?? "stage")).toEqual(["assist", "assist_retry", "stage", "stage"]);
    expect(result.summary.stages[3]).toMatchObject({ calls: 4, invalidReplies: 4, truncatedReplies: 2, fallback: "skeleton" });
    // A rejected assist reply that was not truncated gets no retry.
    const once = hook("local_first", undefined, synthesisBy("rejected")); await run(rejecting("synthesise"), { assists: once.assists }); expect(once.seen.synthesis).toHaveLength(1);
  });

  it("lets a synthesis assist cite only the evidence ids its packet carried", async () => {
    const s = sink(), h = hook("forced_split", undefined, request => ({ kind: "reply", usage, truncated: false, evidenceIds: [], content: goodSynthesis(request) }));
    const result = await run(rejecting("synthesise"), { assists: h.assists, diagnostics: s.diagnostics });
    expect(result.summary.stages[3]).toMatchObject({ calls: 3, invalidReplies: 3, fallback: "skeleton" });
    const assist = s.entries.find(e => e.purpose === SYNTHESIS_ASSIST_PURPOSE)!;
    expect(assist.reasons.map(r => r.code)).toEqual(expect.arrayContaining(["unknown_evidence_id", "unknown_citation"]));
    // The same reply from the stage model, which may cite the whole packet, is accepted.
    const local = await run(models()); expect(local.summary.stages[3]!.synthesisAttempts!.map(a => a.accepted)).toEqual([true]);
  });

  it("makes no third plan request and no assist without a hook, or with a hook that has no plan touchpoint, and keeps the request bytes", async () => {
    const bare = rejecting("plan"), result = await run(bare);
    expect(bare.calls.filter(c => c.stage === "plan")).toHaveLength(RESEARCH_PIPELINE_BUDGET.plannerCalls);
    expect(result.summary.stages[1]).toMatchObject({ calls: 2, invalidReplies: 2, fallback: "host_plan" });
    for (const firing of ["local_first", "forced_split"] as const) {
      const m = rejecting("plan"), h = hook(firing, undefined, synthesisBy("accepted")); await run(m, { assists: h.assists });
      expect(m.calls.filter(c => c.stage === "plan").map(c => c.body)).toEqual(bare.calls.filter(c => c.stage === "plan").map(c => c.body));
    }
    // With a hook whose assist gave no reply, the stage requests are byte-identical to a run without a hook, under either firing.
    for (const firing of ["local_first", "forced_split"] as const) {
      const m = rejecting("plan"), h = hook(firing, planBy("skipped")); await run(m, { assists: h.assists });
      expect(m.calls.filter(c => c.stage === "plan").map(c => c.body)).toEqual(bare.calls.filter(c => c.stage === "plan").map(c => c.body));
    }
    // Synthesis requests differ from 7a.1's only by coverage: its version, `fallbacks` and the protocol hash.
    const clean = models(); await run(clean); const synthesis = clean.calls.find(c => c.stage === "synthesise")!.input;
    expect(Object.keys(synthesis)).toEqual(["brief", "coverage", "evidence", "lengthCap", "plan", "repairReason", "units"]);
    expect(synthesis.coverage).toMatchObject({ version: 2, fallbacks: { plan: "none", synthesis: "none" }, protocolSha256: RESEARCH_PROTOCOL_SHA256 });
    // With coverage put back in 7a.1's shape (version 1, no fallbacks, 7a.1's protocol), the request is 7a.1's byte for byte
    // (captured at #76's head 2fe1ec8, whose protocol is 05f342b2...).
    const v4 = JSON.parse(clean.calls.find(c => c.stage === "synthesise")!.body.messages[1].content as string);
    v4.coverage.version = 1; delete v4.coverage.fallbacks; v4.coverage.protocolSha256 = "05f342b25f3483574cca4f1bad53468219e63e94578927c069a8c831289e93a8";
    expect(digest(canonical(v4))).toBe("03bdfb5e0fc7a0b178c5b743a5b9035fb0fdd8838f53dc701989eb35a38fce6e");
    // A local-first hook is never asked while the stages accept, and every request is the one a run without a hook sends.
    const quiet = hook("local_first", planBy("accepted"), synthesisBy("accepted")), hooked = models(); await run(hooked, { assists: quiet.assists });
    expect(quiet.seen.plan.length + quiet.seen.synthesis.length).toBe(0); expect(hooked.calls.map(c => c.body)).toEqual(clean.calls.map(c => c.body));
    // After a rejected assist, the first stage request carries no trace of it: the plan request is the one pinned before 7b.1,
    // and the synthesis request is a first attempt's (its coverage still "pending").
    const split = rejecting("plan"), splitHook = hook("forced_split", planBy("rejected"), synthesisBy("rejected")); await run(split, { assists: splitHook.assists });
    expect(digest(split.calls.find(c => c.stage === "plan")!.body.messages[1].content as string)).toBe("db70bd30a913d4433bb9e89cff8e3fc24e8a030d89eae13d4d478ee072e1b927");
    expect(split.calls.find(c => c.stage === "synthesise")!.body).toEqual(bare.calls.find(c => c.stage === "synthesise")!.body);
  });

  it("never completes a fallback after a cancel: a cancel between the last rejected reply and the fallback ends the stage as call() would", async () => {
    for (const stage of ["plan", "synthesise"] as const) {
      const controller = new AbortController(), events: ResearchStageCounts[] = [];
      const diagnostics = { retain: (entry: ResearchDiagnostic) => { if (entry.stage === stage && entry.ordinal === 2) controller.abort(); } };
      const m = rejecting(stage), result = await run(m, { signal: controller.signal, diagnostics }, events);
      expect(result).toMatchObject({ status: "incomplete", reason: "research_cancelled" });
      expect(events.at(-1)).toMatchObject({ stage, calls: 2, invalidReplies: 2, denied: "cancelled" }); expect(events.at(-1)!.fallback).toBeUndefined();
      // With a hook, the cancel also refuses the assist before it is asked.
      const again = new AbortController(), h = hook("local_first", planBy("accepted"), synthesisBy("accepted"));
      const withHook = await run(rejecting(stage), { signal: again.signal, assists: h.assists, diagnostics: { retain: entry => { if (entry.stage === stage && entry.ordinal === 2) again.abort(); } } });
      expect(withHook).toMatchObject({ status: "incomplete", reason: "research_cancelled" }); expect(h.seen.plan.length + h.seen.synthesis.length).toBe(stage === "plan" ? 0 : 0);
    }
  });

  it("ends the stage with a fixed code when the hook throws, returns a malformed outcome or stops with a code that is not one, and never lets an alias binding escape", async () => {
    const cases: [string, (request: ResearchAssistPlanRequest) => ResearchAssistOutcome][] = [
      ["assist_hook_failed", () => { throw new Error("A message that must not reach a row"); }],
      ["assist_outcome_invalid", () => ({ kind: "reply", content: 42, usage, truncated: false }) as unknown as ResearchAssistOutcome],
      ["assist_outcome_invalid", () => ({ kind: "reply", content: "{}", usage: { ...usage, inputTokens: -1 }, truncated: false })],
      ["assist_outcome_invalid", () => ({ kind: "maybe" }) as unknown as ResearchAssistOutcome],
      ["assist_stop_code_invalid", () => ({ kind: "stop", code: "A free-text reason" })],
      ["research_plan_alias_binding", request => ({ ...(planBy("accepted")(request) as Extract<ResearchAssistOutcome, { kind: "reply" }>), sourceAliases: { S1: "input/corpus/unknown.md" } })],
    ];
    for (const [code, answer] of cases) for (const firing of ["local_first", "forced_split"] as const) {
      const events: ResearchStageCounts[] = [], result = await run(rejecting("plan"), { assists: hook(firing, answer).assists }, events);
      expect(result).toMatchObject({ status: "incomplete", reason: "research_request_denied" });
      expect(events.at(-1)).toMatchObject({ stage: "plan", denied: code }); hashOnlyStageRow(events.at(-1)!);
    }
    const events: ResearchStageCounts[] = [];
    expect(await run(rejecting("synthesise"), { assists: hook("forced_split", undefined, () => { throw new Error("boom"); }).assists }, events)).toMatchObject({ reason: "research_request_denied" });
    expect(events.at(-1)).toMatchObject({ stage: "synthesise", calls: 0, denied: "assist_hook_failed" });
  });

  it("passes the session deadline to the hook, and gives the hook a copy it cannot write through", async () => {
    const h = hook("forced_split", request => { (request.units as unknown as { id: string }[]).length = 0; (request.priorAttempts as unknown[]).push("forged"); return planBy("skipped")(request); },
      request => { request.evidence.quotes.length = 0; (request.coverage as { status: string }).status = "ready"; return synthesisBy("skipped")(request); });
    // The fixture broker has no clock accessors, so the stage guards are stubbed to admit (as in the A8 test above).
    const m = models(); for (const model of Object.values(m.models)) vi.spyOn(model, "deadlineRefuses").mockReturnValue(false);
    const result = await run(m, { assists: h.assists, deadlineMs: Infinity });
    expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" }); expect(h.seen.plan[0]!.deadlineMs).toBe(Infinity);
    expect(parsed(result, RESEARCH_FILES.evidence).quotes.length).toBeGreaterThan(0);
  });

  it("follows a skipped T1 and a T2 that gives no reply with the stage's own calls, then the skeleton (the forced split's no-reply path)", async () => {
    const h = hook("forced_split", planBy("skipped"), () => ({ kind: "no_reply", outcome: "refused", code: "assist_slot_exhausted" }));
    const m = rejecting("synthesise"), result = await run(m, { assists: h.assists });
    expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(result.summary.stages[1]).toMatchObject({ calls: 1, invalidReplies: 0 }); expect(result.summary.stages[1]!.planAttempts!.map(a => a.slot ?? "stage")).toEqual(["stage"]);
    expect(result.summary.stages[3]).toMatchObject({ calls: 2, invalidReplies: 2, fallback: "skeleton" });
    expect(m.calls.filter(c => c.stage === "synthesise").map(c => c.input.repairReason === null)).toEqual([true, false]);
  });

  it("keeps the hook contract byte-identical to item 10's copy (feat/10a-assist-core d2ab888): a change there is mirrored here and re-pinned", () => {
    expect(digest(readFileSync(new URL("../../src/main/private-agent/research-assist-contract.ts", import.meta.url)))).toBe("9434ed064d9a292e5b7a73c403bb9a31c244ef731c9ab62a382857e6920b8780");
  });

  it("builds the host fallbacks from host data alone: contiguous unit groups, larger first, and a skeleton naming only ids", () => {
    const units = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `U${i + 1}` }));
    expect(hostFallbackPlan(units(1))).toEqual({ version: 2, questions: [{ id: "Q1", text: RESEARCH_FALLBACK_POLICY.plan.questionText.replace("{units}", "U1"), requirementIds: ["U1"], sourceIds: [] }] });
    expect(hostFallbackPlan(units(12)).questions.map(q => q.requirementIds.length)).toEqual(Array(12).fill(1));
    expect(hostFallbackPlan(units(14)).questions.map(q => q.requirementIds.join(","))).toEqual(["U1,U2", "U3,U4", ...Array.from({ length: 10 }, (_, i) => `U${i + 5}`)]);
    expect(hostFallbackPlan(units(25)).questions.map(q => q.requirementIds.length)).toEqual([3, ...Array(11).fill(2)]);
    expect(hostFallbackPlan(units(30)).questions[0]!.text).toBe("Host fallback question: what does the corpus establish for brief requirements U1, U2, U3?");
    // deriveBriefUnits yields at most 128 units: the largest fallback plan still parses, every text within 300 UTF-16 units.
    const largest = hostFallbackPlan(units(128)); expect(ResearchPlanSchema.parse(largest)).toEqual(largest);
    expect(largest.questions.map(q => q.requirementIds.length)).toEqual([...Array(8).fill(11), ...Array(4).fill(10)]); expect(Math.max(...largest.questions.map(q => q.text.length))).toBeLessThanOrEqual(300);
    expect(() => hostFallbackPlan([])).toThrow("research_fallback_plan_units");
    const plan = hostFallbackPlan(units(3)), evidence = { quotes: [{ id: "E1", questionIds: ["Q1", "Q3"] }, { id: "E2", questionIds: ["Q1"] }], conflicts: [{ questionIds: ["Q1"] }, { questionIds: ["Q1", "Q3"] }] };
    const skeleton = hostSkeletonSynthesis(plan, evidence);
    expect(skeleton.questions).toEqual([{ questionId: "Q1", disposition: "findings", evidenceIds: ["E1", "E2"] }, { questionId: "Q2", disposition: "unresolved", evidenceIds: [] }, { questionId: "Q3", disposition: "findings", evidenceIds: ["E1"] }]);
    expect(skeleton.argument).toBe([RESEARCH_FALLBACK_POLICY.skeleton.opening, "", "## Evidence by question", "", "- Q1: [E1][E2]", "- Q2: no verified evidence was extracted.", "- Q3: [E1]", "",
      "## Conflicting evidence", "", "- Q1: conflicts noted by the extractor: 2, listed in evidence.md.", "- Q3: conflicts noted by the extractor: 1, listed in evidence.md.", "", "## Unanswered questions", "", "- Q2", ""].join("\n"));
    expect(hostSkeletonSynthesis(plan, { quotes: [{ id: "E1", questionIds: ["Q1", "Q2", "Q3"] }], conflicts: [] }).argument).toContain("The extractor noted no conflict.\n\n## Unanswered questions\n\nNone: every question has verified evidence ids above.\n");
  });

  it("refuses every other forged stage record: early fallbacks, disagreeing markers, stray keys, lone retries and the synthesis-attempt forgeries", async () => {
    const reject = (files: { path: string; bytes: Buffer }[], code: string) => expect(() => validateReadyResearchPacket(files)).toThrow(code);
    const fallback = await run(models((stage, input, n, system) => stage === "plan" ? "not a plan" : stage === "synthesise" ? "not a synthesis" : happy(stage, input, n, system)));
    const normal = await run(models());
    let files = copy(fallback);
    // A fallback taken before every stage attempt was spent: one rejected attempt, then the marker.
    edit(files, RESEARCH_FILES.summary, s => { const row = s.stages[1]; row.planAttempts = row.planAttempts.slice(0, 1); row.planAttempts[0].repairContext = "not_used"; row.calls = 1; row.invalidReplies = 1; }); reject(files, "plan_attempts");
    files = copy(fallback); edit(files, RESEARCH_FILES.summary, s => { const row = s.stages[3]; row.synthesisAttempts = row.synthesisAttempts.slice(0, 1); row.calls = 1; row.invalidReplies = 1; }); reject(files, "synthesis_attempts");
    // The markers and coverage disagree, both ways, and the status disagrees with the marker.
    files = copy(fallback); edit(files, RESEARCH_FILES.summary, s => { delete s.stages[1].fallback; }); reject(files, "stage_success_contradiction");
    files = copy(fallback); edit(files, RESEARCH_FILES.coverage, c => { c.synthesis.status = "complete"; }); reject(files, "not_ready");
    files = copy(normal); edit(files, RESEARCH_FILES.coverage, c => { c.synthesis.status = "skeleton"; }); reject(files, "not_ready");
    // A marker on the wrong row or with the other stage's value, and attempt records on rows that do not own them.
    files = copy(normal); edit(files, RESEARCH_FILES.summary, s => { s.stages[2].fallback = "skeleton"; }); reject(files, "stage_keys");
    files = copy(fallback); edit(files, RESEARCH_FILES.summary, s => { s.stages[1].fallback = "skeleton"; }); reject(files, "stage_success_contradiction");
    files = copy(normal); edit(files, RESEARCH_FILES.summary, s => { s.stages[0].planAttempts = s.stages[1].planAttempts; }); reject(files, "stage_keys");
    files = copy(normal); edit(files, RESEARCH_FILES.summary, s => { s.stages[2].synthesisAttempts = s.stages[3].synthesisAttempts; }); reject(files, "stage_keys");
    // Under the default budget an assist after one stage attempt, alone or with its retry, is no schedule.
    const local = await run(rejecting("plan"), { assists: hook("local_first", planBy("accepted")).assists });
    files = copy(local); edit(files, RESEARCH_FILES.summary, s => { const row = s.stages[1]; row.planAttempts.splice(1, 1); row.planAttempts[0].repairContext = "not_used"; row.planAttempts[1].ordinal = 2; row.calls = 2; row.invalidReplies = 1; }); reject(files, "plan_attempts");
    const truncated: ResearchAssistOutcome = { kind: "reply", usage, truncated: true, content: "{" };
    const retried = await run(rejecting("synthesise"), { assists: hook("local_first", undefined, (request, n) => n === 0 ? truncated : synthesisBy("accepted")(request)).assists });
    files = copy(retried); edit(files, RESEARCH_FILES.summary, s => { const row = s.stages[3]; row.synthesisAttempts.splice(1, 1); row.synthesisAttempts.forEach((a: any, i: number) => { a.ordinal = i + 1; }); row.calls = 3; row.invalidReplies = 2; }); reject(files, "synthesis_attempts");
    // A lone retry fails closed with the gate's code, not a TypeError.
    files = copy(normal); edit(files, RESEARCH_FILES.summary, s => { s.stages[3].synthesisAttempts[0].slot = "assist_retry"; }); reject(files, "synthesis_attempts");
    // The synthesis-attempt set the plan attempts already have: missing, an ordinal gap, a count mismatch, accepted while truncated or not last, an unknown slot, an extra key.
    const synthesis = (mutate: (row: any) => void) => { const forged = copy(retried); edit(forged, RESEARCH_FILES.summary, s => mutate(s.stages[3])); return forged; };
    for (const forged of [synthesis(row => { delete row.synthesisAttempts; }), synthesis(row => { row.synthesisAttempts[2].ordinal = 4; }), synthesis(row => { row.calls = 3; }),
      synthesis(row => { row.invalidReplies = 2; }), synthesis(row => { row.truncatedReplies = 0; }), synthesis(row => { row.synthesisAttempts[3].truncated = true; row.truncatedReplies = 2; }),
      synthesis(row => { row.synthesisAttempts[2].accepted = true; }), synthesis(row => { row.synthesisAttempts[2].slot = "cloud"; }), synthesis(row => { row.synthesisAttempts[0].note = "x"; })])
      expect(() => validateReadyResearchPacket(forged)).toThrow(/synthesis_attempts|stage_success_contradiction/u);
    // Above the repair-context size limit only omitted_oversize is admitted; at or below it, included and omitted_unencodable both are.
    const repaired = await run(models((stage, input, n, system) => stage === "plan" && n === 0 ? "not a plan" : happy(stage, input, n, system)));
    files = copy(repaired); edit(files, RESEARCH_FILES.summary, s => { s.stages[1].planAttempts[0].repairContext = "omitted_unencodable"; }); expect(() => validateReadyResearchPacket(files)).not.toThrow();
    files = copy(repaired); edit(files, RESEARCH_FILES.summary, s => { s.stages[1].planAttempts[0].repairContext = "omitted_oversize"; }); reject(files, "plan_attempts");
    files = copy(repaired); edit(files, RESEARCH_FILES.summary, s => { s.stages[1].planAttempts[0].replyBytes = 70_000; s.stages[1].planAttempts[0].repairContext = "included"; }); reject(files, "plan_attempts");
  });

  it("leaves the skeleton's word count and heading count at zero, because no model wrote it", async () => {
    const fallback = await run(models((stage, input, n, system) => stage === "plan" ? "not a plan" : stage === "synthesise" ? "not a synthesis" : happy(stage, input, n, system)));
    expect(fallback.summary.stages[3]).toMatchObject({ fallback: "skeleton", argumentWords: 0, headingsNormalised: 0 });
    expect(fallback.summary.stages[3]!.argumentBytes).toBe(fallback.files.find(f => f.path === RESEARCH_FILES.argument)!.bytes.length);
  });

  it("refuses forged slot records and forged fallbacks at the ready gate", async () => {
    const fallback = await run(models((stage, input, n, system) => stage === "plan" ? "not a plan" : stage === "synthesise" ? "not a synthesis" : happy(stage, input, n, system)));
    expect(fallback.status).toBe("completed"); expect(() => validateReadyResearchPacket(copy(fallback))).not.toThrow();
    const reject = (files: { path: string; bytes: Buffer }[], code: string) => expect(() => validateReadyResearchPacket(files)).toThrow(code);
    // An altered host plan, an altered skeleton (its hash kept consistent), and altered skeleton dispositions.
    let files = copy(fallback); edit(files, RESEARCH_FILES.plan, p => { p.questions[0].text = "A planted question about the corpus."; }); reject(files, "fallback_plan");
    files = copy(fallback); const forged = Buffer.from(`${files.find(f => f.path === RESEARCH_FILES.argument)!.bytes.toString()}A planted finding.\n`);
    files.find(f => f.path === RESEARCH_FILES.argument)!.bytes = forged; edit(files, RESEARCH_FILES.coverage, c => { c.synthesis.argumentSha256 = digest(forged); }); reject(files, "fallback_skeleton");
    files = copy(fallback); edit(files, RESEARCH_FILES.coverage, c => { c.synthesis.questions[0].disposition = "unresolved"; c.synthesis.questions[0].evidenceIds = []; }); reject(files, "fallback_skeleton");
    // A marker on one side only, and a marker beside an accepted attempt.
    files = copy(fallback); edit(files, RESEARCH_FILES.coverage, c => { c.fallbacks.plan = "none"; }); reject(files, "fallback_marker");
    files = copy(fallback); edit(files, RESEARCH_FILES.coverage, c => { c.fallbacks.synthesis = "none"; }); reject(files, "not_ready");
    const normal = await run(models());
    files = copy(normal); edit(files, RESEARCH_FILES.coverage, c => { c.fallbacks.plan = "host_plan"; }); reject(files, "fallback_marker");
    files = copy(normal); edit(files, RESEARCH_FILES.summary, s => { s.stages[1].fallback = "host_plan"; }); reject(files, "stage_success_contradiction");
    files = copy(normal); edit(files, RESEARCH_FILES.summary, s => { s.stages[3].fallback = "skeleton"; }); reject(files, "stage_success_contradiction");
    files = copy(normal); edit(files, RESEARCH_FILES.summary, s => { s.stages[1].fallback = "other"; }); reject(files, "plan_attempts");
    // Assists out of order, three stage attempts, a retry without truncation, and a repair context before an assist.
    const local = await run(rejecting("plan"), { assists: hook("local_first", planBy("accepted")).assists });
    files = copy(local); edit(files, RESEARCH_FILES.summary, s => { const a = s.stages[1].planAttempts; a[1].slot = "assist"; delete a[2].slot; }); reject(files, "plan_attempts");
    files = copy(local); edit(files, RESEARCH_FILES.summary, s => { delete s.stages[1].planAttempts[2].slot; }); reject(files, "plan_attempts");
    files = copy(local); edit(files, RESEARCH_FILES.summary, s => { s.stages[1].planAttempts[1].repairContext = "included"; }); reject(files, "plan_attempts");
    expect(() => validateReadyResearchPacket(copy(local))).not.toThrow();
    const truncated: ResearchAssistOutcome = { kind: "reply", usage, truncated: true, content: "{" };
    const retried = await run(rejecting("synthesise"), { assists: hook("local_first", undefined, (request, n) => n === 0 ? truncated : synthesisBy("accepted")(request)).assists });
    expect(() => validateReadyResearchPacket(copy(retried))).not.toThrow();
    files = copy(retried); edit(files, RESEARCH_FILES.summary, s => { const a = s.stages[3].synthesisAttempts; a[1].slot = "assist"; a[2].slot = "assist_retry"; delete a[3].slot; }); reject(files, "synthesis_attempts");
    files = copy(retried); edit(files, RESEARCH_FILES.summary, s => { const a = s.stages[3].synthesisAttempts; delete a[2].slot; delete a[3].slot; }); reject(files, "synthesis_attempts");
    files = copy(retried); edit(files, RESEARCH_FILES.summary, s => { s.stages[3].synthesisAttempts[2].truncated = false; s.stages[3].truncatedReplies = 0; }); reject(files, "synthesis_attempts");
    files = copy(retried); edit(files, RESEARCH_FILES.summary, s => { const a = s.stages[3].synthesisAttempts; a.splice(3, 0, { ...a[1], ordinal: 4 }); a[4].ordinal = 5; s.stages[3].calls = 5; s.stages[3].invalidReplies = 4; }); reject(files, "stage_counts");
  });

  it("fixes two encoding defects already on main: an index field or a plan canonical() cannot encode is refused and repaired, never thrown at put()", async () => {
    const lone = String.fromCharCode(0xd800);
    // Index: the first batch reply titles one source with a lone surrogate; that row is schema-invalid and the source is repaired.
    const badIndex = (input: any) => JSON.stringify({ sources: input.sources.map((s: any, i: number) => ({ sourceId: s.id, title: i === 0 ? `Synthetic ${lone}` : "Synthetic source", gist: "A source for the supplied questions.", date: "", figures: [] })) });
    const repaired = await run(models((stage, input, n, system) => stage === "index" && n === 0 ? badIndex(input) : happy(stage, input, n, system)));
    expect(repaired).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(repaired.summary.stages[0]).toMatchObject({ calls: 2, invalidReplies: 1, sourcesModelRepaired: 1, sourcesIndexed: 2 });
    // When every reply holds it, the source keeps its literal card.
    const literal = await run(models((stage, input, n, system) => stage === "index" ? badIndex(input) : happy(stage, input, n, system)));
    expect(literal.status).toBe("completed"); expect(literal.summary.stages[0]).toMatchObject({ sourcesLiteralFallback: 1, sourcesIndexed: 1 });
    expect(parsed(literal, RESEARCH_FILES.index).sources.map((s: any) => [s.modelStatus, s.metadataOrigin])).toEqual([["unresolved", "host_literal"], ["model_complete", "model_summary"]]);
    // Plan: a schema-valid plan whose question text holds a lone surrogate is rejected at that field's path, then repaired.
    const badPlan = (input: any) => JSON.stringify({ version: 2, questions: [{ id: "Q1", text: `What does ${lone} establish?`, requirementIds: input.units.map((u: any) => u.id), sourceIds: [], lookFor: [] }] });
    const s = sink(), plan = await run(models((stage, input, n, system) => stage === "plan" && n === 0 ? badPlan(input) : happy(stage, input, n, system)), { diagnostics: s.diagnostics });
    expect(plan).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(plan.summary.stages[1]!.planAttempts!.map(a => [a.accepted, a.bindingInspection, a.repairContext, a.errors])).toEqual([
      [false, "not_run", "included", [{ code: "validation_failed", path: ["questions", 0, "text"] }]], [true, "completed", "not_used", []]]);
    expect(s.entries.find(e => e.stage === "plan")!.reasons).toEqual([{ code: "validation_failed", path: ["questions", 0, "text"] }]);
    // The same applies to every free-text plan field, each at its own path.
    const everywhere = (input: any) => JSON.stringify({ version: 2, questions: [{ id: "Q1", text: "ok", requirementIds: input.units.map((u: any) => u.id), sourceIds: [], lookFor: ["fine", `bad ${lone}`] }],
      conflictsToCheck: [`bad ${lone}`], deliverableNotes: `bad ${lone}` });
    const fields = await run(models((stage, input, n, system) => stage === "plan" && n === 0 ? everywhere(input) : happy(stage, input, n, system)));
    expect(fields.summary.stages[1]!.planAttempts![0]!.errors.map(e => e.path)).toEqual([["questions", 0, "lookFor", 1], ["conflictsToCheck", 0], ["deliverableNotes"]]);
    expect(fields.status).toBe("completed");
  });
});
