import { z } from "zod";
import type { ProviderResult } from "../providers/types";
import { anthropicBody, cacheWritePartsAgree, decodeAnthropicReply } from "./anthropic";
import { BROKER_MAX_BODY_BYTES, PrivateAgentBroker } from "./broker";
import { canonical, digest, privateAgentId, sha256Schema } from "./contracts";
import { isAssistDispatch } from "./dispatch-purposes";
import type { FlashNextReplyEvidence } from "./flash-next-reply";
import { LOCAL_TOKEN_ADMISSION_CODES, LOCAL_TOKEN_ADMISSION_STOP } from "./flash-next-admission";

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
const tokenStopSchema = z.object({
  type: z.literal("model_request_not_dispatched"), contextId: privateAgentId, operationId: z.string().uuid(),
  promptProtocolSha256: sha256Schema, reason: z.literal(LOCAL_TOKEN_ADMISSION_STOP), dispatched: z.literal(false),
  code: z.enum(LOCAL_TOKEN_ADMISSION_CODES), bodySha256: sha256Schema, policySha256: sha256Schema.optional(),
}).strict();
export type ModelRequestTokenAdmissionStop = z.infer<typeof tokenStopSchema>;
/**
 * Backlog item 3 (finding A5, BL-20261107-0924): the broker refused the request before any row existed, so nothing was sent and
 * nothing is uncertain; `code` is the broker's own fixed code. A cancel ends the run as cancelled (or paused), an unavailable
 * scanner resumably (`packet_scan_unavailable`), a blocked scan, a missing destination, a size excess without its numbers or a cloud
 * call after an assist whose outcome stayed unknown (BL-20261107-1006, 3) permanently (`model_request_denied`; a size excess with its
 * numbers records the size stop instead), and a ledger refusal as `unresolved_dispatch_no_replay`.
 */
export const BROKER_DENIED_STOP = "broker_denied";
export const BROKER_DENIAL_CODES = ["request_cancelled", "packet_scan_failed", "packet_scan_incomplete_or_blocked", "packet_size_exceeded", "destination_missing", "unresolved_dispatch",
  "cloud_after_assist_unknown"] as const;
export type BrokerDenialCode = (typeof BROKER_DENIAL_CODES)[number];
export const PACKET_SCAN_UNAVAILABLE_STOP = "packet_scan_unavailable";
export const MODEL_REQUEST_DENIED_STOP = "model_request_denied";
const brokerDeniedSchema = z.object({
  type: z.literal("model_request_not_dispatched"), contextId: privateAgentId, operationId: z.string().uuid(),
  promptProtocolSha256: sha256Schema, reason: z.literal(BROKER_DENIED_STOP), dispatched: z.literal(false), code: z.enum(BROKER_DENIAL_CODES),
}).strict();
export type ModelRequestBrokerDenied = z.infer<typeof brokerDeniedSchema>;

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
export function modelRequestTokenAdmissionStop(events: Record<string, unknown>[], start: Record<string, unknown>): ModelRequestTokenAdmissionStop | undefined {
  const marker = notDispatchedJoin(events, start); if (!marker) return;
  const parsed = tokenStopSchema.safeParse(marker); return parsed.success ? parsed.data : undefined;
}
export function modelRequestBrokerDenied(events: Record<string, unknown>[], start: Record<string, unknown>): ModelRequestBrokerDenied | undefined {
  const marker = notDispatchedJoin(events, start); if (!marker) return;
  const parsed = brokerDeniedSchema.safeParse(marker); return parsed.success ? parsed.data : undefined;
}

export const MODEL_UNAVAILABLE_STOP = "model_unavailable";
/**
 * Backlog item 1 (finding A8): the time left was shorter than the destination's request timeout, so a request that the
 * deadline could cut, and whose row would then stay uncertain, was not started. Nothing was recorded or sent.
 */
