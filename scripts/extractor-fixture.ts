/**
 * E0 extractor fixture (review section 5.6, E0: "extractor on 3 synthetic chunks"; BL-20261116-1123-e0-extractor-fixture-design).
 * For each committed synthetic chunk a pinned manifest names, it builds the extraction stage's own initial request (EXTRACT_SYSTEM and
 * researchExtractionUserContent, through the model layer's requestBody exactly as probe P10 builds its bodies: buildRoleRequest in
 * export-role-schemas.ts) under each condition the manifest pins, and POSTs it directly to the owner's endpoint (outside the broker,
 * by design: synthetic public input at zero fee, no dispatch rows). It judges every reply with the stage's own checks
 * (assessResearchExtractionReply), retains every raw reply under a new out directory with mode 0o600, and writes a summary of codes,
 * hashes, counts, times and token usage only, before the first request and again after each call. The endpoint and the request
 * settings come from loadConfig, so the app's endpoint policy applies; the address is never printed or written.
 *
 *   pnpm fixture:extractor -- [--manifest docs/experiments/e0-extractor-fixture-v1.json] [--out <dir>] [--dry-run]
 *
 * The conditions and repeats come only from the manifest. Each (repeat, condition) is salted as one research job is, and runs its
 * chunks in order, so a chunk's call reuses only the job's cached system message and stable packet line, as the stage's calls do.
 * Every refusal happens before any request is sent or any file is written.
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
import { readChatReply } from "./chat-reply";
import { buildRoleRequest, requestSettingsOf, type RequestSettings } from "./export-role-schemas";

export const EXTRACTOR_CONDITIONS = ["thinking-off", "thinking-on", "thinking-on-8192", "thinking-on-16384"] as const;
export type ExtractorCondition = (typeof EXTRACTOR_CONDITIONS)[number];
/**
 * Each condition's call on top of the stage's own extraction request. thinking-off is the stage's call as deployed today
 * (THINKING.extract is "disabled", so call() sends that override, with OUTPUT_TOKENS.extract); the others take the role model's
 * thinking at today's cap, at the plan and synthesis cap, and at the Heavy profile's ceiling, caps 7a.2's role policy admits.
 */
export const CONDITION_CALLS: Readonly<Record<ExtractorCondition, Readonly<{ thinking?: "disabled"; maxOutputTokens: number }>>> = Object.freeze({
  "thinking-off": Object.freeze({ thinking: "disabled" as const, maxOutputTokens: OUTPUT_TOKENS.extract }),
  "thinking-on": Object.freeze({ maxOutputTokens: OUTPUT_TOKENS.extract }),
  "thinking-on-8192": Object.freeze({ maxOutputTokens: 8192 }),
  "thinking-on-16384": Object.freeze({ maxOutputTokens: 16384 }),
});
/** The cell that matches the extraction stage's call as deployed today; the other cells are calibration against it. */
export const DEPLOYED_CONDITION: ExtractorCondition = "thinking-off";
export const FIXTURE_JOB_ID = "e0-extractor-fixture";
/** Each (repeat, condition) is one job for the prefix-cache salt (vllmCacheSalt), as one research job salts all of its calls. */
export function fixtureJobId(repeat: number, condition: ExtractorCondition): string { return `${FIXTURE_JOB_ID}:r${repeat}:${condition}`; }
export const DEFAULT_MANIFEST = "docs/experiments/e0-extractor-fixture-v1.json";

/** A path relative to the manifest's folder: lower-case segments, none starting with a dot, so never absolute and never "..". */
const relativePath = z.string().max(200).regex(/^[a-z0-9][a-z0-9_.-]*(\/[a-z0-9][a-z0-9_.-]*)*$/u);
const pinnedFile = { file: relativePath, sha256: sha256Schema, bytes: z.number().int().positive() };
export const ExtractorFixtureManifestSchema = z.object({
  schemaVersion: z.literal(1), name: z.string().min(1).max(200), status: z.literal("pinned"), note: z.string().max(4000).optional(),
  task: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/u), exposure: z.enum(["fresh", "exposed"]),
  corpus: relativePath, brief: z.object(pinnedFile).strict(), units: z.array(z.string().regex(/^U[0-9]{1,3}$/u)).min(1).max(128), plan: z.object(pinnedFile).strict(),
  sources: z.array(z.object({ id: z.string().min(1).max(2048), ...pinnedFile, chunkId: z.string().regex(/^S[0-9]{1,4}C1$/u) }).strict()).min(1).max(12),
  conditions: z.array(z.enum(EXTRACTOR_CONDITIONS)).min(1), repeats: z.number().int().min(1).max(100),
}).strict().refine(m => new Set(m.conditions).size === m.conditions.length && new Set(m.sources.map(s => s.id)).size === m.sources.length);
export type ExtractorFixtureManifest = z.infer<typeof ExtractorFixtureManifestSchema>;

