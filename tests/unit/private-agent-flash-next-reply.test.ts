import { describe, expect, it, vi } from "vitest";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical } from "../../src/main/private-agent/contracts";
import { inspectFlashNextReply, validateFlashNextRequest, type FlashNextReplyContract } from "../../src/main/private-agent/flash-next-reply";
import { modelIdentity, PrivateAgentModel, vllmCacheSalt, type PrivateModelConfig } from "../../src/main/private-agent/model";

const contract: FlashNextReplyContract = { version: "flash_next_v1", model: "qualified-flash", thinking: "medium" };
const reply = (message: Record<string, unknown>, model: unknown = contract.model) => Buffer.from(JSON.stringify({ model,
  choices: [{ message, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
const chunk = (delta: Record<string, unknown>, finish: string | null = null, model: unknown = contract.model) => ({ model,
  choices: [{ index: 0, delta, finish_reason: finish }] });
const sse = (...chunks: unknown[]) => Buffer.from(chunks.map(value => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n");

describe("explicit Flash-Next raw reply contract", () => {
  it.each(["reasoning", "reasoning_content"] as const)("accepts %s without returning its text", field => {
    const evidence = inspectFlashNextReply(reply({ content: "answer", [field]: "transient secret é" }), "json", contract);
    expect(evidence).toEqual({ contract: "flash_next_v1", format: "json", reasoningField: field, reasoningBytes: Buffer.byteLength("transient secret é") });
    expect(JSON.stringify(evidence)).not.toContain("transient secret");
    expect(Object.isFrozen(evidence)).toBe(true);
  });
  it("accepts absent, null and empty reasoning without treating that as positive thinking evidence", () => {
    for (const fields of [{}, { reasoning: null, reasoning_content: "" }]) {
      expect(inspectFlashNextReply(reply({ content: "answer", ...fields }), "json", contract)).toMatchObject({ reasoningField: "none", reasoningBytes: 0 });
    }
  });
  it.each([
    { reasoning: 1 }, { reasoning: {} }, { reasoning_content: [] }, { reasoning: "a", reasoning_content: "a" },
  ])("refuses malformed or ambiguous reasoning %j", fields => {
    expect(() => inspectFlashNextReply(reply({ content: "answer", ...fields }), "json", contract)).toThrow();
  });
  it("refuses thinking-off leakage and leading protocol wrappers, while preserving embedded literal tags", () => {
    const off = { ...contract, thinking: "disabled" as const };
    expect(() => inspectFlashNextReply(reply({ content: "answer", reasoning_content: "hidden" }), "json", off)).toThrow();
    for (const content of ["<think>leak</think>answer", "  </think>answer", "I should calculate this first.\n</think>\n42"]) {
      expect(() => inspectFlashNextReply(reply({ content }), "json", off)).toThrow();
    }
    expect(inspectFlashNextReply(reply({ content: 'Example: "<think>literal</think>"' }), "json", off).reasoningBytes).toBe(0);
    for (const content of ['{"quotes":[{"quote":"The token </think> closes the section."}]}', 'Example: `</think>` is literal.', 'Example:\n```html\n</think>\n```']) {
      expect(inspectFlashNextReply(reply({ content }), "json", off).reasoningBytes).toBe(0);
    }
    expect(() => inspectFlashNextReply(reply({ content: 'Example: `</think>` is literal.\n</think>\n42' }), "json", off)).toThrow();
  });
  it("requires the configured alias and strict UTF-8 in the original JSON", () => {
    for (const model of ["other", null, 5]) expect(() => inspectFlashNextReply(reply({ content: "ok" }, model), "json", contract)).toThrow();
    expect(() => inspectFlashNextReply(Buffer.from('{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}'), "json", contract)).toThrow();
    expect(() => inspectFlashNextReply(Buffer.concat([reply({ content: "ok" }).subarray(0, 5), Buffer.from([0xff])]), "json", contract)).toThrow();
  });
  it("inspects every raw SSE delta before reasoning is discarded and allows usage without a model", () => {
    const raw = sse(chunk({ reasoning: "one" }), chunk({ reasoning: "two" }), chunk({ content: "answer" }, "stop"), { choices: [], usage: { prompt_tokens: 1, completion_tokens: 3 } });
    expect(inspectFlashNextReply(raw, "sse", contract)).toMatchObject({ format: "sse", reasoningField: "reasoning", reasoningBytes: 6 });
    for (const bad of [
      sse(chunk({ reasoning: "one" }), chunk({ reasoning_content: "two" }), chunk({}, "stop")),
      sse(chunk({ content: "answer" }, "stop"), chunk({ reasoning: "late" })),
      sse(chunk({ content: "answer" }), chunk({}, "stop", "other")),
      sse({ choices: [{ index: 0, delta: { content: "answer" }, finish_reason: "stop" }] }),
      sse(chunk({ reasoning_content: false })),
      sse(chunk({ content: "<thi" }), chunk({ content: "nk>leak" }, "stop")),
      sse(chunk({ tool_calls: [{ index: 0, function: { arguments: 8 } }] }, "tool_calls")),
    ]) expect(() => inspectFlashNextReply(bad, "sse", contract)).toThrow();
    expect(() => inspectFlashNextReply(raw, "sse", { ...contract, thinking: "disabled" })).toThrow();
  });
  it("binds the fixed validator to the actual model and explicit template flags", () => {
    const body = { model: contract.model, reasoning_effort: "medium", chat_template_kwargs: { enable_thinking: true, preserve_thinking: false } };
    expect(() => validateFlashNextRequest(contract, JSON.stringify(body))).not.toThrow();
    for (const changed of [{ ...body, model: "other" }, { ...body, chat_template_kwargs: { enable_thinking: true } },
      { ...body, chat_template_kwargs: { enable_thinking: false, preserve_thinking: false } }]) {
      expect(() => validateFlashNextRequest(contract, JSON.stringify(changed))).toThrow();
    }
  });
});

describe("Flash-Next model request opt-in", () => {
  const base: PrivateModelConfig = { destinationId: "local", model: contract.model, maxOutputTokens: 16384, inputUsdPerMillion: 0, outputUsdPerMillion: 0,
    thinking: "medium", sampling: { temperature: 1, top_p: .95, top_k: 20 }, promptCaching: "vllm_job_salt_v1" };
  it("sets both template flags for Heavy and the narrowed judge, preserving limits/sampling/salt and only counts in results", async () => {
    const requests: Record<string, unknown>[] = [];
    const evidence = { contract: "flash_next_v1" as const, format: "json" as const, reasoningField: "reasoning" as const, reasoningBytes: 7 };
    const request = vi.fn(async (input, settle) => {
      requests.push(input);
      const bytes = reply({ content: "answer" });
      return { bytes, receipt: { feeMicrousd: settle(bytes) }, localReplyEvidence: evidence };
    });
    const model = new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, { ...base, localReplyContract: "flash_next_v1", localContextTokens: 262144 }, "job", "context");
    const tool = { type: "function" as const, function: { name: "calculate", description: "d", parameters: { type: "object" } } };
    expect((await model.complete([{ role: "user", content: "turn" }], [tool], new AbortController().signal)).localReplyEvidence).toEqual(evidence);
    expect(JSON.parse(requests[0]!.body as string)).toMatchObject({ max_tokens: 16384, temperature: 1, top_p: .95, top_k: 20, reasoning_effort: "medium",
      tools: [tool], tool_choice: "auto", parallel_tool_calls: false, cache_salt: vllmCacheSalt("job"), chat_template_kwargs: { enable_thinking: true, preserve_thinking: false } });
    expect(requests[0]!.localReplyContract).toEqual(contract);
    await model.complete([{ role: "user", content: "judge" }], [], new AbortController().signal, { thinking: "disabled", maxOutputTokens: 256 });
    const judge = JSON.parse(requests[1]!.body as string);
    expect(judge).toMatchObject({ max_tokens: 256, cache_salt: vllmCacheSalt("job"), chat_template_kwargs: { enable_thinking: false, preserve_thinking: false } });
    for (const key of ["tools", "tool_choice", "parallel_tool_calls", "reasoning_effort", "temperature", "top_p", "top_k"]) expect(judge).not.toHaveProperty(key);
    expect(requests[1]!.localReplyContract).toEqual({ ...contract, thinking: "disabled" });
  });
  it("keeps legacy request bytes and identity unchanged, and binds only an explicit opt-in", async () => {
    const requests: Record<string, unknown>[] = [];
    const request = vi.fn(async (input, settle) => { requests.push(input); const bytes = reply({ content: "answer" }); return { bytes, receipt: { feeMicrousd: settle(bytes) } }; });
    await new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, base, "job", "context").complete([{ role: "user", content: "turn" }], [], new AbortController().signal);
    expect(requests[0]!.body).toBe(canonical({ model: contract.model, messages: [{ role: "user", content: "turn" }], stream: false, max_tokens: 16384,
      reasoning_effort: "medium", temperature: 1, top_p: .95, top_k: 20, cache_salt: vllmCacheSalt("job") }));
    expect(requests[0]).not.toHaveProperty("localReplyContract");
    expect(modelIdentity(base)).toEqual(base);
    expect(modelIdentity({ ...base, localReplyContract: "flash_next_v1", localContextTokens: 262144 })).toMatchObject({ localReplyContract: "flash_next_v1", localContextTokens: 262144 });
    for (const invalid of [{ api: "openai" }, { inputUsdPerMillion: 1 }, { localReplyContract: "unknown" }]) {
      expect(() => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, { ...base, localReplyContract: "flash_next_v1", localContextTokens: 262144, ...invalid } as PrivateModelConfig, "job", "context")).toThrow("private_model_configuration_invalid");
    }
  });
  it("requires a safe pinned context capacity only for the Flash contract", () => {
    for (const localContextTokens of [undefined, 0, -1, 16384, 262144.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new PrivateAgentModel({} as PrivateAgentBroker, { ...base, localReplyContract: "flash_next_v1", localContextTokens }, "job", "context")).toThrow("private_model_configuration_invalid");
    }
    expect(() => new PrivateAgentModel({} as PrivateAgentBroker, { ...base, localContextTokens: 262144 }, "job", "context")).toThrow("private_model_configuration_invalid");
  });
  it("admits valid Flash token counts above raw body bytes and binds usage to context minus actual output reservation", async () => {
    let prompt = 0, completion = 1, bodyBytes = 0;
    const request = vi.fn(async (input, settle) => {
      bodyBytes = Buffer.byteLength(input.body);
      const bytes = Buffer.from(JSON.stringify({ model: contract.model, choices: [{ message: { content: "answer" }, finish_reason: "stop" }],
        usage: { prompt_tokens: prompt || bodyBytes + 1, completion_tokens: completion } }));
      return { bytes, receipt: { feeMicrousd: settle(bytes) } };
    });
    const model = new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, { ...base, localReplyContract: "flash_next_v1", localContextTokens: 262144 }, "job", "context");
    const send = (maxOutputTokens?: number) => model.complete([{ role: "user", content: "\u{1D160}".repeat(10) }], [], new AbortController().signal,
      maxOutputTokens === undefined ? undefined : { thinking: "disabled", maxOutputTokens });
    expect((await send()).usage!.inputTokens).toBeGreaterThan(bodyBytes);
    prompt = 262144 - 16384; expect((await send()).usage!.inputTokens).toBe(prompt);
    prompt++; await expect(send()).rejects.toThrow("model_usage_outside_envelope");
    prompt = 262144 - 256; expect((await send(256)).usage!.inputTokens).toBe(prompt);
    prompt++; await expect(send(256)).rejects.toThrow("model_usage_outside_envelope");
    prompt = 1; completion = 257; await expect(send(256)).rejects.toThrow("model_usage_outside_envelope");
    expect(request.mock.calls.every(([input]) => input.maxFeeMicrousd === 0)).toBe(true);
    const legacy = new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, base, "job", "context");
    prompt = 0; completion = 1;
    await expect(legacy.complete([{ role: "user", content: "\u{1D160}" }], [], new AbortController().signal)).rejects.toThrow("model_usage_outside_envelope");
  });
});
