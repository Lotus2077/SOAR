import { describe, expect, it, vi } from "vitest";
import { buildCloudArm, parseLocalArtifactScreenArguments } from "../../scripts/private-agent-local-screen";
import { ANTHROPIC_API_VERSION, ANTHROPIC_MESSAGES_ENDPOINT, anthropicConversation } from "../../src/main/private-agent/anthropic";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { ModelRequestBodyTooLarge, PrivateAgentModel, type GeneralMessage, type PrivateModelConfig } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";

const heavy = COORDINATOR_PROFILES.heavy;
const config: PrivateModelConfig = { destinationId: "cloud", model: "claude-sonnet-5-5", api: "anthropic_messages", maxOutputTokens: 16_384,
  inputUsdPerMillion: 2, outputUsdPerMillion: 10, cachedInputUsdPerMillion: 0.1, cacheWriteUsdPerMillion: 2.5, thinking: "medium",
  promptCaching: "anthropic_explicit_5m_v1" };
const tool = { type: "function" as const, function: { name: "execute", description: "Run a command.", parameters: { type: "object", properties: { command: { type: "string" } } } } };
const BREAK = { type: "ephemeral", ttl: "5m" };
const usage = (extra: Record<string, unknown> = {}) => ({ input_tokens: 50, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  service_tier: "standard", inference_geo: "global", ...extra });
const reply = (content: unknown[], extra: Record<string, unknown> = {}) => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5",
  content, stop_reason: "end_turn", stop_sequence: null, usage: usage(), ...extra });
function fixture(answer: (body: string) => unknown, modelConfig: PrivateModelConfig = config) {
  const requests: { body: string; maxFeeMicrousd: number }[] = []; const fees: number[] = [];
  const request = vi.fn(async (input, settle) => {
    requests.push({ body: input.body, maxFeeMicrousd: input.maxFeeMicrousd });
    const bytes = Buffer.from(JSON.stringify(answer(input.body)));
    const fee = settle(bytes); fees.push(fee); return { bytes, receipt: { feeMicrousd: fee } };
  });
  return { model: new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, modelConfig, "job", "context"), requests, fees, request };
}
const call = (id: string, args = "{\"command\":\"ls\"}") => ({ id, type: "function" as const, function: { name: "execute", arguments: args } });
/** A layout-2 request after one executed call: static prompt, brief, call, result, then the turn's guidance and budget. */
const layout2: GeneralMessage[] = [
  { role: "system", content: "You are an agent." },
  { role: "user", content: "Count the lines." },
  { role: "assistant", content: "Checking.", tool_calls: [call("toolu_1", "{\"command\":\"wc -l a\"}")] },
  { role: "tool", tool_call_id: "toolu_1", content: "42 a" },
  { role: "user", content: "Guidance.\nBudget: 3 calls." },
];