/** `read` resolves a path relative to the manifest's folder; the CLI reads the committed files. */
export interface ExtractorFixtureInputs { manifest: unknown; read: (path: string) => Buffer }
export interface VerifiedChunk { sourceId: string; chunkId: string; sourceSha256: string; startLine: number; bytes: number; text: string; userContent: string }
export interface VerifiedExtractorFixture { manifest: ExtractorFixtureManifest; manifestSha256: string; brief: string; units: BriefUnit[]; plan: ResearchPlan; questions: ReadonlySet<string>; chunks: VerifiedChunk[] }

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
  // The judge fixture's rule: the summary binds the design by digest(canonical(manifest)).
  return { manifest, manifestSha256: digest(canonical(inputs.manifest)), brief, units, plan, questions: new Set(plan.questions.map(question => question.id)), chunks };
}

export interface ExtractorRequest { repeat: number; condition: ExtractorCondition; chunkId: string; body: string; requestSha256: string; requestBytes: number;
  maxTokens: number; thinking: "disabled" | "model"; streamed: boolean }

/**
 * Every call's request, in run order: repeat, then condition, then chunk. Each is built by buildRoleRequest (P10's builder), salted for
 * its (repeat, condition), and sent as the exact bytes requestBody made.
 */
export function buildExtractorRequests(fixture: VerifiedExtractorFixture, settings: RequestSettings): ExtractorRequest[] {
  const requests: ExtractorRequest[] = [];
  for (let repeat = 1; repeat <= fixture.manifest.repeats; repeat++) {
    for (const condition of fixture.manifest.conditions) {
      for (const chunk of fixture.chunks) {
        const call = CONDITION_CALLS[condition], built = buildRoleRequest(settings, fixtureJobId(repeat, condition), "extract", chunk.userContent, call);
        // canonical() is requestBody's own serialisation, so re-encoding the parsed body gives back its bytes; refuse anything else.
        const body = canonical(built.body);
        if (digest(body) !== built.bodySha256) throw new Error("extractor_fixture_body_mismatch");
        requests.push({ repeat, condition, chunkId: chunk.chunkId, body, requestSha256: built.bodySha256, requestBytes: Buffer.byteLength(body), maxTokens: call.maxOutputTokens,
          thinking: call.thinking ?? "model", streamed: built.body.stream === true });
      }
    }
  }
  return requests;
}

