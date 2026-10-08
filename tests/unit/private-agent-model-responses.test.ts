import { describe, expect, it, vi } from "vitest";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { PrivateAgentModel, responsesInput, type GeneralMessage, type PrivateModelConfig } from "../../src/main/private-agent/model";
import { buildCloudArm } from "../../scripts/private-agent-local-screen";

const config: PrivateModelConfig = { destinationId: "cloud", model: "gpt-6-sol", api: "openai_responses", maxOutputTokens: 16_384,
  inputUsdPerMillion: 2, outputUsdPerMillion: 10, cachedInputUsdPerMillion: 0.2, thinking: "medium" };
const tool = { type: "function" as const, function: { name: "execute", description: "Run a command.", parameters: { type: "object", properties: { command: { type: "string" } } } } };
const usage = (body: string, extra: Record<string, unknown> = {}) => ({ input_tokens: Math.min(100, Buffer.byteLength(body)), output_tokens: 20,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 5 }, total_tokens: 120, ...extra });
function fixture(reply: (body: string) => unknown, modelConfig: PrivateModelConfig = config) {
  const requests: { body: string; maxFeeMicrousd: number }[] = []; const fees: number[] = [];
  const request = vi.fn(async (input, settle) => {
    requests.push({ body: input.body, maxFeeMicrousd: input.maxFeeMicrousd });
    const bytes = Buffer.from(JSON.stringify(reply(input.body)));
    const fee = settle(bytes); fees.push(fee); return { bytes, receipt: { feeMicrousd: fee } };
  });
  return { model: new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, modelConfig, "job", "context"), requests, fees };
}
const conversation: GeneralMessage[] = [
  { role: "system", content: "You are an agent." },
  { role: "user", content: "Count the lines." },
  { role: "assistant", content: "Checking.", tool_calls: [{ id: "call_1", type: "function", function: { name: "execute", arguments: "{\"command\":\"wc -l a\"}" } }] },
  { role: "tool", tool_call_id: "call_1", content: "42 a" },
  { role: "assistant", content: null, tool_calls: [{ id: "call_2", type: "function", function: { name: "execute", arguments: "{}" } }] },
  { role: "tool", tool_call_id: "call_2", content: null },
];

