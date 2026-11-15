/**
 * E0 extractor fixture (review section 5.6, E0: "extractor on 3 synthetic chunks"; BL-20261115-2006-e0-extractor-fixture-design).
 * For each committed synthetic chunk a pinned manifest names, it builds the extraction stage's own initial request (EXTRACT_SYSTEM and
 * researchExtractionUserContent, through the model layer's requestBody exactly as probe P10 builds its bodies: buildRoleRequest in
 * export-role-schemas.ts) under each condition the manifest pins, and POSTs it directly to the owner's endpoint (outside the broker,
 * by design: synthetic public input at zero fee, no dispatch rows). It judges every reply with the stage's own checks
 * (assessResearchExtractionReply), retains every raw reply under a new out directory with mode 0o600, and writes a summary of codes,
 * hashes, counts, times and token usage only, rewritten after each call. The endpoint and the request settings come from
 * loadConfig, so the app's endpoint policy applies; the address is never printed or written.
 *
 *   pnpm fixture:extractor -- [--manifest docs/experiments/e0-extractor-fixture-v1.json] [--out <dir>] [--dry-run]
 *
 * The conditions and repeats come only from the manifest. Every refusal happens before any request is sent or any file is written.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadConfig, loadEnvironmentFiles } from "../src/main/config";
import { assembleSseChatCompletion } from "../src/main/private-agent/broker";
import { canonical, digest, sha256Schema } from "../src/main/private-agent/contracts";
import { COORDINATOR_PROFILES } from "../src/main/private-agent/profiles";
import { deriveBriefUnits, inventoryResearchSources, type BriefUnit } from "../src/main/private-agent/research-coverage";
import { assertRunDirectoryIgnored } from "../src/main/private-agent/research-diagnostics";
import { assessResearchPlanReply } from "../src/main/private-agent/research-plan";
import { OUTPUT_TOKENS, assessResearchExtractionReply, researchExtractionUserContent, researchProtocolSha256, type ResearchExtractionAssessment,
  type ResearchPlan } from "../src/main/private-agent/research-pipeline";
import { servingCardRequestSettings, type ServingCardRequestSettings } from "../src/main/private-agent/serving-card";
import { buildRoleRequest, requestSettingsOf, type RequestSettings } from "./export-role-schemas";

export const EXTRACTOR_CONDITIONS = ["thinking-off", "thinking-on", "thinking-on-8192"] as const;
export type ExtractorCondition = (typeof EXTRACTOR_CONDITIONS)[number];
/**
 * Each condition's call on top of the stage's own extraction request. thinking-off is the stage's call today (THINKING.extract is
 * "disabled", so call() sends that override, with OUTPUT_TOKENS.extract); thinking-on takes the role model's thinking at the same
 * cap; thinking-on-8192 takes it with the plan and synthesis cap, which 7a.2's role policy admits for a card.
 */
export const CONDITION_CALLS: Readonly<Record<ExtractorCondition, Readonly<{ thinking?: "disabled"; maxOutputTokens: number }>>> = Object.freeze({
  "thinking-off": Object.freeze({ thinking: "disabled" as const, maxOutputTokens: OUTPUT_TOKENS.extract }),
  "thinking-on": Object.freeze({ maxOutputTokens: OUTPUT_TOKENS.extract }),
  "thinking-on-8192": Object.freeze({ maxOutputTokens: 8192 }),
});
/** The job id that salts every body of the fixture (vllmCacheSalt), as one research job's id salts its calls. */
export const FIXTURE_JOB_ID = "e0-extractor-fixture";
export const DEFAULT_MANIFEST = "docs/experiments/e0-extractor-fixture-v1.json";

/** A path relative to the manifest's folder: lower-case segments, none starting with a dot, so never absolute and never "..". */
const relativePath = z.string().max(200).regex(/^[a-z0-9][a-z0-9_.-]*(\/[a-z0-9][a-z0-9_.-]*)*$/u);
const pinnedFile = { file: relativePath, sha256: sha256Schema, bytes: z.number().int().positive() };
export const ExtractorFixtureManifestSchema = z.object({
  schemaVersion: z.literal(1), name: z.string().min(1).max(200), status: z.literal("pinned"), note: z.string().max(4000).optional(),
  corpus: relativePath, brief: z.object(pinnedFile).strict(), units: z.array(z.string().regex(/^U[0-9]{1,3}$/u)).min(1).max(128), plan: z.object(pinnedFile).strict(),
  sources: z.array(z.object({ id: z.string().min(1).max(2048), ...pinnedFile, chunkId: z.string().regex(/^S[0-9]{1,4}C1$/u) }).strict()).min(1).max(12),
  conditions: z.array(z.enum(EXTRACTOR_CONDITIONS)).min(1), repeats: z.number().int().min(1).max(100),
}).strict().refine(m => new Set(m.conditions).size === m.conditions.length && new Set(m.sources.map(s => s.id)).size === m.sources.length);
export type ExtractorFixtureManifest = z.infer<typeof ExtractorFixtureManifestSchema>;

