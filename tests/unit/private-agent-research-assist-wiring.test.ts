import { describe, expect, it } from "vitest";
import { canonical } from "../../src/main/private-agent/contracts";
import { PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE } from "../../src/main/private-agent/dispatch-purposes";
import { ASSIST_CODES, ASSIST_FIELD_CAPS, ASSIST_SERVED_MODEL_MAX_CHARS, ResearchAssistAttemptRecordSchema, assistServedModel, buildPlanAssistPacket, buildSynthesisAssistPacket,
  createResearchAssists, researchAssistProtocolSha256 } from "../../src/main/private-agent/research-assist";
import type { ResearchAssistFiring } from "../../src/main/private-agent/research-assist-contract";
import { validateReadyResearchPacket } from "../../src/main/private-agent/research-coverage";
import { INDEX_LIMITS } from "../../src/main/private-agent/research-index";
import { RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET, researchProtocolSha256, runResearchPipeline } from "../../src/main/private-agent/research-pipeline";
import { ResearchPlanSchema } from "../../src/main/private-agent/research-plan";
import { ResearchEvidenceSchema } from "../../src/main/private-agent/research-coverage";
import { RESEARCH_PROTOCOL_SHA256 } from "../helpers/research-protocol-pin";
import { researchV4Reply } from "../helpers/research-v4-fixture";
import { ASSIST_AUTHORED_BRIEF, ASSIST_FEE_CAP_MICROUSD, assistComposedGoal, assistLocalModels, assistPacketOf, assistRequests, assistSources, cachingAssistModel,
  type AssistShape } from "../helpers/research-assist-fixture";

/**
 * Backlog item 10's PR 10.b (BL-20261117-1202-assist-wiring-design): item 10's real wrapper inside the pipeline, the stage record and
 * the ready gate's reading of it, the protocol binding, and the wrapper's three additions. The cloud is a capturing fake that answers
 * by the provider's documented caching rules; no request leaves the process.
 */
type Reply = string | { content: string; truncated: boolean };
/** An assist model that answers each touchpoint from the packet it was sent, as an honest cloud model would, unless `script` says otherwise. */
function cloud(shape: AssistShape, script: (purpose: string, n: number) => Reply | undefined = () => undefined) {
  const counts = new Map<string, number>();
  return cachingAssistModel(shape, (body, purpose) => {
    const n = counts.get(purpose) ?? 0; counts.set(purpose, n + 1);
    return script(purpose, n) ?? researchV4Reply(purpose === PLAN_ASSIST_PURPOSE ? "You plan" : "You write", canonical(assistPacketOf(body)));
  });
}
async function run(firing: ResearchAssistFiring, shape: AssistShape, options: { reject?: ("plan" | "synthesis")[]; script?: (purpose: string, n: number) => Reply | undefined } = {}) {
  const fake = cloud(shape, options.script);
  const assists = createResearchAssists({ firing, model: fake.model, authoredBrief: ASSIST_AUTHORED_BRIEF, maxFeeMicrousd: ASSIST_FEE_CAP_MICROUSD });
  const outcome = await runResearchPipeline({ brief: assistComposedGoal(), sources: assistSources(), models: assistLocalModels(new Set(options.reject ?? [])), signal: new AbortController().signal,
    record: () => {}, assists, deadlineMs: Number.POSITIVE_INFINITY });
  return { outcome, requests: fake.requests, plan: outcome.summary.stages[1]!, synthesis: outcome.summary.stages[3]! };
}

