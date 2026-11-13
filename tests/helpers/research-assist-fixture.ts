/**
 * Backlog item 10's assist fixtures (BL-20261113-0841-assist-wrapper-design): provider-faithful prompt-cache fakes for both
 * cloud shapes, a capturing broker, assist model configurations, and hook requests built from a real research-pipeline run
 * whose sources, local replies and goal carry planted names, URLs and hashes.
 *
 * The cache fakes encode the documented rules (issue #49, docs/ASSIST_PROVIDER_RESEARCH.md section 2), nothing more:
 * - Responses: with no `prompt_cache_options`, caching is implicit and the whole prompt is written; in explicit mode, the
 *   prefix through the last `prompt_cache_breakpoint` is written, and nothing without one. Below 1,024 tokens nothing is.
 * - Anthropic: the prefix through the last `cache_control` (or the whole prompt for a top-level one) is written, and nothing
 *   without one. Below 512 tokens nothing is.
 * Tokens are estimated from bytes (4 per token on Responses, 3 on Anthropic). A zero-write result proves only these rules.
 */
import { vi } from "vitest";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { claimsInstructions } from "../../src/main/private-agent/claims";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { ASSIST_CACHE_MODE, PrivateAgentModel, type PrivateModelConfig } from "../../src/main/private-agent/model";
import type { ResearchAssistOutcome, ResearchAssistPlanRequest, ResearchAssistSynthesisRequest, ResearchAssists } from "../../src/main/private-agent/research-assist-contract";
import { researchSourceText } from "../../src/main/private-agent/research-coverage";
import { RESEARCH_FILES, runResearchPipeline } from "../../src/main/private-agent/research-pipeline";

/** The split arm's per-task fee cap (RESEARCH_SPLIT_MAX_FEE_USD): T1 and T2 at their bounds fit it at the fixture prices. */
export const ASSIST_FEE_CAP_MICROUSD = 600_000;

export const RESPONSES_CACHE_MIN_TOKENS = 1024;
export const ANTHROPIC_CACHE_MIN_TOKENS = 512;
const tokens = (bytes: number, perToken: number) => Math.ceil(bytes / perToken);
const textBytes = (value: unknown) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));

