import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { BrokerError } from "../../src/main/private-agent/broker";
import { claimsInstructions } from "../../src/main/private-agent/claims";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE } from "../../src/main/private-agent/dispatch-purposes";
import { evidenceInstructions } from "../../src/main/private-agent/evidence";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import {
  ASSIST_BOUNDS, ASSIST_CODES, ASSIST_FAILED_CODES, ASSIST_HOST_MARKERS, ASSIST_OUTPUT_TOKENS, ASSIST_REFUSED_CODES, ASSIST_SKIP_CODES, ASSIST_STOP_CODES,
  ASSIST_SYNTHESIS_REPAIR_REASON, PLAN_ASSIST_SYSTEM, ResearchAssistAttemptRecordSchema, ResearchAssistStageRecordSchema, SYNTHESIS_ASSIST_SYSTEM, assistFailureCode,
  buildPlanAssistPacket, buildSynthesisAssistPacket, classifyAssistCode, createResearchAssists, researchAssistProtocol, researchAssistProtocolSha256,
} from "../../src/main/private-agent/research-assist";
import type { ResearchAssistOutcome, ResearchAssistPlanRequest, ResearchAssistSynthesisRequest, ResearchAssistUsage } from "../../src/main/private-agent/research-assist-contract";
import { deriveBriefUnits, validatePlanCoverage } from "../../src/main/private-agent/research-coverage";
import { researchProtocolSha256, researchWriteInstructions, type ResearchUsage } from "../../src/main/private-agent/research-pipeline";
import { assessResearchPlanReply, validateResearchPlanAttempts, type ResearchPlanAttempt } from "../../src/main/private-agent/research-plan";
import {
  ASSIST_AUTHORED_BRIEF, ASSIST_FEE_CAP_MICROUSD, anthropicCacheWrites, assistComposedGoal, assistModelConfig, assistPacketOf, assistRequests, cachingAssistModel, capturingBroker,
  fakeResearchAssists, forbiddenStrings, frozen, PLANTED, responsesCacheWrites, responsesCachingReply, type AssistShape,
} from "../helpers/research-assist-fixture";

const SHAPES: AssistShape[] = ["openai_responses", "anthropic_messages"];
const signal = () => new AbortController().signal;
/** A valid T1 reply in the packet's own namespace: every unit assigned, opaque source hints. */
const planReply = (packet: Record<string, any>) => JSON.stringify({ version: 2, questions: [{ id: "Q1", text: "How many healthy trees did each site record?",
  requirementIds: packet.units.map((u: any) => u.id), sourceIds: packet.sources.slice(0, 2).map((s: any) => s.id) }] });
const synthesisReply = (packet: Record<string, any>) => JSON.stringify({ version: 1, argument: "Finding [E1].\n\n## Conflicting evidence\nNone.\n\n## Unanswered questions\nNone.",
  questions: packet.plan.questions.map((q: any) => ({ questionId: q.id, disposition: "unresolved", evidenceIds: [] })) });
const answer = (body: string, purpose: string) => purpose === PLAN_ASSIST_PURPOSE ? planReply(assistPacketOf(body)) : synthesisReply(assistPacketOf(body));
const lower = (value: string) => value.toLowerCase();
const wrap = (model: PrivateAgentModel, extra: Partial<Parameters<typeof createResearchAssists>[0]> = {}) =>
  createResearchAssists({ firing: "forced_split", model, authoredBrief: ASSIST_AUTHORED_BRIEF, maxFeeMicrousd: ASSIST_FEE_CAP_MICROUSD, ...extra });
function attemptRecord(outcome: ResearchAssistOutcome) { expect(outcome.record).toBeDefined(); return ResearchAssistAttemptRecordSchema.parse(outcome.record); }
async function frozenRun(options?: Parameters<typeof assistRequests>[0]) { const run = await assistRequests(options); frozen(run.plan); frozen(run.synthesis); return run; }
/** The opaque id of the fixture's alpha (0), beta (1) or web (2) source in a run's inventory order. */
const aliasOf = (run: Awaited<ReturnType<typeof assistRequests>>, i: number) => `S${run.plan.sources.findIndex(s => s.id === [PLANTED.alphaId, PLANTED.betaId, PLANTED.webUrl][i]) + 1}`;

describe("the hook contract (research-assist-contract.ts)", () => {
  it("uses the pipeline's usage shape, so a reply's usage adds into a stage's counts unchanged", () => {
    expectTypeOf<ResearchAssistUsage>().toEqualTypeOf<ResearchUsage>();
  });
  it("keeps the wrapper and the contract free of any runtime import of the pipeline, which imports them", () => {
    for (const path of ["src/main/private-agent/research-assist.ts", "src/main/private-agent/research-assist-contract.ts"]) {
      expect(readFileSync(path, "utf8")).not.toMatch(/from "\.\/research-pipeline"/u);
    }
    expect(readFileSync("src/main/private-agent/research-assist-contract.ts", "utf8").match(/^import (?!type )/mu)).toBeNull();
  });
  it("gives item 7(c) a fake hook in the opaque namespace whose plan replies bind only through the alias map", async () => {
    const run = await frozenRun(), hook = fakeResearchAssists("forced_split");
    const outcome = await hook.plan!(run.plan, signal());
    if (outcome.kind !== "reply") throw new Error("expected a reply");
    const input = { content: outcome.content, truncated: false, ordinal: 1, units: run.plan.units, sources: run.plan.sources };
    // Read like a stage reply, every opaque hint is unknown; read through the aliases, the plan binds to the real ids.
    expect(assessResearchPlanReply(input).plan).toBeUndefined();
    expect(assessResearchPlanReply({ ...input, sourceAliases: outcome.sourceAliases }).plan!.questions[0]!.sourceIds).toEqual(run.plan.sources.map(s => s.id));
    expect(await hook.synthesis!(run.synthesis, signal())).toMatchObject({ kind: "reply", evidenceIds: run.synthesis.evidence.quotes.map(q => q.id) });
  });
});

