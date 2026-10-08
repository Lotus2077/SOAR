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
/** PR-E: the fee cap refused the next request before any row existed; like the size stop, provably not dispatched and never resumable. */
export const MODEL_FEE_CAP_STOP = "fee_cap_reached";
const feeStopSchema = z.object({
  type: z.literal("model_request_not_dispatched"), contextId: privateAgentId, operationId: z.string().uuid(),
  promptProtocolSha256: sha256Schema, reason: z.literal(MODEL_FEE_CAP_STOP), dispatched: z.literal(false),
  maxFeeMicrousd: z.number().int().safe().nonnegative(), settledFeeMicrousd: z.number().int().safe().nonnegative(),
}).strict();
export type ModelRequestFeeStop = z.infer<typeof feeStopSchema>;

function notDispatchedJoin(events: Record<string, unknown>[], start: Record<string, unknown>): Record<string, unknown> | undefined {
  if (start.type !== "model_started") return;
  const starts = events.filter(event => event.type === "model_started" && event.operationId === start.operationId);
  const markers = events.filter(event => event.type === "model_request_not_dispatched" && event.operationId === start.operationId);
  if (starts.length !== 1 || markers.length !== 1 || events.some(event => event.type === "model_finished" && event.operationId === start.operationId)) return;
  if (markers[0]!.contextId !== start.contextId || markers[0]!.promptProtocolSha256 !== start.promptProtocolSha256 || events.indexOf(markers[0]!) <= events.indexOf(starts[0]!)) return;
  return markers[0];
}
/** A receipt's absence never proves non-dispatch. Require one exact host marker/start join. */
export function modelRequestSizeStop(events: Record<string, unknown>[], start: Record<string, unknown>): ModelRequestSizeStop | undefined {
  const marker = notDispatchedJoin(events, start); if (!marker) return;
  const parsed = sizeStopSchema.safeParse(marker); return parsed.success ? parsed.data : undefined;
}
export function modelRequestFeeStop(events: Record<string, unknown>[], start: Record<string, unknown>): ModelRequestFeeStop | undefined {
  const marker = notDispatchedJoin(events, start); if (!marker) return;
  const parsed = feeStopSchema.safeParse(marker); return parsed.success ? parsed.data : undefined;
}

export const MODEL_UNAVAILABLE_STOP = "model_unavailable";

const failedRequestSchema = z.object({
  type: z.literal("model_request_failed"), contextId: privateAgentId, operationId: z.string().uuid(),
  promptProtocolSha256: sha256Schema, reason: z.literal(MODEL_UNAVAILABLE_STOP), dispatched: z.literal(true),
}).strict();
/** The model request ended in a confirmed abort (every row resolved, nothing unknown); the open operation is closed and the task may resume. */
export function modelRequestFailed(events: Record<string, unknown>[], start: Record<string, unknown>): boolean {
  if (start.type !== "model_started") return false;
  const markers = events.filter(event => event.type === "model_request_failed" && event.operationId === start.operationId);
  if (markers.length !== 1 || events.some(event => event.type === "model_finished" && event.operationId === start.operationId)) return false;
  const parsed = failedRequestSchema.safeParse(markers[0]);
  return parsed.success && parsed.data.contextId === start.contextId && parsed.data.promptProtocolSha256 === start.promptProtocolSha256;
}

export function hasInvalidModelRequestSizeStop(events: Record<string, unknown>[]): boolean {
  return events.some(marker => marker.type === "model_request_not_dispatched" &&
    !events.some(start => (modelRequestSizeStop(events, start) ?? modelRequestFeeStop(events, start))?.operationId === marker.operationId));
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
  /** Rate for prompt tokens the provider reports as cached; absent means the input rate. */
  cachedInputUsdPerMillion?: number;
  /**
   * Long-context tier: a request whose prompt exceeds `aboveTokens` is billed at these rates for the whole request. Prompt
   * tokens never exceed body bytes, so a body of at most `aboveTokens` bytes is reserved at the base rates and a larger one
   * at these. Absent means a single tier (and keeps every identity unchanged).
   */
  longContext?: { aboveTokens: number; inputUsdPerMillion: number; outputUsdPerMillion: number; cachedInputUsdPerMillion?: number };
  /**
   * Request shape: the owned vLLM server (default), OpenAI chat completions (`max_completion_tokens`, no vLLM-only fields),
   * or the OpenAI Responses API, which is the only OpenAI shape that serves function tools with reasoning for the sol models.
   * The Responses shape is stateless (`store: false`) and, like the local arm, never replays a turn's reasoning.
   */
  api?: "vllm" | "openai" | "openai_responses";
  /** PR-B: stream the reply from the owned server (assembled by the transport); the cloud shape stays non-streaming in Phase 1. */
  streaming?: boolean;
  thinking: "disabled" | "medium";
  /** Request body cap in bytes; defaults to the broker's packet cap. Profiles raise it for the local model. */
  maxRequestBytes?: number;
  /** Sampling sent only with thinking enabled; absent keeps the server defaults. */
  sampling?: { temperature: number; top_p: number; top_k: number };
}