/** `read` resolves a path relative to the manifest's folder; the CLI reads the committed files. */
export interface ExtractorFixtureInputs { manifest: unknown; manifestSha256: string; read: (path: string) => Buffer }
export interface VerifiedChunk { sourceId: string; chunkId: string; sourceSha256: string; startLine: number; bytes: number; text: string; userContent: string }
export interface VerifiedExtractorFixture { manifest: ExtractorFixtureManifest; brief: string; units: BriefUnit[]; plan: ResearchPlan; questions: ReadonlySet<string>; chunks: VerifiedChunk[] }

/** Every refusal here happens before any request is built or sent. */
export function verifyExtractorInputs(inputs: ExtractorFixtureInputs): VerifiedExtractorFixture {
  const parsed = ExtractorFixtureManifestSchema.safeParse(inputs.manifest);
  if (!parsed.success) throw new Error("extractor_fixture_manifest_invalid");
  const manifest = parsed.data;
  const pinned = (entry: { file: string; sha256: string; bytes: number }, what: string): Buffer => {
    let bytes: Buffer;
    try { bytes = inputs.read(`${manifest.corpus}/${entry.file}`); } catch { throw new Error(`extractor_fixture_${what}_missing`); }
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw new Error(`extractor_fixture_${what}_mismatch`);
    return bytes;
  };
  let brief: string;
  try { brief = new TextDecoder("utf-8", { fatal: true }).decode(pinned(manifest.brief, "brief")); } catch (error) {
    throw error instanceof Error && error.message.startsWith("extractor_fixture_") ? error : new Error("extractor_fixture_brief_mismatch");
  }
  const units = deriveBriefUnits(brief);
  if (canonical(units.map(unit => unit.id)) !== canonical(manifest.units)) throw new Error("extractor_fixture_units_mismatch");
  const sources = manifest.sources.map(source => ({ id: source.id, path: source.id, bytes: pinned(source, "source") }));
  // The pipeline's own plan assessor: the plan binds to the brief's units and to these source ids, or the fixture refuses it.
  const plan = assessResearchPlanReply({ content: pinned(manifest.plan, "plan").toString("utf8"), truncated: false, ordinal: 1, units, sources: sources.map(s => ({ id: s.id })) }).plan;
  if (!plan) throw new Error("extractor_fixture_plan_rejected");
  const inventory = inventoryResearchSources(sources);
  const chunks = manifest.sources.map((entry, index): VerifiedChunk => {
    const own = inventory.chunks.filter(chunk => chunk.sourceId === entry.id), bytes = sources[index]!.bytes;
    // Each source is exactly one chunk of the pipeline's chunking, with the id the manifest pins.
    if (own.length !== 1 || own[0]!.id !== entry.chunkId || own[0]!.startByte !== 0 || own[0]!.endByte !== bytes.length) throw new Error("extractor_fixture_chunk_mismatch");
    const chunk = own[0]!, text = bytes.toString("utf8");
    return { sourceId: entry.id, chunkId: chunk.id, sourceSha256: chunk.sourceSha256, startLine: chunk.startLine, bytes: bytes.length, text,
      userContent: researchExtractionUserContent({ brief, units, plan, source: { id: entry.id, sha256: chunk.sourceSha256 },
        chunk: { id: chunk.id, startByte: chunk.startByte, endByte: chunk.endByte, text }, repairReason: null }) };
  });
  return { manifest, brief, units, plan, questions: new Set(plan.questions.map(question => question.id)), chunks };
}

export interface ExtractorRequest { chunkId: string; condition: ExtractorCondition; body: string; bodySha256: string; bodyBytes: number; maxTokens: number; thinking: "disabled" | "model"; streamed: boolean }