describe("T1, the plan assist packet", () => {
  it.each(SHAPES)("sends exactly the touchpoint table's fields on %s: schema, authored brief, cut units, opaque gists and the budget line", async shape => {
    const run = await frozenRun(), f = cachingAssistModel(shape, answer);
    const outcome = await wrap(f.model).plan!(run.plan, signal());
    expect(outcome.kind).toBe("reply");
    const packet = assistPacketOf(f.requests[0]!.body);
    expect(Object.keys(packet).sort()).toEqual(["authoritativeSchema", "brief", "budget", "sources", "units"]);
    expect(packet.budget).toEqual({ mandatorySourceChunks: run.plan.mandatorySourceChunks, extractionCallBudget: 40 });
    expect(packet.sources.map((s: any) => Object.keys(s).sort())).toEqual(run.plan.sources.map(() => ["gist", "id"]));
    expect(packet.sources.map((s: any) => s.id)).toEqual(run.plan.sources.map((_, i) => `S${i + 1}`));
    // The units keep their ids and are cut where the authored brief ends: nothing the driver appended leaves.
    expect(packet.units.map((u: any) => u.id)).toEqual(run.plan.units.map(u => u.id));
    expect(packet.units.map((u: any) => u.text).join("")).toBe(packet.brief);
    expect(packet.brief).toBe(ASSIST_AUTHORED_BRIEF.replace("alpha-field-notes.md", aliasOf(run, 0)));
    expect(f.requests[0]!.purpose).toBe(PLAN_ASSIST_PURPOSE);
    const record = attemptRecord(outcome);
    expect(record).toMatchObject({ touchpoint: "T1", ordinal: 1, outcome: "settled", dispatched: true, requestBytes: Buffer.byteLength(f.requests[0]!.body), finish: "stop",
      reservedFeeMicrousd: f.requests[0]!.maxFeeMicrousd, usage: { cacheWriteReported: true } });
    expect(record.packet).toMatchObject({ briefBytes: Buffer.byteLength(ASSIST_AUTHORED_BRIEF), units: run.plan.units.length, sources: 3, substitutions: { brief: 1, units: 1 } });
    expect(record.packet!.fieldBytes).toEqual(Object.fromEntries(Object.entries(packet).map(([key, value]) => [key, Buffer.byteLength(canonical(value))])));
    expect(record.packet!.substitutions.gists).toBeGreaterThan(0);
    expect(record.packet!.substitutions.digests).toBeGreaterThan(0);
  });

  it("adds only the safe codes and schema paths of earlier attempts under local-first, never a reply or a hash", async () => {
    const run = await frozenRun(), f = cachingAssistModel("openai_responses", answer);
    const prior: ResearchPlanAttempt[] = [
      { version: 1, ordinal: 1, replyContentSha256: PLANTED.secretHash, replyBytes: 900, truncated: false, accepted: false, bindingInspection: "completed",
        errors: [{ code: "unknown_source_id", path: ["questions", 0, "sourceIds", 1] }, { code: "omitted_requirement", path: ["questions"], requirementId: "U2" }], omittedErrorCount: 0, acceptedPlanSha256: null, repairContext: "included" },
      { version: 1, ordinal: 2, replyContentSha256: PLANTED.secretHash, replyBytes: 70_000, truncated: true, accepted: false, bindingInspection: "not_run",
        errors: [{ code: "truncated", path: [] }], omittedErrorCount: 0, acceptedPlanSha256: null, repairContext: "not_used" }];
    await wrap(f.model, { firing: "local_first" }).plan!({ ...run.plan, priorAttempts: prior }, signal());
    const packet = assistPacketOf(f.requests[0]!.body);
    expect(packet.priorAttempts).toEqual([{ ordinal: 1, truncated: false, errors: prior[0]!.errors, omittedErrorCount: 0 }, { ordinal: 2, truncated: true, errors: [{ code: "truncated", path: [] }], omittedErrorCount: 0 }]);
    expect(f.requests[0]!.body).not.toContain(PLANTED.secretHash);
    // The forced split's T1 comes first, so it carries no prior attempts at all.
    const forced = cachingAssistModel("openai_responses", answer);
    await wrap(forced.model).plan!({ ...run.plan, priorAttempts: prior }, signal());
    expect(assistPacketOf(forced.requests[0]!.body)).not.toHaveProperty("priorAttempts");
  });

  it("binds a reply's opaque ids to the real ids through the alias map, keeping the raw reply's hash, so the ready gate's attempt rule holds", async () => {
    const run = await frozenRun(), f = cachingAssistModel("anthropic_messages", answer);
    const outcome = await wrap(f.model).plan!(run.plan, signal());
    if (outcome.kind !== "reply") throw new Error("expected a reply");
    expect(outcome.sourceAliases).toEqual(Object.fromEntries(run.plan.sources.map((s, i) => [`S${i + 1}`, s.id])));
    const assessed = assessResearchPlanReply({ content: outcome.content, truncated: outcome.truncated, ordinal: 1, units: run.plan.units, sources: run.plan.sources, sourceAliases: outcome.sourceAliases });
    expect(assessed.plan!.questions[0]!.sourceIds).toEqual(run.plan.sources.slice(0, 2).map(s => s.id));
    expect(assessed.attempt.replyContentSha256).toBe(digest(outcome.content));
    validatePlanCoverage(assessed.plan!, run.plan.units, run.plan.sources);
    expect(() => validateResearchPlanAttempts({ calls: 1, invalidReplies: 0, questions: 1, planAttempts: [assessed.attempt] }, assessed.plan!, run.plan.units)).not.toThrow();
    // A real id, or an opaque id the packet never used, is unknown: the whole plan is rejected, as a local plan is.
    for (const bad of [PLANTED.alphaId, "S9"]) {
      const content = JSON.stringify({ version: 2, questions: [{ id: "Q1", text: "q", requirementIds: run.plan.units.map(u => u.id), sourceIds: [bad] }] });
      const rejected = assessResearchPlanReply({ content, truncated: false, ordinal: 1, units: run.plan.units, sources: run.plan.sources, sourceAliases: outcome.sourceAliases });
      expect(rejected.plan).toBeUndefined();
      expect(rejected.attempt.errors).toEqual([{ code: "unknown_source_id", path: ["questions", 0, "sourceIds", 0] }]);
    }
    // An alias map that names an unknown source, keys a real id, or names one source twice is a host error, never a binding.
    const ids = run.plan.sources.map(s => s.id);
    const maps: Record<string, string>[] = [{ S1: "input/elsewhere.md" }, { [ids[1]!]: ids[0]! }, { S1: ids[0]!, S2: ids[0]! }, { S0: ids[0]! }, { s1: ids[0]! }];
    for (const sourceAliases of maps) {
      expect(() => assessResearchPlanReply({ content: outcome.content, truncated: false, ordinal: 1, units: run.plan.units, sources: run.plan.sources, sourceAliases })).toThrow("research_plan_alias_binding");
    }
  });

  it("refuses an authored brief over 8 KiB as a recorded fallback, never trimmed, and stops on one that is not the goal's prefix", async () => {
    const authored = `${"Brief text. ".repeat(683)}\n`;
    expect(Buffer.byteLength(authored)).toBeGreaterThan(ASSIST_BOUNDS.briefBytes);
    const run = await frozenRun({ authored }), f = cachingAssistModel("openai_responses", answer);
    const large = await wrap(f.model, { authoredBrief: authored }).plan!(run.plan, signal());
    expect(large).toMatchObject({ kind: "no_reply", outcome: "refused", code: ASSIST_CODES.briefTooLarge });
    expect(attemptRecord(large)).toMatchObject({ outcome: "refused", dispatched: false, packet: { briefBytes: Buffer.byteLength(authored) } });
    // T2 has no brief bound of its own (the touchpoint table names it for T1 only): its body bound governs.
    expect((await wrap(f.model, { authoredBrief: authored }).synthesis!(run.synthesis, signal())).kind).toBe("reply");
    const other = await wrap(f.model, { authoredBrief: "A different brief." }).plan!(run.plan, signal());
    expect(other).toMatchObject({ kind: "stop", code: ASSIST_CODES.briefNotPrefix });
    expect(f.requests).toHaveLength(1);
  });

  it("cuts every gist to one common length, the largest that fits 32 KiB, back to a word boundary, and counts the trim", () => {
    const sources = Array.from({ length: 40 }, (_, i) => ({ id: `input/s${String(i).padStart(2, "0")}.md`, path: `input/s${String(i).padStart(2, "0")}.md`, sha256: "0".repeat(64), bytes: 10 }));
    const authored = `${"Requirement text. ".repeat(400)}\n`, units = deriveBriefUnits(authored);
    const entry = (id: string, i: number) => ({ sourceId: id, sourceSha256: "0".repeat(64), bytes: 10, lines: 1, title: "", date: "", gist: `${"word ".repeat(119)}${i}`, figures: [], modelStatus: "model_complete" as const,
      metadataOrigin: "model_summary" as const, modelAttempts: 1, modelContentSha256: null, issues: [], needsCoverageRead: true as const,
      literal: { sourceId: id, sourceSha256: "0".repeat(64), bytes: 10, lines: 1, classification: "host_literal" as const, untrusted: true as const, needsCoverageRead: true as const, heading: null,
        opening: { text: `opening of source ${i}`, startByte: 0, endByte: 10, startLine: 1, endLine: 1, sha256: "0".repeat(64) } } });
    const request: ResearchAssistPlanRequest = frozen({ brief: authored, units, sources, sourceTexts: sources.map((_, i) => `opening of source ${i}`), deadlineMs: Number.POSITIVE_INFINITY,
      sourceIndex: { version: 2 as const, sources: sources.map((s, i) => entry(s.id, i)) }, mandatorySourceChunks: 40, extractionCallBudget: 40, priorAttempts: [] });
    const model = new PrivateAgentModel(capturingBroker(() => ({})).broker, assistModelConfig("openai_responses"), "job", "reader");
    const built = buildPlanAssistPacket(request, { firing: "forced_split", authoredBrief: authored, model });
    if (!built.ok) throw new Error(built.code);
    expect(built.requestBytes).toBeLessThanOrEqual(ASSIST_BOUNDS.planBodyBytes);
    expect(built.packet.gistsTrimmed).toBe(40);
    const max = built.packet.gistMaxChars!, gists = (JSON.parse(built.user).sources as { gist: string }[]).map(s => s.gist);
    // Each cut gist is a whole-word prefix of its gist, at most max code points: no alias or placeholder is cut into another.
    gists.forEach((gist, i) => { const full = request.sourceIndex.sources[i]!.gist; expect([...gist].length).toBeLessThanOrEqual(max); expect(full.startsWith(gist)).toBe(true); expect(full[gist.length]).toBe(" "); });
    // One more word per gist would not fit.
    const wider = JSON.parse(built.user); wider.sources = wider.sources.map((s: any, i: number) => ({ ...s, gist: request.sourceIndex.sources[i]!.gist.split(" ").slice(0, s.gist.split(" ").length + 1).join(" ") }));
    expect(Buffer.byteLength(model.requestBody([{ role: "system", content: PLAN_ASSIST_SYSTEM }, { role: "user", content: canonical(wider) }], [], { maxOutputTokens: 8192, purpose: PLAN_ASSIST_PURPOSE }).body)).toBeGreaterThan(ASSIST_BOUNDS.planBodyBytes);
  });
});

