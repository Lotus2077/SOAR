/**
 * A chat-completions reply as the model layer reads it (src/main/private-agent/model.ts, decodeReply under the vLLM and OpenAI chat
 * shapes), for the fixtures that post outside the broker: a reply the model layer would reject is malformed, and one it accepts is read
 * with a missing or null content as empty text, as decodeReply reads it. The schema below is a copy of model.ts's, kept byte-identical:
 * tests/unit/chat-reply.test.ts compares the two texts, so the copy cannot drift without a failing test. Settlement, the broker's
 * receipts and the Responses and Anthropic shapes are not covered.
 */
import { z } from "zod";

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

/** What a fixture reads from an accepted reply: the content as decodeReply reads it, the finish reason, and the raw message and usage. */
export interface ChatReply { content: string; finishReason: string | null; message: Readonly<Record<string, unknown>>; usage: unknown }
/** A parsed reply body (a plain reply, or a stream the broker's assembler rebuilt), or undefined where decodeReply would throw. */
export function readChatReplyJson(json: unknown): ChatReply | undefined {
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const choice = parsed.data.choices[0]!, raw = json as { choices: { message: Record<string, unknown> }[]; usage: unknown };
  return { content: choice.message.content ?? "", finishReason: choice.finish_reason, message: raw.choices[0]!.message, usage: raw.usage };
}
/** A reply's bytes: strict UTF-8 and JSON, as decodeReply decodes them, then readChatReplyJson. */
export function readChatReply(bytes: Uint8Array): ChatReply | undefined {
  let json: unknown;
  try { json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return undefined; }
  return readChatReplyJson(json);
}
