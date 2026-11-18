/**
 * Backlog item 10: the assist's attempt and stage records (#79, decision 12). They live apart
 * from research-assist.ts so that the ready gate (research-coverage.ts) can parse a stage's record strictly without importing the
 * wrapper, whose scrubber imports research-coverage.ts. research-assist.ts re-exports them. Nothing here is part of an assist
 * protocol block: the records say what happened, never what a packet may hold.
 */
import { z } from "zod";
import { canonical, exactText } from "./contracts";

/**
 * 10.b (#147, decision 9a; the Rayline carry-over (d)): the most characters of the served model
 * string a settled attempt records, as the provider reported it.
 */
export const ASSIST_SERVED_MODEL_MAX_CHARS = 200;
/**
 * A model identifier, never free text: a letter or digit, then letters, digits and `. _ : @ / + -`, 1 to 200 characters in all. The
 * record reaches summary.json and the writer's workspace, so a provider's prose, white space or control text is dropped instead.
 */
const SERVED_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,199}$/u;
const servedModelSchema = z.string().regex(SERVED_MODEL).refine(value => { try { return exactText(value) === value; } catch { return false; } }, "exact text");
/** The provider's model string as a settled attempt records it: a model identifier of 1 to 200 characters, or nothing. */
export function assistServedModel(value: unknown): string | undefined {
  return typeof value === "string" && servedModelSchema.safeParse(value).success ? value : undefined;
}
const count = z.number().int().nonnegative();
const usageSchema = z.object({ inputTokens: count, outputTokens: count, cacheReadTokens: count, cacheWriteTokens: count }).strict();
const codeSchema = z.string().regex(/^[a-z_]{1,80}$/u);
const PacketRecordSchema = z.object({ briefBytes: count, units: count, sources: count, priorAttempts: count.optional(), gistsTrimmed: count.optional(), gistMaxChars: count.optional(),
  quotesInPacket: count.optional(), quotesTrimmed: count.optional(), conflictsInPacket: count.optional(), evidenceBytes: count.optional(),
  fieldBytes: z.object(Object.fromEntries(["authoritativeSchema", "brief", "units", "sources", "budget", "priorAttempts", "plan", "evidenceText", "coverage", "repairReason"]
    .map(key => [key, count.optional()]))).strict().optional(),
  substitutions: z.object({ brief: count, units: count, gists: count, plan: count, quotes: count, digests: count, urls: count, files: count }).strict(),
  auditFinding: z.enum(["source_identity", "digest", "url_or_path", "literal_text"]).optional() }).strict();
/** The attempt record each outcome carries (decision 12). */
export const ResearchAssistAttemptRecordSchema = z.object({ version: z.literal(1), touchpoint: z.enum(["T1", "T2"]), ordinal: z.union([z.literal(1), z.literal(2)]), retryAfterTruncation: z.boolean(),
  outcome: z.enum(["settled", "skipped", "failed", "refused", "stopped"]), code: codeSchema.optional(), dispatched: z.boolean(), requestBytes: count.optional(), reservedFeeMicrousd: count.optional(),
  usage: usageSchema.extend({ thinkingTokens: count.optional(), cacheWriteReported: z.boolean() }).strict().optional(), finish: z.enum(["stop", "length", "content_filter", "other"]).optional(),
  feeMicrousd: count.optional(), packet: PacketRecordSchema.optional(), servedModel: servedModelSchema.optional() }).strict()
  .refine(record => (record.outcome === "settled") === (record.code === undefined), "a code exactly when not settled")
  .refine(record => (record.outcome === "settled") === (record.usage !== undefined), "usage exactly when settled")
  .refine(record => record.outcome !== "settled" || (record.dispatched && record.finish !== undefined && record.feeMicrousd !== undefined), "a settled attempt was dispatched and billed")
  .refine(record => !["skipped", "failed"].includes(record.outcome) || record.dispatched, "a skipped or failed attempt was dispatched")
  .refine(record => record.outcome !== "refused" || !record.dispatched, "a refused attempt was never dispatched")
  .refine(record => (record.ordinal === 2) === record.retryAfterTruncation && (record.touchpoint === "T2" || record.ordinal === 1), "only T2's retry is ordinal 2")
  .refine(record => record.servedModel === undefined || record.outcome === "settled", "a served model only on a settled attempt");
const sumUsage = (attempts: readonly { usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } }[]) => {
  const settled = attempts.flatMap(attempt => attempt.usage ? [attempt.usage] : []);
  return settled.length ? settled.reduce((sum, usage) => ({ inputTokens: sum.inputTokens + usage.inputTokens, outputTokens: sum.outputTokens + usage.outputTokens,
    cacheReadTokens: sum.cacheReadTokens + usage.cacheReadTokens, cacheWriteTokens: sum.cacheWriteTokens + usage.cacheWriteTokens }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }) : null;
};
/**
 * The stage summary's `ResearchStageCounts.assist` record, which 10.b builds per touchpoint (decision 12). `attempts` keeps
 * every attempt record whole; `usage` is the settled attempts' sum, and null when none settled, so a skipped or refused
 * assist is never read as zero writes.
 */
export const ResearchAssistStageRecordSchema = z.object({ version: z.literal(1), touchpoint: z.enum(["T1", "T2"]), policy: z.enum(["local_first", "forced_split"]), fired: z.boolean(),
  trigger: z.enum(["forced_split", "local_plans_rejected", "local_syntheses_refused"]).nullable(), attempts: z.array(ResearchAssistAttemptRecordSchema).max(2),
  outcome: z.enum(["settled", "skipped", "failed", "refused", "stopped"]).optional(), accepted: z.boolean(), code: codeSchema.optional(), usage: usageSchema.nullable() }).strict()
  .refine(record => record.attempts.every((attempt, i) => attempt.touchpoint === record.touchpoint && attempt.ordinal === i + 1), "attempts of this touchpoint, in order")
  .refine(record => record.touchpoint === "T2" || record.attempts.length <= 1, "T1 has at most one attempt")
  .refine(record => record.fired ? record.trigger !== null && record.attempts.length > 0 && record.outcome === record.attempts.at(-1)!.outcome
    : record.trigger === null && !record.attempts.length && record.outcome === undefined && record.usage === null, "a fired touchpoint has its trigger, attempts and last outcome")
  .refine(record => !record.accepted || record.attempts.at(-1)?.outcome === "settled", "only a settled reply is accepted")
  .refine(record => canonical(record.usage) === canonical(sumUsage(record.attempts)), "usage is the settled attempts' sum, null when none settled");
export type ResearchAssistStageRecord = z.infer<typeof ResearchAssistStageRecordSchema>;
