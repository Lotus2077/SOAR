/**
 * E0 planner fixture (backlog item 5; review section 5.6, E0: "planner 3 x 10 on the exposed r3 index with raw replies
 * retained"). It builds the research pipeline's exact planner request (PLAN_SYSTEM, the user payload of
 * research-pipeline.ts and the vLLM body of model.ts) from an index.json and a brief that a committed hashes-only
 * manifest pins, POSTs it directly to the owner's endpoint (outside the broker, by design: synthetic or public input at
 * zero fee, no dispatch rows), retains every raw reply under the ignored out directory with mode 0o600, and writes per-call
 * attempt summaries holding codes, hashes and counts only. The endpoint comes from loadConfig, so the app's endpoint
 * policy applies, and the address is never printed.
 *
 *   pnpm fixture:planner -- --index .soar/experiments/e0/index.json --brief .soar/experiments/e0/brief.md \
 *     --manifest docs/experiments/e0-planner-fixture-v1.json --repeats 10 \
 *     --conditions legacy-thinking,flash-thinking,thinking-off [--out <dir>] [--cache-salt] [--dry-run]
 *
 * The three conditions and the 3 x 10 design are a proposal for the E0 card. The committed manifest is a template until the
 * owner fills its hashes from the exposed r3 index; the fixture refuses a template or a mismatch before any request.
 *
 * The serving card's plan call (BL-20261116-1253-e0-planner-structured-condition-design): `legacy-thinking-structured` adds the
 * strict `research_plan` response_format item 9 sends (model.ts's jsonSchemaResponseFormat over RESEARCH_ROLE_SCHEMAS.plan) at the
 * plan cap, and `legacy-thinking-structured-16384` the same call at the Heavy profile's ceiling. Manifest v2 pins them beside
 * `legacy-thinking`. Each of the conditions and the repeats comes from the manifest unless its own flag is given, and each repeat
 * runs every condition in turn. With --cache-salt every body carries the fixture's one salt, as a run under the card carries one:
 *
 *   pnpm fixture:planner -- --index <run-5 index.json> --brief <stage brief> --manifest docs/experiments/e0-planner-fixture-v2.json [--cache-salt]
 *
 * The E0 card's Amendment 7 adds two streamed cells beside `legacy-thinking-structured-16384` (cell A): the same call streamed as the stage
 * streams it (`legacy-thinking-structured-16384-streamed`, cell B) and that call with thinking off (`thinking-off-structured-16384-streamed`,
 * cell C). A streamed reply is reassembled by the broker's own assembler. Manifest v3 pins the index of the r3 re-measurement's run 2 and, as
 * `stage`, that run's first plan receipt: with --stage-run naming the run directory, every invocation (the dry run too) rebuilds cell B's
 * body salted with the run's own job and checks it against the receipt (bodyBytes, and packetSha256 over the configured endpoint) before
 * any request, so cell B is the stage's own call:
 *
 *   pnpm fixture:planner -- --index <run-2 index.json> --brief <stage brief> --manifest docs/experiments/e0-planner-fixture-v3.json \
 *     --conditions <one cell> --stage-run <run-2 directory> --cache-salt [--dry-run]
 */
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadConfig, loadEnvironmentFiles } from "../src/main/config";
import { canonical, digest, sha256Schema } from "../src/main/private-agent/contracts";
import { assembleSseChatCompletion } from "../src/main/private-agent/broker";
import { jsonSchemaResponseFormat, vllmCacheSalt } from "../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../src/main/private-agent/profiles";
import { deriveBriefUnits, type BriefUnit } from "../src/main/private-agent/research-coverage";
import { RESEARCH_PLAN_JSON_SCHEMA, assessResearchPlanReply, type ResearchPlanAttempt } from "../src/main/private-agent/research-plan";
import { OUTPUT_TOKENS, PLAN_SYSTEM, RESEARCH_ROLE_SCHEMAS, researchProtocolSha256 } from "../src/main/private-agent/research-pipeline";
import { readChatReply } from "./chat-reply";

export const FIXTURE_CONDITIONS = ["legacy-thinking", "flash-thinking", "thinking-off", "flash-thinking-off", "legacy-thinking-structured", "legacy-thinking-structured-16384",
  "legacy-thinking-structured-16384-streamed", "thinking-off-structured-16384-streamed"] as const;