describe("Anthropic Messages request shape", () => {
  it("sends the layout-2 request with breakpoints, the guidance as a final system message, adaptive thinking and the pinned tier and geography", async () => {
    const f = fixture(() => reply([{ type: "text", text: "done" }]));
    await f.model.complete(layout2, [tool], new AbortController().signal, { trailingTurnMessage: true });
    expect(JSON.parse(f.requests[0]!.body)).toEqual({ model: "claude-sonnet-5-5", max_tokens: 16_384,
      system: [{ type: "text", text: "You are an agent.", cache_control: BREAK }],
      messages: [
        { role: "user", content: [{ type: "text", text: "Count the lines.", cache_control: BREAK }] },
        { role: "assistant", content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "toolu_1", name: "execute", input: { command: "wc -l a" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "42 a", cache_control: BREAK }] },
        { role: "system", content: "Guidance.\nBudget: 3 calls." },
      ],
      tools: [{ name: "execute", description: "Run a command.", input_schema: tool.function.parameters }],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      thinking: { type: "adaptive" }, output_config: { effort: "medium" }, service_tier: "standard_only", inference_geo: "global" });
    const body = JSON.parse(f.requests[0]!.body);
    for (const field of ["stream", "fallbacks", "speed", "metadata", "stop_sequences", "temperature", "top_p", "top_k", "cache_control"]) expect(body).not.toHaveProperty(field);
  });

  it("marks a one-shot call's system text only, sends no tool fields, and keeps the final user message unmarked", async () => {
    const f = fixture(() => reply([{ type: "text", text: "{}" }]));
    await f.model.complete([{ role: "system", content: "Plan." }, { role: "user", content: "Brief." }], [], new AbortController().signal, { maxOutputTokens: 8192, purpose: "research plan" });
    const body = JSON.parse(f.requests[0]!.body);
    expect(body).toMatchObject({ max_tokens: 8192, system: [{ type: "text", text: "Plan.", cache_control: BREAK }], messages: [{ role: "user", content: [{ type: "text", text: "Brief." }] }] });
    expect(body).not.toHaveProperty("tools"); expect(body).not.toHaveProperty("tool_choice");
    expect(f.requests[0]!.maxFeeMicrousd).toBe(Math.ceil(Buffer.byteLength(f.requests[0]!.body) * 2.5 + 8192 * 10));
  });

  it("marks the latest two tool results with content, never the final message, at most four positions", () => {
    const messages: GeneralMessage[] = [{ role: "system", content: "S" }, { role: "user", content: "brief" },
      ...[1, 2, 3].flatMap(i => [{ role: "assistant" as const, content: null, tool_calls: [call(`t${i}`)] }, { role: "tool" as const, tool_call_id: `t${i}`, content: i === 3 ? "  " : `r${i}` }]),
      { role: "user", content: "guidance" }];
    const wire = anthropicConversation(messages, { breakpoints: true, trailingTurnMessage: true });
    const marks = JSON.stringify(wire).match(/cache_control/gu) ?? [];
    expect(marks).toHaveLength(4);
    const results = wire.messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(block => block.type === "tool_result");
    expect(results.map(block => [block.tool_use_id, "cache_control" in block, "content" in block])).toEqual([["t1", true, true], ["t2", true, true], ["t3", false, false]]);
    expect(wire.messages.at(-1)).toEqual({ role: "system", content: "guidance" });
  });

  it("sends the guidance as user text when it follows an assistant turn, and merges consecutive assistants and user runs", () => {
    const resumed: GeneralMessage[] = [{ role: "system", content: "S" }, { role: "user", content: "brief" },
      { role: "assistant", content: "[reply not executed]" }, { role: "assistant", content: "  ", tool_calls: [call("t1")] }, { role: "tool", tool_call_id: "t1", content: "ok" },
      { role: "user", content: "steer" }, { role: "assistant", content: "thinking aloud" }, { role: "user", content: "guidance" }];
    const wire = anthropicConversation(resumed, { breakpoints: false, trailingTurnMessage: true });
    expect(wire.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "brief" }] },
      { role: "assistant", content: [{ type: "text", text: "[reply not executed]" }, { type: "tool_use", id: "t1", name: "execute", input: { command: "ls" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }, { type: "text", text: "steer" }] },
      { role: "assistant", content: [{ type: "text", text: "thinking aloud" }] },
      { role: "user", content: [{ type: "text", text: "guidance" }] },
    ]);
  });

  it.each<[string, GeneralMessage[], boolean]>([
    ["a system message after the first", [{ role: "system", content: "S" }, { role: "user", content: "u" }, { role: "system", content: "late" }], false],
    ["whitespace-only user text", [{ role: "user", content: " \n" }], false],
    ["a tool result after user text in one turn", [{ role: "user", content: "u" }, { role: "assistant", content: null, tool_calls: [call("t1")] }, { role: "user", content: "x" }, { role: "tool", tool_call_id: "t1", content: "r" }], false],
    ["a tool_use with no result", [{ role: "user", content: "u" }, { role: "assistant", content: null, tool_calls: [call("t1")] }, { role: "user", content: "guidance" }], true],
    ["a result with no tool_use", [{ role: "user", content: "u" }, { role: "assistant", content: "a" }, { role: "tool", tool_call_id: "t9", content: "r" }], false],
    ["an assistant with neither text nor calls", [{ role: "user", content: "u" }, { role: "assistant", content: "  " }, { role: "user", content: "g" }], true],
    ["arguments that are not an object", [{ role: "user", content: "u" }, { role: "assistant", content: null, tool_calls: [call("t1", "[1]")] }, { role: "tool", tool_call_id: "t1", content: "r" }], false],
    ["invalid JSON arguments", [{ role: "user", content: "u" }, { role: "assistant", content: null, tool_calls: [call("t1", "{")] }, { role: "tool", tool_call_id: "t1", content: "r" }], false],
    ["a history that starts with the assistant", [{ role: "assistant", content: "a" }, { role: "user", content: "u" }], false],
    ["a history that ends on an assistant turn (a prefill)", [{ role: "user", content: "u" }, { role: "assistant", content: "a" }], false],
    ["the trailing option on a final tool result", [{ role: "user", content: "u" }, { role: "assistant", content: null, tool_calls: [call("t1")] }, { role: "tool", tool_call_id: "t1", content: "r" }], true],
  ])("refuses %s before dispatch", (_name, messages, trailingTurnMessage) => {
    expect(() => anthropicConversation(messages, { breakpoints: true, trailingTurnMessage })).toThrow("private_model_message_invalid");
  });

  it("refuses a body over the heavy profile's 640 KiB cap before any request", async () => {
    const f = fixture(() => reply([{ type: "text", text: "x" }]), { ...config, maxRequestBytes: heavy.maxRequestBytes });
    const error = await f.model.complete([{ role: "system", content: "S" }, { role: "user", content: "x".repeat(heavy.maxRequestBytes) }], [], new AbortController().signal).catch(caught => caught);
    expect(error).toBeInstanceOf(ModelRequestBodyTooLarge); expect(error.limitBytes).toBe(heavy.maxRequestBytes);
    expect(f.request).not.toHaveBeenCalled();
  });

  it("refuses a tool-less call over a history with tool blocks, and disabled thinking, before any request", async () => {
    const f = fixture(() => reply([{ type: "text", text: "x" }]));
    await expect(f.model.complete(layout2.slice(0, 4).concat([{ role: "user", content: "g" }]), [], new AbortController().signal)).rejects.toThrow("private_model_message_invalid");
    await expect(f.model.complete([{ role: "user", content: "judge" }], [], new AbortController().signal, { thinking: "disabled", maxOutputTokens: 256 })).rejects.toThrow("private_model_thinking_unsupported");
    expect(f.request).not.toHaveBeenCalled();
    for (const bad of [{ thinking: "disabled" as const }, { sampling: { temperature: 1, top_p: 1, top_k: 1 } }, { promptCaching: "responses_explicit_v1" as const }, { streaming: true }]) {
      expect(() => new PrivateAgentModel({} as PrivateAgentBroker, { ...config, ...bad }, "job", "context")).toThrow("private_model_configuration_invalid");
    }
    expect(() => new PrivateAgentModel({} as PrivateAgentBroker, { ...config, api: "openai_responses" }, "job", "context")).toThrow("private_model_configuration_invalid");
  });
});