export const EXTRACTOR_CLASSES = ["complete", "held", "needs_followup", "invalid", "truncated", "request_rejected", "malformed_reply", "transport_failed"] as const;
export type ExtractorClass = (typeof EXTRACTOR_CLASSES)[number];
/** The summary's manifest block: hashes, counts and the design's task and exposure, as the planner and judge fixtures record them. */
export const EXTRACTOR_SUMMARY_MANIFEST_FIELDS = ["sha256", "name", "task", "exposure", "briefSha256", "planSha256", "unitCount", "sourceCount"] as const;
export interface ExtractorCallRecord {
  ordinal: number; repeat: number; condition: ExtractorCondition; chunkId: string; requestSha256: string; requestBytes: number;
  /** The HTTP status, the time to the whole reply, and the raw reply's file, digest and size (`bodySha256`, `bodyBytes`), as the planner and judge record them. */
  status: number | null; elapsedMs: number; replyFile: string | null; bodySha256: string | null; bodyBytes: number;
  classification: ExtractorClass; transportError?: string; streamError?: string;
  /** The finish reason when it is a plain code (otherwise "other"), the reply content's byte length, and the reply's usage with its numeric fields only. */
  finishReason?: string | null; contentBytes?: number; usage?: unknown;
  /** A plain reply's reasoning field, which a streamed reply's assembly drops (its raw stream keeps it). */
  reasoningField?: "none" | "reasoning" | "reasoning_content" | "mixed"; reasoningBytes?: number;
  /**
   * The stage's checks. `keptWithDrops` is a complete reply with any reason (`accepted_with_drops`). `located` quotes and `valid`
   * conflicts pass the checks; the stage keeps them only from a complete reply.
   */
  keptWithDrops?: boolean; reasons?: ResearchExtractionAssessment["reasons"];
  quotes?: { given: number; located: number; dropped: number }; conflicts?: { given: number; valid: number; dropped: number };
  notesCleared?: number; questionsDowngraded?: number; questionsUpgraded?: number; outcomes?: Record<string, ResearchExtractionAssessment["outcomes"][number]["status"]>;
}
export interface ExtractorCellCounts { calls: number; classes: Partial<Record<ExtractorClass, number>>; keptWithDrops: number; reasons: Record<string, number> }
export interface ExtractorFixtureSummary {
  version: 1; startedUtc: string; finishedUtc?: string; model: string; dryRun: boolean; protocolSha256: string; requestSettings: ServingCardRequestSettings;
  manifest: { sha256: string; name: string; task: string; exposure: "fresh" | "exposed"; briefSha256: string; planSha256: string; unitCount: number; sourceCount: number };
  chunks: { chunkId: string; sourceId: string; sourceSha256: string; bytes: number; userContentBytes: number }[];
  conditions: ExtractorCondition[]; deployedCondition: ExtractorCondition; repeats: number; order: "repeat_condition_chunk";
  /** Per condition, as the judge fixture records its sets: the digest of its requests' digests in run order, their count and their summed bytes. */
  requests: Record<string, { requestSetSha256: string; requests: number; requestBytes: number; maxTokens: number; thinking: "disabled" | "model"; streamed: boolean }>;
  calls: ExtractorCallRecord[];
  /** Per condition, each class's count, as the planner's counts; `cells` holds the per-chunk tallies. */
  counts: Record<string, Partial<Record<ExtractorClass, number>>>; cells: Record<string, Record<string, ExtractorCellCounts>>;
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
/** The reply's usage with its numeric fields only (snake_case keys, nested objects kept), so no text the server adds can reach the summary. */
export function numericUsage(value: unknown, depth = 0): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (depth >= 3 || typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const kept: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const number = /^[a-z][a-z0-9_]{0,63}$/u.test(key) ? numericUsage(item, depth + 1) : undefined;
    if (number !== undefined) kept[key] = number;
  }
  return Object.keys(kept).length ? kept : undefined;
}

function judge(record: ExtractorCallRecord, assessment: ResearchExtractionAssessment): void {
  record.classification = assessment.state === "complete" ? (assessment.lostEvidence ? "held" : "complete") : assessment.state;
  record.keptWithDrops = assessment.state === "complete" && !assessment.lostEvidence && assessment.reasons.length > 0;
  record.reasons = assessment.reasons;
  record.quotes = { given: assessment.quotes.length + assessment.quotesDropped, located: assessment.quotes.length, dropped: assessment.quotesDropped };
  record.conflicts = { given: assessment.conflicts.length + assessment.conflictsDropped, valid: assessment.conflicts.length, dropped: assessment.conflictsDropped };
  record.notesCleared = assessment.notesCleared; record.questionsDowngraded = assessment.questionsDowngraded; record.questionsUpgraded = assessment.questionsUpgraded;
  record.outcomes = Object.fromEntries(assessment.outcomes.map(outcome => [outcome.questionId, outcome.status]));
}

function tally(summary: ExtractorFixtureSummary): void {
  summary.counts = Object.fromEntries(summary.conditions.map(condition => [condition, {}])); summary.cells = {};
  for (const call of summary.calls) {
    const counts = summary.counts[call.condition]!; counts[call.classification] = (counts[call.classification] ?? 0) + 1;
    const cell = ((summary.cells[call.chunkId] ??= {})[call.condition] ??= { calls: 0, classes: {}, keptWithDrops: 0, reasons: {} });
    cell.calls++; cell.classes[call.classification] = (cell.classes[call.classification] ?? 0) + 1; if (call.keptWithDrops) cell.keptWithDrops++;
    for (const reason of call.reasons ?? []) cell.reasons[reason.code] = (cell.reasons[reason.code] ?? 0) + 1;
  }
}