describe("T2, the synthesis assist packet", () => {
  it.each(SHAPES)("sends the brief, cut units, the opaque plan, evidence text without notes and counts-only coverage on %s", async shape => {
    const run = await frozenRun(), f = cachingAssistModel(shape, answer);
    const outcome = await wrap(f.model).synthesis!(run.synthesis, signal());
    expect(outcome).toMatchObject({ kind: "reply", evidenceIds: run.synthesis.evidence.quotes.map(q => q.id) });
    const packet = assistPacketOf(f.requests[0]!.body);
    expect(Object.keys(packet).sort()).toEqual(["brief", "coverage", "evidenceText", "plan", "repairReason", "units"]);
    expect(packet.repairReason).toBeNull();
    expect(packet.units.map((u: any) => Object.keys(u).sort())).toEqual(run.synthesis.units.map(() => ["id", "text"]));
    const alias = (id: string) => `S${run.synthesis.sources.findIndex(s => s.id === id) + 1}`;
    expect(packet.plan.questions.map((q: any) => q.sourceIds)).toEqual(run.synthesis.plan.questions.map(q => q.sourceIds.map(alias)));
    for (const quote of run.synthesis.evidence.quotes) expect(packet.evidenceText).toContain(`- [${quote.id}] ${alias(quote.sourceId)} (${quote.locator}; ${quote.questionIds.join(", ")}): `);
    expect(packet.evidenceText).not.toContain("extractor note");
    expect(packet.evidenceText).toContain("## Conflicts noted by the extractor (unverified; notes withheld)");
    expect(Object.keys(packet.coverage).sort()).toEqual(["chunks", "conflictsInPacket", "conflictsNoted", "questions", "quotesInPacket", "quotesTrimmed", "quotesVerified", "sources"]);
    expect(packet.coverage).toMatchObject({ sources: 3, chunks: run.synthesis.coverage.chunks.length, quotesInPacket: run.synthesis.evidence.quotes.length, quotesTrimmed: 0 });
    // The local plan's deliverable note named the web source by a scheme-less URL and by its workspace path: both are its alias now.
    expect(packet.plan.deliverableNotes).toBe(`Compare ${aliasOf(run, 2)} with ${aliasOf(run, 2)}.`);
    expect(attemptRecord(outcome)).toMatchObject({ touchpoint: "T2", outcome: "settled", packet: { quotesInPacket: run.synthesis.evidence.quotes.length, quotesTrimmed: 0 } });
    expect(f.requests[0]!.purpose).toBe(SYNTHESIS_ASSIST_PURPOSE);
  });

  const many = () => {
    const authored = "Answer three questions.\n", units = deriveBriefUnits(authored), text = "A plain synthetic source.\n";
    const sources = [{ id: "input/a.md", path: "input/a.md", sha256: digest(text), bytes: text.length }];
    const entry = { sourceId: "input/a.md", sourceSha256: digest(text), bytes: text.length, lines: 1, title: "", date: "", gist: "", figures: [], modelStatus: "unresolved" as const, metadataOrigin: "host_literal" as const,
      modelAttempts: 1, modelContentSha256: null, issues: [], needsCoverageRead: true as const,
      literal: { sourceId: "input/a.md", sourceSha256: digest(text), bytes: text.length, lines: 1, classification: "host_literal" as const, untrusted: true as const, needsCoverageRead: true as const, heading: null,
        opening: { text, startByte: 0, endByte: text.length, startLine: 1, endLine: 1, sha256: digest(text) } } };
    // Q1 owns most quotes; Q2 and Q3 have a few each, listed last: a plain E-order cut would drop them first.
    const quotes = Array.from({ length: 360 }, (_, i) => ({ id: `E${i + 1}`, questionIds: [i >= 350 ? (i % 2 ? "Q3" : "Q2") : "Q1"], sourceId: "input/a.md", sourceSha256: digest(text),
      chunkIds: ["S1C1"], locator: `line ${i + 1}`, quote: `Quote number ${i + 1} ${"x".repeat(220)}`, note: "" }));
    const plan = { version: 2 as const, questions: ["Q1", "Q2", "Q3"].map(id => ({ id, text: `Question ${id}`, requirementIds: ["U1"], sourceIds: ["input/a.md"] })) };
    const coverage = { briefSha256: digest(authored), sourceManifestSha256: digest("m"), protocolSha256: digest("p"), synthesis: {}, omissions: [], conflictOmissions: [],
      chunks: [{ sha256: digest("c"), sourceSha256: digest(text), attempts: [], questions: plan.questions.map(q => ({ questionId: q.id, status: "evidence_retained", evidenceIds: [] })) }] } as unknown as ResearchAssistSynthesisRequest["coverage"];
    const request: ResearchAssistSynthesisRequest = frozen({ brief: authored, units, sources, sourceTexts: [text], deadlineMs: Number.POSITIVE_INFINITY, sourceIndex: { version: 2 as const, sources: [entry] }, plan, coverage,
      retryAfterTruncation: false, evidence: { version: 2 as const, quotes, conflicts: [], counts: { verified: 360, inPacket: 360, leftByCap: 0, droppedUnverifiedOrDuplicate: 0, conflictsNoted: 0 } } });
    return { authored, request };
  };

  it("orders quotes round-robin over the plan's questions and keeps the longest prefix that fits 64 KiB, and reports the ids it kept", async () => {
    const { authored, request } = many(), f = cachingAssistModel("openai_responses", answer);
    const first = await wrap(f.model, { authoredBrief: authored }).synthesis!(request, signal());
    const packet = assistPacketOf(f.requests[0]!.body), record = attemptRecord(first);
    expect(Buffer.byteLength(packet.evidenceText)).toBeLessThanOrEqual(ASSIST_BOUNDS.evidenceBytes);
    expect(record.packet!.quotesTrimmed).toBeGreaterThan(0);
    expect(record.packet!.quotesInPacket! + record.packet!.quotesTrimmed!).toBe(360);
    // Every question keeps quotes, and the kept quotes render in E order.
    for (const id of ["E351", "E352", "E353", "E354"]) expect(packet.evidenceText).toContain(`[${id}]`);
    const order = [...String(packet.evidenceText).matchAll(/\[E(\d+)\]/gu)].map(m => Number(m[1]));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(packet.coverage.questions.map((q: any) => q.quotesInPacket > 0)).toEqual([true, true, true]);
    // The reply may cite only what the packet held: the outcome lists exactly those ids.
    if (first.kind !== "reply") throw new Error("expected a reply");
    expect(first.evidenceIds).toEqual(order.map(n => `E${n}`));
    expect(first.evidenceIds).not.toContain("E349");
  });

  it("retries a truncated reply once with at most half the evidence and the fixed reason, never the first reply", async () => {
    const run = await frozenRun();
    const f = cachingAssistModel("openai_responses", (body, purpose, index) => index === 0 ? { content: "{\"version\":1,\"argument\":\"cut", truncated: true } : answer(body, purpose));
    const assists = wrap(f.model);
    const cut = await assists.synthesis!(run.synthesis, signal());
    expect(cut).toMatchObject({ kind: "reply", truncated: true });
    const again = await assists.synthesis!({ ...run.synthesis, retryAfterTruncation: true }, signal());
    expect(again.kind).toBe("reply");
    const first = assistPacketOf(f.requests[0]!.body), retry = assistPacketOf(f.requests[1]!.body);
    expect(retry.repairReason).toBe(ASSIST_SYNTHESIS_REPAIR_REASON);
    expect(Buffer.byteLength(retry.evidenceText)).toBeLessThanOrEqual(Math.floor(Buffer.byteLength(first.evidenceText) / 2));
    expect(retry.coverage.quotesTrimmed).toBeGreaterThan(first.coverage.quotesTrimmed);
    expect(f.requests[1]!.body).not.toContain("\\\"argument\\\":\\\"cut");
    expect(attemptRecord(again)).toMatchObject({ ordinal: 2, retryAfterTruncation: true });
  });
});

