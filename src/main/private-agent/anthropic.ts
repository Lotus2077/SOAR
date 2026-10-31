import { z } from "zod";
import { canonical } from "./contracts";
import type { GeneralMessage, GeneralToolDefinition } from "./model";

/**
 * Anthropic Messages shape for the headless cloud arm (BL-20261030-0620, approved BL-20261030-0745). Raw canonical JSON
 * through the broker, no SDK. The API version is fixed here and on the destination, so a version change is a code
 * change bound by the runtime digest.
 */
export const ANTHROPIC_API_VERSION = "2026-10-21" as const;
export const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
/** One TTL per request: 5-minute writes settle at `cacheWriteUsdPerMillion`; a reply reporting a 1-hour write is refused. */
const CACHE_BREAKPOINT = Object.freeze({ type: "ephemeral", ttl: "5m" });

type Block = Record<string, unknown>;
type Turn = { role: "user" | "assistant"; content: Block[] };
const hasText = (value: string | null | undefined): value is string => typeof value === "string" && /\S/u.test(value);
function invalid(): never { throw new Error("private_model_message_invalid"); }

/**
 * Breakpoints on the `GeneralMessage` list, before merging, at the positions H1 chose for the Responses shape: the leading
 * system message, the user message directly after it when more messages follow (the brief), and the latest two tool
 * results with content. The final message never carries one, so a per-turn tail or a one-shot question is never written.
 */
function breakpointIndexes(messages: GeneralMessage[]): Set<number> {
  const marked = new Set<number>(), last = messages.length - 1;
  if (messages[0]?.role === "system") { marked.add(0); if (messages[1]?.role === "user" && messages.length > 2) marked.add(1); }
  for (const index of messages.flatMap((message, index) => message.role === "tool" && hasText(message.content) && index < last ? [index] : []).slice(-2)) marked.add(index);
  return marked;
}

/**
 * Maps the runner's conversation to Messages fields. Thinking is never replayed (the runner stores none). Consecutive
 * tool and user messages become one user turn (tool results first), consecutive assistant messages one assistant turn.
 * With `trailingTurnMessage`, the final user message (layout 2's guidance and budget) becomes a mid-conversation system
 * message when it follows a user turn, which this API requires, and stays user text after an assistant turn. Anything
 * the API would refuse is refused here, before dispatch.
 */