/** The prompt tokens and cache-write tokens the Responses API would report for this body. */
export function responsesCacheWrites(body: string): { promptTokens: number; written: number } {
  const request = JSON.parse(body) as { input: Record<string, unknown>[]; tools?: unknown[]; prompt_cache_options?: { mode?: string } };
  const marked = (item: Record<string, unknown>) => JSON.stringify(item).includes("\"prompt_cache_breakpoint\"");
  const promptTokens = tokens(Buffer.byteLength(body), 4);
  let prefixBytes = 0;
  if (request.prompt_cache_options?.mode !== "explicit") prefixBytes = Buffer.byteLength(body);
  else {
    const last = request.input.reduce((found, item, i) => marked(item) ? i : found, -1);
    if (last >= 0) prefixBytes = textBytes(request.tools ?? []) + request.input.slice(0, last + 1).reduce((n, item) => n + textBytes(item), 0);
  }
  const prefix = Math.min(promptTokens, tokens(prefixBytes, 4));
  return { promptTokens, written: prefix >= RESPONSES_CACHE_MIN_TOKENS ? prefix : 0 };
}
/** The prompt tokens and cache-write tokens the Messages API would report for this body. */
export function anthropicCacheWrites(body: string): { promptTokens: number; written: number } {
  const request = JSON.parse(body) as { tools?: unknown[]; system?: Record<string, unknown>[]; messages: { content: unknown }[]; cache_control?: unknown };
  const promptTokens = tokens(Buffer.byteLength(body), 3);
  const blocks: unknown[] = [...(request.tools ?? []), ...(request.system ?? []), ...request.messages.flatMap(message => Array.isArray(message.content) ? message.content : [message.content])];
  const marked = (block: unknown) => typeof block === "object" && block !== null && "cache_control" in block;
  let prefixBytes = 0;
  if (request.cache_control !== undefined) prefixBytes = Buffer.byteLength(body);
  else {
    const last = blocks.reduce<number>((found, block, i) => marked(block) ? i : found, -1);
    if (last >= 0) prefixBytes = blocks.slice(0, last + 1).reduce<number>((n, block) => n + textBytes(block), 0);
  }
  const prefix = Math.min(promptTokens, tokens(prefixBytes, 3));
  return { promptTokens, written: prefix >= ANTHROPIC_CACHE_MIN_TOKENS ? prefix : 0 };
}
/** A Responses reply carrying `content`, with the usage the provider's caching rules imply for the request body. */
export function responsesCachingReply(body: string, content: string, options: { truncated?: boolean; outputTokens?: number } = {}) {
  const { promptTokens, written } = responsesCacheWrites(body), request = JSON.parse(body) as { model: string };
  return { model: request.model, service_tier: "default", status: options.truncated ? "incomplete" : "completed", incomplete_details: options.truncated ? { reason: "max_output_tokens" } : null,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: content }] }],
    usage: { input_tokens: promptTokens, output_tokens: options.outputTokens ?? 40, input_tokens_details: { cached_tokens: 0, cache_write_tokens: written }, output_tokens_details: { reasoning_tokens: 10 } } };
}
/** A Messages reply carrying `content`, with the usage the provider's caching rules imply for the request body. */
export function anthropicCachingReply(body: string, content: string, options: { truncated?: boolean; outputTokens?: number } = {}) {
  const { promptTokens, written } = anthropicCacheWrites(body), request = JSON.parse(body) as { model: string };
  return { id: "msg_fixture", type: "message", role: "assistant", model: request.model, content: [{ type: "text", text: content }], stop_reason: options.truncated ? "max_tokens" : "end_turn", stop_sequence: null,
    usage: { input_tokens: promptTokens - written, output_tokens: options.outputTokens ?? 40, cache_creation_input_tokens: written, cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: written, ephemeral_1h_input_tokens: 0 }, service_tier: "standard", inference_geo: "global", output_tokens_details: { thinking_tokens: 12 } } };
}

export type AssistShape = "openai_responses" | "anthropic_messages";
/** The assist model configuration E3 would use on each shape: the heavy profile's caps, the published prices, the no-write mode. */
export function assistModelConfig(shape: AssistShape, mode: PrivateModelConfig["promptCaching"] | "none" = ASSIST_CACHE_MODE): PrivateModelConfig {
  const promptCaching = mode === "none" ? undefined : mode;
  return shape === "openai_responses"
    ? { destinationId: "cloud_coordinator", model: "gpt-6-sol", api: "openai_responses", maxOutputTokens: 16_384, inputUsdPerMillion: 2, outputUsdPerMillion: 10, cachedInputUsdPerMillion: 0.2,
      cacheWriteUsdPerMillion: 2.5, thinking: "medium", maxRequestBytes: 640 * 1024, ...(promptCaching ? { promptCaching } : {}) }
    : { destinationId: "cloud_coordinator", model: "claude-sonnet-5-5", api: "anthropic_messages", maxOutputTokens: 16_384, inputUsdPerMillion: 2, outputUsdPerMillion: 10, cachedInputUsdPerMillion: 0.1,
      cacheWriteUsdPerMillion: 2.5, thinking: "medium", maxRequestBytes: 640 * 1024, ...(promptCaching ? { promptCaching } : {}) };
}
export interface CapturedRequest { body: string; purpose: string; maxFeeMicrousd: number }
/**
 * A broker that records each request and answers it with `answer`'s reply object, or throws the Error it returns (a broker
 * denial). It reports a 600 s request timeout and no zero-risk dispatch, as a cloud destination does.
 */
