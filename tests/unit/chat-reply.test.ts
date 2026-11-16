import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readChatReply, readChatReplyJson } from "../../scripts/chat-reply";

/** scripts/chat-reply.ts: a chat-completions reply as the model layer (src/main/private-agent/model.ts, decodeReply) reads it. */
const ROOT = resolve(__dirname, "..", "..");
const usage = { prompt_tokens: 1200, completion_tokens: 80 };
const reply = (message: unknown, rest: Record<string, unknown> = {}) => ({ id: "x", model: "Synthetic", choices: [{ index: 0, message, finish_reason: "length" }], usage, ...rest });
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));

describe("the chat reply reader the fixtures share", () => {
  it("copies model.ts's reply schema byte for byte", () => {
    const block = (text: string) => { const start = text.indexOf("const nonnegativeInt = "); return text.slice(start, text.indexOf("\n});\n", text.indexOf("const responseSchema = ", start)) + 5); };
    const model = block(readFileSync(join(ROOT, "src", "main", "private-agent", "model.ts"), "utf8")), copy = block(readFileSync(join(ROOT, "scripts", "chat-reply.ts"), "utf8"));
    expect(model).toContain("choices: z.array("); expect(copy).toBe(model);
  });
  it("reads a missing or null content as empty text, keeps text, and returns the raw message and usage", () => {
    expect(readChatReply(bytes(reply({ role: "assistant", content: null, reasoning_content: "thoughts" })))).toEqual({ content: "", finishReason: "length",
      message: { role: "assistant", content: null, reasoning_content: "thoughts" }, usage });
    expect(readChatReply(bytes(reply({ role: "assistant" })))?.content).toBe("");
    expect(readChatReply(bytes({ ...reply({ content: "text" }), choices: [{ index: 0, message: { content: "text" }, finish_reason: null }] }))).toMatchObject({ content: "text", finishReason: null });
  });
  it("rejects what decodeReply rejects: content that is not text or null, a message that is not an object, other than one choice, no finish_reason or usage, and bytes that are not strict UTF-8 JSON", () => {
    for (const body of [reply({ content: [{ type: "text", text: "parts" }] }), reply({ content: 7 }), reply([]), reply(null), reply("text"),
      { ...reply({ content: null }), choices: [] }, { ...reply({ content: null }), choices: [{ index: 0, message: { content: null }, finish_reason: "stop" }, { index: 1, message: { content: null }, finish_reason: "stop" }] },
      { ...reply({ content: null }), choices: [{ index: 0, message: { content: null } }] }, { ...reply({ content: null }), usage: undefined }, { ...reply({ content: null }), usage: { prompt_tokens: -1, completion_tokens: 1 } },
      null, []]) expect(readChatReplyJson(body)).toBeUndefined();
    expect(readChatReply(Buffer.from([0x7b, 0xff, 0x7d]))).toBeUndefined(); expect(readChatReply(Buffer.from("not json"))).toBeUndefined();
  });
});
