import { describe, expect, it, vi } from "vitest";
import { BrokerError, type PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { RESEARCH_FILES, RESEARCH_PACKET_MAX_BYTES, RESEARCH_PIPELINE_BUDGET, locateQuote, normalizeQuoteText, parseJsonReply, researchProtocolSha256, researchSourceText,
  runResearchPipeline, stripUnknownCitations, type ResearchStageCounts } from "../../src/main/private-agent/research-pipeline";

const SOURCE_A = "# Battery storage 2024\nU.S. battery storage capacity   nearly doubled in 2024, from 15 GW to 29 GW.\nDevelopers plan to add １８ GW in 2025.\n";
const SOURCE_B = "# Newsletter\nAnalysts expect 2025 additions of 16 GW, below developer plans.\nTexas and California hold most capacity.\n";
type Script = (stage: "index" | "plan" | "extract" | "synthesise", user: string) => string | Error;
/** A model whose replies come from a script keyed by stage (an Error is thrown by the broker); every dispatched call is recorded. */
function models(script: Script) {
  const calls: { stage: string; user: string; purpose: string; maxOutputTokens: number; thinkingOff: boolean; reasoning?: string }[] = [];
  const stageOf = (system: string) => system.startsWith("You index") ? "index" : system.startsWith("You plan") ? "plan" : system.startsWith("You extract") ? "extract" : "synthesise";
  const request = vi.fn(async (input: { body: string; purpose: string }, settle: (bytes: Buffer) => number) => {
    const body = JSON.parse(input.body) as { messages: { content: string }[]; max_tokens: number; chat_template_kwargs?: { enable_thinking?: boolean }; reasoning_effort?: string };
    const stage = stageOf(body.messages[0]!.content), content = script(stage, body.messages[1]!.content);
    if (content instanceof Error) throw content;
    calls.push({ stage, user: body.messages[1]!.content, purpose: input.purpose, maxOutputTokens: body.max_tokens, thinkingOff: body.chat_template_kwargs?.enable_thinking === false, reasoning: body.reasoning_effort });
    const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } } }));
    return { bytes, receipt: { feeMicrousd: settle(bytes) } };
  });
  // The heavy profile's output limit, so the H3 8,192-token caps are visible (a smaller limit would clamp them).
  const config = { destinationId: "owned", model: "RM-01 VLM", maxOutputTokens: 16_384, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium" as const };
  const make = () => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, "job", "reader");
  return { models: { reader: make(), planner: make(), synthesiser: make() }, calls };
}
const sources = () => [{ id: "input/corpus/a.md", path: "input/corpus/a.md", bytes: Buffer.from(SOURCE_A) }, { id: "input/corpus/b.md", path: "input/corpus/b.md", bytes: Buffer.from(SOURCE_B) }];
const plan = (questions: { id: string; text: string; sourceIds: string[] }[]) => JSON.stringify({ version: 1, questions, conflictsToCheck: ["2025 additions: plans versus expectations"], deliverableNotes: "One table." });
const happy: Script = (stage, user) => {
  if (stage === "index") return `Here is the index: ${JSON.stringify({ sources: [{ sourceId: "input/corpus/a.md", title: "Battery storage 2024", date: "2024", gist: "Capacity doubled.", figures: ["29 GW in 2024"] },
    { sourceId: "input/corpus/b.md", title: "Newsletter", gist: "Analyst outlook." }] })}`;
  if (stage === "plan") return plan([{ id: "Q1", text: "How did capacity develop?", sourceIds: ["input/corpus/a.md", "input/missing.md"] }, { id: "Q2", text: "How reliable are plans?", sourceIds: ["input/corpus/b.md", "input/corpus/a.md"] }]);
  if (stage === "extract") {
    if (user.includes("=== source input/corpus/a.md")) return JSON.stringify({ quotes: [
      { quote: "capacity nearly  doubled in 2024, from 15 GW to 29 GW", note: "the headline figure" },           // whitespace differs from the source: normalised match
      { quote: "from 15 GW to 29 GW. Developers plan to add 18 GW in 2025.", note: "spans two lines; fullwidth digits in the source" },
      { quote: "capacity roughly doubled last year", note: "a paraphrase: must be dropped" },
      { quote: "capacity nearly doubled in 2024, from 15 GW to 29 GW", note: "duplicate of the first" },
      { quote: "short", note: "too short" }], conflicts: [{ note: "Plans of 18 GW against the newsletter's 16 GW." }] });
    return JSON.stringify({ quotes: [{ quote: "Analysts expect 2025 additions of 16 GW, below developer plans.", note: "the outlook" }], conflicts: [] });
  }
  return "Capacity nearly doubled [E1], and plans for 2025 are contested [E2] [E9].\n\n## Conflicting evidence\nPlans against outlook [E3].\n\n## Unanswered questions\nNone.";
};
const run = (m: ReturnType<typeof models>, extra: Partial<Parameters<typeof runResearchPipeline>[0]> = {}, events: ResearchStageCounts[] = []) =>
  runResearchPipeline({ brief: "Brief text.", sources: sources(), models: m.models, signal: new AbortController().signal, record: event => events.push(event), ...extra });

