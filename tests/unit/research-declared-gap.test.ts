import { describe, expect, it } from "vitest";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import type { ResearchAdmissionRates } from "../../src/main/private-agent/research-admission";
import { RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET } from "../../src/main/private-agent/research-contract";
import { inventoryResearchSources, validateReadyResearchPacket } from "../../src/main/private-agent/research-coverage";
import { runResearchPipeline } from "../../src/main/private-agent/research-pipeline";
import { buildResearchPresentation } from "../../src/main/private-agent/research-presentation";
import { hostFlagIssues } from "../../src/main/general-tasks/controller";
import { parseResearchUserContent, researchV4Reply, researchV4Sources, RESEARCH_V4_TEST_BRIEF } from "../helpers/research-v4-fixture";

/**
 * The owner's answer of 2026-11-18 (#166): a research packet may stand with ONE disclosed chunk whose last reply, after every repair,
 * declared questions unresolved (needs_followup). Each of the four points the answer fixes is pinned here: (1) one such chunk ends
 * ready, (2) disclosed in coverage, in the writer's presentation and in the report's host flags, (3) an invalid, truncated or denied chunk,
 * or a second unresolved one, still ends the stage, and (4) the repairs run exactly as before the gap is decided.
 */
type Stage = "index" | "plan" | "extract" | "synthesise";
type Script = (stage: Stage, input: any, n: number, system: string) => string | Error;
const sources = researchV4Sources(), chunkIds = inventoryResearchSources(sources).chunks.map(chunk => chunk.id);
/** Two questions, so a gap's declared question and its other one can be told apart; every requirement unit is covered by each. */
function plan(input: any) {
  const ids = input.sourceIndex.sources.map((s: any) => s.sourceId);
  return JSON.stringify({ version: 2, questions: ["Q1", "Q2"].map(id => ({ id, text: `What does the supplied evidence establish (${id})?`, requirementIds: input.units.map((u: any) => u.id),
    sourceIds: ids, lookFor: [] })), conflictsToCheck: [], deliverableNotes: "Distinguish evidence from uncertainty." });
}
/** The test corpus's quotable line of a chunk, as researchV4Reply picks it. */
const line = (input: any) => String(input.chunk.text).split("\n").map((s: string) => s.trim()).find((s: string) => !s.startsWith("#") && s.length >= 12)!;
const answered = (input: any) => JSON.stringify({ questions: ["Q1", "Q2"].map(questionId => ({ questionId, status: "evidence_found" })),
  quotes: [{ quote: line(input), questionIds: ["Q1", "Q2"], note: "" }], conflicts: [] });
/** A reply the stage refuses as needs_followup: Q1 is declared unresolved, while Q2 is answered with a quote the stage never keeps. */
const unresolved = (input: any) => JSON.stringify({ questions: [{ questionId: "Q1", status: "needs_followup" }, { questionId: "Q2", status: "evidence_found" }],
  quotes: [{ quote: line(input), questionIds: ["Q2"], note: "" }], conflicts: [] });

function models(script: Script) {
  const calls: { stage: Stage; chunk?: string; purpose: string }[] = [];
  const request = async (input: { body: string; purpose: string }, settle: (bytes: Buffer) => number) => {
    const body = JSON.parse(input.body), system = body.messages[0].content as string, user = body.messages[1].content as string, parsed = parseResearchUserContent(user);
    const stage: Stage = system.startsWith("You index") ? "index" : system.startsWith("You plan") ? "plan" : system.startsWith("You extract") ? "extract" : "synthesise";
    const output = script(stage, parsed, calls.filter(c => c.stage === stage && (stage !== "extract" || c.chunk === parsed.chunk?.id)).length, system);
    calls.push({ stage, chunk: parsed.chunk?.id, purpose: input.purpose });
    if (output instanceof Error) throw output;
    const truncated = output === "TRUNCATED", bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: truncated ? "" : output }, finish_reason: truncated ? "length" : "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    return { bytes, receipt: { feeMicrousd: settle(bytes) } };
  };
  const config = { destinationId: "owned", model: "Synthetic", maxOutputTokens: 16384, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium" as const };
  const make = () => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, "job", "reader");
  return { models: { reader: make(), planner: make(), synthesiser: make() }, calls };
}
/** Every stage as the happy fixture, except the plan's two questions and the extraction replies `extract` gives per chunk. */
const scripted = (extract: (chunk: number, attempt: number, input: any) => string | Error): Script => (stage, input, n, system) =>
  stage === "plan" ? plan(input) : stage === "extract" ? extract(chunkIds.indexOf(input.chunk.id), n, input) : researchV4Reply(system, JSON.stringify(input));
const rates: ResearchAdmissionRates = { prefillTokensPerSecond: { fastest: 4000, slowest: 2000 }, decodeTokensPerSecond: { fastest: 100, slowest: 50 },
  fanOutDecodeTokensPerSecond: { fastest: 100, slowest: 50 }, expectedOutputTokens: { plan: 1000, extract: 100, synthesis: 2000 } };
