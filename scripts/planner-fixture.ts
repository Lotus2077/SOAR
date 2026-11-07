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
 */
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadConfig, loadEnvironmentFiles } from "../src/main/config";
import { canonical, digest, sha256Schema } from "../src/main/private-agent/contracts";
import { vllmCacheSalt } from "../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../src/main/private-agent/profiles";
import { deriveBriefUnits, type BriefUnit } from "../src/main/private-agent/research-coverage";
import { RESEARCH_PLAN_JSON_SCHEMA, assessResearchPlanReply, type ResearchPlanAttempt } from "../src/main/private-agent/research-plan";
import { OUTPUT_TOKENS, PLAN_SYSTEM, researchProtocolSha256 } from "../src/main/private-agent/research-pipeline";

export const FIXTURE_CONDITIONS = ["legacy-thinking", "flash-thinking", "thinking-off", "flash-thinking-off"] as const;
export type FixtureCondition = (typeof FIXTURE_CONDITIONS)[number];
/** Proposal for the E0 card: the legacy shape with thinking, the flash_next_v1 shape with thinking, and thinking off. */
export const DEFAULT_CONDITIONS: readonly FixtureCondition[] = ["legacy-thinking", "flash-thinking", "thinking-off"];
export const FIXTURE_JOB_ID = "e0-planner-fixture";

export const PlannerFixtureManifestSchema = z.object({
  schemaVersion: z.literal(1), name: z.string().min(1), status: z.enum(["template", "pinned"]), note: z.string().optional(),
  task: z.string().min(1), exposure: z.enum(["exposed", "fresh"]), indexVersion: z.literal(2),
  indexSha256: sha256Schema.nullable(), briefSha256: sha256Schema.nullable(), sourceIdsSha256: sha256Schema.nullable(),
  sourceCount: z.number().int().positive().nullable(), mandatorySourceChunks: z.number().int().positive().nullable(),
  extractionCallBudget: z.number().int().min(1).max(40), conditions: z.array(z.enum(FIXTURE_CONDITIONS)).min(1), repeats: z.number().int().min(1).max(100),
}).strict();
export type PlannerFixtureManifest = z.infer<typeof PlannerFixtureManifestSchema>;
const IndexDocumentSchema = z.object({ version: z.literal(2), sources: z.array(z.object({ sourceId: z.string().min(1).max(2048) }).loose()).min(1) }).loose();

export interface FixtureInputs { index: Buffer; brief: Buffer; manifest: unknown }
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