export function capturingBroker(answer: (body: string, purpose: string, index: number) => unknown) {
  const requests: CapturedRequest[] = [];
  const request = vi.fn(async (input: { body: string; purpose: string; maxFeeMicrousd: number }, settle: (bytes: Buffer) => number) => {
    requests.push({ body: input.body, purpose: input.purpose, maxFeeMicrousd: input.maxFeeMicrousd });
    const output = answer(input.body, input.purpose, requests.length - 1);
    if (output instanceof Error) throw output;
    const bytes = Buffer.from(JSON.stringify(output));
    return { bytes, receipt: { feeMicrousd: settle(bytes) } };
  });
  const broker = { request, requestTimeoutMs: () => 600_000, zeroRiskDispatch: () => false } as unknown as PrivateAgentBroker;
  return { broker, requests, request };
}
/** An assist model on a capturing broker whose replies follow the provider's caching rules for each request body. */
export function cachingAssistModel(shape: AssistShape, content: (body: string, purpose: string, index: number) => string | Error | { content: string; truncated: boolean },
  config: PrivateModelConfig = assistModelConfig(shape)) {
  const captured = capturingBroker((body, purpose, index) => {
    const reply = content(body, purpose, index);
    if (reply instanceof Error) return reply;
    const { content: text, truncated } = typeof reply === "string" ? { content: reply, truncated: false } : reply;
    return shape === "openai_responses" ? responsesCachingReply(body, text, { truncated }) : anthropicCachingReply(body, text, { truncated });
  });
  return { ...captured, model: new PrivateAgentModel(captured.broker, config, "job", "reader") };
}
/** The user message of a captured assist request, parsed, on either shape. */
export function assistPacketOf(body: string): Record<string, any> {
  const request = JSON.parse(body) as { input?: { role: string; content: string }[]; messages?: { content: { text: string }[] }[] };
  const user = request.input ? request.input.find(item => item.role === "user")!.content : request.messages![0]!.content[0]!.text;
  return JSON.parse(user) as Record<string, any>;
}