describe("research pipeline: the claims check's normalisation and locator, ported", () => {
  it("normalises like the python check: NFKC, whitespace collapsed, no outer spaces", () => {
    expect(normalizeQuoteText("  a\u00a0 b\t\u3000c\u2028d ")).toBe("a b c d");
    expect(normalizeQuoteText("１８ GW")).toBe("18 GW");
    expect(normalizeQuoteText("\x1c x \x1f")).toBe("x");
  });
  it("locates a normalised quote across normalised lines joined by single spaces and names the line range", () => {
    expect(locateQuote(SOURCE_A, normalizeQuoteText("capacity nearly  doubled in 2024"))).toEqual({ locator: "line 2" });
    expect(locateQuote(SOURCE_A, normalizeQuoteText("29 GW. Developers plan to add 18 GW"))).toEqual({ locator: "lines 2-3" });
    expect(locateQuote(SOURCE_A, "roughly doubled")).toBeUndefined();
    expect(locateQuote(SOURCE_A, "")).toBeUndefined();
  });
  it("reads only what the check reads as lines: PDF and DOCX by magic or name, NUL and replacement characters are skipped", () => {
    expect(researchSourceText({ path: "input/a.md", bytes: Buffer.from("plain") })).toBe("plain");
    expect(researchSourceText({ path: "input/a.pdf", bytes: Buffer.from("plain text named pdf") })).toBeUndefined();
    expect(researchSourceText({ path: "input/memo.DOCX", bytes: Buffer.from("plain text named docx") })).toBeUndefined();
    expect(researchSourceText({ path: "input/x.bin", bytes: Buffer.from("%PDF-1.4 BT (Hello) Tj ET") })).toBeUndefined();
    expect(researchSourceText({ path: "input/x.bin", bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x41]) })).toBeUndefined();
    expect(researchSourceText({ path: "input/x.txt", bytes: Buffer.from([0x41, 0x00, 0x42]) })).toBeUndefined();
    expect(researchSourceText({ path: "input/x.txt", bytes: Buffer.from([0x41, 0xff, 0x42]) })).toBeUndefined();
  });
  it("parses the outermost JSON object out of prose and rejects the rest", () => {
    expect(parseJsonReply("Sure: {\"a\":1} done")).toEqual({ a: 1 });
    expect(parseJsonReply("no json here")).toBeUndefined(); expect(parseJsonReply("{broken")).toBeUndefined();
  });
  it("keeps known E citations one per bracket, drops and counts unknown ones in every common shape, and never treats a question id as a citation", () => {
    const known = new Set(["E1", "E2"]);
    expect(stripUnknownCitations("Doubled [E1]. Plans [E1, E99]. Outlook (E77). Both [E77][E2]. Spaced [ E88 ]. Question [Q2] stays.", known))
      .toEqual({ text: "Doubled [E1]. Plans [E1]. Outlook. Both [E2]. Spaced. Question [Q2] stays.", stripped: 4 });
    expect(stripUnknownCitations("[E9]", known)).toEqual({ text: "", stripped: 1 });
  });
  it("binds prompts, limits and budget into one protocol hash", () => {
    expect(researchProtocolSha256()).toMatch(/^[a-f0-9]{64}$/u);
    expect(researchProtocolSha256({ ...RESEARCH_PIPELINE_BUDGET, extractionCalls: 1 })).not.toBe(researchProtocolSha256());
  });
});