describe("what the cloud never sees", () => {
  it.each(SHAPES)("sends no source name, path, URL, hash, note or appended instruction in T1 or T2 on %s", async shape => {
    const run = await frozenRun(), f = cachingAssistModel(shape, answer), assists = wrap(f.model);
    expect((await assists.plan!(run.plan, signal())).kind).toBe("reply");
    expect((await assists.synthesis!(run.synthesis, signal())).kind).toBe("reply");
    expect(f.requests).toHaveLength(2);
    const forbidden = forbiddenStrings(run);
    expect(forbidden.length).toBeGreaterThan(20);
    for (const request of f.requests) for (const value of forbidden) expect(lower(request.body)).not.toContain(lower(value));
    for (const entry of run.plan.sourceIndex.sources) expect(f.requests[0]!.body).not.toContain(entry.literal.opening.text.slice(0, 64));
  });

  /** Builds T1 and T2 from the fixture run with the first index gist and the plan's text replaced. */
  async function packetsWith(edit: { gist?: string; question?: string; deliverableNotes?: string }) {
    const run = await assistRequests(), plan = { ...run.synthesis.plan, ...(edit.deliverableNotes !== undefined ? { deliverableNotes: edit.deliverableNotes } : {}),
      questions: run.synthesis.plan.questions.map((q, i) => i === 0 && edit.question !== undefined ? { ...q, text: edit.question } : q) };
    const sourceIndex = { version: 2 as const, sources: run.plan.sourceIndex.sources.map((entry, i) => i === 0 && edit.gist !== undefined ? { ...entry, gist: edit.gist } : entry) };
    const model = new PrivateAgentModel(capturingBroker(() => ({})).broker, assistModelConfig("openai_responses"), "job", "reader");
    return { run, t1: buildPlanAssistPacket(frozen({ ...run.plan, sourceIndex }), { firing: "forced_split", authoredBrief: ASSIST_AUTHORED_BRIEF, model }),
      t2: buildSynthesisAssistPacket(frozen({ ...run.synthesis, sourceIndex, plan }), { authoredBrief: ASSIST_AUTHORED_BRIEF, model }) };
  }

  it("replaces name variants: Unicode forms, URL forms, hosts, distinctive stems, short known digests, other URLs and paths", async () => {
    const { run, t1 } = await packetsWith({ gist: [`See ${PLANTED.betaId.normalize("NFD")}`, "https://example.org/reports/annual-2025.html?x=1#top", "example.org", "www.example.org/news",
      "ALPHA-FIELD-NOTES.MD", "the alpha-field-notes draft", `source ${(await assistRequests()).plan.sources[0]!.sha256.slice(0, 12)}`, "https://elsewhere.test/page", "see archive/2024/memo.txt"].join("; ") });
    if (!t1.ok) throw new Error(t1.code);
    const gist = JSON.parse(t1.user).sources[0].gist as string;
    expect(gist).toBe(`See ${aliasOf(run, 1)}; ${aliasOf(run, 2)}; ${aliasOf(run, 2)}; www.${aliasOf(run, 2)}/news; ${aliasOf(run, 0)}; the ${aliasOf(run, 0)} draft; source [digest]; [url]; see [file]`);
    expect(t1.packet.substitutions).toMatchObject({ urls: 1, files: 1 });
  });

  it("refuses model text that copies a literal opening (T1), source text or a long heading (T2), or the appended host text", async () => {
    const run = await assistRequests(), opening = run.plan.sourceIndex.sources[1]!.literal.opening.text;
    const copied = await packetsWith({ gist: `Summary: ${opening.slice(0, 90)}` });
    expect(copied.t1).toMatchObject({ ok: false, code: ASSIST_CODES.auditFailed, packet: { auditFinding: "literal_text" } });
    // T2's plan text against all source text, not only the openings: the line is deep in the alpha source.
    const deep = await packetsWith({ question: "Per the notes: The surveyors noted that three saplings were replaced after the frost, it seems?" });
    expect(deep.t2).toMatchObject({ ok: false, code: ASSIST_CODES.auditFailed, packet: { auditFinding: "literal_text" } });
    const heading = await packetsWith({ question: "Alpha field notes from the orchard survey in early autumn of the synthetic year?" });
    expect(heading.t2).toMatchObject({ ok: false, packet: { auditFinding: "literal_text" } });
    // A sentence of the claims-ledger instructions the driver appended, copied into the plan's notes.
    const host = await packetsWith({ deliverableNotes: "Every material factual sentence in the report must carry its claim id in brackets." });
    expect(host.t2).toMatchObject({ ok: false, code: ASSIST_CODES.auditFailed, packet: { auditFinding: "host_text" } });
    // And a host file name the plan carried is replaced: claims.json is named only by the appended instructions.
    const named = await packetsWith({ deliverableNotes: "Write claims.json beside the report." });
    if (!named.t2.ok) throw new Error(named.t2.code);
    expect(JSON.parse(named.t2.user).plan.deliverableNotes).toBe("Write [file] beside the report.");
  });

  it("refuses an authored brief that holds appended host text, whatever composed it", () => {
    const model = new PrivateAgentModel(capturingBroker(() => ({})).broker, assistModelConfig("openai_responses"), "job", "reader");
    const composed = [claimsInstructions("output/report.md", [{ id: "input/a.md", path: "input/a.md" }], false),
      evidenceInstructions({ claimsPath: "output/claims-evidence.json", scriptPath: "output/verify.py", resultsPath: "output/results.json" } as never),
      readFileSync("src/main/private-agent/session.ts", "utf8"), researchWriteInstructions()];
    // Each marker opens text the host appends, so this fails if that text changes without the list.
    for (const [i, marker] of ASSIST_HOST_MARKERS.entries()) expect(composed[i]).toContain(marker);
    for (const marker of ASSIST_HOST_MARKERS) expect(() => wrap(model, { authoredBrief: `${ASSIST_AUTHORED_BRIEF}\n${marker} more` })).toThrow("research_assist_config_invalid");
  });
});