/** Each chunk's request under each condition, built by buildRoleRequest (P10's builder) and sent as the exact bytes requestBody made. */
export function buildExtractorRequests(fixture: VerifiedExtractorFixture, settings: RequestSettings): ExtractorRequest[] {
  return fixture.chunks.flatMap(chunk => fixture.manifest.conditions.map(condition => {
    const call = CONDITION_CALLS[condition], built = buildRoleRequest(settings, FIXTURE_JOB_ID, "extract", chunk.userContent, call);
    // canonical() is requestBody's own serialisation, so re-encoding the parsed body gives back its bytes; refuse anything else.
    const body = canonical(built.body);
    if (digest(body) !== built.bodySha256) throw new Error("extractor_fixture_body_mismatch");
    return { chunkId: chunk.chunkId, condition, body, bodySha256: built.bodySha256, bodyBytes: Buffer.byteLength(body), maxTokens: call.maxOutputTokens,
      thinking: call.thinking ?? "model", streamed: built.body.stream === true };
  }));
}

export const EXTRACTOR_CLASSES = ["complete", "held", "needs_followup", "invalid", "truncated", "request_rejected", "malformed_reply", "transport_failed"] as const;
export type ExtractorClass = (typeof EXTRACTOR_CLASSES)[number];
export interface ExtractorCallRecord {
  ordinal: number; repeat: number; chunkId: string; condition: ExtractorCondition; status: number | null; elapsedMs: number;
  replyFile: string | null; replyBytes: number; replySha256: string | null; classification: ExtractorClass; transportError?: string; streamError?: string;
  finishReason?: string | null; usage?: { promptTokens: number | null; completionTokens: number | null; cachedTokens: number | null; reasoningTokens: number | null };
  /** A plain reply's reasoning field, which a streamed reply's assembly drops (its raw stream keeps it). */
  reasoningField?: "none" | "reasoning" | "reasoning_content" | "mixed"; reasoningBytes?: number;
  /** The stage's checks: a complete reply with any reason is kept with drops or corrections (`accepted_with_drops`). */
  keptWithDrops?: boolean; reasons?: ResearchExtractionAssessment["reasons"];
  quotes?: { given: number; kept: number; dropped: number }; conflicts?: { given: number; kept: number; dropped: number };
  notesCleared?: number; questionsDowngraded?: number; questionsUpgraded?: number; outcomes?: Record<string, ResearchExtractionAssessment["outcomes"][number]["status"]>;
}
export interface ExtractorCellCounts { calls: number; classes: Partial<Record<ExtractorClass, number>>; keptWithDrops: number; reasons: Record<string, number> }
export interface ExtractorFixtureSummary {
  version: 1; startedUtc: string; finishedUtc?: string; dryRun: boolean; protocolSha256: string; requestSettings: ServingCardRequestSettings;
  manifest: { name: string; sha256: string; corpus: string; briefSha256: string; planSha256: string; units: string[] };
  chunks: { chunkId: string; sourceId: string; sourceSha256: string; bytes: number; userContentBytes: number }[];
  conditions: ExtractorCondition[]; repeats: number; order: "repeat_chunk_condition";
  requests: Record<string, Record<string, { bodySha256: string; bodyBytes: number; maxTokens: number; thinking: "disabled" | "model"; streamed: boolean }>>;
  calls: ExtractorCallRecord[]; counts: Record<string, Record<string, ExtractorCellCounts>>;
}
export interface ExtractorEndpoint { baseUrl: string; apiKey?: string; timeoutMs?: number }
export interface ExtractorRunOptions { endpoint: ExtractorEndpoint; settings: RequestSettings; inputs: ExtractorFixtureInputs; out: string; dryRun?: boolean }

function writePrivate(path: string, data: Buffer | string): void {
  const handle = openSync(path, "w", 0o600);
  try { writeSync(handle, typeof data === "string" ? Buffer.from(data) : data); } finally { closeSync(handle); }
}
/** Written beside, then renamed over, so an interrupted run leaves the last whole summary. */
function writeSummary(out: string, summary: ExtractorFixtureSummary): void {
  writePrivate(join(out, "summary.json.tmp"), `${JSON.stringify(summary, null, 1)}\n`);
  renameSync(join(out, "summary.json.tmp"), join(out, "summary.json"));
}
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
function usageOf(value: unknown): NonNullable<ExtractorCallRecord["usage"]> {
  const usage = (typeof value === "object" && value !== null ? value : {}) as { prompt_tokens?: unknown; completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown } | null; completion_tokens_details?: { reasoning_tokens?: unknown } | null };
  return { promptTokens: count(usage.prompt_tokens), completionTokens: count(usage.completion_tokens), cachedTokens: count(usage.prompt_tokens_details?.cached_tokens),
    reasoningTokens: count(usage.completion_tokens_details?.reasoning_tokens) };
}