describe("Anthropic Messages reply decoding and settlement", () => {
  it("returns text and the tool call, drops thinking blocks, maps the stop reasons and records thinking tokens", async () => {
    const f = fixture(() => reply([{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "Running." },
      { type: "tool_use", id: "toolu_9", name: "execute", input: { command: "ls" } }], { stop_reason: "tool_use",
      usage: usage({ output_tokens_details: { thinking_tokens: 12 } }) }));
    const result = await f.model.complete(layout2, [tool], new AbortController().signal, { trailingTurnMessage: true });
    expect(result).toMatchObject({ content: "Running.", finishReason: "tool_calls", servedModel: "claude-sonnet-5-5",
      toolCalls: [{ id: "toolu_9", type: "function", function: { name: "execute", arguments: "{\"command\":\"ls\"}" } }], usage: { thinkingTokens: 12 } });
    for (const [stop, expected] of [["max_tokens", "length"], ["refusal", "content_filter"], ["end_turn", "stop"], ["pause_turn", "pause_turn"]] as const) {
      const g = fixture(() => reply([{ type: "redacted_thinking", data: "x" }, { type: "text", text: " \n " }], { stop_reason: stop }));
      const answer = await g.model.complete([{ role: "user", content: "q" }], [], new AbortController().signal);
      expect(answer).toMatchObject({ content: "", finishReason: expected }); expect(answer.usage).not.toHaveProperty("thinkingTokens");
    }
    // A cut reply keeps its calls for the runner's audit (which never runs them); any other non-tool stop drops them.
    for (const stop of ["max_tokens", "model_context_window_exceeded"]) {
      const cut = fixture(() => reply([{ type: "tool_use", id: "toolu_1", name: "execute", input: {} }], { stop_reason: stop }));
      expect(await cut.model.complete([{ role: "user", content: "q" }], [tool], new AbortController().signal)).toMatchObject({ finishReason: "length", toolCalls: [{ id: "toolu_1" }] });
    }
    for (const [stop, expected] of [["refusal", "content_filter"], ["end_turn", "stop"], ["pause_turn", "pause_turn"]] as const) {
      const odd = fixture(() => reply([{ type: "text", text: "partial" }, { type: "tool_use", id: "toolu_1", name: "execute", input: { command: "rm" } }], { stop_reason: stop }));
      expect(await odd.model.complete([{ role: "user", content: "q" }], [tool], new AbortController().signal)).toMatchObject({ finishReason: expected, toolCalls: [], content: "partial" });
    }
  });

  it("settles a reply that both writes and reads at the published rates within the reservation", async () => {
    const big: GeneralMessage[] = [{ role: "system", content: "S" }, { role: "user", content: "x".repeat(100_000) }];
    const f = fixture(() => reply([{ type: "text", text: "ok" }], { usage: usage({ input_tokens: 1000, cache_creation_input_tokens: 3000, cache_read_input_tokens: 20_000, output_tokens: 500 }) }));
    const result = await f.model.complete(big, [], new AbortController().signal);
    expect(f.fees[0]).toBe(1000 * 2 + 3000 * 2.5 + 20_000 * 0.1 + 500 * 10);
    expect(f.fees[0]).toBe(16_500);
    expect(f.requests[0]!.maxFeeMicrousd).toBe(Math.ceil(Buffer.byteLength(f.requests[0]!.body) * 2.5 + 16_384 * 10));
    expect(result.usage).toMatchObject({ inputTokens: 24_000, cacheReadTokens: 20_000, cacheWriteTokens: 3000, outputTokens: 500 });
  });

  it("counts cache reads and writes inside the prompt envelope", async () => {
    const f = fixture(body => reply([{ type: "text", text: "ok" }], { usage: usage({ input_tokens: 100, cache_read_input_tokens: Buffer.byteLength(body) - 99 }) }));
    await expect(f.model.complete([{ role: "user", content: "q" }], [], new AbortController().signal)).rejects.toThrow("model_usage_outside_envelope");
    const nulls = fixture(() => reply([{ type: "text", text: "ok" }], { usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null, cache_creation: null } }));
    expect((await nulls.model.complete([{ role: "user", content: "q" }], [], new AbortController().signal)).usage).toMatchObject({ inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const inner = fixture(() => reply([{ type: "text", text: "ok" }], { usage: usage({ cache_creation: { ephemeral_5m_input_tokens: null, ephemeral_1h_input_tokens: null },
      output_tokens_details: { thinking_tokens: null } }) }));
    const answer = await inner.model.complete([{ role: "user", content: "q" }], [], new AbortController().signal);
    expect(answer.content).toBe("ok"); expect(answer.usage).not.toHaveProperty("thinkingTokens");
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["another served model", { model: "claude-sonnet-5" }, "model_served_mismatch"],
    ["the priority tier", { usage: usage({ service_tier: "priority" }) }, "model_service_tier_mismatch"],
    ["US-only inference", { usage: usage({ inference_geo: "us" }) }, "model_inference_geo_mismatch"],
    ["fast mode", { usage: usage({ speed: "fast" }) }, "model_speed_mismatch"],
    ["a 1-hour cache write", { usage: usage({ cache_creation_input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 5 } }) }, "model_cache_ttl_mismatch"],
    ["an unknown block type", { content: [{ type: "server_tool_use", id: "x" }] }, "invalid_union"],
    ["more than eight calls", { content: Array.from({ length: 9 }, (_, i) => ({ type: "tool_use", id: `t${i}`, name: "execute", input: {} })) }, "private_model_response_invalid"],
    ["a tool input that is not an object", { content: [{ type: "tool_use", id: "t", name: "execute", input: [1] }] }, "private_model_response_invalid"],
    ["a NUL in a tool input", { content: [{ type: "tool_use", id: "t", name: "execute", input: { command: "a\u0000b" } }] }, "private_model_response_invalid"],
  ])("refuses %s inside settlement", async (_name, extra, message) => {
    const f = fixture(() => reply([{ type: "text", text: "x" }], extra));
    await expect(f.model.complete([{ role: "user", content: "q" }], [tool], new AbortController().signal)).rejects.toThrow(message);
  });

  it("adds no thinking field to the usage of an existing shape", async () => {
    const responses: PrivateModelConfig = { destinationId: "cloud", model: "gpt-6-sol", api: "openai_responses", maxOutputTokens: 4096, inputUsdPerMillion: 2, outputUsdPerMillion: 10, thinking: "medium" };
    const f = fixture(() => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }],
      usage: { input_tokens: 10, output_tokens: 5, output_tokens_details: { reasoning_tokens: 3 } } }), responses);
    const result = await f.model.complete([{ role: "user", content: "q" }], [], new AbortController().signal);
    expect(Object.keys(result.usage!).sort()).toEqual(["cacheReadTokens", "cacheWriteTokens", "inputTokens", "outputTokens", "totalTokens"]);
    const vllm: PrivateModelConfig = { destinationId: "local", model: "local", maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium" };
    const g = fixture(() => ({ model: "local", choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), vllm);
    const local = await g.model.complete([{ role: "user", content: "q" }], [], new AbortController().signal, { trailingTurnMessage: true });
    expect(Object.keys(local.usage!).sort()).toEqual(["cacheReadTokens", "cacheWriteTokens", "inputTokens", "outputTokens", "totalTokens"]);
  });

  it("accepts the documented reporting values that do not change the price", async () => {
    const f = fixture(() => reply([{ type: "text", text: "x" }], { usage: { input_tokens: 5, output_tokens: 1, service_tier: null, inference_geo: "global", speed: "standard",
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, server_tool_use: null } }));
    expect((await f.model.complete([{ role: "user", content: "q" }], [], new AbortController().signal)).content).toBe("x");
  });
});