describe("the fallback, stop and skip codes", () => {
  it("pins the table", () => {
    expect(ASSIST_SKIP_CODES).toEqual(["transport_or_settlement_unknown"]);
    expect(ASSIST_FAILED_CODES).toEqual(["request_failed"]);
    expect(ASSIST_REFUSED_CODES).toEqual(["budget_denied", "cloud_mode_denied", "offline_network_denied", "exact_grant_required", "private_disclosure_requires_exact_grant",
      "synthetic_destination_private_data_denied", "packet_size_exceeded", "request_body_size_exceeded", "deadline_before_request", "packet_scan_incomplete_or_blocked",
      "cloud_after_assist_unknown", "private_agent_assist_after_unknown", "assist_brief_too_large", "assist_source_alias_collision", "assist_packet_size_exceeded",
      "assist_packet_audit_failed", "assist_suppressed_after_unknown"]);
    expect(ASSIST_STOP_CODES).toEqual(["cancelled", "job_cancelled", "request_cancelled", "retry_wait_cancelled", "packet_scan_failed", "destination_missing", "assist_destination_invalid",
      "private_model_thinking_unsupported", "private_model_assist_cache_mode_required", "private_model_assist_request_invalid", "private_model_request_bound_invalid", "unresolved_dispatch",
      "assist_brief_not_prefix", "assist_request_invalid", "assist_deadline_missing", "assist_slot_exhausted", "assist_failure_unclassified"]);
    const lists = [ASSIST_SKIP_CODES, ASSIST_FAILED_CODES, ASSIST_REFUSED_CODES, ASSIST_STOP_CODES].flat();
    expect(new Set(lists).size).toBe(lists.length);
    expect(classifyAssistCode("credential_in_packet")).toBe("stop");
    expect(classifyAssistCode("private_agent_admission_changed")).toBe("stop");
  });

  it("trusts a code only by its error type", () => {
    expect(assistFailureCode(new BrokerError("request_failed"))).toBe("request_failed");
    expect(assistFailureCode(new Error("request_failed"))).toBe(ASSIST_CODES.unclassified);
    expect(assistFailureCode(new Error("private_agent_assist_after_unknown"))).toBe("private_agent_assist_after_unknown");
    expect(assistFailureCode(new Error("private_model_assist_request_invalid"))).toBe("private_model_assist_request_invalid");
    expect(assistFailureCode(new Error("SQLITE_BUSY: database is locked"))).toBe(ASSIST_CODES.unclassified);
    expect(assistFailureCode("thrown string")).toBe(ASSIST_CODES.unclassified);
  });

  it.each<[string, unknown, string, string, boolean, boolean]>([
    ["a pinned unknown row is skipped and bars later calls", new BrokerError("transport_or_settlement_unknown"), "no_reply", "skipped", true, true],
    ["a confirmed failure falls back", new BrokerError("request_failed"), "no_reply", "failed", true, false],
    ["a cap refusal falls back", new BrokerError("budget_denied"), "no_reply", "refused", false, false],
    ["an offline policy falls back", new BrokerError("offline_network_denied"), "no_reply", "refused", false, false],
    ["the ledger's own assist backstop falls back and bars", new Error("private_agent_assist_after_unknown"), "no_reply", "refused", false, true],
    ["an unavailable scanner stops", new BrokerError("packet_scan_failed"), "stop", "stopped", false, false],
    ["a ledger refusal stops", new BrokerError("unresolved_dispatch"), "stop", "stopped", false, false],
    ["a retry-wait cancel stops after a dispatch", new BrokerError("retry_wait_cancelled"), "stop", "stopped", true, false],
    ["a plain error named like a broker code stops", new Error("request_failed"), "stop", "stopped", false, false],
  ])("maps the model's failure: %s", async (_name, error, kind, outcome, dispatched, bars) => {
    const run = await frozenRun(), f = cachingAssistModel("openai_responses", (body, purpose, index) => index === 0 ? error as Error : answer(body, purpose));
    const assists = wrap(f.model);
    const result = await assists.plan!(run.plan, signal());
    expect(result.kind).toBe(kind);
    expect(attemptRecord(result)).toMatchObject({ outcome, dispatched });
    const after = await assists.synthesis!(run.synthesis, signal());
    expect(after.kind === "no_reply" && after.code === ASSIST_CODES.suppressed).toBe(bars);
  });
});

