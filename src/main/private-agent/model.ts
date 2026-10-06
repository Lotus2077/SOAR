import { z } from "zod";
import type { ProviderResult } from "../providers/types";
import { BROKER_MAX_BODY_BYTES, PrivateAgentBroker } from "./broker";
import { canonical, privateAgentId, sha256Schema } from "./contracts";

export const MODEL_REQUEST_SIZE_STOP = "request_body_size_exceeded";
/** Adapter ceiling. Callers choose their own lower profile limit (the desktop clamps to 4096). */
export const MAX_MODEL_OUTPUT_TOKENS = 32768;
/** Constructed only from the completed canonical body, before any broker call. */
export class ModelRequestBodyTooLarge extends Error {
  constructor(readonly bodyBytes: number, readonly limitBytes: number = BROKER_MAX_BODY_BYTES) {
    super(MODEL_REQUEST_SIZE_STOP);
    if (!Number.isSafeInteger(bodyBytes) || !Number.isSafeInteger(limitBytes) || limitBytes < 1 || bodyBytes <= limitBytes) throw new Error("model_request_size_error_invalid");
  }
}

const sizeStopSchema = z.object({
  type: z.literal("model_request_not_dispatched"), contextId: privateAgentId, operationId: z.string().uuid(),
  promptProtocolSha256: sha256Schema, reason: z.literal(MODEL_REQUEST_SIZE_STOP), dispatched: z.literal(false),
  bodyBytes: z.number().int().safe().positive(), limitBytes: z.number().int().safe().positive(),
}).strict().refine(value => value.bodyBytes > value.limitBytes);
export type ModelRequestSizeStop = z.infer<typeof sizeStopSchema>;

/** A receipt's absence never proves non-dispatch. Require one exact host marker/start join. */
export function modelRequestSizeStop(events: Record<string, unknown>[], start: Record<string, unknown>): ModelRequestSizeStop | undefined {
  if (start.type !== "model_started") return;
  const starts = events.filter(event => event.type === "model_started" && event.operationId === start.operationId);
  const markers = events.filter(event => event.type === "model_request_not_dispatched" && event.operationId === start.operationId);
  if (starts.length !== 1 || markers.length !== 1 || events.some(event => event.type === "model_finished" && event.operationId === start.operationId)) return;
  const parsed = sizeStopSchema.safeParse(markers[0]);
  if (!parsed.success || parsed.data.contextId !== start.contextId || parsed.data.promptProtocolSha256 !== start.promptProtocolSha256 ||
      events.indexOf(markers[0]!) <= events.indexOf(starts[0]!)) return;
  return parsed.data;
}

export function hasInvalidModelRequestSizeStop(events: Record<string, unknown>[]): boolean {
  return events.some(marker => marker.type === "model_request_not_dispatched" &&
    !events.some(start => modelRequestSizeStop(events, start)?.operationId === marker.operationId));
}

export interface GeneralMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}
export interface GeneralToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface PrivateModelConfig {
  destinationId: string;
  model: string;
  maxOutputTokens: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  thinking: "disabled" | "medium";
  /** Request body cap in bytes; defaults to the broker's packet cap. Profiles raise it for the local model. */
  maxRequestBytes?: number;
  /** Sampling sent only with thinking enabled; absent keeps the server defaults. */
  sampling?: { temperature: number; top_p: number; top_k: number };
}

const nonnegativeInt = z.number().int().nonnegative().safe();
const responseSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({ id: z.string().min(1), type: z.literal("function"),
        function: z.object({ name: z.string().min(1), arguments: z.string() }) })).max(8).optional(),
    }), finish_reason: z.string().nullable(),
  })).length(1),
  usage: z.object({ prompt_tokens: nonnegativeInt, completion_tokens: nonnegativeInt,
    total_tokens: nonnegativeInt.optional(), prompt_tokens_details: z.object({ cached_tokens: nonnegativeInt.optional() }).optional() }),
});