/** The exact vLLM body of model.ts for the owned destination, non-streaming, no tools: legacy or flash_next_v1 shape. */
export function buildPlannerBody(condition: FixtureCondition, model: string, messages: readonly { role: string; content: string }[], options: { cacheSalt?: string } = {}): string {
  const thinking = condition === "thinking-off" || condition === "flash-thinking-off" ? "disabled" : "medium", flash = condition.startsWith("flash");
  return canonical({ model, messages, stream: false, max_tokens: OUTPUT_TOKENS.plan,
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
  units: number; requests: Record<string, { requestSha256: string; requestBytes: number; maxTokens: number }>; calls: FixtureCallRecord[]; counts: Record<string, Record<string, number>>;
}
export interface FixtureEndpoint { baseUrl: string; apiKey?: string; model: string; timeoutMs?: number }
export interface FixtureRunOptions { endpoint: FixtureEndpoint; inputs: FixtureInputs; out: string; repeats: number; conditions: readonly FixtureCondition[]; cacheSalt?: boolean; dryRun?: boolean }

function writePrivate(path: string, data: Buffer | string): void {
  const handle = openSync(path, "w", 0o600);
  try { writeSync(handle, typeof data === "string" ? Buffer.from(data) : data); } finally { closeSync(handle); }
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
    units: fixture.units.length, requests: Object.fromEntries(conditions.map(condition => [condition, { requestSha256: digest(bodies[condition]), requestBytes: Buffer.byteLength(bodies[condition]), maxTokens: OUTPUT_TOKENS.plan }])),
    calls: [], counts: {} };
  if (options.dryRun) return summary;
  const replies = join(options.out, "replies");
  mkdirSync(replies, { recursive: true, mode: 0o700 });
  const headers: Record<string, string> = { "content-type": "application/json", ...(options.endpoint.apiKey ? { authorization: `Bearer ${options.endpoint.apiKey}` } : {}) };
  const timeoutMs = options.endpoint.timeoutMs ?? COORDINATOR_PROFILES.heavy.requestTimeoutMs, sources = fixture.sourceIds.map(id => ({ id }));
  for (const condition of conditions) {
    for (let ordinal = 1; ordinal <= options.repeats; ordinal++) {
      const started = performance.now();
      const record: FixtureCallRecord = { condition, ordinal, status: null, elapsedMs: 0, replyFile: null, bodySha256: null, bodyBytes: 0, classification: "transport_failed" };
      try {
        const response = await fetch(`${options.endpoint.baseUrl}/chat/completions`, { method: "POST", headers, body: bodies[condition], redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
        const bytes = Buffer.from(await response.arrayBuffer());
        record.elapsedMs = Math.round(performance.now() - started); record.status = response.status;
        record.replyFile = `${condition}-${String(ordinal).padStart(2, "0")}.json`; record.bodySha256 = digest(bytes); record.bodyBytes = bytes.length;
        writePrivate(join(replies, record.replyFile), bytes);
        if (response.status !== 200) { record.classification = "request_rejected"; summary.calls.push(record); continue; }
        let reply: { choices?: { message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }[]; usage?: unknown };
        try { reply = JSON.parse(bytes.toString("utf8")); } catch { record.classification = "malformed_reply"; summary.calls.push(record); continue; }
        const choice = reply.choices?.[0], message = choice?.message, content = typeof message?.content === "string" ? message.content : undefined;
        if (content === undefined) { record.classification = "malformed_reply"; summary.calls.push(record); continue; }
        const fields = (["reasoning", "reasoning_content"] as const).filter(field => typeof message?.[field] === "string" && (message[field] as string).length);
        record.finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null; record.usage = reply.usage ?? null;
        record.reasoningField = fields.length === 0 ? "none" : fields.length === 1 ? fields[0]! : "mixed";
        record.reasoningBytes = fields.reduce((n, field) => n + Buffer.byteLength(message![field] as string), 0);
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
  if (!index || !brief) { process.stderr.write("usage: --index <index.json> --brief <brief> [--manifest <json>] [--repeats N] [--conditions a,b] [--out <dir>] [--cache-salt] [--dry-run]\n"); return 2; }
  const conditionsArgument = argument("--conditions"), conditions = conditionsArgument ? conditionsArgument.split(",").map(s => s.trim()).filter(Boolean) : [...DEFAULT_CONDITIONS];
  const unknown = conditions.filter(c => !(FIXTURE_CONDITIONS as readonly string[]).includes(c));
  if (unknown.length) { process.stderr.write(`unknown condition(s): ${unknown.join(", ")}\n`); return 2; }
  const repeats = Number(argument("--repeats") ?? "10");
  const environment = loadEnvironmentFiles({});
  if (!environment.SOAR_VLLM_BASE_URL) { process.stderr.write("SOAR_VLLM_BASE_URL is not set (environment or .env.local).\n"); return 2; }
  const config = loadConfig();
  const out = argument("--out") ?? join(".soar", "experiments", `e0-planner-fixture-${new Date().toISOString().replace(/[:.]/gu, "")}`);
  const summary = await runPlannerFixture({ endpoint: { baseUrl: config.vllm.baseUrl, apiKey: config.vllm.apiKey, model: config.vllm.model, timeoutMs: COORDINATOR_PROFILES.heavy.requestTimeoutMs },
    inputs: { index: readFileSync(index), brief: readFileSync(brief), manifest: JSON.parse(readFileSync(manifest, "utf8")) },
    out, repeats, conditions: conditions as FixtureCondition[], cacheSalt: process.argv.includes("--cache-salt"), dryRun: process.argv.includes("--dry-run") });
  process.stdout.write(`${JSON.stringify({ dryRun: summary.dryRun, conditions: summary.conditions, repeats: summary.repeats, units: summary.units, requests: summary.requests, counts: summary.counts,
    retained: summary.dryRun ? null : `${basename(out)}/replies` })}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error instanceof Error ? error.message : "planner_fixture_failed"}\n`); process.exitCode = 2; });
}
