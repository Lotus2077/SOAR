import { describe, expect, it, vi } from "vitest";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE } from "../../src/main/private-agent/dispatch-purposes";
import { ModelRequestBodyTooLarge, PrivateAgentModel, responsesInput, type GeneralMessage, type PrivateModelConfig } from "../../src/main/private-agent/model";
import { buildCloudArm } from "../../scripts/private-agent-local-screen";
import { assistModelConfig, capturingBroker, responsesCachingReply } from "../helpers/research-assist-fixture";

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

describe("H1: explicit prompt-cache breakpoints and cache-write settlement", () => {
  const caching: PrivateModelConfig = { ...config, promptCaching: "responses_explicit_v1", cacheWriteUsdPerMillion: 2.5 };
  const history: GeneralMessage[] = [
    { role: "system", content: "You are an agent." },
    { role: "user", content: "The brief." },
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "execute", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_1", content: "first result" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_2", type: "function", function: { name: "execute", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_2", content: "second result" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_3", type: "function", function: { name: "execute", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_3", content: "" },
    { role: "user", content: "Current host budget ..." },
  ];
  const block = (text: string) => [{ type: "input_text", text, prompt_cache_breakpoint: { mode: "explicit" } }];

  it("marks the static prompt, the brief and the latest two non-empty tool results, never the final message", () => {
    const input = responsesInput(history, true);
    expect(input[0]).toEqual({ type: "message", role: "system", content: block("You are an agent.") });
    expect(input[1]).toEqual({ type: "message", role: "user", content: block("The brief.") });
    // The empty third result cannot carry a block, so the two latest non-empty results are marked.
    expect(input[3]).toEqual({ type: "function_call_output", call_id: "call_1", output: block("first result") });
    expect(input[5]).toEqual({ type: "function_call_output", call_id: "call_2", output: block("second result") });
    expect(input[7]).toEqual({ type: "function_call_output", call_id: "call_3", output: "" });
    expect(input.at(-1)).toEqual({ type: "message", role: "user", content: "Current host budget ..." });
    expect(responsesInput(history)).toEqual(responsesInput(history, false));
    expect(JSON.stringify(responsesInput(history))).not.toContain("prompt_cache_breakpoint");
    // Without a leading system message only the latest tool results are marked.
    expect(responsesInput(history.slice(1), true)[0]).toEqual({ type: "message", role: "user", content: "The brief." });
    // A one-shot [system, user] call (the cloud critic) marks the system message only: its packet is never re-read.
    expect(responsesInput(history.slice(0, 2), true)).toEqual([{ type: "message", role: "system", content: block("You are an agent.") }, { type: "message", role: "user", content: "The brief." }]);
  });

  it("sends explicit-mode caching with the marked input and settles writes at the write rate inside the reservation", async () => {
    const f = fixture(body => ({ status: "completed", output: [{ type: "function_call", call_id: "c", name: "execute", arguments: "{}" }],
      usage: usage(body, { input_tokens: 100, input_tokens_details: { cached_tokens: 60, cache_write_tokens: 30 } }) }), caching);
    const result = await f.model.complete(history, [tool], new AbortController().signal);
    const body = JSON.parse(f.requests[0]!.body);
    expect(body.prompt_cache_options).toEqual({ mode: "explicit" });
    expect(body.input).toEqual(responsesInput(history, true));
    expect(body.store).toBe(false);
    const bytes = Buffer.byteLength(f.requests[0]!.body);
    expect(f.requests[0]!.maxFeeMicrousd).toBe(Math.ceil(bytes * 2.5 + 16_384 * 10));
    expect(f.fees[0]).toBe(Math.ceil(10 * 2 + 30 * 2.5 + 60 * 0.2 + 20 * 10));
    expect(result.usage).toMatchObject({ inputTokens: 100, cacheReadTokens: 60, cacheWriteTokens: 30 });
    // Without caching the body carries no cache options or breakpoints, and writes settle at the input rate.
    const plain = fixture(body => ({ status: "completed", output: [], usage: usage(body, { input_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 100 } }) }));
    await plain.model.complete(history, [tool], new AbortController().signal);
    expect(JSON.parse(plain.requests[0]!.body)).not.toHaveProperty("prompt_cache_options");
    expect(plain.requests[0]!.body).not.toContain("prompt_cache_breakpoint");
    expect(plain.fees[0]).toBe(Math.ceil(100 * 2 + 20 * 10));
  });

  it("settles long-context writes at that tier's write rate and refuses invalid caching configurations", async () => {
    const longContext = { aboveTokens: 300, inputUsdPerMillion: 4, outputUsdPerMillion: 15, cachedInputUsdPerMillion: 0.4, cacheWriteUsdPerMillion: 5 };
    const big = fixture(body => ({ status: "completed", output: [], usage: usage(body, { input_tokens: 350, input_tokens_details: { cached_tokens: 50, cache_write_tokens: 100 } }) }), { ...caching, longContext });
    await big.model.complete([{ role: "user", content: "x".repeat(400) }], [], new AbortController().signal);
    expect(big.requests[0]!.maxFeeMicrousd).toBe(Math.ceil(Buffer.byteLength(big.requests[0]!.body) * 5 + 16_384 * 15));
    expect(big.fees[0]).toBe(Math.ceil(200 * 4 + 100 * 5 + 50 * 0.4 + 20 * 15));
    expect(() => fixture(() => ({}), { ...config, promptCaching: "responses_explicit_v1", api: "openai" })).toThrow("private_model_configuration_invalid");
    expect(() => fixture(() => ({}), { ...config, promptCaching: "vllm_job_salt_v1" })).toThrow("private_model_configuration_invalid");
    expect(() => fixture(() => ({}), { ...config, cacheWriteUsdPerMillion: 9 })).toThrow("private_model_configuration_invalid");
    expect(() => fixture(() => ({}), { ...caching, longContext: { ...longContext, cacheWriteUsdPerMillion: 17 } })).toThrow("private_model_configuration_invalid");
    // A long-tier reservation can settle at the base tier, so the long tier's write rate (default: its input rate) must cover the base one.
    expect(() => fixture(() => ({}), { ...config, cacheWriteUsdPerMillion: 6, longContext: { aboveTokens: 300, inputUsdPerMillion: 4, outputUsdPerMillion: 15 } })).toThrow("private_model_configuration_invalid");
    expect(() => fixture(() => ({}), { ...config, cacheWriteUsdPerMillion: 6, longContext: { aboveTokens: 300, inputUsdPerMillion: 4, outputUsdPerMillion: 15, cacheWriteUsdPerMillion: 6 } })).not.toThrow();
    // A usage block with no prompt tokens for a non-empty body never settles as a free call.
    await expect(fixture(body => ({ status: "completed", output: [], usage: usage(body, { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } }) }), caching)
      .model.complete(history, [tool], new AbortController().signal)).rejects.toThrow("model_usage_outside_envelope");
  });

  it("is switched on by the cloud arm for the Responses shape with the published write price, and recorded in the freeze", () => {
    const coordinator = { maxOutputTokens: 16_384, thinking: "medium" as const, maxRequestBytes: 640 * 1024 };
    const environment = { SOAR_PHASE2_CLOUD_API_KEY: "sk-synthetic-key-0001" };
    const responses = buildCloudArm({ model: "gpt-6-sol", endpoint: "https://api.openai.com/v1/responses", prices: { input: 2, output: 10, cached: 0.2 }, maxFeeUsd: 8,
      longContext: { aboveTokens: 272_000, input: 4, output: 15, cached: 0.4 } }, environment, coordinator);
    expect(responses.freeze.modelConfig).toMatchObject({ promptCaching: "responses_explicit_v1", cacheWriteUsdPerMillion: 2.5, longContext: { cacheWriteUsdPerMillion: 5 } });
    const explicit = buildCloudArm({ model: "gpt-6-sol", endpoint: "https://api.openai.com/v1/responses", prices: { input: 2, output: 10, cached: 0.2, write: 2 }, maxFeeUsd: 8 }, environment, coordinator);
    expect(explicit.freeze.modelConfig.cacheWriteUsdPerMillion).toBe(2);
    // The chat-completions shape reports no write counts: its configuration and identity stay as before, a write price is ignored.
    const chat = buildCloudArm({ model: "gpt-6-sol", endpoint: "https://api.openai.com/v1/chat/completions", prices: { input: 2, output: 10, cached: 0.2, write: 2 }, maxFeeUsd: 8 }, environment, coordinator);
    expect(chat.freeze.modelConfig).not.toHaveProperty("promptCaching");
    expect(chat.freeze.modelConfig).not.toHaveProperty("cacheWriteUsdPerMillion");
  });
});