describe("one wrapper per reading stage: slots, the skip bar, the deadline and cancels", () => {
  it("sends no cloud call after an assist whose row stayed unknown", async () => {
    const run = await frozenRun(), f = cachingAssistModel("anthropic_messages", () => new BrokerError("transport_or_settlement_unknown")), assists = wrap(f.model);
    expect(await assists.plan!(run.plan, signal())).toMatchObject({ kind: "no_reply", outcome: "skipped", code: "transport_or_settlement_unknown" });
    const t2 = await assists.synthesis!(run.synthesis, signal());
    expect(t2).toMatchObject({ kind: "no_reply", outcome: "refused", code: ASSIST_CODES.suppressed });
    expect(attemptRecord(t2)).toMatchObject({ dispatched: false });
    expect(f.requests).toHaveLength(1);
  });

  it("makes at most one T1 call and two T2 calls, the second only after a truncated first reply", async () => {
    const run = await frozenRun(), f = cachingAssistModel("openai_responses", answer), assists = wrap(f.model);
    expect((await assists.plan!(run.plan, signal())).kind).toBe("reply");
    expect(await assists.plan!(run.plan, signal())).toMatchObject({ kind: "stop", code: ASSIST_CODES.slotExhausted });
    expect((await assists.synthesis!(run.synthesis, signal())).kind).toBe("reply");
    expect(await assists.synthesis!({ ...run.synthesis, retryAfterTruncation: true }, signal())).toMatchObject({ kind: "stop", code: ASSIST_CODES.slotExhausted });
    expect(await assists.synthesis!(run.synthesis, signal())).toMatchObject({ kind: "stop", code: ASSIST_CODES.slotExhausted });
    expect(f.requests).toHaveLength(2);
  });

  it("refuses a call the deadline could cut, stops without a deadline or on a cancel, before any request", async () => {
    const run = await frozenRun(), f = cachingAssistModel("openai_responses", answer);
    expect(await wrap(f.model).plan!({ ...run.plan, deadlineMs: performance.now() + 60_000 }, signal())).toMatchObject({ kind: "no_reply", outcome: "refused", code: "deadline_before_request" });
    expect(await wrap(f.model).plan!({ ...run.plan, deadlineMs: undefined as unknown as number }, signal())).toMatchObject({ kind: "stop", code: ASSIST_CODES.deadlineMissing });
    const aborted = new AbortController(); aborted.abort();
    expect(await wrap(f.model).synthesis!(run.synthesis, aborted.signal)).toMatchObject({ kind: "stop", code: "cancelled" });
    expect(f.requests).toHaveLength(0);
  });

  it("stops as cancelled when the stage is cancelled mid-request, records the dispatch, and bars later calls when that row stayed unknown", async () => {
    const run = await frozenRun(), controller = new AbortController();
    const f = cachingAssistModel("openai_responses", () => { controller.abort(); return new BrokerError("transport_or_settlement_unknown"); }), assists = wrap(f.model);
    const cut = await assists.plan!(run.plan, controller.signal);
    expect(cut).toMatchObject({ kind: "stop", code: "cancelled" });
    expect(attemptRecord(cut)).toMatchObject({ outcome: "stopped", dispatched: true });
    expect(await assists.synthesis!(run.synthesis, signal())).toMatchObject({ code: ASSIST_CODES.suppressed });
  });

  it("refuses to be built around a model that could write to a cache, a cap that cannot hold T1 and T2 at their bounds, or a bad brief", () => {
    const broker = capturingBroker(() => ({})).broker, make = (config = assistModelConfig("openai_responses")) => new PrivateAgentModel(broker, config, "job", "reader");
    for (const extra of [{ model: make(assistModelConfig("openai_responses", "responses_explicit_v1")) }, { model: make(assistModelConfig("anthropic_messages", "none")) },
      { model: make({ ...assistModelConfig("openai_responses"), maxOutputTokens: 4096 }) }, { model: make({ ...assistModelConfig("openai_responses"), maxRequestBytes: 65_536 }) },
      { authoredBrief: "" }, { firing: "always" as never }, { maxFeeMicrousd: 0 }, { maxFeeMicrousd: 400_000 },
      // At USD 3, 3.75 and 15 per million, T1 and T2 at their bounds reserve 0.737: no USD 0.60 cap holds both.
      { model: make({ ...assistModelConfig("openai_responses"), inputUsdPerMillion: 3, cacheWriteUsdPerMillion: 3.75, outputUsdPerMillion: 15, cachedInputUsdPerMillion: 0.3 }) }]) {
      expect(() => wrap(make(), extra)).toThrow("research_assist_config_invalid");
    }
    expect(make().reservationMicrousd(ASSIST_BOUNDS.planBodyBytes, 8192) + make().reservationMicrousd(ASSIST_BOUNDS.synthesisBodyBytes, 8192)).toBe(163_840 + 327_680);
    expect(() => wrap(make())).not.toThrow();
  });
});

describe("zero cache writes on both shapes", () => {
  it.each(SHAPES)("writes nothing on every T1 and T2 attempt on %s, where the same bodies under the provider's default would write", async shape => {
    // A longer authored brief puts every body above both providers' minimum cacheable prompt (1,024 and 512 tokens).
    const authored = `${ASSIST_AUTHORED_BRIEF}${"The surveys used the same counting method at both sites. ".repeat(60)}\n`;
    const run = await frozenRun({ authored }), f = cachingAssistModel(shape, answer), assists = wrap(f.model, { authoredBrief: authored });
    for (const outcome of [await assists.plan!(run.plan, signal()), await assists.synthesis!(run.synthesis, signal())]) {
      if (outcome.kind !== "reply") throw new Error("expected a reply");
      expect(outcome.usage.cacheWriteTokens).toBe(0);
      expect(attemptRecord(outcome).usage).toMatchObject({ cacheWriteTokens: 0, cacheWriteReported: true });
    }
    // The mode marks nothing at all, whatever the prompt's size: the proof is the mechanism, not a minimum.
    for (const request of f.requests) expect(request.body).not.toMatch(/prompt_cache_breakpoint|cache_control/u);
    // Negative control: each body is long enough to be written under the provider's default handling.
    for (const request of f.requests) {
      const body = JSON.parse(request.body);
      if (shape === "openai_responses") { delete body.prompt_cache_options; expect(responsesCacheWrites(JSON.stringify(body)).written).toBeGreaterThan(0); }
      else { body.system = body.system.map((block: any) => ({ ...block, cache_control: { type: "ephemeral", ttl: "5m" } })); body.messages[0].content[0].cache_control = { type: "ephemeral", ttl: "5m" };
        expect(anthropicCacheWrites(JSON.stringify(body)).written).toBeGreaterThan(0); }
    }
  });

  it("records a reply that did not report its writes as unproven, whatever it counted", async () => {
    const run = await frozenRun();
    const captured = capturingBroker(body => { const reply = responsesCachingReply(body, planReply(assistPacketOf(body))); delete (reply.usage.input_tokens_details as Record<string, unknown>).cache_write_tokens; return reply; });
    const outcome = await wrap(new PrivateAgentModel(captured.broker, assistModelConfig("openai_responses"), "job", "reader")).plan!(run.plan, signal());
    expect(attemptRecord(outcome).usage).toMatchObject({ cacheWriteTokens: 0, cacheWriteReported: false });
  });
});

