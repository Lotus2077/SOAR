import { z } from "zod";
import { createHash } from "node:crypto";

export const privateAgentId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u);
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const ModeSchema = z.enum(["private", "cloud_help", "offline"]);
export type PrivateAgentMode = z.infer<typeof ModeSchema>;
export const SourceSchema = z.object({
  id: privateAgentId,
  version: sha256Schema,
  classification: z.enum(["public", "private", "credential"]),
  synthetic: z.boolean(),
}).strict();
export type PrivateAgentSource = z.infer<typeof SourceSchema>;

export const JobPolicySchema = z.object({
  version: z.literal(1),
  id: privateAgentId,
  mode: ModeSchema,
  revision: z.number().int().nonnegative().safe(),
  cancelled: z.boolean(),
  // These are host-admitted destination IDs, never model-authored URLs.
  destinations: z.array(privateAgentId).max(100),
  maxRequests: z.number().int().positive().max(1000),
  maxFeeMicrousd: z.number().int().nonnegative().safe(),
}).strict();
export type PrivateJobPolicy = z.infer<typeof JobPolicySchema>;

export const ContextSchema = z.object({
  id: privateAgentId,
  jobId: privateAgentId,
  sources: z.array(SourceSchema).min(1).max(10000),
}).strict();
export type PrivateAgentContext = z.infer<typeof ContextSchema>;

export const ExactApprovalSchema = z.object({
  proposalId: z.string().uuid(),
  proposalSha256: sha256Schema,
  priceProfileSha256: sha256Schema,
  maxFeeMicrousd: z.number().int().nonnegative().safe(),
}).strict();
export type ExactApproval = z.infer<typeof ExactApprovalSchema>;

export const GrantSchema = z.object({
  id: privateAgentId,
  jobId: privateAgentId,
  contextId: privateAgentId,
  policyRevision: z.number().int().nonnegative().safe(),
  contextSha256: sha256Schema,
  packetSha256: sha256Schema,
  destinationId: privateAgentId,
  destinationSha256: sha256Schema,
  purpose: z.string().min(1).max(500),
  expiresAt: z.number().int().positive().safe(),
  remainingUses: z.number().int().nonnegative().max(100),
  revoked: z.boolean(),
  approval: ExactApprovalSchema.optional(),
}).strict();
export type PrivateAgentGrant = z.infer<typeof GrantSchema>;

/** Deterministic host envelope encoding; reject text that UTF-8 would change. */
export function exactText(text: string): string {
  if (typeof text !== "string" || text.includes("\0") ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) {
    throw new Error("private_agent_invalid_text");
  }
  return text;
}

export function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonical(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(exactText(value));
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(exactText(key))}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error("private_agent_invalid_value");
}

export function contextFingerprint(context: PrivateAgentContext): string {
  return digest(canonical(ContextSchema.parse(context)));
}

export function restrictedContext(context: PrivateAgentContext): boolean {
  return context.sources.some(source => source.classification !== "public");
}

export function syntheticContext(context: PrivateAgentContext): boolean {
  return context.sources.every(source => source.classification === "public" || (source.classification === "private" && source.synthetic));
}