export async function runExtractorFixture(options: ExtractorRunOptions): Promise<ExtractorFixtureSummary> {
  const fixture = verifyExtractorInputs(options.inputs), requests = buildExtractorRequests(fixture, options.settings);
  const { manifest } = fixture;
  if (!options.dryRun && existsSync(options.out)) throw new Error("extractor_fixture_out_exists");
  const summary: ExtractorFixtureSummary = { version: 1, startedUtc: new Date().toISOString(), model: options.settings.vllm.model, dryRun: options.dryRun === true,
    protocolSha256: researchProtocolSha256(), requestSettings: servingCardRequestSettings(options.settings, true),
    manifest: { sha256: fixture.manifestSha256, name: manifest.name, task: manifest.task, exposure: manifest.exposure, briefSha256: manifest.brief.sha256, planSha256: manifest.plan.sha256,
      unitCount: fixture.units.length, sourceCount: fixture.chunks.length },
    chunks: fixture.chunks.map(c => ({ chunkId: c.chunkId, sourceId: c.sourceId, sourceSha256: c.sourceSha256, bytes: c.bytes, userContentBytes: Buffer.byteLength(c.userContent) })),
    conditions: [...manifest.conditions], deployedCondition: DEPLOYED_CONDITION, repeats: manifest.repeats, order: "repeat_condition_chunk", requests: {}, calls: [], counts: {}, cells: {} };
  for (const condition of manifest.conditions) {
    const own = requests.filter(request => request.condition === condition), first = own[0]!;
    summary.requests[condition] = { requestSetSha256: digest(canonical(own.map(request => request.requestSha256))), requests: own.length,
      requestBytes: own.reduce((sum, request) => sum + request.requestBytes, 0), maxTokens: first.maxTokens, thinking: first.thinking, streamed: first.streamed };
  }
  tally(summary);
  if (options.dryRun) return summary;
  const replies = join(options.out, "replies");
  mkdirSync(replies, { recursive: true, mode: 0o700 });
  const headers: Record<string, string> = { "content-type": "application/json", ...(options.endpoint.apiKey ? { authorization: `Bearer ${options.endpoint.apiKey}` } : {}) };
  const timeoutMs = options.endpoint.timeoutMs ?? COORDINATOR_PROFILES.heavy.requestTimeoutMs, chunks = new Map(fixture.chunks.map(c => [c.chunkId, c]));
  // Written before the first request, so no reply file ever exists without a summary beside it.
  writeSummary(options.out, summary);
  let ordinal = 0;
  for (const request of requests) {
    const chunk = chunks.get(request.chunkId)!, started = performance.now();
    const record: ExtractorCallRecord = { ordinal: ++ordinal, repeat: request.repeat, condition: request.condition, chunkId: request.chunkId, requestSha256: request.requestSha256,
      requestBytes: request.requestBytes, status: null, elapsedMs: 0, replyFile: null, bodySha256: null, bodyBytes: 0, classification: "transport_failed" };
    try {
      const response = await fetch(`${options.endpoint.baseUrl}/chat/completions`, { method: "POST", headers, body: request.body, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
      const bytes = Buffer.from(await response.arrayBuffer());
      record.elapsedMs = Math.round(performance.now() - started); record.status = response.status;
      record.replyFile = `r${String(request.repeat).padStart(2, "0")}-${request.condition}-${request.chunkId}.${request.streamed ? "sse" : "json"}`;
      record.bodySha256 = digest(bytes); record.bodyBytes = bytes.length;
      writePrivate(join(replies, record.replyFile), bytes);
      if (response.status !== 200) record.classification = "request_rejected";
      else {
        let body: Buffer | undefined;
        try {
          // A streamed reply is reassembled by the broker's own assembler, into the JSON a plain reply has.
          body = request.streamed ? assembleSseChatCompletion(bytes.toString("utf8")) : bytes;
        } catch (error) {
          if (error instanceof Error && /^[a-z_]+$/u.test(error.message)) record.streamError = error.message;
        }
        // The reply as the model layer reads it (scripts/chat-reply.ts): one it would reject is malformed, and a missing or null content is
        // empty text, which the stage judges.
        const reply = body === undefined ? undefined : readChatReply(body);
        if (reply === undefined) record.classification = "malformed_reply";
        else {
          const { content, message } = reply, finish = reply.finishReason;
          const fields = (["reasoning", "reasoning_content"] as const).filter(field => typeof message[field] === "string" && (message[field] as string).length);
          record.finishReason = typeof finish === "string" ? (/^[a-z_]{1,32}$/u.test(finish) ? finish : "other") : null;
          record.contentBytes = Buffer.byteLength(content); record.usage = numericUsage(reply.usage) ?? null;
          if (!request.streamed) {
            record.reasoningField = fields.length === 0 ? "none" : fields.length === 1 ? fields[0]! : "mixed";
            record.reasoningBytes = fields.reduce((n, field) => n + Buffer.byteLength(message[field] as string), 0);
          }
          // The stage's own judgement of an initial attempt: truncated when the reply stopped at its cap, as the pipeline's call() reads it.
          judge(record, assessResearchExtractionReply({ content, truncated: finish === "length", questions: fixture.questions, source: { id: chunk.sourceId },
            chunk: { id: chunk.chunkId, sourceSha256: chunk.sourceSha256, startLine: chunk.startLine }, chunkText: chunk.text }));
        }
      }
    } catch (error) {
      // Only the error's class name: a transport error's message and cause can carry the address.
      record.elapsedMs = Math.round(performance.now() - started); record.transportError = error instanceof Error ? error.name : "unknown";
    }
    summary.calls.push(record); tally(summary); writeSummary(options.out, summary);
  }
  summary.finishedUtc = new Date().toISOString(); writeSummary(options.out, summary);
  return summary;
}

const USAGE = "usage: pnpm fixture:extractor -- [--manifest <json>] [--out <dir>] [--dry-run]\n";
/** The command line's arguments, strictly: an unknown or repeated flag, or a flag without its value, is refused before anything runs. */
export function parseExtractorArguments(argv: readonly string[]): { manifest?: string; out?: string; dryRun: boolean } | undefined {
  const parsed: { manifest?: string; out?: string; dryRun: boolean } = { dryRun: false }, seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (seen.has(flag)) return undefined;
    seen.add(flag);
    if (flag === "--dry-run") parsed.dryRun = true;
    else if (flag === "--manifest" || flag === "--out") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) return undefined;
      if (flag === "--manifest") parsed.manifest = value; else parsed.out = value;
    } else return undefined;
  }
  return parsed;
}