/** Planted names, a URL and a hash that must never reach a cloud packet. */
export const PLANTED = Object.freeze({
  alphaId: "input/corpus/alpha-field-notes.md", betaId: "input/corpus/beta-ledger.md",
  webUrl: "https://example.org/reports/annual-2025.html", webPath: "sources/0f1e2d3c4b5a6978.bin",
  secretHash: digest("planted secret hash"),
});
const ALPHA = `# Alpha field notes from the orchard survey in early autumn of the synthetic year
The orchard recorded twelve healthy trees during the autumn survey of the north slope.
A ledger copy lists the checksum ${PLANTED.secretHash} beside the tally.
The surveyors noted that three saplings were replaced after the frost.
`;
const BETA = `# Beta ledger of the meadow
The meadow recorded seven healthy trees during the spring survey.
The ledger cites alpha-field-notes.md as its source for the orchard tally.
`;
const WEB = `<html><body><h1>Annual report 2025</h1>
<p>The annual report counts nineteen healthy trees across both sites in the synthetic year.</p>
</body></html>
`;
export const ASSIST_AUTHORED_BRIEF = "Describe the synthetic tree surveys and their limitations, citing alpha-field-notes.md where it applies.\n1. How many healthy trees did each site record?\n2. Which changes followed the frost?\n";
export function assistSources() {
  return [{ id: PLANTED.alphaId, path: PLANTED.alphaId, bytes: Buffer.from(ALPHA) }, { id: PLANTED.betaId, path: PLANTED.betaId, bytes: Buffer.from(BETA) },
    { id: PLANTED.webUrl, path: PLANTED.webPath, bytes: Buffer.from(WEB) }];
}
/** The composed goal: the authored brief plus the claims-ledger instructions the driver appends, which list every input path. */
export function assistComposedGoal(authored = ASSIST_AUTHORED_BRIEF): string {
  return `${authored}\n${claimsInstructions("output/report.md", assistSources().filter(source => source.id.startsWith("input/")).map(source => ({ id: source.id, path: source.path })), true)}`;
}
/** The local replies of the fixture run: model text that names files, a URL and the planted hash, as a careless local model might. */
function localReply(system: string, user: string): string {
  // One canonical JSON line per part: 7b.1 splits a local request into two, so the parts are merged whatever their number.
  const input = Object.assign({}, ...user.split("\n").map(line => JSON.parse(line))) as Record<string, any>;
  if (system.startsWith("You index")) return JSON.stringify({ sources: input.sources.map((s: any) => ({ sourceId: s.id, title: `Notes in ${s.id}`, date: "",
    gist: `A survey record kept as ${s.id}; see also beta-ledger.md and ${PLANTED.webUrl}; checksum ${PLANTED.secretHash}.`, figures: ["12 trees"] })) });
  if (system.startsWith("You plan")) return JSON.stringify({ version: 2, questions: [
    { id: "Q1", text: "How many healthy trees did each site record, per alpha-field-notes.md and the annual report?", requirementIds: input.units.map((u: any) => u.id), sourceIds: input.sourceIndex.sources.map((s: any) => s.sourceId), lookFor: [`tallies in ${PLANTED.betaId}`] },
    { id: "Q2", text: "Which changes followed the frost?", requirementIds: [input.units.at(-1).id], sourceIds: [PLANTED.alphaId] }],
    conflictsToCheck: [`counts in ${PLANTED.webUrl}`], deliverableNotes: `Compare example.org/reports/annual-2025.html with ${PLANTED.webPath}.` });
  if (system.startsWith("You extract")) {
    const lines = String(input.chunk.text).split("\n").map((s: string) => s.replace(/<[^>]+>/gu, "").trim()).filter((s: string) => !s.startsWith("#") && s.length >= 12 && s.length <= 300);
    const questionIds = input.plan.questions.map((q: any) => q.id);
    return JSON.stringify({ questions: questionIds.map((questionId: string) => ({ questionId, status: lines.length ? "evidence_found" : "no_verified_evidence" })),
      quotes: lines.slice(0, 3).map((quote: string) => ({ quote, questionIds, note: `extractor note naming ${input.source.id}` })),
      conflicts: lines.length > 1 ? [{ questionIds: ["Q1"], note: `conflict note naming ${input.source.id}` }] : [] });
  }
  const quotes = input.evidence.quotes as { id: string; questionIds: string[] }[];
  return JSON.stringify({ version: 1, argument: `Synthetic finding [${quotes[0]!.id}].\n\n## Conflicting evidence\nNone.\n\n## Unanswered questions\nNone.`,
    questions: input.plan.questions.map((q: any) => ({ questionId: q.id, disposition: "findings", evidenceIds: quotes.filter(e => e.questionIds.includes(q.id)).map(e => e.id) })) });
}
/** A zero-fee local model on a fake broker answering with `localReply`. */
function localModels() {
  const request = vi.fn(async (input: { body: string }, settle: (bytes: Buffer) => number) => {
    const body = JSON.parse(input.body), content = localReply(body.messages[0].content as string, body.messages[1].content as string);
    const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    return { bytes, receipt: { feeMicrousd: settle(bytes) } };
  });
  const config: PrivateModelConfig = { destinationId: "owned_local_model", model: "Synthetic", maxOutputTokens: 16_384, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium" };
  const make = () => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, "job", "reader");
  return { reader: make(), planner: make(), synthesiser: make() };
}
/** Runs the unchanged v4 pipeline over the planted corpus and builds the T1 and T2 hook requests from its packet. */
export async function assistRequests(options: { authored?: string; composed?: string } = {}) {
  const brief = options.composed ?? assistComposedGoal(options.authored), sources = assistSources();
  const outcome = await runResearchPipeline({ brief, sources, models: localModels(), signal: new AbortController().signal, record: () => {} });
  if (outcome.status !== "completed") throw new Error(`assist_fixture_pipeline_${outcome.reason}`);
  const read = (path: string) => JSON.parse(outcome.files.find(file => file.path === path)!.bytes.toString("utf8"));
  const coverage = read(RESEARCH_FILES.coverage), index = read(RESEARCH_FILES.index), plan = read(RESEARCH_FILES.plan), evidence = read(RESEARCH_FILES.evidence);
  const inventory = coverage.sources.map(({ readable: _readable, ...source }: any) => source) as { id: string; path: string; sha256: string; bytes: number }[];
  const sourceTexts = inventory.map(identity => researchSourceText(sources.find(source => source.id === identity.id)!)!);
  const base = { brief, units: coverage.units, sources: inventory, sourceTexts, sourceIndex: index, deadlineMs: Number.POSITIVE_INFINITY };
  const plan_: ResearchAssistPlanRequest = { ...base, mandatorySourceChunks: coverage.chunks.length, extractionCallBudget: 40, priorAttempts: [] };
  const synthesis: ResearchAssistSynthesisRequest = { ...base, plan, evidence, coverage, retryAfterTruncation: false };
  return { plan: plan_, synthesis, outcome, sources, brief };
}
/** Every string the cloud must never see for the fixture corpus and run: names, URL forms, paths, hashes, notes, appended instructions. */
export function forbiddenStrings(run: Awaited<ReturnType<typeof assistRequests>>): string[] {
  const hashes = new Set<string>([PLANTED.secretHash, digest(Buffer.from(run.brief))]);
  for (const source of run.plan.sources) hashes.add(source.sha256);
  for (const entry of run.plan.sourceIndex.sources) { hashes.add(entry.sourceSha256); if (entry.modelContentSha256) hashes.add(entry.modelContentSha256); hashes.add(entry.literal.opening.sha256); if (entry.literal.heading) hashes.add(entry.literal.heading.sha256); }
  for (const unit of run.plan.units) hashes.add(unit.sha256);
  for (const chunk of run.synthesis.coverage.chunks) { hashes.add(chunk.sha256); for (const attempt of chunk.attempts) hashes.add(attempt.responseSha256); }
  return [PLANTED.alphaId, PLANTED.betaId, PLANTED.webUrl, PLANTED.webPath, "alpha-field-notes.md", "beta-ledger.md", "example.org/reports/annual-2025.html", "annual-2025.html",
    "0f1e2d3c4b5a6978.bin", "corpus/alpha-field-notes.md", "extractor note naming", "conflict note naming", "Claims ledger requirement", ...hashes];
}
export const canonicalOf = canonical;
/** Deep-freezes a request, so a test fails if the wrapper ever writes into the pipeline's own objects. */
export function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) frozen(item); }
  return value;
}