describe("research pipeline: stages, verification, packet and budgets", () => {
  it("indexes, plans, extracts only host-verified quotes, synthesises with known citations, and records counts only", async () => {
    const m = models(happy), events: ResearchStageCounts[] = [];
    const outcome = await run(m, {}, events);
    expect(outcome).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    const file = (path: string) => outcome.files.find(item => item.path === path)!.bytes.toString("utf8");
    expect(outcome.files.map(item => item.path).sort()).toEqual(Object.values(RESEARCH_FILES).sort());
    // Index: one batch for two small sources; gists kept; the unknown plan source id is dropped from Q1, not the question.
    expect(JSON.parse(file(RESEARCH_FILES.index)).sources).toMatchObject([{ sourceId: "input/corpus/a.md", title: "Battery storage 2024", lines: 4 }, { sourceId: "input/corpus/b.md", gist: "Analyst outlook." }]);
    expect(JSON.parse(file(RESEARCH_FILES.plan)).questions[0].sourceIds).toEqual(["input/corpus/a.md"]);
    // Extraction: three pairs (Q1/a, Q2/b, Q2/a); the paraphrase, the duplicate and the short quote are dropped; quotes are stored normalised with locators and E ids.
    const evidence = JSON.parse(file(RESEARCH_FILES.evidence));
    expect(evidence.quotes.map((quote: { id: string; questionId: string; sourceId: string; locator: string; quote: string }) => [quote.id, quote.questionId, quote.sourceId, quote.locator, quote.quote])).toEqual([
      ["E1", "Q1", "input/corpus/a.md", "line 2", "capacity nearly doubled in 2024, from 15 GW to 29 GW"],
      ["E2", "Q2", "input/corpus/b.md", "line 2", "Analysts expect 2025 additions of 16 GW, below developer plans."],
      ["E3", "Q1", "input/corpus/a.md", "lines 2-3", "from 15 GW to 29 GW. Developers plan to add 18 GW in 2025."],
      ["E4", "Q2", "input/corpus/a.md", "line 2", "capacity nearly doubled in 2024, from 15 GW to 29 GW"],
      ["E5", "Q2", "input/corpus/a.md", "lines 2-3", "from 15 GW to 29 GW. Developers plan to add 18 GW in 2025."]]);
    expect(evidence.counts).toEqual({ verified: 5, inPacket: 5, leftByCap: 0, droppedUnverifiedOrDuplicate: 6, conflictsNoted: 2 });
    expect(evidence.conflicts).toHaveLength(2);
    const text = file(RESEARCH_FILES.evidenceText);
    expect(text).toContain("- [E1] input/corpus/a.md (line 2): \"capacity nearly doubled in 2024, from 15 GW to 29 GW\" — extractor note (unverified): the headline figure");
    expect(text).toContain("## Conflicts noted by the extractor (unverified)");
    // Synthesis: the unknown [E9] is stripped, known ids stay; the write instruction names the files and the trust boundary.
    expect(file(RESEARCH_FILES.argument)).toBe("Capacity nearly doubled [E1], and plans for 2025 are contested [E2].\n\n## Conflicting evidence\nPlans against outlook [E3].\n\n## Unanswered questions\nNone.\n");
    expect(events.map(event => event.stage)).toEqual(["index", "plan", "extract", "synthesise"]);
    expect(events[0]).toMatchObject({ calls: 1, invalidReplies: 0, sourcesIndexed: 2, sourcesSkipped: 0, batchesSkipped: 0, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 0 } });
    expect(events[1]).toMatchObject({ calls: 1, invalidReplies: 0, questions: 2, unknownSourceIds: 1 });
    expect(events[2]).toMatchObject({ calls: 3, invalidReplies: 0, pairsPlanned: 3, pairsExtracted: 3, quotesVerified: 5, quotesInPacket: 5, quotesLeftByCap: 0, quotesDropped: 6, conflictsNoted: 2, conflictsInPacket: 2, usage: { inputTokens: 300 } });
    expect(events[3]).toMatchObject({ calls: 1, invalidReplies: 0, citationsStripped: 1 });
    expect(events.every(event => event.denied === undefined)).toBe(true);
    expect(JSON.stringify(events)).not.toContain("doubled");
    expect(JSON.parse(file(RESEARCH_FILES.summary))).toMatchObject({ version: 2, protocolSha256: researchProtocolSha256(), stages: events });
    // Purposes name the stage; the reader's calls run thinking-off while the planner and synthesiser use the model's thinking with
    // the H3 8,192-token cap; the planner saw the brief and the index, never a source body.
    expect(m.calls.map(call => call.purpose)).toEqual(["research source index", "research plan", "research evidence extraction", "research evidence extraction", "research evidence extraction", "research synthesis"]);
    expect(m.calls.map(call => [call.stage, call.thinkingOff, call.maxOutputTokens])).toEqual([["index", true, 1536], ["plan", false, 8192], ["extract", true, 2048], ["extract", true, 2048], ["extract", true, 2048], ["synthesise", false, 8192]]);
    expect(m.calls[1]!.reasoning).toBe("medium");
    expect(m.calls[1]!.user).toContain("Brief text."); expect(m.calls[1]!.user).not.toContain("nearly doubled");
    expect(m.calls.at(-1)!.user).toContain("[E1] input/corpus/a.md");
  });

  it("retries an invalid plan once with the validation error, then ends incomplete with the index kept", async () => {
    let plans = 0;
    const m = models((stage, user) => stage === "plan" ? (plans++, user.includes("rejected") ? "still not json" : "{\"version\":1,\"questions\":[]}") : happy(stage, user));
    const outcome = await run(m);
    expect(outcome).toMatchObject({ status: "incomplete", reason: "research_plan_invalid" });
    expect(plans).toBe(2); expect(m.calls[2]!.user).toContain("Your previous reply was rejected: questions:");
    expect(outcome.files.map(file => file.path)).toEqual([RESEARCH_FILES.index, RESEARCH_FILES.summary]);
    expect(outcome.summary.stages[1]).toMatchObject({ stage: "plan", calls: 2, invalidReplies: 2 });
  });

  it("stops extraction at the reader budget and still synthesises from what it verified (H2c)", async () => {
    const m = models(happy);
    const outcome = await run(m, { budget: { ...RESEARCH_PIPELINE_BUDGET, extractionCalls: 1 } });
    expect(outcome.status).toBe("completed");
    expect(m.calls.filter(call => call.stage === "extract")).toHaveLength(1);
    expect(outcome.summary.stages[2]).toMatchObject({ pairsPlanned: 3, pairsExtracted: 1, quotesVerified: 2 });
    expect(outcome.summary.protocolSha256).not.toBe(researchProtocolSha256());
  });

  it("stops the stage on a broker denial with its code (never counted as a call or an invalid reply) and ends research_request_denied", async () => {
    const denied = models((stage, user) => stage === "extract" && user.includes("input/corpus/b.md") ? new BrokerError("synthetic_destination_private_data_denied") : happy(stage, user));
    const outcome = await run(denied);
    expect(outcome).toMatchObject({ status: "incomplete", reason: "research_request_denied" });
    expect(outcome.summary.stages[2]).toMatchObject({ stage: "extract", calls: 1, invalidReplies: 0, denied: "synthetic_destination_private_data_denied", pairsExtracted: 1 });
    expect(denied.calls.filter(call => call.stage === "extract")).toHaveLength(1);
    expect(outcome.files.map(file => file.path)).toEqual([RESEARCH_FILES.index, RESEARCH_FILES.plan, RESEARCH_FILES.summary]);
    const budget = await run(models(stage => stage === "plan" ? new Error("private_agent_budget_denied") : "unused"));
    expect(budget).toMatchObject({ status: "incomplete", reason: "research_request_denied" });
    expect(budget.summary.stages[1]).toMatchObject({ stage: "plan", calls: 0, denied: "private_agent_budget_denied" });
    const opaque = await run(models(stage => stage === "index" ? new Error("ECONNRESET: socket hang up") : "unused"));
    expect(opaque.summary.stages[0]).toMatchObject({ stage: "index", calls: 0, denied: "request_failed" });
  });

  it("ends without evidence when no quote verifies, and skips binary sources", async () => {
    const none = models((stage, user) => stage === "extract" ? JSON.stringify({ quotes: [{ quote: "words that are not in the source at all" }] }) : happy(stage, user));
    expect(await run(none)).toMatchObject({ status: "incomplete", reason: "research_no_evidence" });
    const binary = [{ id: "input/a.pdf", path: "input/a.pdf", bytes: Buffer.from("%PDF-1.4 plain ascii pdf") }, { id: "input/m.docx", path: "input/m.docx", bytes: Buffer.from("Minutes of the meeting") }];
    const skipped = await run(models(happy), { sources: [...binary, ...sources()] });
    expect(skipped.summary.stages[0]).toMatchObject({ sourcesIndexed: 2, sourcesSkipped: 2 });
    expect(await run(models(happy), { sources: binary })).toMatchObject({ status: "incomplete", reason: "research_no_text_sources" });
  });

  it("caps conflict notes separately so they never starve verified quotes, and keeps evidence.md within the packet cap", async () => {
    const note = "x".repeat(300);
    const m = models((stage, user) => stage === "extract"
      ? JSON.stringify({ quotes: [{ quote: user.includes("input/corpus/a.md") ? "capacity nearly doubled in 2024, from 15 GW to 29 GW" : "Analysts expect 2025 additions of 16 GW, below developer plans." }], conflicts: [{ note }, { note }, { note }, { note }] })
      : happy(stage, user));
    const outcome = await run(m);
    expect(outcome.status).toBe("completed");
    const evidence = JSON.parse(outcome.files.find(file => file.path === RESEARCH_FILES.evidence)!.bytes.toString("utf8"));
    expect(evidence.counts).toMatchObject({ verified: 3, inPacket: 3, leftByCap: 0, conflictsNoted: 12 });
    expect(evidence.conflicts.length).toBe(12);
    expect(outcome.summary.stages[2]).toMatchObject({ conflictsNoted: 12, conflictsInPacket: 12, quotesInPacket: 3 });
    expect(outcome.files.find(file => file.path === RESEARCH_FILES.evidenceText)!.bytes.length).toBeLessThanOrEqual(RESEARCH_PACKET_MAX_BYTES);
  });

  it("caps the packet round-robin across questions, counts every verified quote the cap left out, and keeps the Markdown within the cap", async () => {
    const lines = (tag: string) => Array.from({ length: 200 }, (_, i) => `${tag} figure ${String(i).padStart(3, "0")}: utility-scale storage reached ${i} gigawatts in a synthetic year with a long descriptive clause to fill the line out further and further until it is long enough to matter for the packet cap.`);
    const corpus = { "input/big-a.md": lines("Alpha"), "input/big-b.md": lines("Beta") };
    const big = Object.entries(corpus).map(([path, rows]) => ({ id: path, path, bytes: Buffer.from(rows.join("\n")) }));
    const questions = Array.from({ length: 12 }, (_, i) => ({ id: `Q${i + 1}`, text: `Question ${i + 1}`, sourceIds: Object.keys(corpus) }));
    const served = new Map<string, number>();
    const m = models((stage, user) => {
      if (stage === "index") return JSON.stringify({ sources: big.map(source => ({ sourceId: source.id, gist: "figures" })) });
      if (stage === "plan") return plan(questions);
      if (stage === "extract") {
        const path = Object.keys(corpus).find(candidate => user.includes(`=== source ${candidate}`))!, rows = corpus[path as keyof typeof corpus];
        const start = ((served.get(path) ?? 0) * 12) % rows.length; served.set(path, (served.get(path) ?? 0) + 1);
        return JSON.stringify({ quotes: rows.slice(start, start + 12).map(quote => ({ quote })), conflicts: [{ note: "a conflict note" }] });
      }
      return "Argument [E1].";
    });
    const outcome = await run(m, { sources: big });
    expect(outcome.status).toBe("completed");
    const evidence = JSON.parse(outcome.files.find(file => file.path === RESEARCH_FILES.evidence)!.bytes.toString("utf8"));
    const text = outcome.files.find(file => file.path === RESEARCH_FILES.evidenceText)!.bytes;
    expect(text.length).toBeLessThanOrEqual(RESEARCH_PACKET_MAX_BYTES);
    expect(evidence.counts.verified).toBe(288);
    expect(evidence.counts.leftByCap).toBeGreaterThan(0);
    expect(evidence.counts.inPacket + evidence.counts.leftByCap).toBe(evidence.counts.verified);
    expect(outcome.summary.stages[2]).toMatchObject({ quotesVerified: 288, quotesInPacket: evidence.counts.inPacket, quotesLeftByCap: evidence.counts.leftByCap, conflictsNoted: 24, conflictsInPacket: 16 });
    const perQuestion = new Map<string, number>();
    for (const quote of evidence.quotes as { questionId: string }[]) perQuestion.set(quote.questionId, (perQuestion.get(quote.questionId) ?? 0) + 1);
    expect(perQuestion.size).toBe(12);
    expect(Math.max(...perQuestion.values()) - Math.min(...perQuestion.values())).toBeLessThanOrEqual(1);
    expect((evidence.quotes as { id: string }[]).map(quote => quote.id)).toEqual(evidence.quotes.map((_: unknown, i: number) => `E${i + 1}`));
  });

  it("stops cleanly when cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    expect(await run(models(happy), { signal: controller.signal })).toMatchObject({ status: "incomplete", reason: "research_cancelled" });
  });
});

