/**
 * The research role policy (SC, the shared serving-card reader): per-role output caps and thinking for attempt 1 (the
 * initial call) and attempt 2 (the repair or second call of the same role), and the structured-output flag of the three
 * roles with a reply schema. A leaf module: it imports zod only, so research-pipeline.ts and everything it imports may import
 * it. Only types may be imported from serving-card.ts there, because serving-card.ts imports research-pipeline.ts.
 */
import { z } from "zod";

export const RESEARCH_ROLES = ["index", "plan", "extract", "synthesis"] as const;
export type ResearchRole = (typeof RESEARCH_ROLES)[number];
export const STRUCTURED_OUTPUT_ROLES = ["plan", "extract", "synthesis"] as const;
export type StructuredOutputRole = (typeof STRUCTURED_OUTPUT_ROLES)[number];
/** SOAR_MAX_OUTPUT_TOKENS's floor (config.ts); a role cap below it is refused. */
export const MIN_ROLE_OUTPUT_TOKENS = 128;
/** "model" means the role model's profile setting (Heavy: medium). */
export const RoleThinkingSchema = z.enum(["disabled", "model"]);
export type RoleThinking = z.infer<typeof RoleThinkingSchema>;
export const StructuredOutputVariantSchema = z.enum(["strict", "non_strict"]);
export type StructuredOutputVariant = z.infer<typeof StructuredOutputVariantSchema>;
/** The flags refer to the call's effective thinking mode, which matches probe P10's `<role>/off` and `<role>/on` cells. */
export const StructuredOutputPolicySchema = z.object({ variant: StructuredOutputVariantSchema, thinkingOff: z.boolean(), thinkingOn: z.boolean() })
  .strict().refine(policy => policy.thinkingOff || policy.thinkingOn);
export type StructuredOutputPolicy = z.infer<typeof StructuredOutputPolicySchema>;

const cap = z.number().int().positive();
/** [attempt 1, attempt 2]: the initial call, then the repair or second call of the same role. Exactly two entries. */
const attemptCaps = z.tuple([cap, cap]);
const attemptThinking = z.tuple([RoleThinkingSchema, RoleThinkingSchema]);
const IndexRolePolicySchema = z.object({ maxOutputTokens: attemptCaps, thinking: attemptThinking }).strict();
const SchemaRolePolicySchema = z.object({ maxOutputTokens: attemptCaps, thinking: attemptThinking, structuredOutput: StructuredOutputPolicySchema.nullable() }).strict();
/** Strict throughout; the index role has no reply schema and never a structuredOutput key. */
export const ResearchRolePolicySchema = z.object({ index: IndexRolePolicySchema, plan: SchemaRolePolicySchema, extract: SchemaRolePolicySchema,
  synthesis: SchemaRolePolicySchema }).strict();
export type ResearchRolePolicy = z.infer<typeof ResearchRolePolicySchema>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
}

/**
 * Today's OUTPUT_TOKENS and THINKING (research-pipeline.ts:28-29) on both attempts, and no structured output. Literal values,
 * because this leaf cannot import the pipeline; a test pins them equal to the pipeline's constants. Deep-frozen.
 */
export const DEFAULT_RESEARCH_ROLE_POLICY: Readonly<ResearchRolePolicy> = deepFreeze({
  index: { maxOutputTokens: [1536, 1536], thinking: ["disabled", "disabled"] },
  plan: { maxOutputTokens: [8192, 8192], thinking: ["model", "model"], structuredOutput: null },
  extract: { maxOutputTokens: [2048, 2048], thinking: ["disabled", "disabled"], structuredOutput: null },
  synthesis: { maxOutputTokens: [8192, 8192], thinking: ["model", "model"], structuredOutput: null },
} satisfies ResearchRolePolicy);

export const ROLE_PARAMETERS = ["maxOutputTokens", "thinking", "structuredOutput"] as const;
export type RoleParameter = (typeof ROLE_PARAMETERS)[number];

const samePair = (left: readonly unknown[], right: readonly unknown[]) => left.length === right.length && left.every((item, index) => item === right[index]);

/**
 * Every role value that differs from DEFAULT_RESEARCH_ROLE_POLICY, in role order then parameter order: a cap pair or a
 * thinking pair that differs on either attempt, or a non-null structured output. `at` is a fixed key path into the card.
 * The one predicate shared by the reader's fail-closed step and item 7(a)'s hash binding.
 */
export function nonDefaultRoleParameters(roles: ResearchRolePolicy): { parameter: RoleParameter; at: string }[] {
  const found: { parameter: RoleParameter; at: string }[] = [];
  for (const role of RESEARCH_ROLES) {
    const value = roles[role], fallback = DEFAULT_RESEARCH_ROLE_POLICY[role];
    if (!samePair(value.maxOutputTokens, fallback.maxOutputTokens)) found.push({ parameter: "maxOutputTokens", at: `roles.${role}.maxOutputTokens` });
    if (!samePair(value.thinking, fallback.thinking)) found.push({ parameter: "thinking", at: `roles.${role}.thinking` });
    if ("structuredOutput" in value && value.structuredOutput !== null) found.push({ parameter: "structuredOutput", at: `roles.${role}.structuredOutput` });
  }
  return found;
}