export type FixtureCondition = (typeof FIXTURE_CONDITIONS)[number];
/** Proposal for the E0 card: the legacy shape with thinking, the flash_next_v1 shape with thinking, and thinking off. */
export const DEFAULT_CONDITIONS: readonly FixtureCondition[] = ["legacy-thinking", "flash-thinking", "thinking-off"];
export const FIXTURE_JOB_ID = "e0-planner-fixture";
/** The serving card's plan call adds this format (item 9): the strict `research_plan` schema, as the pipeline sends it under the card. */
export const PLAN_RESPONSE_FORMAT = Object.freeze({ ...RESEARCH_ROLE_SCHEMAS.plan, strict: true });
const CAP_16384: ReadonlySet<FixtureCondition> = new Set(["legacy-thinking-structured-16384", "legacy-thinking-structured-16384-streamed", "thinking-off-structured-16384-streamed"]);
const STREAMED: ReadonlySet<FixtureCondition> = new Set(["legacy-thinking-structured-16384-streamed", "thinking-off-structured-16384-streamed"]);
const THINKING_OFF: ReadonlySet<FixtureCondition> = new Set(["thinking-off", "flash-thinking-off", "thinking-off-structured-16384-streamed"]);
const STRUCTURED: ReadonlySet<FixtureCondition> = new Set(["legacy-thinking-structured", ...CAP_16384]);
/** Each condition's output cap: the plan cap, except the 16,384-token cells (the Heavy profile's ceiling, the adopted card's plan cap). */
export function plannerConditionCap(condition: FixtureCondition): number { return CAP_16384.has(condition) ? 16384 : OUTPUT_TOKENS.plan; }
/** Amendment 7's cells B and C are streamed, as the stage streams under the card; every other condition is not. */
export function plannerConditionStreamed(condition: FixtureCondition): boolean { return STREAMED.has(condition); }
/** The condition whose body is the stage's own first plan call under the adopted card, which manifest v3's `stage` receipt checks. */
export const STAGE_CONDITION: FixtureCondition = "legacy-thinking-structured-16384-streamed";
/** The dispatch purpose of a stage plan call (research-pipeline.ts PURPOSES.plan), which the run's receipts carry. */
export const PLAN_PURPOSE = "research plan";

export const PlannerFixtureManifestSchema = z.object({
  schemaVersion: z.literal(1), name: z.string().min(1), status: z.enum(["template", "pinned"]), note: z.string().optional(),
  task: z.string().min(1), exposure: z.enum(["exposed", "fresh"]), indexVersion: z.literal(2),
  indexSha256: sha256Schema.nullable(), briefSha256: sha256Schema.nullable(), sourceIdsSha256: sha256Schema.nullable(),
  sourceCount: z.number().int().positive().nullable(), mandatorySourceChunks: z.number().int().positive().nullable(),
  extractionCallBudget: z.number().int().min(1).max(40), conditions: z.array(z.enum(FIXTURE_CONDITIONS)).min(1), repeats: z.number().int().min(1).max(100),
  /** Manifest v3: the run whose first plan call cell B replays, by its job's hash and that call's receipt. */
  stage: z.object({ run: z.string().regex(/^run-[0-9]{1,2}$/u), jobIdSha256: sha256Schema, bodyBytes: z.number().int().positive(), packetSha256: sha256Schema }).strict().optional(),
}).strict();
export type PlannerFixtureManifest = z.infer<typeof PlannerFixtureManifestSchema>;
const IndexDocumentSchema = z.object({ version: z.literal(2), sources: z.array(z.object({ sourceId: z.string().min(1).max(2048) }).loose()).min(1) }).loose();

/** `stageResult` is the result.json of the run manifest v3's `stage` names (--stage-run). */
export interface FixtureInputs { index: Buffer; brief: Buffer; manifest: unknown; stageResult?: Buffer }
export interface VerifiedFixture {
  manifest: PlannerFixtureManifest; indexDocument: z.infer<typeof IndexDocumentSchema>; brief: string; units: BriefUnit[]; sourceIds: string[];
  indexSha256: string; briefSha256: string; sourceIdsSha256: string;
}

