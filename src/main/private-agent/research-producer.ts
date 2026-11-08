import { z } from "zod";
import { canonical, digest, privateAgentId, sha256Schema } from "./contracts";
import { validateReadyResearchPacket } from "./research-coverage";
import type { ResearchSourceIdentity } from "./research-contract";

const sourceSchema = z.object({ id: z.string().min(1).max(2048), path: z.string().min(1).max(2048),
  sha256: sha256Schema, bytes: z.number().int().nonnegative().safe() }).strict();
const sourcesSchema = z.array(sourceSchema).min(1).max(1024).refine(sources => new Set(sources.map(source => source.id)).size === sources.length, "duplicate source id");
const budgetSchema = z.object({ indexCalls: z.number().int().positive(), extractionCalls: z.number().int().positive(),
  plannerCalls: z.number().int().positive(), synthesisCalls: z.number().int().positive() }).strict();
const stageSchema = z.enum(["index", "plan", "extract", "synthesise"]);
type Stage = z.infer<typeof stageSchema>;
const stagePurposes: Readonly<Record<Stage, string>> = Object.freeze({ index: "research source index", plan: "research plan",
  extract: "research evidence extraction", synthesise: "research synthesis" });
export const ResearchInputSchema = z.object({ originalGoalSha256: sha256Schema, sourceManifest: sourcesSchema }).strict();
export type ResearchInput = z.infer<typeof ResearchInputSchema>;
/** A reader-context row that resolved without a response: `superseded` (a retry followed) or `failed` (none did). Absent on a settled row, so every earlier producer is byte-identical. */
const resolvedStatusSchema = z.enum(["superseded", "failed"]);
export const ResearchProducerSchema = z.object({ version: z.literal(2), kind: z.enum(["session", "controlled_pipeline"]),
  sourceJobId: privateAgentId, contextId: privateAgentId, originalGoalSha256: sha256Schema, sourceManifest: sourcesSchema,
  protocolSha256: sha256Schema, budget: budgetSchema,
  receipts: z.array(z.object({ id: privateAgentId, stage: stageSchema, sha256: sha256Schema, status: resolvedStatusSchema.optional() }).strict()).min(1).max(1000),
}).strict();
export type ResearchProducer = z.infer<typeof ResearchProducerSchema>;
type File = { path: string; bytes: Buffer };
type Source = { id: string; path: string; bytes: Buffer };
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function need(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }

/** Bind the actual composed research input before any model dispatch; task/brief file identity is separate. */
export function createResearchInput(brief: string, sources: readonly Source[]): ResearchInput {
  const sourceManifest: ResearchSourceIdentity[] = sources.map(source => ({ id: source.id, path: source.path,
    sha256: digest(source.bytes), bytes: source.bytes.length })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return ResearchInputSchema.parse({ originalGoalSha256: digest(brief), sourceManifest });
}

const receiptBase = { id: privateAgentId, jobId: privateAgentId, contextId: privateAgentId, purpose: z.string(),
  committedAt: z.number().int().nonnegative().safe(), reservedFeeMicrousd: z.number().int().nonnegative().safe() };
/**
 * A resolved row: settled with its response, or resolved without one (`superseded` by a retry, or `failed`). Settled rows
 * carry a response and a fee; a resolved-without-response row carries neither and never a fee. A `committed` or `unknown`
 * row is not resolved and still refuses the binding (research_producer_unsettled_receipt).
 */
const receiptSchema = z.union([
  z.object({ ...receiptBase, status: z.literal("settled"), responseSha256: sha256Schema, feeMicrousd: z.number().int().nonnegative().safe() }).passthrough(),
  z.object({ ...receiptBase, status: resolvedStatusSchema, responseSha256: z.undefined().optional(), feeMicrousd: z.undefined().optional() }).passthrough(),
]);

/**
 * Receipt hashes cover complete persisted rows, including any native admission evidence. No authority is minted here.
 * Every resolved reader-context row is bound, so the ledger and the packet agree row for row: a row a retry superseded (the
 * D4 local retry, or the Anthropic destination's 429/529 retry) and a failed row bind with their status; each stage's calls
 * must equal its rows that no retry superseded (finding D14, backlog item 1 of the 2026-11-05 review).
 */
function receiptBindings(receipts: readonly unknown[], jobId: string, contextId: string,
  summary: { stages: readonly { stage: string; calls: number }[] }): ResearchProducer["receipts"] {
  const rows = receipts.filter(receipt => typeof receipt === "object" && receipt !== null && (receipt as { contextId?: unknown }).contextId === contextId);
  const seen = new Set<string>();
  const bindings = rows.map(raw => {
    const parsed = receiptSchema.safeParse(raw);
    need(parsed.success, "research_producer_unsettled_receipt");
    const row = parsed.data;
    need(row.jobId === jobId && !seen.has(row.id), "research_producer_receipt_identity"); seen.add(row.id);
    const stage = (Object.keys(stagePurposes) as Stage[]).find(key => stagePurposes[key] === row.purpose);
    need(stage, "research_producer_unknown_purpose");
    return { id: row.id, stage, sha256: digest(canonical(raw)), ...(row.status === "settled" ? {} : { status: row.status }) };
  });
  need(summary.stages.length === 4 && same(summary.stages.map(stage => stage.stage), Object.keys(stagePurposes)), "research_producer_stage_summary");
  for (const stage of summary.stages) need(Number.isSafeInteger(stage.calls) && stage.calls > 0 &&
    bindings.filter(receipt => receipt.stage === stage.stage && receipt.status !== "superseded").length === stage.calls, "research_producer_receipt_count");
  return bindings;
}

/** Pure construction from actual ledger receipts and the validated generated packet, for either honest producer kind. */
export function createResearchProducer(input: { kind: ResearchProducer["kind"]; jobId: string; contextId: string;
  brief: string; sources: readonly Source[]; files: readonly File[]; receipts: readonly unknown[] }): ResearchProducer {
  const source = createResearchInput(input.brief, input.sources);
  const packet = validateReadyResearchPacket(input.files, { brief: input.brief, sources: input.sources });
  return ResearchProducerSchema.parse({ version: 2, kind: input.kind, sourceJobId: input.jobId, contextId: input.contextId,
    ...source, protocolSha256: packet.summary.protocolSha256, budget: packet.summary.budget,
    receipts: receiptBindings(input.receipts, input.jobId, input.contextId, packet.summary) });
}

/** Recheck a saved producer against the raw persisted ledger and separately frozen/pre-stage input. */
export function validateResearchProducer(value: unknown, input: { jobId: string; files: readonly File[];
  receipts: readonly unknown[]; input: ResearchInput }): ResearchProducer {
  const producer = ResearchProducerSchema.parse(value), expected = ResearchInputSchema.parse(input.input);
  need(producer.sourceJobId === input.jobId && producer.originalGoalSha256 === expected.originalGoalSha256 &&
    same(producer.sourceManifest, expected.sourceManifest), "research_producer_input_drift");
  const packet = validateReadyResearchPacket(input.files, { sourceManifest: expected.sourceManifest,
    protocolSha256: producer.protocolSha256, budget: producer.budget });
  need(packet.coverage.briefSha256 === producer.originalGoalSha256, "research_producer_goal_drift");
  need(same(producer.receipts, receiptBindings(input.receipts, input.jobId, producer.contextId, packet.summary)), "research_producer_receipts_drift");
  return producer;
}