const nonnegativeInt = z.number().int().nonnegative().safe();
const responseSchema = z.object({
  model: z.string().optional(),
  service_tier: z.string().nullable().optional(),
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

const responsesSchema = z.object({
  model: z.string().optional(),
  service_tier: z.string().nullable().optional(),
  status: z.enum(["completed", "incomplete"]),
  incomplete_details: z.object({ reason: z.string().optional() }).passthrough().nullable().optional(),
  output: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("reasoning") }).passthrough(),
    z.object({ type: z.literal("message"), role: z.literal("assistant"),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()) }).passthrough(),
    z.object({ type: z.literal("function_call"), call_id: z.string().min(1), name: z.string().min(1), arguments: z.string() }).passthrough(),
  ])).max(64),
  usage: z.object({ input_tokens: nonnegativeInt, output_tokens: nonnegativeInt, total_tokens: nonnegativeInt.optional(),
    input_tokens_details: z.object({ cached_tokens: nonnegativeInt.optional(), cache_write_tokens: nonnegativeInt.optional() }).passthrough().optional() }).passthrough(),
});
type DecodedReply = { model?: string; serviceTier?: string | null; content: string; toolCalls: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  finishReason: string | null; promptTokens: number; completionTokens: number; cachedTokens: number; cacheWriteTokens: number };

/** Chat-completion messages as Responses input items: tool calls and results become function_call items; no reasoning items. */
export function responsesInput(messages: GeneralMessage[]): Record<string, unknown>[] {
  return messages.flatMap((message): Record<string, unknown>[] => {
    if (message.role === "tool") {
      if (!message.tool_call_id) throw new Error("private_model_message_invalid");
      return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content ?? "" }];
    }
    const text = message.content ? [{ type: "message", role: message.role, content: message.content }] : [];
    if (message.role !== "assistant") {
      if (message.tool_calls?.length) throw new Error("private_model_message_invalid");
      return text;
    }
    return [...text, ...(message.tool_calls ?? []).map(call => ({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments }))];
  });
}

function decodeReply(api: PrivateModelConfig["api"], bytes: Uint8Array): DecodedReply {
  const json: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (api !== "openai_responses") {
    const decoded = responseSchema.parse(json), choice = decoded.choices[0]!;
    return { model: decoded.model, serviceTier: decoded.service_tier, content: choice.message.content ?? "", toolCalls: choice.message.tool_calls ?? [], finishReason: choice.finish_reason,
      promptTokens: decoded.usage.prompt_tokens, completionTokens: decoded.usage.completion_tokens, cachedTokens: decoded.usage.prompt_tokens_details?.cached_tokens ?? 0, cacheWriteTokens: 0 };
  }
  const decoded = responsesSchema.parse(json);
  let refused = false;
  const content = decoded.output.flatMap(item => item.type !== "message" ? [] : item.content.flatMap(part => {
    if (part.type === "output_text" && typeof part.text === "string") return [part.text];
    if (part.type === "refusal") { refused = true; return []; }
    throw new Error("private_model_response_invalid");
  })).join("");
  const toolCalls = decoded.output.flatMap(item => item.type === "function_call"
    ? [{ id: item.call_id, type: "function" as const, function: { name: item.name, arguments: item.arguments } }] : []);
  if (toolCalls.length > 8) throw new Error("private_model_response_invalid");
  // The runner keys on "length"; an incomplete reply for any other reason keeps the provider's own reason.
  const finishReason = decoded.status === "incomplete"
    ? (decoded.incomplete_details?.reason === "max_output_tokens" ? "length" : decoded.incomplete_details?.reason ?? "incomplete")
    : refused ? "content_filter" : toolCalls.length ? "tool_calls" : "stop";
  return { model: decoded.model, serviceTier: decoded.service_tier, content, toolCalls, finishReason, promptTokens: decoded.usage.input_tokens, completionTokens: decoded.usage.output_tokens,
    cachedTokens: decoded.usage.input_tokens_details?.cached_tokens ?? 0, cacheWriteTokens: decoded.usage.input_tokens_details?.cache_write_tokens ?? 0 };
}