describe("the assist protocol block and the records", () => {
  it("binds the prompts, bounds, caps, cache mode, policy and codes, and leaves the default research protocol unchanged", () => {
    const block = researchAssistProtocol("forced_split");
    expect(block).toMatchObject({ version: 1, firing: "forced_split", prompts: { plan: PLAN_ASSIST_SYSTEM, synthesis: SYNTHESIS_ASSIST_SYSTEM }, bounds: ASSIST_BOUNDS,
      outputTokens: ASSIST_OUTPUT_TOKENS, thinking: "model_medium_only", cacheMode: "assist_no_cache_write_v1", triggers: { rejectedLocalPlans: 2, refusedLocalSyntheses: 2 } });
    // The patterns that apply the rules are bound too, so changing a matcher changes the block.
    expect(block.packet.patterns.url.length).toBeGreaterThan(3);
    expect(block.packet.patterns.path.length).toBeGreaterThan(5);
    expect(block.packet.evidenceTemplate).toContain("notes withheld");
    expect(researchAssistProtocolSha256("forced_split")).toBe(researchAssistProtocolSha256("forced_split"));
    expect(researchAssistProtocolSha256("forced_split")).not.toBe(researchAssistProtocolSha256("local_first"));
    expect(researchProtocolSha256()).toBe("3453710315d7226ea4d6195ec7401d000f86c5b0d9afa9839a801d5c6d391262");
  });

  it("validates the stage record 10.b assembles, which keeps every attempt and never reads a skipped one as zero writes", async () => {
    const run = await frozenRun(), f = cachingAssistModel("openai_responses", answer);
    const outcome = await wrap(f.model).plan!(run.plan, signal());
    if (outcome.kind !== "reply") throw new Error("expected a reply");
    expect(ResearchAssistStageRecordSchema.parse({ version: 1, touchpoint: "T1", policy: "forced_split", fired: true, trigger: "forced_split", attempts: [outcome.record], outcome: "settled",
      accepted: true, usage: outcome.usage })).toBeTruthy();
    const skipped = { version: 1, touchpoint: "T1", ordinal: 1, retryAfterTruncation: false, outcome: "skipped", code: "transport_or_settlement_unknown", dispatched: true };
    expect(ResearchAssistStageRecordSchema.parse({ version: 1, touchpoint: "T1", policy: "forced_split", fired: true, trigger: "forced_split", attempts: [skipped], outcome: "skipped",
      accepted: false, code: "transport_or_settlement_unknown", usage: null })).toBeTruthy();
    expect(() => ResearchAssistAttemptRecordSchema.parse({ ...skipped, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWriteReported: false } })).toThrow();
    expect(() => ResearchAssistAttemptRecordSchema.parse({ ...outcome.record, code: "request_failed" })).toThrow();
    expect(canonical(outcome.record)).not.toContain(PLANTED.alphaId);
  });

  it("keeps the fixture's composed goal honest: the authored brief, then the input paths", () => {
    const goal = assistComposedGoal();
    expect(goal.startsWith(ASSIST_AUTHORED_BRIEF)).toBe(true);
    expect(goal.slice(ASSIST_AUTHORED_BRIEF.length)).toContain(PLANTED.alphaId);
  });
});