describe("10.b: item 10's real wrapper inside the pipeline (decisions 7 and 12)", () => {
  it.each(["openai_responses", "anthropic_messages"] as const)("under local_first on %s: T1 after two rejected local plans at ordinal 3, T2 after two refused syntheses at ordinal 3 and its retry after truncation at ordinal 4, each recorded with its slot", async shape => {
    const { outcome, requests, plan, synthesis } = await run("local_first", shape, { reject: ["plan", "synthesis"],
      script: (purpose, n) => purpose === SYNTHESIS_ASSIST_PURPOSE && n === 0 ? { content: "{\"version\":1", truncated: true } : undefined });
    expect(outcome).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(requests.map(request => request.purpose)).toEqual([PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE]);
    expect(plan.planAttempts!.map(a => [a.ordinal, a.slot ?? "stage", a.accepted])).toEqual([[1, "stage", false], [2, "stage", false], [3, "assist", true]]);
    expect(synthesis.synthesisAttempts!.map(a => [a.ordinal, a.slot ?? "stage", a.truncated, a.accepted])).toEqual([[1, "stage", false, false], [2, "stage", false, false],
      [3, "assist", true, false], [4, "assist_retry", false, true]]);
    expect(plan.assist).toMatchObject({ version: 1, touchpoint: "T1", policy: "local_first", fired: true, trigger: "local_plans_rejected", outcome: "settled", accepted: true });
    expect(plan.assist!.code).toBeUndefined();
    expect(synthesis.assist).toMatchObject({ touchpoint: "T2", policy: "local_first", fired: true, trigger: "local_syntheses_refused", outcome: "settled", accepted: true });
    expect(synthesis.assist!.attempts.map(a => [a.ordinal, a.retryAfterTruncation, a.outcome, a.finish])).toEqual([[1, false, "settled", "length"], [2, true, "settled", "stop"]]);
    // Each settled attempt records its usage once: zero writes the provider reported, the model it served, the fee; the row's own usage holds them already.
    for (const attempt of [...plan.assist!.attempts, ...synthesis.assist!.attempts]) {
      expect(attempt.usage).toMatchObject({ cacheWriteReported: true, cacheWriteTokens: 0 });
      expect(attempt.servedModel).toBe(shape === "openai_responses" ? "gpt-6-sol" : "claude-sonnet-5-5");
    }
    expect(plan.assist!.usage).toEqual({ inputTokens: plan.assist!.attempts[0]!.usage!.inputTokens, outputTokens: plan.assist!.attempts[0]!.usage!.outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });
    // The retry's evidence is at most half the first packet's (review §5.2, S6c), as the packet records show.
    const [first, retry] = synthesis.assist!.attempts.map(a => a.packet!.evidenceBytes!);
    expect(retry).toBeLessThanOrEqual(Math.floor(first! / 2));
    // The ready gate accepted the packet: the records match the slot attempts.
    expect(() => validateReadyResearchPacket(outcome.files, { brief: assistComposedGoal(), sources: assistSources(), protocolSha256: researchProtocolSha256(RESEARCH_PIPELINE_BUDGET, undefined, false, "local_first") })).not.toThrow();
  });

  it("under forced_split, a rejected T1 reply leads to the local planner (a mixed sequence) and an accepted T2 needs no local synthesis", async () => {
    const { outcome, plan, synthesis } = await run("forced_split", "openai_responses", { script: purpose => purpose === PLAN_ASSIST_PURPOSE ? "not a plan from the assist" : undefined });
    expect(outcome.status).toBe("completed");
    expect(plan.planAttempts!.map(a => [a.ordinal, a.slot ?? "stage", a.accepted])).toEqual([[1, "assist", false], [2, "stage", true]]);
    expect(plan.assist).toMatchObject({ trigger: "forced_split", fired: true, outcome: "settled", accepted: false, code: "assist_reply_rejected" });
    expect(synthesis.synthesisAttempts!.map(a => [a.ordinal, a.slot ?? "stage", a.accepted])).toEqual([[1, "assist", true]]);
    expect(synthesis.assist).toMatchObject({ trigger: "forced_split", fired: true, outcome: "settled", accepted: true });
  });

  it("records an unfired local-first touchpoint as such, and binds the firing into the summary's protocol hash", async () => {
    const { outcome, requests, plan, synthesis } = await run("local_first", "openai_responses");
    expect(requests).toHaveLength(0);
    for (const [row, touchpoint] of [[plan, "T1"], [synthesis, "T2"]] as const)
      expect(row.assist).toEqual({ version: 1, touchpoint, policy: "local_first", fired: false, trigger: null, attempts: [], accepted: false, usage: null });
    expect(outcome.summary.protocolSha256).toBe(researchProtocolSha256(RESEARCH_PIPELINE_BUDGET, undefined, false, "local_first"));
  });
});