function judge(record: ExtractorCallRecord, assessment: ResearchExtractionAssessment): void {
  record.classification = assessment.state === "complete" ? (assessment.lostEvidence ? "held" : "complete") : assessment.state;
  record.keptWithDrops = assessment.state === "complete" && !assessment.lostEvidence && assessment.reasons.length > 0;
  record.reasons = assessment.reasons;
  record.quotes = { given: assessment.quotes.length + assessment.quotesDropped, kept: assessment.quotes.length, dropped: assessment.quotesDropped };
  record.conflicts = { given: assessment.conflicts.length + assessment.conflictsDropped, kept: assessment.conflicts.length, dropped: assessment.conflictsDropped };
  record.notesCleared = assessment.notesCleared; record.questionsDowngraded = assessment.questionsDowngraded; record.questionsUpgraded = assessment.questionsUpgraded;
  record.outcomes = Object.fromEntries(assessment.outcomes.map(outcome => [outcome.questionId, outcome.status]));
}

function tally(summary: ExtractorFixtureSummary): void {
  summary.counts = {};
  for (const call of summary.calls) {
    const cell = ((summary.counts[call.chunkId] ??= {})[call.condition] ??= { calls: 0, classes: {}, keptWithDrops: 0, reasons: {} });
    cell.calls++; cell.classes[call.classification] = (cell.classes[call.classification] ?? 0) + 1; if (call.keptWithDrops) cell.keptWithDrops++;
    for (const reason of call.reasons ?? []) cell.reasons[reason.code] = (cell.reasons[reason.code] ?? 0) + 1;
  }
}