export const DEADLINE_BEFORE_REQUEST_STOP = "deadline_before_request";

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
    !events.some(start => (modelRequestSizeStop(events, start) ?? modelRequestFeeStop(events, start) ?? modelRequestTokenAdmissionStop(events, start) ?? modelRequestBrokerDenied(events, start))?.operationId === marker.operationId));
}
export function hasInvalidModelRequestTokenAdmissionStop(events: Record<string, unknown>[]): boolean {
  return events.some(marker => marker.type === "model_request_not_dispatched" && marker.reason === LOCAL_TOKEN_ADMISSION_STOP &&
    !events.some(start => modelRequestTokenAdmissionStop(events, start)?.operationId === marker.operationId));
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
/** Backlog item 10 (BL-20261113-0920-assist-wrapper-design, decision 1): the only cache mode an assist may carry. */
export const ASSIST_CACHE_MODE = "assist_no_cache_write_v1" as const;
/**
 * Item 9 (BL-20261114-1650-research-structured-output-design): a JSON-schema reply format for one call. `strict` true sends
 * `strict: true`; false omits the key, as probe P10's non-strict variant does.
 */
export interface ModelResponseFormat { name: string; schema: Record<string, unknown>; strict: boolean }
/** The `response_format` value: the ReviewResultV1 shape (review-result-contract.ts, `reviewResultV1ResponseFormat`). */
export function jsonSchemaResponseFormat(format: ModelResponseFormat) {
  return { type: "json_schema" as const, json_schema: { name: format.name, schema: format.schema, ...(format.strict ? { strict: true as const } : {}) } };
}
/** Per-call narrowing of the configured model; nothing here widens a configured value. */
export interface ModelCallOverrides {
  thinking?: "disabled"; maxOutputTokens?: number; purpose?: string; trailingTurnMessage?: boolean;
  /** A lower request-body cap for this call (the assist bounds); the configured cap still applies when it is lower. */
  maxRequestBytes?: number;
  /** Item 9: a reply format, on the owned vLLM shape without tools only; refused before any body exists otherwise. */
  responseFormat?: ModelResponseFormat;
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
   * Rate for prompt tokens the provider reports as written to its cache (`cache_write_tokens`); absent means the input
   * rate. OpenAI publishes a 30-minute cache-write price of 1.25× the input rate for its GPT-5.6-and-later models.
   */
  cacheWriteUsdPerMillion?: number;
  /**
   * Long-context tier: a request whose prompt exceeds `aboveTokens` is billed at these rates for the whole request. Prompt
   * tokens never exceed body bytes, so a body of at most `aboveTokens` bytes is reserved at the base rates and a larger one
   * at these. Absent means a single tier (and keeps every identity unchanged).
   */
  longContext?: { aboveTokens: number; inputUsdPerMillion: number; outputUsdPerMillion: number; cachedInputUsdPerMillion?: number; cacheWriteUsdPerMillion?: number };
  /**
   * Request shape: the owned vLLM server (default), OpenAI chat completions (`max_completion_tokens`, no vLLM-only fields),
   * or the OpenAI Responses API, which is the only OpenAI shape that serves function tools with reasoning for the sol models.
   * The Responses shape is stateless (`store: false`) and, like the local arm, never replays a turn's reasoning.
   * `anthropic_messages` is Anthropic's Messages API (BL-20261030-0620): adaptive thinking at effort medium only, never
   * replayed, the standard tier and global geography pinned; its body and decoder live in `anthropic.ts`.
   */
  api?: "vllm" | "openai" | "openai_responses" | "anthropic_messages";
  /**
   * Prompt-cache handling per request shape. `responses_explicit_v1` (Responses shape only): explicit prompt-cache
   * breakpoints after the static prompt, the user message that follows it (the brief) and the latest two tool results,
   * with implicit caching off (H1). `vllm_job_salt_v1` (owned vLLM shape only): a per-job `cache_salt` derived from the
   * job id, so prefix-cache blocks are shared only within one job and never across matters (H2a, design principle P6);
   * the box's prefix caching itself is a server setting and stays as it is (D11). `anthropic_explicit_5m_v1` (Anthropic
   * shape only): 5-minute `cache_control` breakpoints at the same positions as `responses_explicit_v1`.
   * `assist_no_cache_write_v1` (Responses and Anthropic shapes only; backlog item 10): a sealed one-shot assist that writes
   * nothing to a provider cache, by mechanism rather than by size: explicit mode with no breakpoint on Responses, no
   * `cache_control` on Anthropic (issue #49). An assist purpose requires it and it serves nothing else (see `requestBody`).
   */
  promptCaching?: "responses_explicit_v1" | "vllm_job_salt_v1" | "anthropic_explicit_5m_v1" | typeof ASSIST_CACHE_MODE;
  /** PR-B: stream the reply from the owned server (assembled by the transport); the cloud shape stays non-streaming in Phase 1. */
  streaming?: boolean;
  /** Explicit qualified local deployment contract; absent preserves every earlier body and model identity. */
  localReplyContract?: "flash_next_v1";
  /** Qualified Flash deployment context capacity, including the reserved output; required only with its reply contract. */
  localContextTokens?: number;
  /** Exact-token policy identity. The trusted broker loads the separately hash-pinned host descriptor. */
  localTokenAdmissionSha256?: string;
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
  finishReason: string | null; promptTokens: number; completionTokens: number; cachedTokens: number; cacheWriteTokens: number; thinkingTokens?: number;
  /** Whether the reply reported its cache writes itself (backlog item 10): the chat shape never does; a missing field decodes as 0. */
  cacheWriteReported: boolean };

const PROMPT_CACHE_BREAKPOINT = Object.freeze({ mode: "explicit" });
/**
 * Chat-completion messages as Responses input items: tool calls and results become function_call items; no reasoning items.
 * With `breakpoints`, the leading system message, a user message directly after it when more messages follow (the brief)
 * and the latest two non-empty tool results carry an explicit prompt-cache breakpoint (their text as an input_text block),
 * so the next turn's lookup matches the prefix this turn wrote. The final message never carries one (a one-shot
 * [system, user] call such as the cloud critic would otherwise pay the write rate on a packet nothing re-reads), so a
 * trailing per-turn message is never written.
 */
export function responsesInput(messages: GeneralMessage[], breakpoints = false): Record<string, unknown>[] {
  const marked = new Set<number>();
  if (breakpoints) {
    if (messages[0]?.role === "system") { marked.add(0); if (messages[1]?.role === "user" && messages.length > 2) marked.add(1); }
    for (const index of messages.flatMap((message, index) => message.role === "tool" && message.content ? [index] : []).slice(-2)) marked.add(index);
  }
  const block = (text: string) => [{ type: "input_text", text, prompt_cache_breakpoint: PROMPT_CACHE_BREAKPOINT }];
  return messages.flatMap((message, index): Record<string, unknown>[] => {
    if (message.role === "tool") {
      if (!message.tool_call_id) throw new Error("private_model_message_invalid");
      const output = message.content ?? "";
      return [{ type: "function_call_output", call_id: message.tool_call_id, output: marked.has(index) ? block(output) : output }];
    }
    const text = message.content ? [{ type: "message", role: message.role, content: marked.has(index) ? block(message.content) : message.content }] : [];
    if (message.role !== "assistant") {
      if (message.tool_calls?.length) throw new Error("private_model_message_invalid");
      return text;
    }
    return [...text, ...(message.tool_calls ?? []).map(call => ({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments }))];
  });
}

function decodeReply(api: PrivateModelConfig["api"], bytes: Uint8Array, configuredModel: string): DecodedReply {
  if (api === "anthropic_messages") return decodeAnthropicReply(bytes, configuredModel);
  const json: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (api !== "openai_responses") {
    const decoded = responseSchema.parse(json), choice = decoded.choices[0]!;
    return { model: decoded.model, serviceTier: decoded.service_tier, content: choice.message.content ?? "", toolCalls: choice.message.tool_calls ?? [], finishReason: choice.finish_reason,
      promptTokens: decoded.usage.prompt_tokens, completionTokens: decoded.usage.completion_tokens, cachedTokens: decoded.usage.prompt_tokens_details?.cached_tokens ?? 0, cacheWriteTokens: 0,
      cacheWriteReported: false };
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
  // The write count proves zero writes only when the reply reports it, and its TTL parts (when given) add up to it.
  const details = decoded.usage.input_tokens_details;
  const cacheWriteReported = typeof details?.cache_write_tokens === "number" && cacheWritePartsAgree(details.cache_write_tokens_details, ["ttl_30m_tokens", "ttl_12h_tokens"], details.cache_write_tokens);
  return { model: decoded.model, serviceTier: decoded.service_tier, content, toolCalls, finishReason, promptTokens: decoded.usage.input_tokens, completionTokens: decoded.usage.output_tokens,
    cachedTokens: details?.cached_tokens ?? 0, cacheWriteTokens: details?.cache_write_tokens ?? 0, cacheWriteReported };
}

/**
 * The per-job prefix-cache salt sent to the owned vLLM server (H2a): a digest of the job id, so it is random and unguessable
 * like the id, carries no job content, stays identical for every call of the job (the judge included) and differs between
 * jobs. The job id itself is never sent.
 */
export function vllmCacheSalt(jobId: string): string { return digest(canonical({ version: 1, purpose: "vllm_prefix_cache_salt", jobId })); }

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
        (config.cacheWriteUsdPerMillion !== undefined && !(Number.isFinite(config.cacheWriteUsdPerMillion) && config.cacheWriteUsdPerMillion >= 0 && config.cacheWriteUsdPerMillion <= 4 * config.inputUsdPerMillion)) ||
        (config.longContext !== undefined && !(Number.isSafeInteger(config.longContext.aboveTokens) && config.longContext.aboveTokens > 0 &&
          Number.isFinite(config.longContext.inputUsdPerMillion) && config.longContext.inputUsdPerMillion >= config.inputUsdPerMillion &&
          Number.isFinite(config.longContext.outputUsdPerMillion) && config.longContext.outputUsdPerMillion >= config.outputUsdPerMillion &&
          (config.longContext.cachedInputUsdPerMillion === undefined || (Number.isFinite(config.longContext.cachedInputUsdPerMillion) &&
            config.longContext.cachedInputUsdPerMillion >= (config.cachedInputUsdPerMillion ?? config.inputUsdPerMillion) &&
            config.longContext.cachedInputUsdPerMillion <= config.longContext.inputUsdPerMillion)) &&
          (config.longContext.cacheWriteUsdPerMillion === undefined || (Number.isFinite(config.longContext.cacheWriteUsdPerMillion) &&
            config.longContext.cacheWriteUsdPerMillion >= 0 && config.longContext.cacheWriteUsdPerMillion <= 4 * config.longContext.inputUsdPerMillion)) &&
          // A body bound reserved at the long tier can settle at the base tier, so the long tier's write rate must cover the base one.
          (config.longContext.cacheWriteUsdPerMillion ?? config.longContext.inputUsdPerMillion) >= (config.cacheWriteUsdPerMillion ?? config.inputUsdPerMillion))) ||
        (config.api !== undefined && config.api !== "vllm" && config.api !== "openai" && config.api !== "openai_responses" && config.api !== "anthropic_messages") ||
        (config.promptCaching !== undefined && !((config.promptCaching === "responses_explicit_v1" && config.api === "openai_responses") ||
          (config.promptCaching === "vllm_job_salt_v1" && (config.api === undefined || config.api === "vllm")) ||
          (config.promptCaching === "anthropic_explicit_5m_v1" && config.api === "anthropic_messages") ||
          (config.promptCaching === ASSIST_CACHE_MODE && (config.api === "openai_responses" || config.api === "anthropic_messages")))) ||
        // The Anthropic shape sends adaptive thinking only (the model refuses `disabled`) and no sampling fields.
        (config.api === "anthropic_messages" && (config.thinking !== "medium" || config.sampling !== undefined)) ||
        (config.localReplyContract !== undefined && (config.localReplyContract !== "flash_next_v1" ||
          (config.api !== undefined && config.api !== "vllm") || config.inputUsdPerMillion !== 0 || config.outputUsdPerMillion !== 0 ||
          (config.cachedInputUsdPerMillion ?? 0) !== 0 || (config.cacheWriteUsdPerMillion ?? 0) !== 0 || config.longContext !== undefined ||
          !Number.isSafeInteger(config.localContextTokens) || config.localContextTokens! <= config.maxOutputTokens)) ||
        (config.localContextTokens !== undefined && config.localReplyContract === undefined) ||
        (config.localTokenAdmissionSha256 !== undefined && (config.localReplyContract === undefined || !sha256Schema.safeParse(config.localTokenAdmissionSha256).success)) ||
        (config.streaming !== undefined && (typeof config.streaming !== "boolean" || (config.streaming && config.api !== undefined && config.api !== "vllm")))) {
      throw new Error("private_model_configuration_invalid");
    }
    this.config = Object.freeze({ ...config, maxRequestBytes, ...(config.sampling ? { sampling: Object.freeze({ ...config.sampling }) } : {}),
      ...(config.longContext ? { longContext: Object.freeze({ ...config.longContext }) } : {}) });
  }

  /**
   * Pre-dispatch guard for finding A8 (backlog item 1): true when less time remains than the destination's request timeout
   * and the call would not be zero-risk at the broker (a priced reservation, or any cloud destination), so a deadline cut
   * would leave an `unknown` row with its reservation pinned. A zero-risk call is never refused here: the deadline then
   * resolves its row `failed`. The reservation is zero exactly when every configured rate is zero, since the prompt bound
   * and the output tokens are always positive.
   */
  deadlineRefuses(remainingMs: number): boolean {
    const long = this.config.longContext;
    const zeroFee = this.config.inputUsdPerMillion === 0 && this.config.outputUsdPerMillion === 0 && (this.config.cacheWriteUsdPerMillion ?? 0) === 0 &&
      (long === undefined || (long.inputUsdPerMillion === 0 && long.outputUsdPerMillion === 0 && (long.cacheWriteUsdPerMillion ?? 0) === 0));
    return remainingMs < this.broker.requestTimeoutMs(this.config.destinationId) &&
      !this.broker.zeroRiskDispatch({ destinationId: this.config.destinationId, maxFeeMicrousd: zeroFee ? 0 : 1, method: "POST" });
  }

  /** The configured rates for a prompt of this many tokens: the long-context tier above its threshold, the base tier otherwise. */
  private rates(promptTokens: number) {
    const long = this.config.longContext;
    return long && promptTokens > long.aboveTokens
      ? { input: long.inputUsdPerMillion, output: long.outputUsdPerMillion, cached: long.cachedInputUsdPerMillion ?? long.inputUsdPerMillion, write: long.cacheWriteUsdPerMillion ?? long.inputUsdPerMillion }
      : { input: this.config.inputUsdPerMillion, output: this.config.outputUsdPerMillion, cached: this.config.cachedInputUsdPerMillion ?? this.config.inputUsdPerMillion,
        write: this.config.cacheWriteUsdPerMillion ?? this.config.inputUsdPerMillion };
  }

  /**
   * The fee `complete()` reserves for a prompt bound (the body's bytes, or the Flash context envelope) and an output cap, in
   * micro-USD (review §5.1 rule 8). It takes the tier the bound could reach and the dearer of its input and cache-write rates,
   * so it covers either tier the reply settles at however the provider splits the prompt between reads, writes and input.
   */
  reservationMicrousd(promptBound: number, maxOutputTokens: number): number {
    const reserveRates = this.rates(promptBound);
    return Math.ceil(promptBound * Math.max(reserveRates.input, reserveRates.write) + maxOutputTokens * reserveRates.output);
  }

  /**
   * The exact request body `complete()` sends for these arguments, built without any dispatch (backlog item 10: the assist
   * wrapper measures and trims its packets on these bytes). Every refusal here comes before any body exists.
   */
  requestBody(messages: GeneralMessage[], tools: GeneralToolDefinition[], overrides?: ModelCallOverrides): { body: string; maxOutputTokens: number; thinking: "disabled" | "medium" } {
    const thinking = overrides?.thinking ?? this.config.thinking, maxOutputTokens = Math.min(this.config.maxOutputTokens, overrides?.maxOutputTokens ?? this.config.maxOutputTokens);
    const anthropic = this.config.api === "anthropic_messages";
    // Refused before any body exists, so never dispatched: the Anthropic model answers `disabled` thinking with HTTP 400.
    if (anthropic && thinking === "disabled") throw new Error("private_model_thinking_unsupported");
    // Backlog item 10: an assist carries the no-write cache mode and nothing else does, so `promptCaching` is never undefined (or
    // a breakpoint mode) on an assist; and the mode serves only a sealed tool-less [system, user] one-shot (review §5.2, principle 3).
    const assistMode = this.config.promptCaching === ASSIST_CACHE_MODE;
    if (isAssistDispatch({ purpose: overrides?.purpose }) && !assistMode) throw new Error("private_model_assist_cache_mode_required");
    // Two non-empty text messages, no tools, no trailing turn and the model's own thinking: a body that drops nothing silently.
    if (assistMode && (!isAssistDispatch({ purpose: overrides?.purpose }) || tools.length || overrides?.trailingTurnMessage || overrides?.thinking !== undefined || messages.length !== 2 ||
        messages[0]!.role !== "system" || messages[1]!.role !== "user" || messages.some(message => typeof message.content !== "string" || !message.content.length ||
          message.tool_calls?.length || message.tool_call_id !== undefined))) {
      throw new Error("private_model_assist_request_invalid");
    }
    // Item 9: a reply format reaches the owned vLLM shape alone, on a tool-less call, with a name and an object schema; every
    // other shape would drop it or answer it differently, so it is refused here, before any body exists and so before any dispatch.
    const format = overrides?.responseFormat;
    if (format !== undefined && ((this.config.api !== undefined && this.config.api !== "vllm") || tools.length)) throw new Error("private_model_response_format_unsupported");
    if (format !== undefined && (typeof format.name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(format.name) || format.schema === null || typeof format.schema !== "object" ||
        Array.isArray(format.schema) || typeof format.strict !== "boolean")) throw new Error("private_model_response_format_invalid");
    const openai = this.config.api === "openai";
    // An OpenAI-compatible server rejects an empty `tools` array, so a tool-less call (the entailment judge) omits the tool fields.
    // The OpenAI shape uses max_completion_tokens and top-level reasoning_effort only; vLLM-only fields never leave for a cloud API.
    // The Responses shape sends non-strict function tools (its default is strict), an explicit effort and no stored state.
    // The owned vLLM shape salts the server's prefix cache per job when configured (`cache_salt`, 1 to 1,024 characters).
    // The Anthropic shape sends layout 2's trailing guidance as a system message (`trailingTurnMessage`); every other
    // shape ignores that option, so their bodies are unchanged.
    // Breakpoints only under the two breakpoint modes, which the constructor admits on these shapes alone: the no-write assist
    // mode marks nothing (explicit mode without a breakpoint on Responses, no `cache_control` on Anthropic).
    const body = anthropic
      ? anthropicBody({ model: this.config.model, maxOutputTokens, messages, tools, breakpoints: this.config.promptCaching === "anthropic_explicit_5m_v1",
        trailingTurnMessage: overrides?.trailingTurnMessage === true })
      : this.config.api === "openai_responses"
      ? canonical({ model: this.config.model, input: responsesInput(messages, this.config.promptCaching === "responses_explicit_v1"),
        ...(this.config.promptCaching ? { prompt_cache_options: { mode: "explicit" } } : {}),
        ...(tools.length ? { tools: tools.map(tool => ({ type: "function", name: tool.function.name, description: tool.function.description,
          parameters: tool.function.parameters, strict: false })), tool_choice: "auto", parallel_tool_calls: false } : {}),
        max_output_tokens: maxOutputTokens, reasoning: { effort: thinking === "disabled" ? "none" : "medium" }, store: false, service_tier: "default" })
      : canonical({ model: this.config.model, messages, ...(tools.length ? { tools, tool_choice: "auto", parallel_tool_calls: false } : {}),
        ...(this.config.streaming && !openai ? { stream: true, stream_options: { include_usage: true } } : { stream: false }),
        // An omitted tier is "auto" and can follow project settings to a dearer tier, so a cloud shape pins the standard one.
        ...(openai ? { max_completion_tokens: maxOutputTokens, service_tier: "default" } : { max_tokens: maxOutputTokens }),
        ...(openai ? (thinking === "disabled" ? {} : { reasoning_effort: "medium" })
          : thinking === "disabled" ? { chat_template_kwargs: { enable_thinking: false } } : { reasoning_effort: "medium", ...(this.config.sampling ?? {}) }),
        ...(this.config.localReplyContract ? { chat_template_kwargs: { enable_thinking: thinking !== "disabled", preserve_thinking: false } } : {}),
        ...(this.config.promptCaching === "vllm_job_salt_v1" ? { cache_salt: vllmCacheSalt(this.jobId) } : {}),
        ...(format ? { response_format: jsonSchemaResponseFormat(format) } : {}),
      });
    return { body, maxOutputTokens, thinking };
  }

  /** Host-side calls (the entailment judge) narrow the same destination to thinking off and a short reply; they never widen anything. */
  async complete(messages: GeneralMessage[], tools: GeneralToolDefinition[], signal: AbortSignal,
    overrides?: ModelCallOverrides): Promise<ProviderResult & { localReplyEvidence?: FlashNextReplyEvidence; cacheWriteReported?: boolean }> {
    if (overrides?.maxRequestBytes !== undefined && (!Number.isSafeInteger(overrides.maxRequestBytes) || overrides.maxRequestBytes < 1)) throw new Error("private_model_request_bound_invalid");
    const { body, maxOutputTokens, thinking } = this.requestBody(messages, tools, overrides);
    const openaiShape = this.config.api === "openai" || this.config.api === "openai_responses";
    const configuredBytes = this.config.maxRequestBytes ?? BROKER_MAX_BODY_BYTES;
    const bodyBytes = Buffer.byteLength(body), limitBytes = Math.min(configuredBytes, overrides?.maxRequestBytes ?? configuredBytes);
    if (bodyBytes > limitBytes) throw new ModelRequestBodyTooLarge(bodyBytes, limitBytes);
    // Flash's NFC tokenizer can expand raw input bytes, so its zero-fee settlement envelope is the pinned context capacity
    // minus this call's actual output reservation. The broker separately enforces the pinned exact-token proof before dispatch.
    // Legacy/provider price reservations keep their established byte envelope unchanged.
    const promptBound = this.config.localReplyContract ? this.config.localContextTokens! - maxOutputTokens : bodyBytes;
    const rates = (promptTokens: number) => this.rates(promptTokens);
    const reservation = this.reservationMicrousd(promptBound, maxOutputTokens);
    let decoded: DecodedReply | undefined;
    const started = performance.now();
    const result = await this.broker.request({ jobId: this.jobId, contextId: this.contextId, destinationId: this.config.destinationId,
      purpose: overrides?.purpose ?? "agent reasoning and tool selection", method: "POST", body, maxFeeMicrousd: reservation, signal,
      ...(this.config.localReplyContract ? { localReplyContract: { version: this.config.localReplyContract, model: this.config.model, thinking },
        localTokenAdmission: { policySha256: this.config.localTokenAdmissionSha256 ?? "", contextTokens: this.config.localContextTokens! } } : {}) }, bytes => {
      decoded = decodeReply(this.config.api, bytes, this.config.model);
      // The scoped contract must refuse malformed native call identities before settlement; legacy adapters keep their path.
      if (this.config.localReplyContract && new Set(decoded.toolCalls.map(call => call.id)).size !== decoded.toolCalls.length) throw new Error("private_model_duplicate_tool_id");
      const cached = decoded.cachedTokens;
      // A usage block reporting no prompt tokens for a non-empty body is a provider reporting failure (seen once in a replay
      // chain, where the next turn's cache hit proved the call was processed); it must not settle as a free call.
      if (decoded.promptTokens === 0 || decoded.completionTokens > maxOutputTokens || decoded.promptTokens > promptBound || cached > decoded.promptTokens ||
          decoded.cacheWriteTokens > decoded.promptTokens - cached) throw new Error("model_usage_outside_envelope");
      // Prices assume the standard tier the request pinned; a reply served at another tier leaves the spend unknown.
      if ((openaiShape) && decoded.serviceTier !== undefined && decoded.serviceTier !== null && decoded.serviceTier !== "default") throw new Error("model_service_tier_mismatch");
      // Cached prompt tokens settle at the cached rate and cache writes at the write rate (OpenAI bills GPT-5.6-and-later
      // writes at 1.25× input; the earlier "no write premium" reading was wrong). The result stays within the reservation
      // because written + cached ≤ prompt ≤ bound and the bound was reserved at the dearer of the input and write rates.
      const settle = rates(decoded.promptTokens), written = decoded.cacheWriteTokens;
      return Math.ceil((decoded.promptTokens - cached - written) * settle.input + written * settle.write + cached * settle.cached + decoded.completionTokens * settle.output);
    });
    if (!decoded) throw new Error("private_model_response_invalid");
    const calls = decoded.toolCalls;
    if (new Set(calls.map(call => call.id)).size !== calls.length) throw new Error("private_model_duplicate_tool_id");
    return { content: decoded.content, toolCalls: calls, finishReason: decoded.finishReason,
      servedModel: decoded.model,
      usage: { inputTokens: decoded.promptTokens, outputTokens: decoded.completionTokens,
        totalTokens: decoded.promptTokens + decoded.completionTokens,
        cacheReadTokens: decoded.cachedTokens, cacheWriteTokens: decoded.cacheWriteTokens,
        ...(decoded.thinkingTokens !== undefined ? { thinkingTokens: decoded.thinkingTokens } : {}) },
      costUsd: (result.receipt.feeMicrousd ?? 0) / 1000000, durationMs: performance.now() - started,
      ...(result.localReplyEvidence ? { localReplyEvidence: result.localReplyEvidence } : {}),
      // Backlog item 10: an assist's receipt says whether the provider reported its writes; every other call's result is unchanged.
      ...(this.config.promptCaching === ASSIST_CACHE_MODE ? { cacheWriteReported: decoded.cacheWriteReported } : {}) };
  }
}