async function main(): Promise<number> {
  const args = parseExtractorArguments(process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === "--")));
  if (!args) { process.stderr.write(USAGE); return 2; }
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  const environment = loadEnvironmentFiles({});
  if (!environment.SOAR_VLLM_BASE_URL) { process.stderr.write("SOAR_VLLM_BASE_URL is not set (environment or .env.local).\n"); return 2; }
  // loadConfig applies the app's endpoint policy: a base that is not loopback needs the explicit zero-fee declaration. Its policy
  // refusals name settings; any message that could carry an address is replaced by a fixed code.
  let config: ReturnType<typeof loadConfig>;
  try { config = loadConfig(); } catch (error) {
    const message = error instanceof Error && !error.message.includes("://") && !error.message.includes("\n") ? error.message : "extractor_fixture_config_invalid";
    process.stderr.write(`${message}\n`); return 2;
  }
  const out = args.out ?? join(".soar", "experiments", `e0-extractor-fixture-${new Date().toISOString().replace(/[:.]/gu, "")}`);
  if (!args.dryRun) {
    try { assertRunDirectoryIgnored(out); } catch { process.stderr.write("extractor_fixture_out_not_ignored\n"); return 2; }
  }
  const folder = dirname(resolve(manifestPath));
  const summary = await runExtractorFixture({ endpoint: { baseUrl: config.vllm.baseUrl, apiKey: config.vllm.apiKey, timeoutMs: COORDINATOR_PROFILES.heavy.requestTimeoutMs },
    settings: requestSettingsOf(config), out, dryRun: args.dryRun,
    inputs: { manifest: JSON.parse(readFileSync(manifestPath, "utf8")), read: path => readFileSync(join(folder, path)) } });
  process.stdout.write(`${JSON.stringify({ dryRun: summary.dryRun, conditions: summary.conditions, deployedCondition: summary.deployedCondition, repeats: summary.repeats,
    chunks: summary.chunks.map(c => c.chunkId), calls: summary.dryRun ? summary.conditions.length * summary.repeats * summary.chunks.length : summary.calls.length,
    requestSettings: summary.requestSettings, manifest: summary.manifest, requests: summary.requests, counts: summary.counts, retained: summary.dryRun ? null : `${basename(out)}/replies` })}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error instanceof Error && /^[a-z_]+$/u.test(error.message) ? error.message : "extractor_fixture_failed"}\n`); process.exitCode = 2; });
}