describe("10.b: the protocol binding (decision 6)", () => {
  it("leaves the default unchanged and binds each firing's assist block only when one is given", () => {
    expect(researchProtocolSha256()).toBe(RESEARCH_PROTOCOL_SHA256);
    expect(researchProtocolSha256(RESEARCH_PIPELINE_BUDGET, undefined, undefined)).toBe(RESEARCH_PROTOCOL_SHA256);
    const bound = (["local_first", "forced_split"] as const).map(firing => researchProtocolSha256(RESEARCH_PIPELINE_BUDGET, undefined, false, firing));
    expect(new Set([RESEARCH_PROTOCOL_SHA256, ...bound]).size).toBe(3);
    // The block is the assist protocol's: a change to it (its digest) changes the bound hash.
    expect(researchAssistProtocolSha256("local_first")).not.toBe(researchAssistProtocolSha256("forced_split"));
  });
});

describe("10.b: the ready gate reads the assist record (decision 8)", () => {
  type Files = { path: string; bytes: Buffer }[];
  const edit = (files: Files, mutate: (summary: any) => void): Files => files.map(file => {
    if (file.path !== RESEARCH_FILES.summary) return { path: file.path, bytes: Buffer.from(file.bytes) };
    const value = JSON.parse(file.bytes.toString()); mutate(value); return { path: file.path, bytes: Buffer.from(`${canonical(value)}\n`) };
  });
  it("refuses a record that is missing, misplaced, of another policy, mis-counted or mis-accepted, and one that does not parse strictly", async () => {
    const { outcome } = await run("local_first", "openai_responses", { reject: ["plan"] });
    const expectation = { brief: assistComposedGoal(), sources: assistSources(), protocolSha256: outcome.summary.protocolSha256 };
    expect(() => validateReadyResearchPacket(outcome.files, expectation)).not.toThrow();
    // Each forgery is refused with the gate's own code; only the strict parse's refusal is the schema's (an unrecognized key).
    const STAGE_ASSIST = "research_packet_stage_assist";
    const forgeries: [string, (summary: any) => void, string | RegExp][] = [
      ["a slot attempt without its record", s => { delete s.stages[1].assist; delete s.stages[3].assist; }, STAGE_ASSIST],
      // T2 did not fire here, so only the both-or-neither rule sees its record go.
      ["one touchpoint recorded and not the other", s => { delete s.stages[3].assist; }, STAGE_ASSIST],
      ["a record on the index row", s => { s.stages[0].assist = s.stages[1].assist; }, "research_packet_stage_keys"],
      ["two policies", s => { s.stages[3].assist.policy = "forced_split"; }, STAGE_ASSIST],
      ["a settled attempt the row does not count", s => { s.stages[1].planAttempts = s.stages[1].planAttempts.filter((a: any) => a.slot === undefined); s.stages[1].calls -= 1; }, /^research_packet_/u],
      ["an accepted record beside a rejected slot attempt", s => { s.stages[1].planAttempts.at(-1).accepted = false; }, /^research_packet_/u],
      ["an unknown key in the record", s => { s.stages[1].assist.note = "text"; }, /note/u],
      ["a T2 record on the plan row", s => { s.stages[1].assist.touchpoint = "T2"; for (const a of s.stages[1].assist.attempts) a.touchpoint = "T2"; }, STAGE_ASSIST],
    ];
    expect(outcome.summary.stages[3]!.assist).toMatchObject({ fired: false });
    for (const [name, forge, code] of forgeries) expect(() => validateReadyResearchPacket(edit(outcome.files, forge), expectation), name).toThrow(code);
    // A fired record's trigger is its policy's for its touchpoint.
    expect(() => validateReadyResearchPacket(edit(outcome.files, s => { s.stages[1].assist.trigger = "forced_split"; }), expectation)).toThrow(STAGE_ASSIST);
  });

  it("ties the records to the firing the caller knows: a firing needs both records under it, and null forbids any (the pipeline's own check and the seed loader pass it)", async () => {
    const { outcome } = await run("local_first", "openai_responses", { reject: ["plan"] });
    const expectation = { brief: assistComposedGoal(), sources: assistSources(), protocolSha256: outcome.summary.protocolSha256 };
    expect(() => validateReadyResearchPacket(outcome.files, { ...expectation, assistFiring: "local_first" })).not.toThrow();
    expect(() => validateReadyResearchPacket(outcome.files, { ...expectation, assistFiring: "forced_split" })).toThrow("research_packet_stage_assist");
    expect(() => validateReadyResearchPacket(outcome.files, { ...expectation, assistFiring: null })).toThrow("research_packet_stage_assist");
    const relabelled = edit(outcome.files, s => { for (const stage of [s.stages[1], s.stages[3]]) { stage.assist.policy = "forced_split"; if (stage.assist.fired) stage.assist.trigger = "forced_split"; } });
    expect(() => validateReadyResearchPacket(relabelled, expectation)).not.toThrow();
    expect(() => validateReadyResearchPacket(relabelled, { ...expectation, assistFiring: "local_first" })).toThrow("research_packet_stage_assist");
    // Records on a run without a hook, and a run with a hook whose records were removed: the known firing refuses both.
    const plain = (await runResearchPipeline({ brief: assistComposedGoal(), sources: assistSources(), models: assistLocalModels(), signal: new AbortController().signal, record: () => {} })).files;
    const unfired = { version: 1, policy: "local_first", fired: false, trigger: null, attempts: [], accepted: false, usage: null };
    const forged = edit(plain, s => { s.stages[1].assist = { ...unfired, touchpoint: "T1" }; s.stages[3].assist = { ...unfired, touchpoint: "T2" }; });
    expect(() => validateReadyResearchPacket(forged, { brief: assistComposedGoal(), sources: assistSources() })).not.toThrow();
    expect(() => validateReadyResearchPacket(forged, { brief: assistComposedGoal(), sources: assistSources(), assistFiring: null })).toThrow("research_packet_stage_assist");
    const stripped = edit((await run("local_first", "openai_responses")).outcome.files, s => { delete s.stages[1].assist; delete s.stages[3].assist; });
    expect(() => validateReadyResearchPacket(stripped, { brief: assistComposedGoal(), sources: assistSources(), assistFiring: "local_first" })).toThrow("research_packet_stage_assist");
  });
});