describe("the assist no-write cache mode on the Responses shape (backlog item 10)", () => {
  const assist = assistModelConfig("openai_responses"), oneShot: GeneralMessage[] = [{ role: "system", content: "Plan." }, { role: "user", content: "Brief." }];
  const text = (body: string) => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{}" }] }], usage: usage(body) });

  it("sends explicit mode and no breakpoint anywhere, byte for byte, and requestBody returns exactly the dispatched body", async () => {
    const f = fixture(text, assist);
    await f.model.complete(oneShot, [], new AbortController().signal, { maxOutputTokens: 8192, purpose: PLAN_ASSIST_PURPOSE });
    expect(f.requests[0]!.body).toBe('{"input":[{"content":"Plan.","role":"system","type":"message"},{"content":"Brief.","role":"user","type":"message"}],"max_output_tokens":8192,'
      + '"model":"gpt-6-sol","prompt_cache_options":{"mode":"explicit"},"reasoning":{"effort":"medium"},"service_tier":"default","store":false}');
    expect(f.model.requestBody(oneShot, [], { maxOutputTokens: 8192, purpose: PLAN_ASSIST_PURPOSE }).body).toBe(f.requests[0]!.body);
    // The reservation keeps the shipped formula: the body at the dearer of the input and write rates, plus the cap at the output rate.
    expect(f.requests[0]!.maxFeeMicrousd).toBe(Math.ceil(Buffer.byteLength(f.requests[0]!.body) * 2.5 + 8192 * 10));
  });

  it("refuses an assist under any other cache mode, and the mode outside a sealed tool-less one-shot assist, before any request", async () => {
    const signal = new AbortController().signal;
    for (const promptCaching of [undefined, "responses_explicit_v1"] as const) {
      const f = fixture(text, { ...assist, promptCaching });
      await expect(f.model.complete(oneShot, [], signal, { purpose: SYNTHESIS_ASSIST_PURPOSE })).rejects.toThrow("private_model_assist_cache_mode_required");
      expect(f.requests).toHaveLength(0);
    }
    const f = fixture(text, assist);
    for (const [messages, tools, overrides] of [[oneShot, [], { purpose: "research plan" }], [oneShot, [], undefined], [oneShot, [tool], { purpose: PLAN_ASSIST_PURPOSE }],
      [[...oneShot, { role: "assistant", content: "earlier" }, { role: "user", content: "again" }], [], { purpose: PLAN_ASSIST_PURPOSE }],
      [[{ role: "user", content: "Brief." }], [], { purpose: PLAN_ASSIST_PURPOSE }]] as const) {
      await expect(f.model.complete([...messages] as GeneralMessage[], [...tools], signal, overrides)).rejects.toThrow("private_model_assist_request_invalid");
    }
    expect(f.requests).toHaveLength(0);
    // Admitted on the Responses and Anthropic shapes only: the chat shape cannot prove zero writes and the owned server takes none.
    expect(() => fixture(text, { ...assist, api: "openai" })).toThrow("private_model_configuration_invalid");
    expect(() => fixture(text, { ...assist, api: undefined, inputUsdPerMillion: 0, outputUsdPerMillion: 0, cachedInputUsdPerMillion: undefined, cacheWriteUsdPerMillion: undefined })).toThrow("private_model_configuration_invalid");
  });

  it("narrows the body bound per call, and refuses a malformed bound", async () => {
    const f = fixture(text, assist), signal = new AbortController().signal, long = [oneShot[0]!, { role: "user" as const, content: "x".repeat(40_000) }];
    const error = await f.model.complete(long, [], signal, { purpose: PLAN_ASSIST_PURPOSE, maxRequestBytes: 32_768 }).catch(caught => caught);
    expect(error).toBeInstanceOf(ModelRequestBodyTooLarge); expect(error.limitBytes).toBe(32_768);
    for (const maxRequestBytes of [0, 1.5, Number.NaN]) await expect(f.model.complete(oneShot, [], signal, { purpose: PLAN_ASSIST_PURPOSE, maxRequestBytes })).rejects.toThrow("private_model_request_bound_invalid");
    // A bound above the configured cap does not widen it.
    const capped = await fixture(text, { ...assist, maxRequestBytes: 8192 }).model.complete(long, [], signal, { purpose: PLAN_ASSIST_PURPOSE, maxRequestBytes: 1_000_000 }).catch(caught => caught);
    expect(capped).toBeInstanceOf(ModelRequestBodyTooLarge); expect(capped.limitBytes).toBe(8192);
    expect(f.requests).toHaveLength(0);
  });

  it("writes nothing under the provider's documented caching rules, where the breakpoint mode and the implicit default write the same long prompt", async () => {
    const system = `You plan research. ${"Plan carefully and cover every requirement. ".repeat(160)}`, messages: GeneralMessage[] = [{ role: "system", content: system }, { role: "user", content: "Brief." }];
    const run = async (config: PrivateModelConfig, purpose: string) => {
      const captured = capturingBroker(body => responsesCachingReply(body, "{}"));
      return new PrivateAgentModel(captured.broker, config, "job", "reader").complete(messages, [], new AbortController().signal, { maxOutputTokens: 8192, purpose });
    };
    expect((await run(assist, PLAN_ASSIST_PURPOSE)).usage?.cacheWriteTokens).toBe(0);
    // Negative controls: a marked system block over 1,024 tokens is written, and so is the whole prompt with no cache field at all.
    expect((await run(assistModelConfig("openai_responses", "responses_explicit_v1"), "research plan")).usage?.cacheWriteTokens).toBeGreaterThan(1024);
    expect((await run(assistModelConfig("openai_responses", "none"), "research plan")).usage?.cacheWriteTokens).toBeGreaterThan(1024);
  });
});

