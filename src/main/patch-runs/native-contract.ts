import { readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { LocalCodingThinking } from "./config";

export function canonicalRequest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRequest).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalRequest(item)}`).join(",")}}`;
  if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) throw new Error("Request contains a non-JSON value.");
  return JSON.stringify(value);
}

const toolName = z.enum(["run_command", "submit_task", "run_visible_checks", "request_help"]);
const contractSchema = z.object({
  schemaVersion: z.literal(1), system: z.string().min(1).max(16384),
  tools: z.array(z.object({ type: z.literal("function"), function: z.object({
    name: toolName, description: z.string(), parameters: z.record(z.string(), z.unknown()),
  }).strict() }).strict()).length(4),
  requestProfile: z.object({ tool_choice: z.literal("auto"), parallel_tool_calls: z.literal(false),
    chat_template_kwargs: z.object({ enable_thinking: z.literal(false) }).strict(), stream: z.literal(false) }).strict(),
  limits: z.object({ maxOutputTokens: z.literal(8192), maxInputBytes: z.literal(256000),
    localStepLimit: z.literal(24), finishingReserve: z.literal(2) }).strict(),
}).strict();

/** Load application-owned protocol authority, never a model-provided schema. */
export function loadNativeCodingContract(workerPath: string) {
  const text = readFileSync(path.join(path.dirname(workerPath), "native-coding-contract.json"), "utf8");
  if (Buffer.byteLength(text) > 32768) throw new Error("Native protocol authority is oversized.");
  const contract = contractSchema.parse(JSON.parse(text));
  if (new Set(contract.tools.map((tool) => tool.function.name)).size !== 4) throw new Error("Native protocol tools are incomplete.");
  return contract;
}

function boundedText(value: unknown, bytes: number, nonblank = false): string {
  const text = z.string().parse(value);
  if (Buffer.byteLength(text) > bytes || (nonblank && !text.trim()) ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) {
    throw new Error("Native text exceeds its valid UTF-8 envelope.");
  }
  return text;
}

function validateArguments(name: z.infer<typeof toolName>, raw: string): void {
  boundedText(raw, 65536);
  if (name === "submit_task" || name === "run_visible_checks") {
    if (!/^\s*\{\s*\}\s*$/u.test(raw)) throw new Error("Native action requires an empty object.");
    return;
  }
  // The admitted argument shape is one string member. Matching that shape
  // before JSON.parse also rejects duplicate members without normalizing them.
  const match = /^\s*\{\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")\s*\}\s*$/su.exec(raw);
  if (!match || JSON.parse(match[1]!) !== (name === "run_command" ? "command" : "reason")) throw new Error("Native action arguments differ from their schema.");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const text = boundedText(parsed[name === "run_command" ? "command" : "reason"], name === "run_command" ? 32768 : 1024, true);
  if (text.includes("\0")) throw new Error("Native action contains a NUL character.");
}

/** Validate the current tool mask and complete full-catalog call/result history.
 * Standalone calibration may omit the mask; application admission must supply it. */
export function validateNativeCodingBody(body: Record<string, unknown>, workerPath: string,
  allowedActions?: readonly string[], thinking: LocalCodingThinking = "disabled"): void {
  const contract = loadNativeCodingContract(workerPath);
  if (thinking !== "disabled" && thinking !== "medium") throw new Error("Native thinking profile is invalid.");
  const { chat_template_kwargs: _disabled, ...commonProfile } = contract.requestProfile;
  const profile = thinking === "medium" ? { ...commonProfile, reasoning_effort: "medium" } : contract.requestProfile;
  const mask = allowedActions === undefined ? undefined : z.array(toolName).min(1).max(4).parse(allowedActions);
  if (mask && new Set(mask).size !== mask.length) throw new Error("Native action mask contains duplicates.");
  const tools = mask ? contract.tools.filter(tool => mask.includes(tool.function.name)) : contract.tools;
  if (Object.hasOwn(body, thinking === "medium" ? "chat_template_kwargs" : "reasoning_effort") ||
      !isDeepStrictEqual(body.tools, tools) || Object.entries(profile).some(([key, value]) => !isDeepStrictEqual(body[key], value))) {
    throw new Error("Native request tools or thinking authority changed.");
  }
  const messages = z.array(z.record(z.string(), z.unknown())).min(2).parse(body.messages);
  const seen = new Set<string>();
  let pending: { id: string; name: z.infer<typeof toolName> } | undefined;
  let userSeen = false;
  for (const [index, raw] of messages.entries()) {
    if (pending) {
      const message = z.object({ role: z.literal("tool"), content: z.string(), tool_call_id: z.string() }).strict().parse(raw);
      if (message.tool_call_id !== pending.id || pending.name === "submit_task") throw new Error("Native tool history does not match its preceding call.");
      boundedText(message.content, 65536);
      pending = undefined;
      continue;
    }
    if (raw.role === "system" || raw.role === "user") {
      const message = z.object({ role: z.enum(["system", "user"]), content: z.string() }).strict().parse(raw);
      if ((index === 0 && (message.role !== "system" || message.content !== contract.system)) ||
          (index !== 0 && message.role === "system")) throw new Error("Native system authority changed.");
      boundedText(message.content, 256000, true);
      userSeen ||= message.role === "user";
      continue;
    }
    if (!userSeen) throw new Error("Native history lacks its admitted task.");
    const message = z.object({ role: z.literal("assistant"), content: z.string().nullable(),
      tool_calls: z.array(z.object({ id: z.string(), type: z.literal("function"),
        function: z.object({ name: toolName, arguments: z.string() }).strict() }).strict()).length(1) }).strict().parse(raw);
    if (message.content !== null) boundedText(message.content, 65536);
    const call = message.tool_calls[0]!;
    boundedText(call.id, 256, true);
    if (call.id.trim() !== call.id || /[\x00-\x1f\x7f]/u.test(call.id) || seen.has(call.id)) throw new Error("Native call identity is invalid or reused.");
    validateArguments(call.function.name, call.function.arguments);
    seen.add(call.id);
    pending = { id: call.id, name: call.function.name };
  }
  if (!userSeen || pending) throw new Error("Native request contains incomplete tool history.");
}