/** Every refusal here happens before any request is built or sent. */
export function verifyFixtureInputs(inputs: FixtureInputs): VerifiedFixture {
  const manifest = PlannerFixtureManifestSchema.parse(inputs.manifest);
  if (manifest.status === "template" || manifest.indexSha256 === null || manifest.briefSha256 === null || manifest.sourceIdsSha256 === null ||
      manifest.sourceCount === null || manifest.mandatorySourceChunks === null) throw new Error("planner_fixture_manifest_template");
  const indexSha256 = digest(inputs.index), briefSha256 = digest(inputs.brief);
  if (indexSha256 !== manifest.indexSha256) throw new Error("planner_fixture_index_mismatch");
  if (briefSha256 !== manifest.briefSha256) throw new Error("planner_fixture_brief_mismatch");
  const indexDocument = IndexDocumentSchema.parse(JSON.parse(inputs.index.toString("utf8")));
  const sourceIds = indexDocument.sources.map(s => s.sourceId), sourceIdsSha256 = digest(canonical([...sourceIds].sort()));
  if (sourceIdsSha256 !== manifest.sourceIdsSha256 || sourceIds.length !== manifest.sourceCount) throw new Error("planner_fixture_source_ids_mismatch");
  const brief = new TextDecoder("utf-8", { fatal: true }).decode(inputs.brief);
  return { manifest, indexDocument, brief, units: deriveBriefUnits(brief), sourceIds, indexSha256, briefSha256, sourceIdsSha256 };
}

/** The exact planner messages of research-pipeline.ts: PLAN_SYSTEM and the canonical user payload with repair null. */
export function buildPlannerMessages(fixture: VerifiedFixture): { role: "system" | "user"; content: string }[] {
  return [{ role: "system", content: PLAN_SYSTEM }, { role: "user", content: canonical({ authoritativeSchema: RESEARCH_PLAN_JSON_SCHEMA, brief: fixture.brief, units: fixture.units,
    sourceIndex: fixture.indexDocument, mandatorySourceChunks: fixture.manifest.mandatorySourceChunks, extractionCallBudget: fixture.manifest.extractionCallBudget, repair: null }) }];
}

/**
 * The exact vLLM body of model.ts for the owned destination, non-streaming, no tools: legacy or flash_next_v1 shape, and for the
 * structured conditions the serving card's plan call (item 9's response_format) at the condition's cap.
 */
export function buildPlannerBody(condition: FixtureCondition, model: string, messages: readonly { role: string; content: string }[], options: { cacheSalt?: string } = {}): string {
  const thinking = THINKING_OFF.has(condition) ? "disabled" : "medium", flash = condition.startsWith("flash"), structured = STRUCTURED.has(condition);
  return canonical({ model, messages, ...(STREAMED.has(condition) ? { stream: true, stream_options: { include_usage: true } } : { stream: false }), max_tokens: plannerConditionCap(condition),
    ...(structured ? { response_format: jsonSchemaResponseFormat(PLAN_RESPONSE_FORMAT) } : {}),
    ...(thinking === "disabled" ? { chat_template_kwargs: { enable_thinking: false } } : { reasoning_effort: "medium", ...COORDINATOR_PROFILES.heavy.sampling }),
    ...(flash ? { chat_template_kwargs: { enable_thinking: thinking !== "disabled", preserve_thinking: false } } : {}),
    ...(options.cacheSalt ? { cache_salt: options.cacheSalt } : {}) });
}

export type CallClassification = "valid" | "binding_invalid" | "schema_invalid" | "invalid_json" | "truncated" | "request_rejected" | "transport_failed" | "malformed_reply";
export interface FixtureCallRecord {
  condition: FixtureCondition; ordinal: number; status: number | null; elapsedMs: number; replyFile: string | null; bodySha256: string | null; bodyBytes: number;
  finishReason?: string | null; usage?: unknown; reasoningField?: "none" | "reasoning" | "reasoning_content" | "mixed"; reasoningBytes?: number;
  transportError?: string; attempt?: ResearchPlanAttempt; classification: CallClassification;
}
export interface FixtureSummary {
  version: 1; startedUtc: string; finishedUtc?: string; protocolSha256: string; model: string; conditions: FixtureCondition[]; repeats: number; dryRun: boolean;
  manifest: { name: string; task: string; exposure: string; indexSha256: string; briefSha256: string; sourceIdsSha256: string; sourceCount: number; mandatorySourceChunks: number; extractionCallBudget: number };
  units: number; requests: Record<string, { requestSha256: string; requestBytes: number; maxTokens: number; streamed: boolean }>; calls: FixtureCallRecord[]; counts: Record<string, Record<string, number>>;
  /** Manifest v3: cell B's body salted with the stage run's job, against that run's first plan receipt. */
  stageCheck?: PlannerStageCheck;
}
export interface PlannerStageCheck { run: string; condition: FixtureCondition; bodyBytes: boolean; packetSha256: boolean }
export interface FixtureEndpoint { baseUrl: string; apiKey?: string; model: string; timeoutMs?: number }
export interface FixtureRunOptions { endpoint: FixtureEndpoint; inputs: FixtureInputs; out: string; repeats: number; conditions: readonly FixtureCondition[]; cacheSalt?: boolean; dryRun?: boolean }