/**
 * A fake hook for item 7(c)'s pipeline tests: it answers as the real wrapper does, in the opaque namespace. A plan reply names
 * sources by S{n} with `sourceAliases`, so the pipeline must assess it with `assessResearchPlanReply({ ..., sourceAliases })`;
 * a synthesis reply carries the evidence ids its packet would have held. `script` may replace either answer with any outcome.
 */
export function fakeResearchAssists(firing: ResearchAssists["firing"], script: { plan?: (request: ResearchAssistPlanRequest) => ResearchAssistOutcome;
  synthesis?: (request: ResearchAssistSynthesisRequest) => ResearchAssistOutcome } = {}): ResearchAssists & { calls: string[] } {
  const calls: string[] = [];
  const usage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 };
  return { firing, calls,
    async plan(request) {
      calls.push("plan");
      if (script.plan) return script.plan(request);
      const sourceAliases = Object.fromEntries(request.sources.map((source, i) => [`S${i + 1}`, source.id]));
      return { kind: "reply", truncated: false, usage, sourceAliases, content: JSON.stringify({ version: 2, questions: [{ id: "Q1", text: "What does the supplied evidence establish?",
        requirementIds: request.units.map(unit => unit.id), sourceIds: Object.keys(sourceAliases).slice(0, 8) }] }) };
    },
    async synthesis(request) {
      calls.push(request.retryAfterTruncation ? "synthesis retry" : "synthesis");
      if (script.synthesis) return script.synthesis(request);
      const evidenceIds = request.evidence.quotes.map(quote => quote.id);
      return { kind: "reply", truncated: false, usage, evidenceIds, content: JSON.stringify({ version: 1, argument: `A finding [${evidenceIds[0]}].\n\n## Conflicting evidence\nNone.\n\n## Unanswered questions\nNone.`,
        questions: request.plan.questions.map(question => { const ids = request.evidence.quotes.filter(quote => quote.questionIds.includes(question.id)).map(quote => quote.id);
          return { questionId: question.id, disposition: ids.length ? "findings" : "unresolved", evidenceIds: ids }; }) }) };
    } };
}