export function anthropicConversation(input: GeneralMessage[], options: { breakpoints: boolean; trailingTurnMessage: boolean }) {
  const marked = options.breakpoints ? breakpointIndexes(input) : new Set<number>();
  const mark = (index: number, block: Block): Block => marked.has(index) ? { ...block, cache_control: CACHE_BREAKPOINT } : block;
  let messages = input, system: Block[] | undefined, trailing: string | undefined;
  if (messages[0]?.role === "system") {
    if (!hasText(messages[0].content) || messages[0].tool_calls?.length) invalid();
    system = [mark(0, { type: "text", text: messages[0].content })];
  }
  const start = system ? 1 : 0;
  if (options.trailingTurnMessage) {
    const final = messages.at(-1);
    if (messages.length - 1 < start + 1 || final?.role !== "user" || !hasText(final.content) || final.tool_calls?.length) invalid();
    trailing = final.content;
    messages = messages.slice(0, -1);
  }
  const turns: Turn[] = [];
  messages.forEach((message, index) => {
    if (index < start) return;
    const previous = turns.at(-1);
    if (message.role === "system") invalid();
    if (message.role === "assistant") {
      const blocks: Block[] = [...(hasText(message.content) ? [{ type: "text", text: message.content }] : []),
        ...(message.tool_calls ?? []).map(call => {
          let parsed: unknown;
          try { parsed = JSON.parse(call.function.arguments); } catch { invalid(); }
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !call.id || !call.function.name) invalid();
          return { type: "tool_use", id: call.id, name: call.function.name, input: parsed };
        })];
      if (!blocks.length || message.tool_call_id !== undefined) invalid();
      if (previous?.role === "assistant") previous.content.push(...blocks); else turns.push({ role: "assistant", content: blocks });
      return;
    }
    if (message.tool_calls?.length) invalid();
    let block: Block;
    if (message.role === "tool") {
      if (!message.tool_call_id) invalid();
      block = mark(index, { type: "tool_result", tool_use_id: message.tool_call_id, ...(hasText(message.content) ? { content: message.content } : {}) });
    } else {
      if (!hasText(message.content)) invalid();
      block = mark(index, { type: "text", text: message.content });
    }
    if (previous?.role === "user") {
      // Tool results lead their user turn; a result after user text in the same turn is refused.
      if (block.type === "tool_result" && previous.content.some(item => item.type !== "tool_result")) invalid();
      previous.content.push(block);
    } else turns.push({ role: "user", content: [block] });
  });
  // The API takes a text system message only directly after a user turn; after an assistant turn the tail stays user text.
  const tail = trailing !== undefined && turns.at(-1)?.role === "user" ? { role: "system", content: trailing } : undefined;
  if (trailing !== undefined && !tail) turns.push({ role: "user", content: [{ type: "text", text: trailing }] });
  // The history must start and, without a system tail, end on a user turn: these models refuse an assistant prefill.
  if (turns[0]?.role !== "user" || (!tail && turns.at(-1)?.role !== "user")) invalid();
  // Every tool_use is answered in the very next user turn, and every tool_result answers the turn before it.
  turns.forEach((turn, i) => {
    const uses = turn.role === "assistant" ? turn.content.filter(block => block.type === "tool_use").map(block => block.id as string) : [];
    const next = turns[i + 1], results = next?.role === "user" ? next.content.filter(block => block.type === "tool_result").map(block => block.tool_use_id as string) : [];
    if (uses.length && (results.length !== uses.length || uses.some(id => !results.includes(id)) || new Set(uses).size !== uses.length)) invalid();
    if (turn.role === "user" && turn.content.some(block => block.type === "tool_result")) {
      const before = turns[i - 1];
      const answered = before?.role === "assistant" ? before.content.filter(block => block.type === "tool_use").map(block => block.id as string) : [];
      if (turn.content.some(block => block.type === "tool_result" && !answered.includes(block.tool_use_id as string))) invalid();
    }
  });
  return { ...(system ? { system } : {}), messages: tail ? [...turns, tail] : turns,
    toolBlocks: turns.some(turn => turn.content.some(block => block.type === "tool_use" || block.type === "tool_result")) };
}

/**
 * The full request body. Adaptive thinking at effort `medium` is the only thinking setting this shape sends (the model
 * refuses `disabled`); the standard tier and the global geography are pinned, so the published prices apply.
 */
export function anthropicBody(input: { model: string; maxOutputTokens: number; messages: GeneralMessage[]; tools: GeneralToolDefinition[];
  breakpoints: boolean; trailingTurnMessage: boolean }): string {
  const conversation = anthropicConversation(input.messages, { breakpoints: input.breakpoints, trailingTurnMessage: input.trailingTurnMessage });
  // The API requires tool definitions whenever the history holds tool blocks.
  if (!input.tools.length && conversation.toolBlocks) invalid();
  return canonical({ model: input.model, max_tokens: input.maxOutputTokens, ...(conversation.system ? { system: conversation.system } : {}),
    messages: conversation.messages,
    ...(input.tools.length ? { tools: input.tools.map(tool => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })),
      tool_choice: { type: "auto", disable_parallel_tool_use: true } } : {}),
    thinking: { type: "adaptive" }, output_config: { effort: "medium" }, service_tier: "standard_only", inference_geo: "global" });
}

