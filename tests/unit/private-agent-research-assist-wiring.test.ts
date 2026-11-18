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
import type { ResearchAdmissionRates } from "../../src/main/private-agent/research-admission";
import { inventoryResearchSources } from "../../src/main/private-agent/research-coverage";
import { RESEARCH_PROTOCOL_SHA256, RESEARCH_PROTOCOL_SHA256_ADMISSION_ASSIST, RESEARCH_PROTOCOL_SHA256_ASSIST } from "../helpers/research-protocol-pin";
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
async function run(firing: ResearchAssistFiring, shape: AssistShape, options: { reject?: ("plan" | "synthesis")[]; script?: (purpose: string, n: number) => Reply | undefined;
  admission?: ResearchAdmissionRates; deadlineMs?: number; budget?: typeof RESEARCH_PIPELINE_BUDGET; extractFailures?: number } = {}) {
  const fake = cloud(shape, options.script);
  const assists = createResearchAssists({ firing, model: fake.model, authoredBrief: ASSIST_AUTHORED_BRIEF, maxFeeMicrousd: ASSIST_FEE_CAP_MICROUSD });
  const outcome = await runResearchPipeline({ brief: assistComposedGoal(), sources: assistSources(), models: assistLocalModels(new Set(options.reject ?? []), { extractFailures: options.extractFailures ?? 0 }),
    signal: new AbortController().signal, record: () => {}, assists, deadlineMs: options.deadlineMs ?? Number.POSITIVE_INFINITY,
    ...(options.admission ? { admission: options.admission } : {}), ...(options.budget ? { budget: options.budget } : {}) });
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
    expect(outcome.summary.protocolSha256).toBe(RESEARCH_PROTOCOL_SHA256_ASSIST.local_first);
  });
});

describe("10.b: the protocol binding (decision 6)", () => {
  it("leaves the default unchanged and binds each firing's assist block only when one is given", () => {
    expect(researchProtocolSha256()).toBe(RESEARCH_PROTOCOL_SHA256);
    expect(researchProtocolSha256(RESEARCH_PIPELINE_BUDGET, undefined, false, undefined)).toBe(RESEARCH_PROTOCOL_SHA256);
    const bound = (["local_first", "forced_split"] as const).map(firing => researchProtocolSha256(RESEARCH_PIPELINE_BUDGET, undefined, false, firing));
    expect(new Set([RESEARCH_PROTOCOL_SHA256, ...bound]).size).toBe(3);
    // The block is the assist protocol's: a change to it (its digest) changes the bound hash.
    expect(researchAssistProtocolSha256("local_first")).not.toBe(researchAssistProtocolSha256("forced_split"));
  });
  it("pins the four bound hashes (10.b's second review): each firing, without and with a card's admission policy", () => {
    for (const firing of ["forced_split", "local_first"] as const) {
      expect(researchProtocolSha256(RESEARCH_PIPELINE_BUDGET, undefined, false, firing)).toBe(RESEARCH_PROTOCOL_SHA256_ASSIST[firing]);
      expect(researchProtocolSha256(RESEARCH_PIPELINE_BUDGET, undefined, true, firing)).toBe(RESEARCH_PROTOCOL_SHA256_ADMISSION_ASSIST[firing]);
    }
  });
});

/**
 * 10.b's second review, minor 1 (BL-20261117-1216-correction-assist-wiring-card-admission-merge, decision 4): the real wrapper inside
 * the pipeline under a card's admission rates (7b.3), with item (ii)'s second repair, which only those rates allow.
 */