function writePrivate(path: string, data: Buffer | string): void {
  const handle = openSync(path, "w", 0o600);
  try { writeSync(handle, typeof data === "string" ? Buffer.from(data) : data); } finally { closeSync(handle); }
}

/** The broker's packet digest (broker.ts: method, URL, headers and body) for a POST to the owned endpoint. */
export function plannerPacketSha256(baseUrl: string, body: string): string {
  return digest(canonical({ method: "POST", url: new URL(`${baseUrl}/chat/completions`).href, headers: { "content-type": "application/json" }, body }));
}
/**
 * Manifest v3's check that cell B is the stage's own first plan call: the run's receipts are one job's, its first plan receipt is the
 * pinned one, and cell B's body salted with that job has the receipt's size and, over the configured endpoint, its packet digest.
 */
export function checkPlannerStage(fixture: VerifiedFixture, stageResult: Buffer | undefined, model: string, baseUrl: string): PlannerStageCheck | undefined {
  const stage = fixture.manifest.stage;
  if (!stage) return undefined;
  if (!stageResult) throw new Error("planner_fixture_stage_run_missing");
  let dispatches: { jobId: string; purpose: string; committedAt: number; bodyBytes: number; packetSha256: string }[];
  try {
    dispatches = z.array(z.object({ jobId: z.string().min(1), purpose: z.string(), committedAt: z.number(), bodyBytes: z.number().int().nonnegative(), packetSha256: sha256Schema }).loose())
      .parse((JSON.parse(stageResult.toString("utf8")) as { dispatches?: unknown }).dispatches);
  } catch { throw new Error("planner_fixture_stage_result_invalid"); }
  const jobIds = new Set(dispatches.map(d => d.jobId));
  if (jobIds.size !== 1 || digest([...jobIds][0]!) !== stage.jobIdSha256) throw new Error("planner_fixture_stage_job_mismatch");
  const first = dispatches.filter(d => d.purpose === PLAN_PURPOSE).sort((a, b) => a.committedAt - b.committedAt)[0];
  if (!first || first.bodyBytes !== stage.bodyBytes || first.packetSha256 !== stage.packetSha256) throw new Error("planner_fixture_stage_receipt_mismatch");
  const body = buildPlannerBody(STAGE_CONDITION, model, buildPlannerMessages(fixture), { cacheSalt: vllmCacheSalt([...jobIds][0]!) });
  return { run: stage.run, condition: STAGE_CONDITION, bodyBytes: Buffer.byteLength(body) === stage.bodyBytes, packetSha256: plannerPacketSha256(baseUrl, body) === stage.packetSha256 };
}

function classify(attempt: ResearchPlanAttempt): CallClassification {
  if (attempt.accepted) return "valid";
  if (attempt.truncated) return "truncated";
  if (attempt.errors.some(e => e.code === "invalid_json")) return "invalid_json";
  return attempt.bindingInspection === "completed" ? "binding_invalid" : "schema_invalid";
}