describe("requestBody is the dispatched body (backlog item 10)", () => {
  const flash: PrivateModelConfig = { destinationId: "local", model: "flash", maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium",
    localReplyContract: "flash_next_v1", localContextTokens: 65_536 };
  const vllm: PrivateModelConfig = { destinationId: "local", model: "local", maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium", promptCaching: "vllm_job_salt_v1", streaming: true };
  const anthropic: PrivateModelConfig = { ...config, model: "claude-sonnet-5-5", api: "anthropic_messages", cachedInputUsdPerMillion: 0.1, cacheWriteUsdPerMillion: 2.5 };
  const oneShot: GeneralMessage[] = [{ role: "system", content: "Plan." }, { role: "user", content: "Brief." }];
  const layout2: GeneralMessage[] = [...conversation.slice(0, 4), { role: "user", content: "Guidance." }];
  const cases: [string, PrivateModelConfig, GeneralMessage[], boolean, Parameters<PrivateAgentModel["complete"]>[3]][] = [
    ["vllm salted, thinking", vllm, layout2, true, undefined], ["vllm salted, thinking off", vllm, oneShot, false, { thinking: "disabled", maxOutputTokens: 256 }],
    ["Flash contract", flash, layout2, true, undefined], ["Flash contract, thinking off", flash, oneShot, false, { thinking: "disabled" }],
    ["chat", { ...config, api: "openai" }, layout2, true, undefined], ["chat, thinking off", { ...config, api: "openai" }, oneShot, false, { thinking: "disabled" }],
    ["Responses", config, layout2, true, { trailingTurnMessage: true }], ["Responses, breakpoints", { ...config, promptCaching: "responses_explicit_v1" }, layout2, true, undefined],
    ["Responses, no-write assist", { ...config, promptCaching: "assist_no_cache_write_v1" }, oneShot, false, { purpose: PLAN_ASSIST_PURPOSE, maxOutputTokens: 8192 }],
    ["Anthropic, layout 2", { ...anthropic, promptCaching: "anthropic_explicit_5m_v1" }, layout2, true, { trailingTurnMessage: true }],
    ["Anthropic, no cache field", anthropic, oneShot, false, undefined],
    ["Anthropic, no-write assist", { ...anthropic, promptCaching: "assist_no_cache_write_v1" }, oneShot, false, { purpose: SYNTHESIS_ASSIST_PURPOSE }],
  ];
  it.each(cases)("on %s", async (_name, modelConfig, messages, withTools, overrides) => {
    let sent = "";
    const broker = { request: async (input: { body: string }) => { sent = input.body; throw new Error("capture_only"); } } as unknown as PrivateAgentBroker;
    const model = new PrivateAgentModel(broker, modelConfig, "00000000-0000-4000-8000-000000000001", "context"), tools = withTools ? [tool] : [];
    await model.complete(messages, tools, new AbortController().signal, overrides).catch(() => undefined);
    expect(sent).not.toBe("");
    expect(model.requestBody(messages, tools, overrides).body).toBe(sent);
  });
});