describe("research pipeline on the split arm: a Responses-shaped planner", () => {
  it("sends the planner and synthesiser calls on the Responses shape with the model's thinking and the 8,192 cap, counts a truncated reply, and keeps the reader local", async () => {
    const bodies: { purpose: string; body: Record<string, unknown> }[] = [];
    const responsesRequest = vi.fn(async (input: { body: string; purpose: string }, settle: (bytes: Buffer) => number) => {
      const body = JSON.parse(input.body) as { input: { content: unknown }[] }; bodies.push({ purpose: input.purpose, body });
      const system = String((body.input[0]!.content as { text: string }[])[0]!.text);
      const text = system.startsWith("You plan") ? plan([{ id: "Q1", text: "How did capacity develop?", sourceIds: ["input/corpus/a.md"] }]) : "Capacity doubled [E1].";
      const status = system.startsWith("You plan") ? "completed" : "incomplete";
      const bytes = Buffer.from(JSON.stringify({ status, ...(status === "incomplete" ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], usage: { input_tokens: 50, output_tokens: 10, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } }));
      return { bytes, receipt: { feeMicrousd: settle(bytes) } };
    });
    const cloud = new PrivateAgentModel({ request: responsesRequest } as unknown as PrivateAgentBroker,
      { destinationId: "cloud", model: "gpt-6-sol", api: "openai_responses", maxOutputTokens: 16_384, inputUsdPerMillion: 2, outputUsdPerMillion: 10, cachedInputUsdPerMillion: 0.2, cacheWriteUsdPerMillion: 2.5, thinking: "medium", promptCaching: "responses_explicit_v1" }, "job", "reader");
    const local = models(happy);
    const outcome = await runResearchPipeline({ brief: "Brief text.", sources: sources(), models: { reader: local.models.reader, planner: cloud, synthesiser: cloud }, signal: new AbortController().signal, record: () => {} });
    expect(outcome.status).toBe("completed");
    expect(bodies.map(item => item.purpose)).toEqual(["research plan", "research synthesis"]);
    for (const { body } of bodies) { expect(body).toMatchObject({ max_output_tokens: 8192, reasoning: { effort: "medium" }, store: false, service_tier: "default", prompt_cache_options: { mode: "explicit" } }); expect(body).not.toHaveProperty("tools"); }
    // The synthesis reply was cut at the cap: counted, and the argument (its visible part) still used since it parsed.
    expect(outcome.summary.stages[3]).toMatchObject({ stage: "synthesise", calls: 1, truncatedReplies: 1 });
    expect(outcome.summary.stages[1]).not.toHaveProperty("truncatedReplies");
    expect(local.calls.map(call => call.stage)).toEqual(["index", "extract"]);
  });
});