export async function runPlannerFixture(options: FixtureRunOptions): Promise<FixtureSummary> {
  const fixture = verifyFixtureInputs(options.inputs), messages = buildPlannerMessages(fixture);
  const conditions = [...new Set(options.conditions)];
  if (!conditions.length || !Number.isInteger(options.repeats) || options.repeats < 1) throw new Error("planner_fixture_design_invalid");
  const cacheSalt = options.cacheSalt ? vllmCacheSalt(FIXTURE_JOB_ID) : undefined;
  const bodies = Object.fromEntries(conditions.map(condition => [condition, buildPlannerBody(condition, options.endpoint.model, messages, { cacheSalt })])) as Record<FixtureCondition, string>;
  const summary: FixtureSummary = { version: 1, startedUtc: new Date().toISOString(), protocolSha256: researchProtocolSha256(), model: options.endpoint.model, conditions, repeats: options.repeats, dryRun: options.dryRun === true,
    manifest: { name: fixture.manifest.name, task: fixture.manifest.task, exposure: fixture.manifest.exposure, indexSha256: fixture.indexSha256, briefSha256: fixture.briefSha256, sourceIdsSha256: fixture.sourceIdsSha256,
      sourceCount: fixture.sourceIds.length, mandatorySourceChunks: fixture.manifest.mandatorySourceChunks!, extractionCallBudget: fixture.manifest.extractionCallBudget },
    units: fixture.units.length, requests: Object.fromEntries(conditions.map(condition => [condition, { requestSha256: digest(bodies[condition]), requestBytes: Buffer.byteLength(bodies[condition]),
      maxTokens: plannerConditionCap(condition), streamed: plannerConditionStreamed(condition) }])),
    calls: [], counts: {} };
  const stageCheck = checkPlannerStage(fixture, options.inputs.stageResult, options.endpoint.model, options.endpoint.baseUrl);
  if (stageCheck) summary.stageCheck = stageCheck;
  if (options.dryRun) return summary;
  if (stageCheck && !(stageCheck.bodyBytes && stageCheck.packetSha256)) throw new Error("planner_fixture_stage_mismatch");
  const replies = join(options.out, "replies");
  mkdirSync(replies, { recursive: true, mode: 0o700 });
  const headers: Record<string, string> = { "content-type": "application/json", ...(options.endpoint.apiKey ? { authorization: `Bearer ${options.endpoint.apiKey}` } : {}) };
  const timeoutMs = options.endpoint.timeoutMs ?? COORDINATOR_PROFILES.heavy.requestTimeoutMs, sources = fixture.sourceIds.map(id => ({ id }));
  // Each repeat runs every condition in turn (BL-20261116-1253-e0-planner-structured-condition-design, review), so drift at the
  // endpoint over the run falls on every condition alike, as the extractor fixture orders its calls.
  for (let ordinal = 1; ordinal <= options.repeats; ordinal++) {
    for (const condition of conditions) {
      const started = performance.now();
      const record: FixtureCallRecord = { condition, ordinal, status: null, elapsedMs: 0, replyFile: null, bodySha256: null, bodyBytes: 0, classification: "transport_failed" };
      try {
        const response = await fetch(`${options.endpoint.baseUrl}/chat/completions`, { method: "POST", headers, body: bodies[condition], redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
        const bytes = Buffer.from(await response.arrayBuffer());
        record.elapsedMs = Math.round(performance.now() - started); record.status = response.status;
        const streamed = plannerConditionStreamed(condition);
        record.replyFile = `${condition}-${String(ordinal).padStart(2, "0")}.${streamed ? "sse" : "json"}`; record.bodySha256 = digest(bytes); record.bodyBytes = bytes.length;
        writePrivate(join(replies, record.replyFile), bytes);
        if (response.status !== 200) { record.classification = "request_rejected"; summary.calls.push(record); continue; }
        // A streamed reply is reassembled by the broker's own assembler into the JSON a plain reply has; one it refuses is malformed.
        let body: Uint8Array | undefined;
        try { body = streamed ? assembleSseChatCompletion(bytes.toString("utf8")) : bytes; } catch { body = undefined; }
        // The reply as the model layer reads it (scripts/chat-reply.ts): one it would reject is malformed, and a missing or null content is
        // empty text, so a reply whose thinking spent the output cap and left no content is the pipeline's truncated attempt.
        const reply = body === undefined ? undefined : readChatReply(body);
        if (reply === undefined) { record.classification = "malformed_reply"; summary.calls.push(record); continue; }
        const { content, message } = reply;
        const fields = (["reasoning", "reasoning_content"] as const).filter(field => typeof message[field] === "string" && (message[field] as string).length);
        record.finishReason = reply.finishReason; record.usage = reply.usage ?? null;
        // The assembler keeps no reasoning field, so a streamed reply's reasoning is not recorded (its raw stream keeps it).
        if (!streamed) {
          record.reasoningField = fields.length === 0 ? "none" : fields.length === 1 ? fields[0]! : "mixed";
          record.reasoningBytes = fields.reduce((n, field) => n + Buffer.byteLength(message[field] as string), 0);
        }
        record.attempt = assessResearchPlanReply({ content, truncated: record.finishReason === "length", ordinal: 1, units: fixture.units, sources }).attempt;
        record.classification = classify(record.attempt);
      } catch (error) {
        record.elapsedMs = Math.round(performance.now() - started); record.transportError = error instanceof Error ? error.name : "unknown";
      }
      summary.calls.push(record);
    }
  }
  for (const condition of conditions) {
    const counts: Record<string, number> = {};
    for (const call of summary.calls.filter(c => c.condition === condition)) counts[call.classification] = (counts[call.classification] ?? 0) + 1;
    summary.counts[condition] = counts;
  }
  summary.finishedUtc = new Date().toISOString();
  writePrivate(join(options.out, "summary.json"), `${JSON.stringify(summary, null, 1)}\n`);
  return summary;
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }

async function main(): Promise<number> {
  const index = argument("--index"), brief = argument("--brief"), manifest = argument("--manifest") ?? "docs/experiments/e0-planner-fixture-v1.json";
  if (!index || !brief) { process.stderr.write("usage: --index <index.json> --brief <brief> [--manifest <json>] [--repeats N] [--conditions a,b] [--out <dir>] [--stage-run <run dir>] [--cache-salt] [--dry-run]\n"); return 2; }
  // The design comes from the manifest (its conditions and repeats) unless --conditions or --repeats overrides it; a manifest the schema
  // refuses keeps the built-in default here and is refused by the run before any request.
  const manifestJson: unknown = JSON.parse(readFileSync(manifest, "utf8")), pinned = PlannerFixtureManifestSchema.safeParse(manifestJson);
  const conditionsArgument = argument("--conditions"), conditions = conditionsArgument ? conditionsArgument.split(",").map(s => s.trim()).filter(Boolean)
    : pinned.success ? [...pinned.data.conditions] : [...DEFAULT_CONDITIONS];
  const unknown = conditions.filter(c => !(FIXTURE_CONDITIONS as readonly string[]).includes(c));
  if (unknown.length) { process.stderr.write(`unknown condition(s): ${unknown.join(", ")}\n`); return 2; }
  const repeats = Number(argument("--repeats") ?? (pinned.success ? pinned.data.repeats : 10));
  const environment = loadEnvironmentFiles({});
  if (!environment.SOAR_VLLM_BASE_URL) { process.stderr.write("SOAR_VLLM_BASE_URL is not set (environment or .env.local).\n"); return 2; }
  const config = loadConfig();
  const out = argument("--out") ?? join(".soar", "experiments", `e0-planner-fixture-${new Date().toISOString().replace(/[:.]/gu, "")}`);
  const summary = await runPlannerFixture({ endpoint: { baseUrl: config.vllm.baseUrl, apiKey: config.vllm.apiKey, model: config.vllm.model, timeoutMs: COORDINATOR_PROFILES.heavy.requestTimeoutMs },
    inputs: { index: readFileSync(index), brief: readFileSync(brief), manifest: manifestJson, ...(argument("--stage-run") ? { stageResult: readFileSync(join(argument("--stage-run")!, "result.json")) } : {}) },
    out, repeats, conditions: conditions as FixtureCondition[], cacheSalt: process.argv.includes("--cache-salt"), dryRun: process.argv.includes("--dry-run") });
  const stagePassed = summary.stageCheck === undefined || (summary.stageCheck.bodyBytes && summary.stageCheck.packetSha256);
  process.stdout.write(`${JSON.stringify({ dryRun: summary.dryRun, conditions: summary.conditions, repeats: summary.repeats, units: summary.units, requests: summary.requests, counts: summary.counts,
    stageCheck: summary.stageCheck ?? null, retained: summary.dryRun ? null : `${basename(out)}/replies` })}\n`);
  return stagePassed ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error instanceof Error ? error.message : "planner_fixture_failed"}\n`); process.exitCode = 2; });
}