describe("10.b under a card's admission rates and item (ii)'s second repair", () => {
  const rates: ResearchAdmissionRates = { prefillTokensPerSecond: { fastest: 4000, slowest: 2000 }, decodeTokensPerSecond: { fastest: 100, slowest: 50 },
    fanOutDecodeTokensPerSecond: { fastest: 100, slowest: 50 }, expectedOutputTokens: { plan: 1000, extract: 100, synthesis: 2000 } };
  const hour = () => performance.now() + 3_600_000;
  const gate = (outcome: Awaited<ReturnType<typeof run>>["outcome"], firing: ResearchAssistFiring) => validateReadyResearchPacket(outcome.files, { brief: assistComposedGoal(),
    sources: assistSources(), protocolSha256: RESEARCH_PROTOCOL_SHA256_ADMISSION_ASSIST[firing], assistFiring: firing });

  it.each(["openai_responses", "anthropic_messages"] as const)("on %s under forced_split: T2 is built after a second repair and carries every quote of a run whose chunk never failed, T1 is that run's; without the card the run stops before T2", async shape => {
    const clean = await run("forced_split", shape, { admission: rates, deadlineMs: hour() });
    const repaired = await run("forced_split", shape, { admission: rates, deadlineMs: hour(), extractFailures: 2 });
    for (const { outcome } of [clean, repaired]) {
      expect(outcome).toMatchObject({ status: "completed", reason: "research_packet_ready", summary: { protocolSha256: RESEARCH_PROTOCOL_SHA256_ADMISSION_ASSIST.forced_split, admission: { decision: "admitted" } } });
      expect(() => gate(outcome, "forced_split")).not.toThrow();
    }
    // The second repair saved the chunk its first repair left invalid, and the extract row counts it.
    expect(repaired.outcome.summary.stages.find(row => row.stage === "extract")).toMatchObject({ repairCalls: 2, secondRepairCalls: 1, secondRepairsComplete: 1 });
    const attempts = (JSON.parse(repaired.outcome.files.find(file => file.path === RESEARCH_FILES.coverage)!.bytes.toString()).chunks as { attempts?: { status: string }[] }[])
      .map(chunk => (chunk.attempts ?? []).map(attempt => attempt.status));
    expect(attempts.filter(statuses => statuses.length === 3)).toEqual([["invalid", "invalid", "complete"]]);
    // T1 is built before extraction, so it is the clean run's byte for byte. T2 is built after every repair pass: it carries every quote the
    // clean run's T2 carries, the recovered chunk's included, and its counts-only coverage and every other field are the clean run's. Only
    // the evidence's order moves, which follows when each chunk completed: the recovered quotes come last, and the ids are renumbered.
    expect(repaired.requests.map(request => request.purpose)).toEqual([PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE]);
    expect(repaired.requests[0]!.body).toBe(clean.requests[0]!.body);
    const [cleanT2, repairedT2] = [clean, repaired].map(result => assistPacketOf(result.requests[1]!.body));
    const quotes = (packet: Record<string, any>) => (packet.evidenceText as string).split("\n").filter(line => /^- \[E\d+\] /u.test(line)).map(line => line.replace(/^- \[E\d+\] /u, "")).sort();
    expect(quotes(repairedT2).length).toBeGreaterThan(0); expect(quotes(repairedT2)).toEqual(quotes(cleanT2));
    expect({ ...repairedT2, evidenceText: null }).toEqual({ ...cleanT2, evidenceText: null });
    for (const row of [repaired.plan, repaired.synthesis]) expect(row.assist).toMatchObject({ policy: "forced_split", fired: true, trigger: "forced_split", accepted: true });
    // Without the card's rates the chunk ends after its one repair: the run stops at extraction and T2 is never built.
    const plain = await run("forced_split", shape, { extractFailures: 2 });
    expect(plain.outcome).toMatchObject({ status: "incomplete", reason: "research_extraction_incomplete" });
    expect(plain.requests.map(request => request.purpose)).toEqual([PLAN_ASSIST_PURPOSE]);
  });

  it("under local_first: T1 after the rejected local plans and T2 after the refused syntheses, each recorded, under the bound hash", async () => {
    const { outcome, requests, plan, synthesis } = await run("local_first", "anthropic_messages", { admission: rates, deadlineMs: hour(), reject: ["plan", "synthesis"] });
    expect(outcome).toMatchObject({ status: "completed", summary: { protocolSha256: RESEARCH_PROTOCOL_SHA256_ADMISSION_ASSIST.local_first, admission: { decision: "admitted" } } });
    expect(requests.map(request => request.purpose)).toEqual([PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE]);
    expect(plan.assist).toMatchObject({ trigger: "local_plans_rejected", accepted: true }); expect(synthesis.assist).toMatchObject({ trigger: "local_syntheses_refused", accepted: true });
    expect(() => gate(outcome, "local_first")).not.toThrow();
  });

  it.each(["forced_split", "local_first"] as const)("under %s, a card that refuses the run on its budget or its clock sends neither T1 nor T2, and no stage runs", async firing => {
    // Every chunk's call fits the budget, but not the repair reserve admission keeps; and a clock of one second.
    const chunks = inventoryResearchSources(assistSources()).chunks.length;
    const refusals = [[{ budget: { ...RESEARCH_PIPELINE_BUDGET, extractionCalls: chunks }, deadlineMs: hour() }, "refused_budget", "research_mandatory_budget_exceeded"],
      [{ deadlineMs: performance.now() + 1_000 }, "refused_clock", "research_infeasible_in_clock"]] as const;
    for (const [options, decision, reason] of refusals) {
      const { outcome, requests } = await run(firing, "anthropic_messages", { admission: rates, reject: ["plan", "synthesis"], ...options });
      expect(outcome).toMatchObject({ status: "incomplete", reason, summary: { admission: { decision } } });
      expect(requests).toHaveLength(0); expect(outcome.summary.stages).toHaveLength(0);
    }
  });
});

/** 10.b's second review, nit 3: T2's scrubber knows every plan attempt's reply digest, as T1's knows its prior attempts'. */
describe("10.b: T2's known digests hold the plan stage's attempts", () => {
  it("scrubs a piece of a plan reply's digest that the plan carries into T2, which T2 sent before", async () => {
    const { synthesis, outcome } = await assistRequests();
    const attempt = outcome.summary.stages.find(row => row.stage === "plan")!.planAttempts![0]!, piece = attempt.replyContentSha256.slice(8, 24);
    const plan = structuredClone(synthesis.plan); plan.questions[0]!.text = `${plan.questions[0]!.text} Compare run ${piece} first.`;
    const build = (planAttempts?: (typeof attempt)[]) => buildSynthesisAssistPacket({ ...synthesis, plan, ...(planAttempts ? { planAttempts } : {}) },
      { authoredBrief: ASSIST_AUTHORED_BRIEF, model: cloud("anthropic_messages").model });
    const before = build(), after = build([attempt]);
    expect(before.ok && before.user).toContain(piece);
    expect(after).toMatchObject({ ok: true }); expect(after.ok && after.user).not.toContain(piece);
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