/** The model configuration as bound into session and task identities: streaming is a transport mode, never an identity change. */
export function modelIdentity(config: PrivateModelConfig): Omit<PrivateModelConfig, "streaming"> {
  const { streaming: _streaming, ...identity } = config;
  return identity;
}

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
        ![config.inputUsdPerMillion, config.outputUsdPerMillion].every(value => Number.isFinite(value) && value >= 0) ||
        (config.cachedInputUsdPerMillion !== undefined && !(Number.isFinite(config.cachedInputUsdPerMillion) && config.cachedInputUsdPerMillion >= 0 && config.cachedInputUsdPerMillion <= config.inputUsdPerMillion)) ||
        (config.longContext !== undefined && !(Number.isSafeInteger(config.longContext.aboveTokens) && config.longContext.aboveTokens > 0 &&
          Number.isFinite(config.longContext.inputUsdPerMillion) && config.longContext.inputUsdPerMillion >= config.inputUsdPerMillion &&
          Number.isFinite(config.longContext.outputUsdPerMillion) && config.longContext.outputUsdPerMillion >= config.outputUsdPerMillion &&
          (config.longContext.cachedInputUsdPerMillion === undefined || (Number.isFinite(config.longContext.cachedInputUsdPerMillion) &&
            config.longContext.cachedInputUsdPerMillion >= (config.cachedInputUsdPerMillion ?? config.inputUsdPerMillion) &&
            config.longContext.cachedInputUsdPerMillion <= config.longContext.inputUsdPerMillion)))) ||
        (config.api !== undefined && config.api !== "vllm" && config.api !== "openai" && config.api !== "openai_responses") ||
        (config.streaming !== undefined && (typeof config.streaming !== "boolean" || (config.streaming && config.api !== undefined && config.api !== "vllm")))) {
      throw new Error("private_model_configuration_invalid");
    }
    this.config = Object.freeze({ ...config, maxRequestBytes, ...(config.sampling ? { sampling: Object.freeze({ ...config.sampling }) } : {}),
      ...(config.longContext ? { longContext: Object.freeze({ ...config.longContext }) } : {}) });
  }

  /** Host-side calls (the entailment judge) narrow the same destination to thinking off and a short reply; they never widen anything. */
  async complete(messages: GeneralMessage[], tools: GeneralToolDefinition[], signal: AbortSignal,
    overrides?: { thinking?: "disabled"; maxOutputTokens?: number; purpose?: string }): Promise<ProviderResult> {
    const thinking = overrides?.thinking ?? this.config.thinking, maxOutputTokens = Math.min(this.config.maxOutputTokens, overrides?.maxOutputTokens ?? this.config.maxOutputTokens);
    const openai = this.config.api === "openai", openaiShape = openai || this.config.api === "openai_responses";
    // An OpenAI-compatible server rejects an empty `tools` array, so a tool-less call (the entailment judge) omits the tool fields.
    // The OpenAI shape uses max_completion_tokens and top-level reasoning_effort only; vLLM-only fields never leave for a cloud API.
    // The Responses shape sends non-strict function tools (its default is strict), an explicit effort and no stored state.
    const body = this.config.api === "openai_responses"
      ? canonical({ model: this.config.model, input: responsesInput(messages),
        ...(tools.length ? { tools: tools.map(tool => ({ type: "function", name: tool.function.name, description: tool.function.description,
          parameters: tool.function.parameters, strict: false })), tool_choice: "auto", parallel_tool_calls: false } : {}),
        max_output_tokens: maxOutputTokens, reasoning: { effort: thinking === "disabled" ? "none" : "medium" }, store: false, service_tier: "default" })
      : canonical({ model: this.config.model, messages, ...(tools.length ? { tools, tool_choice: "auto", parallel_tool_calls: false } : {}),
        ...(this.config.streaming && !openai ? { stream: true, stream_options: { include_usage: true } } : { stream: false }),
        // An omitted tier is "auto" and can follow project settings to a dearer tier, so a cloud shape pins the standard one.
        ...(openai ? { max_completion_tokens: maxOutputTokens, service_tier: "default" } : { max_tokens: maxOutputTokens }),
        ...(openai ? (thinking === "disabled" ? {} : { reasoning_effort: "medium" })
          : thinking === "disabled" ? { chat_template_kwargs: { enable_thinking: false } } : { reasoning_effort: "medium", ...(this.config.sampling ?? {}) }),
      });
    const bodyBytes = Buffer.byteLength(body), limitBytes = this.config.maxRequestBytes ?? BROKER_MAX_BODY_BYTES;
    if (bodyBytes > limitBytes) throw new ModelRequestBodyTooLarge(bodyBytes, limitBytes);
    // Prompt tokens never exceed bytes, so bytes stay the reservation and settlement envelope (a token estimate was reviewed
    // out: digit-dense prompts exceed ceil(bytes/2) tokens, and reservations never accumulate across calls anyway).
    const promptBound = bodyBytes, long = this.config.longContext;
    const rates = (promptTokens: number) => long && promptTokens > long.aboveTokens
      ? { input: long.inputUsdPerMillion, output: long.outputUsdPerMillion, cached: long.cachedInputUsdPerMillion ?? long.inputUsdPerMillion }
      : { input: this.config.inputUsdPerMillion, output: this.config.outputUsdPerMillion, cached: this.config.cachedInputUsdPerMillion ?? this.config.inputUsdPerMillion };
    // The reservation takes the tier the byte bound could reach, so it covers either tier the reply settles at.
    const reserveRates = rates(promptBound);
    const reservation = Math.ceil(promptBound * reserveRates.input + maxOutputTokens * reserveRates.output);
    let decoded: DecodedReply | undefined;
    const started = performance.now();
    const result = await this.broker.request({ jobId: this.jobId, contextId: this.contextId, destinationId: this.config.destinationId,
      purpose: overrides?.purpose ?? "agent reasoning and tool selection", method: "POST", body, maxFeeMicrousd: reservation, signal }, bytes => {
      decoded = decodeReply(this.config.api, bytes);
      const cached = decoded.cachedTokens;
      if (decoded.completionTokens > maxOutputTokens || decoded.promptTokens > promptBound || cached > decoded.promptTokens ||
          decoded.cacheWriteTokens > decoded.promptTokens - cached) throw new Error("model_usage_outside_envelope");
      // Prices assume the standard tier the request pinned; a reply served at another tier leaves the spend unknown.
      if ((openaiShape) && decoded.serviceTier !== undefined && decoded.serviceTier !== null && decoded.serviceTier !== "default") throw new Error("model_service_tier_mismatch");
      // Cached prompt tokens settle at the cached rate; cache writes are uncached input and settle at the input rate (no
      // write premium is published for these models). The result stays within the reservation because cached ≤ prompt ≤ bound.
      const settle = rates(decoded.promptTokens);
      return Math.ceil((decoded.promptTokens - cached) * settle.input + cached * settle.cached + decoded.completionTokens * settle.output);
    });
    if (!decoded) throw new Error("private_model_response_invalid");
    const calls = decoded.toolCalls;
    if (new Set(calls.map(call => call.id)).size !== calls.length) throw new Error("private_model_duplicate_tool_id");
    return { content: decoded.content, toolCalls: calls, finishReason: decoded.finishReason,
      servedModel: decoded.model,
      usage: { inputTokens: decoded.promptTokens, outputTokens: decoded.completionTokens,
        totalTokens: decoded.promptTokens + decoded.completionTokens,
        cacheReadTokens: decoded.cachedTokens },
      costUsd: (result.receipt.feeMicrousd ?? 0) / 1000000, durationMs: performance.now() - started };
  }
}