describe("OpenAI Responses request shape (cloud arm)", () => {
  it("maps the conversation to input items with no reasoning items", () => {
    expect(responsesInput(conversation)).toEqual([
      { type: "message", role: "system", content: "You are an agent." },
      { type: "message", role: "user", content: "Count the lines." },
      { type: "message", role: "assistant", content: "Checking." },
      { type: "function_call", call_id: "call_1", name: "execute", arguments: "{\"command\":\"wc -l a\"}" },
      { type: "function_call_output", call_id: "call_1", output: "42 a" },
      { type: "function_call", call_id: "call_2", name: "execute", arguments: "{}" },
      { type: "function_call_output", call_id: "call_2", output: "" },
    ]);
    expect(() => responsesInput([{ role: "tool", content: "orphan" }])).toThrow("private_model_message_invalid");
    expect(() => responsesInput([{ role: "user", content: "x", tool_calls: conversation[2]!.tool_calls }])).toThrow("private_model_message_invalid");
  });

  it("sends a stateless body with non-strict tools and explicit effort, and parses a function call", async () => {
    const f = fixture(body => ({ model: "gpt-6-sol", status: "completed", incomplete_details: null, output: [
      { type: "reasoning", id: "rs_1", summary: [], content: [], encrypted_content: "opaque" },
      { type: "function_call", id: "fc_1", call_id: "call_9", name: "execute", arguments: "{\"command\":\"ls\"}", status: "completed" }], usage: usage(body) }));
    const result = await f.model.complete(conversation, [tool], new AbortController().signal);
    const body = JSON.parse(f.requests[0]!.body);
    expect(body).toEqual({ model: "gpt-6-sol", input: responsesInput(conversation), max_output_tokens: 16_384, reasoning: { effort: "medium" }, store: false, service_tier: "default",
      tools: [{ type: "function", name: "execute", description: "Run a command.", parameters: tool.function.parameters, strict: false }], tool_choice: "auto", parallel_tool_calls: false });
    expect(body).not.toHaveProperty("messages"); expect(body).not.toHaveProperty("include"); expect(body).not.toHaveProperty("stream");
    expect(result).toMatchObject({ content: "", finishReason: "tool_calls", servedModel: "gpt-6-sol",
      toolCalls: [{ id: "call_9", type: "function", function: { name: "execute", arguments: "{\"command\":\"ls\"}" } }] });
  });

  it("joins output text, maps max_output_tokens to length, refusal to content_filter, and settles cached tokens at the cached rate", async () => {
    const text = fixture(body => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "4" }, { type: "output_text", text: "2" }] }],
      usage: usage(body, { input_tokens: 100, input_tokens_details: { cached_tokens: 60 } }) }));
    const answer = await text.model.complete([{ role: "user", content: "q" }], [], new AbortController().signal);
    expect(answer).toMatchObject({ content: "42", finishReason: "stop", usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 60 } });
    expect(text.fees[0]).toBe(Math.ceil(40 * 2 + 60 * 0.2 + 20 * 10));
    const cut = fixture(body => ({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "reasoning", summary: [] }], usage: usage(body) }));
    expect((await cut.model.complete([{ role: "user", content: "q" }], [], new AbortController().signal)).finishReason).toBe("length");
    const refused = fixture(body => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "no" }] }], usage: usage(body) }));
    expect(await refused.model.complete([{ role: "user", content: "q" }], [], new AbortController().signal)).toMatchObject({ content: "", finishReason: "content_filter" });
  });

  it("turns reasoning off explicitly for a tool-less narrowed call", async () => {
    const f = fixture(body => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }], usage: usage(body) }));
    await f.model.complete([{ role: "user", content: "judge" }], [], new AbortController().signal, { thinking: "disabled", maxOutputTokens: 256 });
    const body = JSON.parse(f.requests[0]!.body);
    expect(body).toMatchObject({ reasoning: { effort: "none" }, max_output_tokens: 256, store: false }); expect(body).not.toHaveProperty("tools");
  });

  it.each<[string, (body: string) => unknown]>([
    ["an unknown output item", body => ({ status: "completed", output: [{ type: "web_search_call" }], usage: usage(body) })],
    ["an unknown content part", body => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "audio" }] }], usage: usage(body) })],
    ["a failed status", body => ({ status: "failed", output: [], usage: usage(body) })],
    ["more than eight calls", body => ({ status: "completed", output: Array.from({ length: 9 }, (_, i) => ({ type: "function_call", call_id: `c${i}`, name: "execute", arguments: "{}" })), usage: usage(body) })],
    ["duplicate call ids", body => ({ status: "completed", output: [1, 2].map(() => ({ type: "function_call", call_id: "same", name: "execute", arguments: "{}" })), usage: usage(body) })],
    ["usage outside the envelope", body => ({ status: "completed", output: [], usage: usage(body, { output_tokens: 99_999 }) })],
  ])("refuses %s", async (_name, reply) => {
    await expect(fixture(reply).model.complete([{ role: "user", content: "q" }], [tool], new AbortController().signal)).rejects.toThrow();
  });

  it("keeps the chat-completions shape and identity for every other configuration, and refuses streaming", async () => {
    const chat = fixture(() => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { ...config, api: "openai" });
    await chat.model.complete([{ role: "user", content: "q" }], [tool], new AbortController().signal);
    expect(JSON.parse(chat.requests[0]!.body)).toMatchObject({ messages: [{ role: "user", content: "q" }], max_completion_tokens: 16_384, reasoning_effort: "medium", stream: false });
    expect(() => fixture(() => ({}), { ...config, streaming: true })).toThrow("private_model_configuration_invalid");
  });

  it("is selected by the cloud arm's endpoint path and recorded in its freeze", () => {
    const input = { model: "gpt-6-sol", endpoint: "https://api.openai.com/v1/responses", prices: { input: 2, output: 10, cached: 0.2 }, maxFeeUsd: 8 };
    const coordinator = { maxOutputTokens: 16_384, thinking: "medium" as const, maxRequestBytes: 640 * 1024 };
    const environment = { SOAR_PHASE2_CLOUD_API_KEY: "sk-synthetic-key-0001" };
    expect(buildCloudArm(input, environment, coordinator).freeze.modelConfig.api).toBe("openai_responses");
    expect(buildCloudArm({ ...input, endpoint: "https://api.openai.com/v1/chat/completions" }, environment, coordinator).freeze.modelConfig.api).toBe("openai");
  });
});

