import { z } from "zod";
import { canonical, digest, exactText, ExactApprovalSchema, privateAgentId, sha256Schema, type ExactApproval } from "./contracts";
import type { PrivateAgentBroker } from "./broker";

export const CONSULTATION_PURPOSE = "general task consultation";

const integer = z.number().int().nonnegative().safe();
const configSchema = z.object({
  destinationId: privateAgentId,
  model: z.string().min(1).max(256),
  maxOutputTokens: z.number().int().min(128).max(4096),
  inputMicrousdPerMillion: integer,
  outputMicrousdPerMillion: integer,
  cachedInputMicrousdPerMillion: integer.optional(),
  serviceTier: z.literal("default").optional(),
}).strict();
export type ConsultantTextConfig = z.infer<typeof configSchema>;
const messagesSchema = z.array(z.object({ role: z.enum(["system", "user"]), content: z.string() }).strict()).min(1).max(100);
export interface PreparedConsultantRequest {
  body: string;
  bodySha256: string;
  priceProfileSha256: string;
  maxFeeMicrousd: number;
}
export interface ConsultantTextResult {
  content: string;
  dispatchId: string;
  responseSha256: string;
  feeMicrousd: number;
  model: string;
  usage: { promptTokens: number; completionTokens: number; cachedInputTokens: number };
  serviceTier?: "default";
}
const preparedSchema = z.object({ body: z.string(), bodySha256: sha256Schema,
  priceProfileSha256: sha256Schema, maxFeeMicrousd: integer }).strict();
function invalid(code: string): never { throw new Error(code); }
function configuration(raw: ConsultantTextConfig): ConsultantTextConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) invalid("consultant_configuration_invalid");
  exactText(result.data.model);
  if (!result.data.model.trim()) invalid("consultant_configuration_invalid");
  if (result.data.serviceTier === undefined) {
    const { serviceTier: _omitted, ...unconfigured } = result.data;
    return unconfigured;
  }
  return result.data;
}
function ceilingFee(input: number, output: number, cached: number, config: ConsultantTextConfig): number {
  const numerator = BigInt(input - cached) * BigInt(config.inputMicrousdPerMillion) +
    BigInt(cached) * BigInt(config.cachedInputMicrousdPerMillion ?? config.inputMicrousdPerMillion) +
    BigInt(output) * BigInt(config.outputMicrousdPerMillion);
  const fee = (numerator + 999999n) / 1000000n;
  if (fee > BigInt(Number.MAX_SAFE_INTEGER)) invalid("consultant_fee_outside_envelope");
  return Number(fee);
}
export function consultantPriceProfileSha256(raw: ConsultantTextConfig): string {
  return digest(canonical({ schemaVersion: 1, algorithm: "ceil_linear_token_microusd_v1", config: configuration(raw) }));
}
export function prepareConsultantRequest(raw: ConsultantTextConfig,
  messages: { role: "system" | "user"; content: string }[]): PreparedConsultantRequest {
  const config = configuration(raw), parsed = messagesSchema.safeParse(messages);
  if (!parsed.success) invalid("consultant_messages_invalid");
  for (const message of parsed.data) exactText(message.content);
  // This method is deliberately text-only and nonstreaming. No tool schema,
  // provider-specific Qwen setting, credential or caller-controlled parameter.
  const body = canonical({ model: config.model, messages: parsed.data, stream: false, max_tokens: config.maxOutputTokens,
    ...(config.serviceTier === undefined ? {} : { service_tier: config.serviceTier }) });
  const inputBound = Buffer.byteLength(body);
  if (inputBound > 192 * 1024) invalid("consultant_body_exceeded");
  const reserveConfig = { ...config, inputMicrousdPerMillion: Math.max(config.inputMicrousdPerMillion,
    config.cachedInputMicrousdPerMillion ?? config.inputMicrousdPerMillion) };
  return { body, bodySha256: digest(body), priceProfileSha256: consultantPriceProfileSha256(config),
    maxFeeMicrousd: ceilingFee(inputBound, config.maxOutputTokens, 0, reserveConfig) };
}

