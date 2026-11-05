/** Host-selected local deployment contract. Never inferred from provider text or a model-name substring. */
export interface FlashNextReplyContract {
  version: "flash_next_v1";
  model: string;
  thinking: "disabled" | "medium";
}

/** Only fixed metadata and a byte count may leave raw-response inspection; reasoning text is never retained. */
export interface FlashNextReplyEvidence {
  contract: "flash_next_v1";
  format: "json" | "sse";
  reasoningField: "none" | "reasoning" | "reasoning_content";
  reasoningBytes: number;
}

function invalid(): never { throw new Error("flash_next_reply_invalid"); }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

/** Ranges of explicit, closed Markdown code literals; used only for inspection, never to rewrite final content. */
function codeLiterals(content: string): [number, number][] {
  const ranges: [number, number][] = [];
  let fence: { start: number; marker: string } | undefined, offset = 0;
  for (const line of content.split(/(?<=\n)/u)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n)?$/u);
    if (marker) {
      if (!fence) fence = { start: offset, marker: marker[1]! };
      else if (marker[1]![0] === fence.marker[0] && marker[1]!.length >= fence.marker.length && !marker[2]!.trim()) {
        ranges.push([fence.start, offset + line.length]); fence = undefined;
      }
    }
    offset += line.length;
  }
  let inline: { start: number; length: number } | undefined;
  for (const run of content.matchAll(/`+/gu)) {
    if (ranges.some(([start, end]) => run.index >= start && run.index < end)) continue;
    if (!inline) inline = { start: run.index, length: run[0].length };
    else if (run[0].length === inline.length) { ranges.push([inline.start, run.index + run[0].length]); inline = undefined; }
  }
  return ranges;
}

/** Bind the typed host option to the actual request, before a dispatch row or scan exists. */
export function validateFlashNextRequest(contract: FlashNextReplyContract, body: string): void {
  if (contract.version !== "flash_next_v1" || typeof contract.model !== "string" || !contract.model ||
      (contract.thinking !== "disabled" && contract.thinking !== "medium") ||
      Object.keys(contract).some(key => !["version", "model", "thinking"].includes(key))) invalid();
  const request = object(JSON.parse(body)), template = object(request.chat_template_kwargs);
  if (request.model !== contract.model || template.enable_thinking !== (contract.thinking === "medium") || template.preserve_thinking !== false ||
      (contract.thinking === "medium" ? request.reasoning_effort !== "medium" : request.reasoning_effort !== undefined)) invalid();
}

/**
 * Inspect the bounded, original wire response before settlement. The ordinary decoder still validates the final
 * content/tools/usage. This check runs before SSE assembly can discard reasoning or hide a later model alias.
 * It never adds reasoning to history, logs or receipts, and does not require every thinking-on turn to reason.
 */
export function inspectFlashNextReply(raw: Uint8Array, format: "json" | "sse", contract: FlashNextReplyContract): FlashNextReplyEvidence {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  let sawModel = false, finished = false, content = "", reasoningBytes = 0;
  let reasoningField: FlashNextReplyEvidence["reasoningField"] = "none";
  const model = (item: Record<string, unknown>) => {
    if (item.model === undefined) return;
    if (item.model !== contract.model) invalid();
    sawModel = true;
  };
  const message = (item: Record<string, unknown>) => {
    for (const field of ["reasoning", "reasoning_content"] as const) {
      const value = item[field];
      if (value !== undefined && value !== null && typeof value !== "string") invalid();
      if (typeof value === "string" && value.length) {
        if (contract.thinking === "disabled" || finished || (reasoningField !== "none" && reasoningField !== field)) invalid();
        reasoningField = field; reasoningBytes += Buffer.byteLength(value);
      }
    }
    if (item.content !== undefined && item.content !== null && typeof item.content !== "string") invalid();
    if (typeof item.content === "string") content += item.content;
    if (item.tool_calls !== undefined && item.tool_calls !== null) {
      if (!Array.isArray(item.tool_calls)) invalid();
      for (const value of item.tool_calls) {
        const call = object(value);
        if ((call.id !== undefined && typeof call.id !== "string") || (call.type !== undefined && call.type !== "function")) invalid();
        if (call.function !== undefined) {
          const fn = object(call.function);
          if ((fn.name !== undefined && typeof fn.name !== "string") || (fn.arguments !== undefined && typeof fn.arguments !== "string")) invalid();
        }
      }
    }
  };
  if (format === "json") {
    const reply = object(JSON.parse(text)); model(reply);
    if (!Array.isArray(reply.choices) || reply.choices.length !== 1) invalid();
    const choice = object(reply.choices[0]);
    message(object(choice.message));
    if (typeof choice.finish_reason !== "string" || !choice.finish_reason) invalid();
    finished = true;
  } else {
    // Framing, usage and terminal markers are also checked by the existing SSE assembler. Inspect every original delta.
    for (const line of text.split(/\r?\n/u)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      const chunk = object(JSON.parse(payload)); model(chunk);
      if (chunk.choices === undefined) continue;
      if (!Array.isArray(chunk.choices) || chunk.choices.length > 1) invalid();
      for (const value of chunk.choices) {
        const choice = object(value);
        if (choice.index !== 0) invalid();
        if (choice.delta !== undefined) message(object(choice.delta));
        if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
          if (typeof choice.finish_reason !== "string" || !choice.finish_reason) invalid();
          finished = true;
        }
      }
    }
  }
  // A leading protocol wrapper is a malformed projection, including when its prefix arrived in several SSE chunks.
  // Whole JSON values and explicit code literals may quote reserved tags. Never strip or rewrite their content.
  if (!sawModel || !finished || /^\s*<\/?think(?:\s[^>]*)?>/iu.test(content)) invalid();
  let wholeJson = false;
  try { JSON.parse(content); wholeJson = true; } catch { /* Ordinary prose is inspected below. */ }
  if (!wholeJson) {
    const literals = codeLiterals(content);
    let openTags = 0;
    for (const tag of content.matchAll(/<\/?think(?:\s[^>]*)?>/giu)) {
      if (literals.some(([start, end]) => tag.index >= start && tag.index < end)) continue;
      if (tag[0].startsWith("</")) { if (openTags === 0) invalid(); openTags--; }
      else openTags++;
    }
  }
  return Object.freeze({ contract: "flash_next_v1", format, reasoningField, reasoningBytes });
}