describe("the driver's Claude cloud arm", () => {
  const input = { model: "claude-sonnet-5-5", endpoint: ANTHROPIC_MESSAGES_ENDPOINT, prices: { input: 2, output: 10, cached: 0.1, write: 2.5 }, maxFeeUsd: 3, proxyFakeIp: true as const };
  const environment = { SOAR_CLAUDE_CLOUD_API_KEY: "sk-ant-test-0001", SOAR_CLAUDE_CLOUD_CREDENTIAL_VERSION: "2" };

  it("builds the destination and freeze from the Claude variables only, with the fixed version, 5-minute caching and no long-context tier", () => {
    const arm = buildCloudArm(input, environment, heavy);
    expect(arm.destination).toEqual({ id: "cloud_coordinator", kind: "cloud_model", endpoint: ANTHROPIC_MESSAGES_ENDPOINT, apiKey: "sk-ant-test-0001",
      accountId: "owner_anthropic_account", credentialVersion: 2, privateDataAdmitted: false, syntheticOnly: true, grantFreeSynthetic: true,
      maxResponseBytes: 512 * 1024, timeoutMs: 600_000, maxRequestBytes: heavy.maxRequestBytes, proxyFakeIp: true, anthropicVersion: ANTHROPIC_API_VERSION });
    expect(arm.modelConfig).toEqual({ destinationId: "cloud_coordinator", model: "claude-sonnet-5-5", api: "anthropic_messages", maxOutputTokens: heavy.maxOutputTokens,
      thinking: "medium", inputUsdPerMillion: 2, outputUsdPerMillion: 10, cachedInputUsdPerMillion: 0.1, cacheWriteUsdPerMillion: 2.5, maxRequestBytes: heavy.maxRequestBytes,
      promptCaching: "anthropic_explicit_5m_v1" });
    expect(arm.freeze).toMatchObject({ arm: "cloud", accountId: "owner_anthropic_account", credentialVersion: 2, maxFeeMicrousd: 3_000_000, proxyFakeIp: true,
      anthropicVersion: ANTHROPIC_API_VERSION, modelConfig: arm.modelConfig });
    expect(JSON.stringify(arm.freeze)).not.toContain("sk-ant");
    expect(buildCloudArm({ ...input, prices: { input: 2, output: 10, cached: 0.1 } }, environment, heavy).modelConfig.cacheWriteUsdPerMillion).toBe(2.5);
  });

  it("takes the Claude account and credential version from their own variables only", () => {
    const key = { SOAR_CLAUDE_CLOUD_API_KEY: "sk-ant-test-0001" };
    expect(buildCloudArm(input, { ...key, SOAR_PHASE2_CLOUD_CREDENTIAL_VERSION: "7", SOAR_PHASE2_CLOUD_ACCOUNT_ID: "openai_account" }, heavy).destination)
      .toMatchObject({ credentialVersion: 1, accountId: "owner_anthropic_account" });
    expect(buildCloudArm(input, { ...key, SOAR_CLAUDE_CLOUD_CREDENTIAL_VERSION: "4", SOAR_CLAUDE_CLOUD_ACCOUNT_ID: "owner_claude_two" }, heavy).freeze)
      .toMatchObject({ credentialVersion: 4, accountId: "owner_claude_two" });
  });

  it("never reads the OpenAI key for Claude or the Claude key for OpenAI, and pins the host and the heavy thinking", () => {
    expect(() => buildCloudArm(input, { SOAR_PHASE2_CLOUD_API_KEY: "sk-oai-test-0001" }, heavy)).toThrow("local_screen_cloud_key_missing");
    expect(() => buildCloudArm({ ...input, endpoint: "https://api.openai.com/v1/responses" }, environment, heavy)).toThrow("local_screen_cloud_key_missing");
    expect(() => buildCloudArm({ ...input, endpoint: "https://proxy.example.test/v1/messages" }, environment, heavy)).toThrow("local_screen_cloud_arm_invalid");
    expect(() => buildCloudArm(input, environment, COORDINATOR_PROFILES.standard)).toThrow("local_screen_cloud_arm_invalid");
  });

  const base = ["--execute-synthetic-local", "--task-directory", "t", "--job-sha256", "a".repeat(64), "--brief-sha256", "b".repeat(64), "--authority-sha256", "c".repeat(64),
    "--image-id", `sha256:${"d".repeat(64)}`, "--output-directory", "o", "--runtime-sha256", "e".repeat(64), "--claims-ledger", "true"];
  const claude = ["--arm", "cloud", "--cloud-model", "claude-sonnet-5-5", "--cloud-endpoint", ANTHROPIC_MESSAGES_ENDPOINT, "--cloud-prices", "2,10,0.1,2.5", "--proxy-fake-ip", "true"];

  it("parses the H5 Claude flags without a long-context tier on both arms and refuses the standard profile", () => {
    const all = parseLocalArtifactScreenArguments([...base, "--profile", "heavy", ...claude, "--max-fee-usd", "3"]);
    expect(all.cloudArm).toEqual({ model: "claude-sonnet-5-5", endpoint: ANTHROPIC_MESSAGES_ENDPOINT, prices: { input: 2, output: 10, cached: 0.1, write: 2.5 }, maxFeeUsd: 3, proxyFakeIp: true });
    expect(parseLocalArtifactScreenArguments([...base, "--profile", "heavy", "--pipeline", "research", ...claude, "--max-fee-usd", "0.6"]).cloudArm?.endpoint).toBe(ANTHROPIC_MESSAGES_ENDPOINT);
    expect(() => parseLocalArtifactScreenArguments([...base, ...claude, "--max-fee-usd", "3"])).toThrow("local_screen_cli_invalid");
    expect(() => parseLocalArtifactScreenArguments([...base, "--profile", "standard", ...claude, "--max-fee-usd", "3"])).toThrow("local_screen_cli_invalid");
    expect(() => parseLocalArtifactScreenArguments([...base, "--profile", "heavy", "--pipeline", "research", ...claude, "--max-fee-usd", "0.7"])).toThrow("local_screen_cli_invalid");
    const other = claude.map(value => value === ANTHROPIC_MESSAGES_ENDPOINT ? "https://proxy.example.test/v1/messages" : value);
    expect(() => parseLocalArtifactScreenArguments([...base, "--profile", "heavy", "--pipeline", "research", ...other, "--max-fee-usd", "0.6"])).toThrow("local_screen_cli_invalid");
    expect(() => parseLocalArtifactScreenArguments([...base, "--profile", "heavy", ...other, "--max-fee-usd", "3"])).toThrow("local_screen_cli_invalid");
    const openai = ["--arm", "cloud", "--cloud-model", "gpt-6-sol", "--cloud-endpoint", "https://api.openai.com/v1/responses", "--cloud-prices", "2,10,0.2,2.5", "--max-fee-usd", "2.5"];
    expect(() => parseLocalArtifactScreenArguments([...base, "--profile", "heavy", ...openai])).toThrow("local_screen_cli_invalid");
    expect(parseLocalArtifactScreenArguments([...base, "--profile", "heavy", ...openai, "--cloud-long-context", "272000,4,15,0.4,5"]).cloudArm?.longContext).toMatchObject({ aboveTokens: 272000 });
  });
});