const responseSchema = z.object({
  model: z.string(),
  service_tier: z.unknown().optional(),
  choices: z.array(z.object({ finish_reason: z.literal("stop"), message: z.object({
    role: z.literal("assistant").optional(), content: z.string(),
    tool_calls: z.array(z.unknown()).optional(), function_call: z.unknown().optional(),
  }) })).length(1),
  usage: z.object({ prompt_tokens: integer, completion_tokens: integer, total_tokens: integer.optional(),
    prompt_tokens_details: z.object({ cached_tokens: integer.optional() }).optional() }),
});

/** Send the exact approved bytes once; the caller must persist the returned
 * text with its receipt identity before allowing any local continuation. */
export async function dispatchConsultantText(input: {
  broker: PrivateAgentBroker; jobId: string; contextId: string; config: ConsultantTextConfig;
  prepared: PreparedConsultantRequest; grantId: string; approval: ExactApproval; signal: AbortSignal;
  validateAtCommit?: () => void;
}): Promise<ConsultantTextResult> {
  const config = configuration(input.config), parsed = preparedSchema.safeParse(input.prepared);
  const approval = ExactApprovalSchema.safeParse(input.approval);
  if (!parsed.success || !approval.success) invalid("consultant_prepared_invalid");
  const saved = parsed.data;
  let packet: unknown;
  try { packet = JSON.parse(saved.body); } catch { invalid("consultant_prepared_invalid"); }
  const packetSchema = z.object({ model: z.string(), messages: messagesSchema, stream: z.literal(false), max_tokens: integer,
    service_tier: z.literal("default").optional() }).strict();
  const decodedPacket = packetSchema.safeParse(packet);
  if (!decodedPacket.success) invalid("consultant_prepared_invalid");
  const rebuilt = prepareConsultantRequest(config, decodedPacket.data.messages);
  if (canonical(rebuilt) !== canonical(saved) || approval.data.priceProfileSha256 !== saved.priceProfileSha256 ||
      approval.data.maxFeeMicrousd !== saved.maxFeeMicrousd) invalid("consultant_prepared_changed");
  const maxInputTokens = Buffer.byteLength(saved.body);
  let content: string | undefined;
  let validatedUsage: ConsultantTextResult["usage"] | undefined;
  const result = await input.broker.request({ jobId: input.jobId, contextId: input.contextId, destinationId: config.destinationId,
    purpose: CONSULTATION_PURPOSE, method: "POST", body: saved.body, maxFeeMicrousd: saved.maxFeeMicrousd,
    grantId: input.grantId, approval: approval.data, signal: input.signal }, bytes => {
    const response = responseSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (!response.success) invalid("consultant_response_invalid");
    const value = response.data, choice = value.choices[0]!, usage = value.usage;
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    if (value.model !== config.model || (config.serviceTier !== undefined && value.service_tier !== config.serviceTier) ||
        choice.message.tool_calls?.length || choice.message.function_call != null ||
        !choice.message.content.trim() || usage.prompt_tokens > maxInputTokens || usage.completion_tokens > config.maxOutputTokens ||
        cached > usage.prompt_tokens || !Number.isSafeInteger(usage.prompt_tokens + usage.completion_tokens) ||
        (usage.total_tokens !== undefined && usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens)) invalid("consultant_response_invalid");
    exactText(choice.message.content);
    content = choice.message.content;
    validatedUsage = { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, cachedInputTokens: cached };
    return ceilingFee(usage.prompt_tokens, usage.completion_tokens, cached, config);
  }, input.validateAtCommit);
  if (content === undefined || validatedUsage === undefined || result.receipt.status !== "settled" || result.receipt.responseSha256 !== digest(result.bytes) ||
      result.receipt.feeMicrousd === undefined) invalid("consultant_settlement_missing");
  return { content, dispatchId: result.receipt.id, responseSha256: result.receipt.responseSha256, feeMicrousd: result.receipt.feeMicrousd,
    model: config.model, usage: validatedUsage, ...(config.serviceTier === undefined ? {} : { serviceTier: config.serviceTier }) };
}