describe("10.b: the wrapper's additions (decision 9)", () => {
  it("caps each scrubbed field at its caller's cap: the plan schema's, the index's gist and the evidence schema's quote, refusing before any request", async () => {
    // The caps are the callers' own: one more character than each fails its own schema.
    expect(ASSIST_FIELD_CAPS.gist).toBe(INDEX_LIMITS.gistChars);
    const plan = (question: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ version: 2, questions: [{ id: "Q1", text: "t", requirementIds: ["U1"], sourceIds: [], ...question }], ...extra });
    for (const [question, extra] of [[{ text: "x".repeat(ASSIST_FIELD_CAPS.planText) }, {}], [{ lookFor: ["x".repeat(ASSIST_FIELD_CAPS.lookFor)] }, {}],
      [{}, { conflictsToCheck: ["x".repeat(ASSIST_FIELD_CAPS.conflictsToCheck)] }], [{}, { deliverableNotes: "x".repeat(ASSIST_FIELD_CAPS.deliverableNotes) }]] as const) {
      expect(ResearchPlanSchema.safeParse(plan(question, extra)).success).toBe(true);
      const over = Object.fromEntries(Object.entries({ ...question, ...extra }).map(([key, value]) => [key, Array.isArray(value) ? [`${value[0]}x`] : `${value}x`]));
      expect(ResearchPlanSchema.safeParse(plan(Object.fromEntries(Object.entries(over).filter(([key]) => key in question)), Object.fromEntries(Object.entries(over).filter(([key]) => key in extra)))).success).toBe(false);
    }
    const quoteShape = ResearchEvidenceSchema.shape.quotes.element.shape.quote;
    expect(quoteShape.safeParse("x".repeat(ASSIST_FIELD_CAPS.quote)).success).toBe(true); expect(quoteShape.safeParse("x".repeat(ASSIST_FIELD_CAPS.quote + 1)).success).toBe(false);
    // Over a cap, each touchpoint refuses as a recorded fallback, before any scrub or request.
    const requests = await assistRequests(), model = cloud("openai_responses").model;
    const longGist = structuredClone(requests.plan); (longGist.sourceIndex.sources[0] as { gist: string }).gist = "g".repeat(ASSIST_FIELD_CAPS.gist + 1);
    expect(buildPlanAssistPacket(longGist, { firing: "forced_split", authoredBrief: ASSIST_AUTHORED_BRIEF, model })).toMatchObject({ ok: false, code: ASSIST_CODES.fieldTooLong });
    const longText = structuredClone(requests.synthesis); longText.plan.questions[0]!.text = "q".repeat(ASSIST_FIELD_CAPS.planText + 1);
    expect(buildSynthesisAssistPacket(longText, { authoredBrief: ASSIST_AUTHORED_BRIEF, model })).toMatchObject({ ok: false, code: ASSIST_CODES.fieldTooLong });
    const longQuote = structuredClone(requests.synthesis); longQuote.evidence.quotes[0]!.quote = "w".repeat(ASSIST_FIELD_CAPS.quote + 1);
    expect(buildSynthesisAssistPacket(longQuote, { authoredBrief: ASSIST_AUTHORED_BRIEF, model })).toMatchObject({ ok: false, code: ASSIST_CODES.fieldTooLong });
    const fake = cloud("openai_responses"), wrapper = createResearchAssists({ firing: "forced_split", model: fake.model, authoredBrief: ASSIST_AUTHORED_BRIEF, maxFeeMicrousd: ASSIST_FEE_CAP_MICROUSD });
    expect(await wrapper.plan!(longGist, new AbortController().signal)).toMatchObject({ kind: "no_reply", outcome: "refused", code: ASSIST_CODES.fieldTooLong, record: { outcome: "refused", dispatched: false } });
    expect(fake.requests).toHaveLength(0);
  });

  it("gives T2's coverage the local trim counts: quotes the local packet left out, and per question the chunks whose evidence it trimmed", async () => {
    const requests = await assistRequests(), synthesis = structuredClone(requests.synthesis);
    synthesis.evidence.counts.leftByCap = 3;
    synthesis.coverage.chunks[0]!.questions = synthesis.coverage.chunks[0]!.questions.map(q => ({ ...q, status: "evidence_trimmed" as const }));
    const built = buildSynthesisAssistPacket(synthesis, { authoredBrief: ASSIST_AUTHORED_BRIEF, model: cloud("openai_responses").model });
    expect(built.ok).toBe(true);
    const packet = JSON.parse((built as { user: string }).user);
    expect(packet.coverage.quotesTrimmedLocally).toBe(3);
    const trimmed = (questionId: string) => synthesis.coverage.chunks.filter(chunk => chunk.questions.some(q => q.questionId === questionId && q.status === "evidence_trimmed")).length;
    expect(packet.coverage.questions.map((q: any) => [q.questionId, q.chunksWithTrimmedEvidence])).toEqual(synthesis.plan.questions.map(q => [q.id, trimmed(q.id)]));
  });

  it("records the served model on a settled attempt only, as a model identifier of at most 200 characters, never free text", async () => {
    for (const good of ["claude-sonnet-5-5", "gpt-6-sol", "models/gemini-2.5@001", "Qwen3.6-27B:fp8"]) expect(assistServedModel(good)).toBe(good);
    for (const bad of [undefined, "", "m".repeat(ASSIST_SERVED_MODEL_MAX_CHARS + 1), "model\u0000", 7, "claude sonnet", "gpt-6-sol\n", "-leading-dash", "see /var/data/x"]) expect(assistServedModel(bad)).toBeUndefined();
    expect(assistServedModel("m".repeat(ASSIST_SERVED_MODEL_MAX_CHARS))).toHaveLength(ASSIST_SERVED_MODEL_MAX_CHARS);
    const refused = { version: 1, touchpoint: "T1", ordinal: 1, retryAfterTruncation: false, outcome: "refused", code: "budget_denied", dispatched: false };
    expect(ResearchAssistAttemptRecordSchema.safeParse(refused).success).toBe(true);
    expect(ResearchAssistAttemptRecordSchema.safeParse({ ...refused, servedModel: "claude-sonnet-5-5" }).success).toBe(false);
  });
});