describe("the code review's cases: names, paths, URLs and digests in any form", () => {
  const model = () => new PrivateAgentModel(capturingBroker(() => ({})).broker, assistModelConfig("openai_responses"), "job", "reader");
  /** The fixture's T1 and T2 requests with the first source renamed and the first gist, plan text or first quote replaced. */
  async function variant(edit: { id?: string; gist?: string; question?: string; quote?: string; locator?: string; extraPlanKey?: boolean }) {
    const run = await assistRequests(), first = run.plan.sources[0]!, id = edit.id ?? first.id;
    const sources = run.plan.sources.map((s, i) => i === 0 ? { ...s, id, path: edit.id ?? s.path } : s);
    const sourceIndex = { version: 2 as const, sources: run.plan.sourceIndex.sources.map((entry, i) => i === 0 ? { ...entry, sourceId: id, ...(edit.gist !== undefined ? { gist: edit.gist } : {}) } : entry) };
    const remap = (sourceId: string) => sourceId === first.id ? id : sourceId;
    const plan = { ...run.synthesis.plan, ...(edit.extraPlanKey ? { rationale: `see ${PLANTED.alphaId}` } : {}),
      questions: run.synthesis.plan.questions.map((q, i) => ({ ...q, sourceIds: q.sourceIds.map(remap), ...(i === 0 && edit.question !== undefined ? { text: edit.question } : {}) })) };
    const evidence = { ...run.synthesis.evidence, conflicts: run.synthesis.evidence.conflicts.map(c => ({ ...c, sourceId: remap(c.sourceId) })),
      quotes: run.synthesis.evidence.quotes.map((q, i) => ({ ...q, sourceId: remap(q.sourceId), ...(i === 0 && edit.quote !== undefined ? { quote: edit.quote } : {}), ...(i === 0 && edit.locator !== undefined ? { locator: edit.locator } : {}) })) };
    const t1 = buildPlanAssistPacket(frozen({ ...run.plan, sources, sourceIndex }), { firing: "forced_split", authoredBrief: ASSIST_AUTHORED_BRIEF, model: model() });
    const t2 = buildSynthesisAssistPacket(frozen({ ...run.synthesis, sources, sourceIndex, plan, evidence }), { authoredBrief: ASSIST_AUTHORED_BRIEF, model: model() });
    return { run, t1, t2, alias: `S1` };
  }
  const gistOf = (built: ReturnType<typeof buildPlanAssistPacket>) => { if (!built.ok) throw new Error(built.code); return JSON.parse(built.user).sources[0].gist as string; };
  const t2Of = (built: ReturnType<typeof buildSynthesisAssistPacket>) => { if (!built.ok) throw new Error(built.code); return JSON.parse(built.user) as Record<string, any>; };

  it("replaces absolute, home, Windows, UNC and backslash paths, whole URLs with digests or brackets in them, scheme-less hosts and IPv4 addresses", async () => {
    const gist = ["from /Users/alice/Clients/Acme/merger-plan.docx", "~/Documents/Acme/merger-plan.docx", "C:\\Users\\alice\\Acme\\merger-plan.docx", "\\\\fileserver\\share\\plan.docx",
      "Acme\\plans\\merger.docx", `https://files.acme.example/share/${"a".repeat(64)}/board-minutes-q3.pdf`, "https://acme.example/x?names[]=Alice+Smith&case=4471",
      "https://acme.example/HR_(layoffs_2025)/list", "github.com/acme-corp/merger-tools-private", "10.20.30.40/admin/backup-keys", "(see https://acme.example/a)."].join("; ");
    expect(gistOf((await variant({ gist })).t1)).toBe("from [file]; [file]; [file]; [file]; [file]; [url]; [url]; [url]; [url]; [url]; (see [url]).");
  });

  it("replaces a source's name glued to other text, with another extension, without its extension, or in dotted capitals", async () => {
    const { run, t1 } = await variant({ gist: "copy_of_alpha-field-notes.md, old-alpha-field-notes.md, alpha-field-notes.md.bak, alpha-field-notes.mdx, beta-ledger.xlsx, alpha-field-notes-v2, annual-2025.pdf" });
    const a = aliasOf(run, 0), b = aliasOf(run, 1), w = aliasOf(run, 2);
    expect(gistOf(t1)).toBe(`copy_of_${a}, old-${a}, ${a}, ${a}, ${b}, ${a}-v2, ${w}`);
    const turkish = await variant({ id: "input/corpus/İzmir-rapor-2024.md", gist: "Bkz. İzmir-rapor-2024.md tablosu ve izmir-rapor-2024.md." });
    expect(gistOf(turkish.t1)).toBe("Bkz. S1 tablosu ve S1.");
  });

  it("matches names through zero-width characters, soft hyphens and Unicode hyphens, and finds a known digest's prefix, tail or 0x form", async () => {
    const { run, t1 } = await variant({ gist: "alpha-field-\u200bnotes.md, alpha\u00ad-field-notes.md, alpha\u2010field\u2010notes.md" });
    const a = aliasOf(run, 0);
    expect(gistOf(t1)).toBe(`${a}, ${a}, ${a}`);
    const hash = run.plan.sources[0]!.sha256;
    expect(gistOf((await variant({ gist: `0x${hash.slice(0, 20)}, tail ${hash.slice(40)}, short ${hash.slice(0, 9)}` })).t1)).toBe("0x[digest], tail [digest], short [digest]");
  });

  it("keeps a stem in the owner's brief and in quotes, where it is a word, and replaces it in model text", async () => {
    const stemmed = await variant({ id: "input/data/budget_2024_acme", gist: "see budget_2024_acme and 1x2Y3z4W5v6U7t8S9r0QpOn" });
    expect(gistOf(stemmed.t1)).toBe("see S1 and 1x2Y3z4W5v6U7t8S9r0QpOn");
    const opaque = await variant({ id: "https://docs.example/document/d/1x2Y3z4W5v6U7t8S9r0QpOn/view", gist: "doc 1x2Y3z4W5v6U7t8S9r0QpOn" });
    expect(gistOf(opaque.t1)).toBe("doc S1");
    const quoted = t2Of((await variant({ id: "input/data/budget_2024_acme", quote: "The budget_2024_acme line holds twelve entries." })).t2);
    expect(quoted.evidenceText).toContain("The budget_2024_acme line holds twelve entries.");
  });

  it("replaces file paths and URLs inside verified quotes too, and sends only the plan schema's fields", async () => {
    const { t2 } = await variant({ quote: "See /Users/alice/x.docx and https://elsewhere.test/a for the tally.", extraPlanKey: true });
    const packet = t2Of(t2);
    expect(packet.evidenceText).toContain("See [file] and [url] for the tally.");
    expect(Object.keys(packet.plan).sort()).toEqual(["conflictsToCheck", "deliverableNotes", "questions", "version"]);
    expect((await variant({ locator: "line 3 of input/corpus/alpha-field-notes.md" })).t2).toMatchObject({ ok: false, code: ASSIST_CODES.requestInvalid });
  });

  it("keeps a root URL's host bounded, and never audits the fixed schema against a json-schema.org source", async () => {
    const root = await variant({ id: "https://example.org/", gist: "notexample.org, example.organization, example.org.au, www.example.org, https://example.org" });
    expect(gistOf(root.t1)).toBe("notexample.org, example.organization, example.org.au, www.S1, S1");
    expect((await variant({ id: "https://json-schema.org/draft/2020-12/schema" })).t1.ok).toBe(true);
  });

  it("refuses copies the audit reads case-folded and with names kept: an uppercased opening, a source passage naming a file", async () => {
    const run = await assistRequests(), opening = run.plan.sourceIndex.sources[1]!.literal.opening.text;
    expect((await variant({ gist: opening.slice(0, 120).toUpperCase() })).t1).toMatchObject({ ok: false, packet: { auditFinding: "literal_text" } });
    expect((await variant({ question: "Is it true that the ledger cites alpha-field-notes.md as its source for the orchard tally?" })).t2).toMatchObject({ ok: false, packet: { auditFinding: "literal_text" } });
  });

  it("scans a hostile brief in linear time and refuses a T2 brief too large for its body before any scan", async () => {
    const hostile = `${"a.a.".repeat(1900)}\n`, run = await assistRequests({ authored: hostile });
    const started = performance.now();
    expect(buildPlanAssistPacket(run.plan, { firing: "forced_split", authoredBrief: hostile, model: model() }).ok).toBe(true);
    expect(buildSynthesisAssistPacket(run.synthesis, { authoredBrief: hostile, model: model() }).ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(5_000);
    const huge = `${"Brief sentence. ".repeat(3200)}\n`, big = await assistRequests({ authored: huge });
    expect(buildSynthesisAssistPacket(big.synthesis, { authoredBrief: huge, model: model() })).toMatchObject({ ok: false, code: ASSIST_CODES.packetSize });
  });

  it("lets a cancel win over a used slot, refuses a thinking-off assist model, and checks the stage record's own rules", async () => {
    const run = await frozenRun(), f = cachingAssistModel("openai_responses", answer), assists = wrap(f.model);
    await assists.plan!(run.plan, signal());
    const aborted = new AbortController(); aborted.abort();
    expect(await assists.plan!(run.plan, aborted.signal)).toMatchObject({ kind: "stop", code: "cancelled" });
    expect(() => wrap(new PrivateAgentModel(capturingBroker(() => ({})).broker, { ...assistModelConfig("openai_responses"), thinking: "disabled" }, "job", "reader"))).toThrow("research_assist_config_invalid");
    const settled = { version: 1, touchpoint: "T1", ordinal: 1, retryAfterTruncation: false, outcome: "settled", dispatched: true, finish: "stop", feeMicrousd: 1,
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWriteReported: true } };
    const skipped = { version: 1, touchpoint: "T1", ordinal: 1, retryAfterTruncation: false, outcome: "skipped", code: "transport_or_settlement_unknown", dispatched: true };
    const stage = { version: 1, touchpoint: "T1", policy: "forced_split", fired: true, trigger: "forced_split", accepted: false };
    const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(ResearchAssistStageRecordSchema.safeParse({ ...stage, attempts: [skipped], outcome: "skipped", code: "transport_or_settlement_unknown", usage: zero }).success).toBe(false);
    expect(ResearchAssistStageRecordSchema.safeParse({ ...stage, attempts: [{ ...settled, touchpoint: "T2" }], outcome: "settled", usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } }).success).toBe(false);
    expect(ResearchAssistStageRecordSchema.safeParse({ ...stage, fired: false, trigger: null, attempts: [settled], usage: null }).success).toBe(false);
    expect(ResearchAssistStageRecordSchema.safeParse({ ...stage, attempts: [skipped], outcome: "skipped", accepted: true, usage: null }).success).toBe(false);
    expect(ResearchAssistStageRecordSchema.safeParse({ ...stage, attempts: [settled], outcome: "settled", accepted: true, usage: zero }).success).toBe(false);
    expect(ResearchAssistStageRecordSchema.safeParse({ ...stage, attempts: [settled], outcome: "settled", accepted: true, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } }).success).toBe(true);
    expect(ResearchAssistStageRecordSchema.safeParse({ ...stage, fired: false, trigger: null, attempts: [], usage: null }).success).toBe(true);
  });
});