describe("cloud settlement guards", () => {
  const reply = (body: string, extra: Record<string, unknown> = {}, usageExtra: Record<string, unknown> = {}) => ({ status: "completed",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }], usage: usage(body, usageExtra), ...extra });
  const longContext = { aboveTokens: 300, inputUsdPerMillion: 4, outputUsdPerMillion: 15, cachedInputUsdPerMillion: 0.4 };

  it("reserves and settles at the long-context tier only when the bound or the prompt crosses it", async () => {
    const small = fixture(body => reply(body, {}, { input_tokens: 100 }), { ...config, longContext });
    await small.model.complete([{ role: "user", content: "q" }], [], new AbortController().signal);
    const smallBytes = Buffer.byteLength(small.requests[0]!.body);
    expect(smallBytes).toBeLessThanOrEqual(300);
    expect(small.requests[0]!.maxFeeMicrousd).toBe(Math.ceil(smallBytes * 2 + 16_384 * 10));
    expect(small.fees[0]).toBe(Math.ceil(100 * 2 + 20 * 10));
    const big = fixture(body => reply(body, {}, { input_tokens: 350, input_tokens_details: { cached_tokens: 50 } }), { ...config, longContext });
    await big.model.complete([{ role: "user", content: "x".repeat(400) }], [], new AbortController().signal);
    const bigBytes = Buffer.byteLength(big.requests[0]!.body);
    expect(big.requests[0]!.maxFeeMicrousd).toBe(Math.ceil(bigBytes * 4 + 16_384 * 15));
    expect(big.fees[0]).toBe(Math.ceil(300 * 4 + 50 * 0.4 + 20 * 15));
    const under = fixture(body => reply(body, {}, { input_tokens: 250 }), { ...config, longContext });
    await under.model.complete([{ role: "user", content: "x".repeat(400) }], [], new AbortController().signal);
    expect(under.fees[0]).toBe(Math.ceil(250 * 2 + 20 * 10));
  });

  it("refuses a long-context tier cheaper than the base tier", () => {
    expect(() => fixture(() => ({}), { ...config, longContext: { ...longContext, inputUsdPerMillion: 1 } })).toThrow("private_model_configuration_invalid");
    expect(() => fixture(() => ({}), { ...config, longContext: { ...longContext, aboveTokens: 0 } })).toThrow("private_model_configuration_invalid");
  });

  it("pins the standard tier on both cloud shapes and refuses a reply served at another tier", async () => {
    const ok = fixture(body => reply(body, { service_tier: "default" }));
    await ok.model.complete([{ role: "user", content: "q" }], [], new AbortController().signal);
    expect(JSON.parse(ok.requests[0]!.body).service_tier).toBe("default");
    await expect(fixture(body => reply(body, { service_tier: "priority" })).model.complete([{ role: "user", content: "q" }], [], new AbortController().signal)).rejects.toThrow();
    const chat = fixture(() => ({ service_tier: "flex", choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { ...config, api: "openai" });
    await expect(chat.model.complete([{ role: "user", content: "q" }], [], new AbortController().signal)).rejects.toThrow();
    expect(JSON.parse(chat.requests[0]!.body).service_tier).toBe("default");
  });

  it("refuses cache writes beyond the uncached prompt", async () => {
    await expect(fixture(body => reply(body, {}, { input_tokens: 100, input_tokens_details: { cached_tokens: 90, cache_write_tokens: 20 } }))
      .model.complete([{ role: "user", content: "q" }], [], new AbortController().signal)).rejects.toThrow();
  });
});