const count = z.number().int().nonnegative().safe();
const replySchema = z.object({
  type: z.literal("message"), role: z.literal("assistant"), model: z.string().min(1),
  content: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
    z.object({ type: z.literal("tool_use"), id: z.string().min(1), name: z.string().min(1), input: z.unknown() }).passthrough(),
    z.object({ type: z.literal("thinking") }).passthrough(),
    z.object({ type: z.literal("redacted_thinking") }).passthrough(),
  ])).max(256),
  stop_reason: z.string().min(1),
  usage: z.object({ input_tokens: count, output_tokens: count, cache_creation_input_tokens: count.nullable().optional(),
    cache_read_input_tokens: count.nullable().optional(),
    cache_creation: z.object({ ephemeral_5m_input_tokens: count.nullable().optional(), ephemeral_1h_input_tokens: count.nullable().optional() }).passthrough().nullable().optional(),
    service_tier: z.string().nullable().optional(), inference_geo: z.string().nullable().optional(), speed: z.string().nullable().optional(),
    output_tokens_details: z.object({ thinking_tokens: count.nullable().optional() }).passthrough().nullable().optional() }).passthrough(),
}).passthrough();

export interface AnthropicReply {
  model: string; content: string; toolCalls: { id: string; type: "function"; function: { name: string; arguments: string } }[]; finishReason: string;
  promptTokens: number; completionTokens: number; cachedTokens: number; cacheWriteTokens: number; thinkingTokens?: number;
}

/**
 * Decodes a non-streamed reply. Called inside the broker's settlement callback, so every refusal here is recorded as
 * `response_or_usage_invalid`. `promptTokens` is the whole prompt: Anthropic's `input_tokens` is only the uncached part.
 * Only reported values that would change the price are refused: another model, a non-standard tier, US-only inference,
 * fast mode, or a 1-hour cache write.
 */
export function decodeAnthropicReply(bytes: Uint8Array, configuredModel: string): AnthropicReply {
  const reply = replySchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  if (reply.model !== configuredModel) throw new Error("model_served_mismatch");
  const usage = reply.usage;
  if (usage.service_tier !== undefined && usage.service_tier !== null && usage.service_tier !== "standard") throw new Error("model_service_tier_mismatch");
  if (usage.inference_geo === "us") throw new Error("model_inference_geo_mismatch");
  if (usage.speed === "fast") throw new Error("model_speed_mismatch");
  if ((usage.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0) throw new Error("model_cache_ttl_mismatch");
  const text = reply.content.flatMap(block => block.type === "text" ? [block.text as string] : []).join("");
  const toolCalls = reply.content.flatMap(block => {
    if (block.type !== "tool_use") return [];
    const input = block.input;
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("private_model_response_invalid");
    // A NUL or a lone surrogate would make the next request unencodable; refuse it while the reply is settled.
    try { canonical(input); } catch { throw new Error("private_model_response_invalid"); }
    return [{ id: block.id as string, type: "function" as const, function: { name: block.name as string, arguments: JSON.stringify(input) } }];
  });
  if (toolCalls.length > 8) throw new Error("private_model_response_invalid");
  // A cut reply (`length`) keeps its calls for the runner's audit, which never executes them; any other stop that is
  // not `tool_use` (a refusal, an unexpected value) drops them, so an interrupted call can never run.
  const cut = reply.stop_reason === "max_tokens" || reply.stop_reason === "model_context_window_exceeded";
  const finishReason = cut ? "length" : reply.stop_reason === "refusal" ? "content_filter"
    : reply.stop_reason === "tool_use" ? "tool_calls" : reply.stop_reason === "end_turn" ? "stop" : reply.stop_reason;
  const kept = cut || reply.stop_reason === "tool_use" ? toolCalls : [];
  const written = usage.cache_creation_input_tokens ?? 0, read = usage.cache_read_input_tokens ?? 0;
  const thinking = usage.output_tokens_details?.thinking_tokens ?? undefined;
  return { model: reply.model, content: /\S/u.test(text) ? text : "", toolCalls: kept, finishReason,
    promptTokens: usage.input_tokens + written + read, completionTokens: usage.output_tokens, cachedTokens: read, cacheWriteTokens: written,
    ...(thinking !== undefined ? { thinkingTokens: thinking } : {}) };
}