export async function runExtractorFixture(options: ExtractorRunOptions): Promise<ExtractorFixtureSummary> {
  const fixture = verifyExtractorInputs(options.inputs), requests = buildExtractorRequests(fixture, options.settings);
  const { manifest } = fixture;
  if (!options.dryRun && existsSync(options.out)) throw new Error("extractor_fixture_out_exists");
  const summary: ExtractorFixtureSummary = { version: 1, startedUtc: new Date().toISOString(), dryRun: options.dryRun === true, protocolSha256: researchProtocolSha256(),
    requestSettings: servingCardRequestSettings(options.settings, true),
    manifest: { name: manifest.name, sha256: options.inputs.manifestSha256, corpus: manifest.corpus, briefSha256: manifest.brief.sha256, planSha256: manifest.plan.sha256, units: fixture.units.map(u => u.id) },
    chunks: fixture.chunks.map(c => ({ chunkId: c.chunkId, sourceId: c.sourceId, sourceSha256: c.sourceSha256, bytes: c.bytes, userContentBytes: Buffer.byteLength(c.userContent) })),
    conditions: [...manifest.conditions], repeats: manifest.repeats, order: "repeat_chunk_condition", requests: {}, calls: [], counts: {} };
  for (const request of requests) (summary.requests[request.chunkId] ??= {})[request.condition] = { bodySha256: request.bodySha256, bodyBytes: request.bodyBytes,
    maxTokens: request.maxTokens, thinking: request.thinking, streamed: request.streamed };
  if (options.dryRun) return summary;
  const replies = join(options.out, "replies");
  mkdirSync(replies, { recursive: true, mode: 0o700 });
  const headers: Record<string, string> = { "content-type": "application/json", ...(options.endpoint.apiKey ? { authorization: `Bearer ${options.endpoint.apiKey}` } : {}) };
  const timeoutMs = options.endpoint.timeoutMs ?? COORDINATOR_PROFILES.heavy.requestTimeoutMs, chunks = new Map(fixture.chunks.map(c => [c.chunkId, c]));
  writeSummary(options.out, summary);
  let ordinal = 0;
  // Repeat-major: every repeat runs each chunk under each condition, so an interrupted run leaves balanced cells.
  for (let repeat = 1; repeat <= manifest.repeats; repeat++) {
    for (const request of requests) {
      const chunk = chunks.get(request.chunkId)!, started = performance.now();
      const record: ExtractorCallRecord = { ordinal: ++ordinal, repeat, chunkId: request.chunkId, condition: request.condition, status: null, elapsedMs: 0,
        replyFile: null, replyBytes: 0, replySha256: null, classification: "transport_failed" };
      try {
        const response = await fetch(`${options.endpoint.baseUrl}/chat/completions`, { method: "POST", headers, body: request.body, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
        const bytes = Buffer.from(await response.arrayBuffer());
        record.elapsedMs = Math.round(performance.now() - started); record.status = response.status;
        record.replyFile = `${request.chunkId}-${request.condition}-${String(repeat).padStart(2, "0")}.${request.streamed ? "sse" : "json"}`;
        record.replySha256 = digest(bytes); record.replyBytes = bytes.length;
        writePrivate(join(replies, record.replyFile), bytes);
        if (response.status !== 200) record.classification = "request_rejected";
        else {
          let reply: { choices?: { message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }[]; usage?: unknown } | undefined;
          try {
            // A streamed reply is reassembled by the broker's own assembler, into the JSON a plain reply has.
            reply = JSON.parse((request.streamed ? assembleSseChatCompletion(bytes.toString("utf8")) : bytes).toString("utf8"));
          } catch (error) {
            record.classification = "malformed_reply";
            if (request.streamed && error instanceof Error && /^[a-z_]+$/u.test(error.message)) record.streamError = error.message;
          }
          const choice = reply?.choices?.[0], message = choice?.message, content = message?.content === null ? "" : message?.content;
          if (reply && typeof content === "string") {
            const fields = (["reasoning", "reasoning_content"] as const).filter(field => typeof message?.[field] === "string" && (message[field] as string).length);
            record.finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null; record.usage = usageOf(reply.usage);
            if (!request.streamed) {
              record.reasoningField = fields.length === 0 ? "none" : fields.length === 1 ? fields[0]! : "mixed";
              record.reasoningBytes = fields.reduce((n, field) => n + Buffer.byteLength(message![field] as string), 0);
            }
            // The stage's own judgement of an initial attempt: truncated when the reply stopped at its cap, as the pipeline's call() reads it.
            judge(record, assessResearchExtractionReply({ content, truncated: record.finishReason === "length", questions: fixture.questions, source: { id: chunk.sourceId },
              chunk: { id: chunk.chunkId, sourceSha256: chunk.sourceSha256, startLine: chunk.startLine }, chunkText: chunk.text }));
          } else if (reply) record.classification = "malformed_reply";
        }
      } catch (error) {
        record.elapsedMs = Math.round(performance.now() - started); record.transportError = error instanceof Error ? error.name : "unknown";
      }
      summary.calls.push(record); tally(summary); writeSummary(options.out, summary);
    }
  }
  summary.finishedUtc = new Date().toISOString(); writeSummary(options.out, summary);
  return summary;
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }

async function main(): Promise<number> {
  const manifestPath = argument("--manifest") ?? DEFAULT_MANIFEST, dryRun = process.argv.includes("--dry-run");
  const environment = loadEnvironmentFiles({});
  if (!environment.SOAR_VLLM_BASE_URL) { process.stderr.write("SOAR_VLLM_BASE_URL is not set (environment or .env.local).\n"); return 2; }
  // loadConfig applies the app's endpoint policy: a base that is not loopback needs the explicit zero-fee declaration. Its policy
  // refusals name settings; any message that could carry an address is replaced by a fixed code.
  let config: ReturnType<typeof loadConfig>;
  try { config = loadConfig(); } catch (error) {
    const message = error instanceof Error && !error.message.includes("://") && !error.message.includes("\n") ? error.message : "extractor_fixture_config_invalid";
    process.stderr.write(`${message}\n`); return 2;
  }
  const out = argument("--out") ?? join(".soar", "experiments", `e0-extractor-fixture-${new Date().toISOString().replace(/[:.]/gu, "")}`);
  if (!dryRun) {
    try { assertRunDirectoryIgnored(out); } catch { process.stderr.write("extractor_fixture_out_not_ignored\n"); return 2; }
  }
  const manifestBytes = readFileSync(manifestPath), folder = dirname(resolve(manifestPath));
  const summary = await runExtractorFixture({ endpoint: { baseUrl: config.vllm.baseUrl, apiKey: config.vllm.apiKey, timeoutMs: COORDINATOR_PROFILES.heavy.requestTimeoutMs },
    settings: requestSettingsOf(config), out, dryRun,
    inputs: { manifest: JSON.parse(manifestBytes.toString("utf8")), manifestSha256: digest(manifestBytes), read: path => readFileSync(join(folder, path)) } });
  process.stdout.write(`${JSON.stringify({ dryRun: summary.dryRun, conditions: summary.conditions, repeats: summary.repeats, chunks: summary.chunks.map(c => c.chunkId),
    requestSettings: summary.requestSettings, requests: summary.requests, counts: summary.counts, retained: summary.dryRun ? null : `${basename(out)}/replies` })}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error instanceof Error && /^[a-z_]+$/u.test(error.message) ? error.message : "extractor_fixture_failed"}\n`); process.exitCode = 2; });
}