/** Models get only the context bound by the host; transport is always brokered. */
export class PrivateAgentModel {
  readonly config: PrivateModelConfig;
  constructor(private readonly broker: PrivateAgentBroker, config: PrivateModelConfig,
    readonly jobId: string, readonly contextId: string) {
    const maxRequestBytes = config.maxRequestBytes ?? BROKER_MAX_BODY_BYTES;
    if (!Number.isSafeInteger(config.maxOutputTokens) || config.maxOutputTokens < 128 || config.maxOutputTokens > MAX_MODEL_OUTPUT_TOKENS ||
        !Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 4096 || maxRequestBytes > 4 * 1024 * 1024 ||
        (config.sampling !== undefined && ![config.sampling.temperature, config.sampling.top_p].every(value => Number.isFinite(value) && value >= 0 && value <= 2) ||
          config.sampling !== undefined && !Number.isSafeInteger(config.sampling.top_k)) ||
        ![config.inputUsdPerMillion, config.outputUsdPerMillion].every(value => Number.isFinite(value) && value >= 0)) {
      throw new Error("private_model_configuration_invalid");
    }
    this.config = Object.freeze({ ...config, maxRequestBytes, ...(config.sampling ? { sampling: Object.freeze({ ...config.sampling }) } : {}) });
  }

  /** Host-side calls (the entailment judge) narrow the same destination to thinking off and a short reply; they never widen anything. */
  async complete(messages: GeneralMessage[], tools: GeneralToolDefinition[], signal: AbortSignal,
    overrides?: { thinking?: "disabled"; maxOutputTokens?: number; purpose?: string }): Promise<ProviderResult> {
    const thinking = overrides?.thinking ?? this.config.thinking, maxOutputTokens = Math.min(this.config.maxOutputTokens, overrides?.maxOutputTokens ?? this.config.maxOutputTokens);
    const body = canonical({ model: this.config.model, messages, tools, tool_choice: "auto",
      parallel_tool_calls: false, stream: false, max_tokens: maxOutputTokens,
      ...(thinking === "disabled" ? { chat_template_kwargs: { enable_thinking: false } } : { reasoning_effort: "medium", ...(this.config.sampling ?? {}) }),
    });
    const bodyBytes = Buffer.byteLength(body), limitBytes = this.config.maxRequestBytes ?? BROKER_MAX_BODY_BYTES;
    if (bodyBytes > limitBytes) throw new ModelRequestBodyTooLarge(bodyBytes, limitBytes);
    const reservation = Math.ceil(bodyBytes * this.config.inputUsdPerMillion + maxOutputTokens * this.config.outputUsdPerMillion);
    let decoded: z.infer<typeof responseSchema> | undefined;
    const started = performance.now();
    const result = await this.broker.request({ jobId: this.jobId, contextId: this.contextId, destinationId: this.config.destinationId,
      purpose: overrides?.purpose ?? "agent reasoning and tool selection", method: "POST", body, maxFeeMicrousd: reservation, signal }, bytes => {
      decoded = responseSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      if (decoded.usage.completion_tokens > maxOutputTokens || decoded.usage.prompt_tokens > Buffer.byteLength(body)) throw new Error("model_usage_outside_envelope");
      return Math.ceil(decoded.usage.prompt_tokens * this.config.inputUsdPerMillion + decoded.usage.completion_tokens * this.config.outputUsdPerMillion);
    });
    if (!decoded) throw new Error("private_model_response_invalid");
    const choice = decoded.choices[0]!;
    const calls = choice.message.tool_calls ?? [];
    if (new Set(calls.map(call => call.id)).size !== calls.length) throw new Error("private_model_duplicate_tool_id");
    return { content: choice.message.content ?? "", toolCalls: calls, finishReason: choice.finish_reason,
      servedModel: decoded.model,
      usage: { inputTokens: decoded.usage.prompt_tokens, outputTokens: decoded.usage.completion_tokens,
        totalTokens: decoded.usage.prompt_tokens + decoded.usage.completion_tokens,
        cacheReadTokens: decoded.usage.prompt_tokens_details?.cached_tokens ?? 0 },
      costUsd: (result.receipt.feeMicrousd ?? 0) / 1000000, durationMs: performance.now() - started };
  }
}