async function run(script: Script, extra: Partial<Parameters<typeof runResearchPipeline>[0]> = {}) {
  const m = models(script);
  const outcome = await runResearchPipeline({ brief: RESEARCH_V4_TEST_BRIEF, sources, models: m.models, signal: new AbortController().signal, record: () => undefined, ...extra });
  const file = (path: string) => JSON.parse(outcome.files.find(f => f.path === path)!.bytes.toString("utf8"));
  return { outcome, calls: m.calls, file, extractRow: outcome.summary.stages.find(row => row.stage === "extract")! as unknown as Record<string, unknown> };
}
const gapOnFirst = scripted((chunk, _attempt, input) => chunk === 0 ? unresolved(input) : answered(input));

describe("one declared gap: the owner's answer of 2026-11-18", () => {
  it("(1) ends ready when one chunk's last reply, after its repair, declares a question unresolved", async () => {
    const r = await run(gapOnFirst);
    expect([r.outcome.status, r.outcome.reason]).toEqual(["completed", "research_packet_ready"]);
    expect(r.file(RESEARCH_FILES.coverage).gaps).toEqual([{ chunkId: chunkIds[0], sourceId: sources[0]!.id, questionIds: ["Q1"], attempts: 2 }]);
    expect(r.extractRow).toMatchObject({ declaredGaps: 1, chunksComplete: chunkIds.length - 1, initialCalls: chunkIds.length, repairCalls: 1 });
    expect(() => validateReadyResearchPacket(r.outcome.files, { brief: RESEARCH_V4_TEST_BRIEF, sources })).not.toThrow();
  });

  it("(2) discloses the gap in coverage, in the writer's presentation and in the report's host flags, and gives the packet no evidence from it", async () => {
    const r = await run(gapOnFirst), coverage = r.file(RESEARCH_FILES.coverage), evidence = r.file(RESEARCH_FILES.evidence);
    const gap = coverage.chunks.find((c: any) => c.id === chunkIds[0]);
    expect([gap.status, gap.attempts.map((a: any) => a.status)]).toEqual(["needs_followup", ["needs_followup", "needs_followup"]]);
    // The declared question stays needs_followup; the other one has no verified evidence from this chunk, though the reply quoted for it.
    expect(gap.questions).toEqual([{ questionId: "Q1", status: "needs_followup", evidenceIds: [] }, { questionId: "Q2", status: "no_verified_evidence", evidenceIds: [] }]);
    expect(evidence.quotes.some((q: any) => q.chunkIds.includes(chunkIds[0]))).toBe(false);
    expect(evidence.quotes.length).toBeGreaterThan(0);
    const presentation = buildResearchPresentation(r.outcome.files, RESEARCH_V4_TEST_BRIEF, { sources });
    expect(presentation.rendered).toContain(JSON.stringify(canonical(coverage.gaps)).slice(1, -1));
    // The report's host flags, as the desktop renders them, with the gap's counts (host-flags.ts writes declaredGaps and gapQuestions).
    const event = { type: "host_flags", contextId: "c", version: 1, rules: {}, counts: {}, misses: { declaredGaps: 1, gapQuestions: 1 } };
    expect(hostFlagIssues([event as never], true)).toEqual(["One passage of the sources stayed unresolved after its repairs: the reader declared 1 research question unresolved there, and the packet holds no evidence from it."]);
    expect(hostFlagIssues([{ ...event, misses: { declaredGaps: 0, gapQuestions: 0 } } as never], true)).toEqual([]);
  });

  it("(3) still ends the stage for a second unresolved chunk, or for a chunk left invalid or truncated, alone or beside a gap", async () => {
    const cases: [string, (chunk: number, input: any) => string][] = [
      ["two unresolved", (_c, input) => unresolved(input)],
      ["one invalid", (c, input) => c === 0 ? "not json" : answered(input)],
      ["one truncated", (c, input) => c === 0 ? "TRUNCATED" : answered(input)],
      ["a gap and an invalid chunk", (c, input) => c === 0 ? unresolved(input) : "not json"]];
    for (const [name, extract] of cases) {
      const r = await run(scripted((chunk, _n, input) => extract(chunk, input)));
      expect({ name, status: r.outcome.status, reason: r.outcome.reason, gaps: r.file(RESEARCH_FILES.coverage).gaps ?? null, declared: r.extractRow.declaredGaps ?? null })
        .toEqual({ name, status: "incomplete", reason: "research_extraction_incomplete", gaps: null, declared: null });
    }
    // A denied repair call ends the stage as before, with no gap.
    const denied = await run(scripted((chunk, n, input) => chunk === 0 ? (n === 0 ? unresolved(input) : new Error("network_down")) : answered(input)));
    expect(denied.outcome.status).toBe("incomplete");
    expect(denied.outcome.reason).not.toBe("research_packet_ready");
    expect(denied.file(RESEARCH_FILES.coverage).gaps).toBeUndefined();
  });

  it("(4) runs every repair as before: under a card's rates the gap is what the second repair leaves, and a repaired chunk is no gap", async () => {
    const r = await run(gapOnFirst, { admission: rates });
    expect([r.outcome.status, r.outcome.reason]).toEqual(["completed", "research_packet_ready"]);
    expect(r.calls.filter(c => c.stage === "extract" && c.chunk === chunkIds[0]).length).toBe(3);
    expect(r.extractRow).toMatchObject({ repairCalls: 2, secondRepairCalls: 1, secondRepairsComplete: 0, declaredGaps: 1 });
    expect(r.file(RESEARCH_FILES.coverage).gaps).toEqual([{ chunkId: chunkIds[0], sourceId: sources[0]!.id, questionIds: ["Q1"], attempts: 3 }]);
    // The same chunk answered at its second repair: no gap, and the packet is ready as before.
    const saved = await run(scripted((chunk, n, input) => chunk === 0 && n < 2 ? unresolved(input) : answered(input)), { admission: rates });
    expect([saved.outcome.status, saved.file(RESEARCH_FILES.coverage).gaps, saved.extractRow.declaredGaps]).toEqual(["completed", undefined, undefined]);
    expect(saved.extractRow).toMatchObject({ secondRepairCalls: 1, secondRepairsComplete: 1 });
  });

  it("refuses at the ready gate a gap that is not its chunk's own, an unresolved outcome outside it, and a row that disagrees", async () => {
    const r = await run(gapOnFirst), base = r.outcome.files;
    const edit = (path: string, change: (value: any) => void) => base.map(f => {
      if (f.path !== path) return f;
      const value = JSON.parse(f.bytes.toString("utf8")); change(value); return { path: f.path, bytes: Buffer.from(`${canonical(value)}\n`) };
    });
    const refusal = (files: typeof base) => { try { validateReadyResearchPacket(files); return "accepted"; } catch (error) { return (error as Error).message; } };
    expect(refusal(base)).toBe("accepted");
    expect(refusal(edit(RESEARCH_FILES.coverage, c => { delete c.gaps; }))).toBe("research_packet_not_ready");
    expect(refusal(edit(RESEARCH_FILES.coverage, c => { c.gaps[0].questionIds = ["Q2"]; }))).toBe("research_packet_gap");
    expect(refusal(edit(RESEARCH_FILES.coverage, c => { c.gaps[0].attempts = 3; }))).toBe("research_packet_gap");
    expect(refusal(edit(RESEARCH_FILES.coverage, c => { c.gaps[0].chunkId = chunkIds[1]; }))).toBe("research_packet_gap");
    expect(refusal(edit(RESEARCH_FILES.coverage, c => { c.chunks[0].questions[1].status = "needs_followup"; }))).toBe("research_packet_gap");
    expect(refusal(edit(RESEARCH_FILES.coverage, c => { c.chunks[1].questions[0].status = "needs_followup"; c.chunks[1].questions[0].evidenceIds = []; }))).toBe("research_packet_question_outcome");
    expect(refusal(edit(RESEARCH_FILES.summary, s => { delete s.stages[2].declaredGaps; }))).toBe("research_packet_gap");
    // A ready packet without a gap whose row claims one.
    const plain = await run(scripted((_c, _n, input) => answered(input)));
    expect(refusal(plain.outcome.files)).toBe("accepted");
    expect(refusal(plain.outcome.files.map(f => f.path !== RESEARCH_FILES.summary ? f : { path: f.path,
      bytes: Buffer.from(`${canonical((v => { v.stages[2].declaredGaps = 1; return v; })(JSON.parse(f.bytes.toString("utf8"))))}\n`) }))).toBe("research_packet_gap");
  });

  it("records, under a card's rates, the held chunks and those left without their optional repair", async () => {
    // A held chunk: a complete first reply that marks Q1 evidence_found but quotes nothing locatable for it.
    const lost = (input: any) => JSON.stringify({ questions: [{ questionId: "Q1", status: "evidence_found" }, { questionId: "Q2", status: "evidence_found" }],
      quotes: [{ quote: "a sentence that is nowhere in the chunk at all", questionIds: ["Q1"], note: "" }, { quote: line(input), questionIds: ["Q2"], note: "" }], conflicts: [] });
    const r = await run(scripted((chunk, n, input) => chunk === 0 && n === 0 ? lost(input) : answered(input)), { admission: rates });
    expect(r.extractRow).toMatchObject({ heldChunks: 1, heldKeptUnrepaired: 0 });
    // The admission's one reserved repair goes to the other chunk's plain repair, which comes first, so the held chunk keeps its first reply.
    const tight = await run(scripted((chunk, n, input) => n === 0 ? (chunk === 0 ? lost(input) : "not json") : answered(input)),
      { admission: rates, budget: { ...RESEARCH_PIPELINE_BUDGET, extractionCalls: chunkIds.length + 1 } });
    expect(tight.outcome.status).toBe("completed");
    expect(tight.extractRow).toMatchObject({ heldChunks: 1, heldKeptUnrepaired: 1, repairCalls: 1 });
    // Without a card's rates the row carries neither count, as it carries no second repairs.
    const plain = await run(scripted((chunk, n, input) => chunk === 0 && n === 0 ? lost(input) : answered(input)));
    expect([plain.extractRow.heldChunks, plain.extractRow.heldKeptUnrepaired]).toEqual([undefined, undefined]);
  });
});
