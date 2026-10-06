import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BROKER_MAX_BODY_BYTES, type PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { digest } from "../../src/main/private-agent/contracts";
import { MAX_MODEL_OUTPUT_TOKENS, PrivateAgentModel, ModelRequestBodyTooLarge, modelRequestSizeStop, hasInvalidModelRequestSizeStop } from "../../src/main/private-agent/model";

describe("model request size before dispatch", () => {
  it("admits exactly the UTF-8 byte cap and rejects one byte over without calling the broker", async () => {
    const bodies: string[] = [];
    const request = vi.fn(async (input, settle) => {
      bodies.push(input.body);
      const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      return { bytes, receipt: { feeMicrousd: settle(bytes) } };
    });
    const model = new PrivateAgentModel({ request } as unknown as PrivateAgentBroker,
      { destinationId: "fixture", model: "synthetic", maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" }, "job", "context");
    const send = (content: string) => model.complete([{ role: "user", content }], [], new AbortController().signal);
    await send("");
    const capacity = BROKER_MAX_BODY_BYTES - Buffer.byteLength(bodies[0]!);
    const atLimit = "é".repeat(Math.floor(capacity / 2)) + "x".repeat(capacity % 2);
    await send(atLimit);
    expect(Buffer.byteLength(bodies[1]!)).toBe(BROKER_MAX_BODY_BYTES);
    await expect(send(`${atLimit}x`)).rejects.toMatchObject({ bodyBytes: BROKER_MAX_BODY_BYTES + 1, limitBytes: BROKER_MAX_BODY_BYTES, message: "request_body_size_exceeded" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(() => new ModelRequestBodyTooLarge(BROKER_MAX_BODY_BYTES)).toThrow("model_request_size_error_invalid");
  });

  it("omits the tool fields for a tool-less call and lets host overrides only narrow the request", async () => {
    const requests: { body: string; purpose: string }[] = [];
    const request = vi.fn(async (input, settle) => {
      requests.push({ body: input.body, purpose: input.purpose });
      const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: '{"verdict":"supported"}' }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      return { bytes, receipt: { feeMicrousd: settle(bytes) } };
    });
    const heavy = new PrivateAgentModel({ request } as unknown as PrivateAgentBroker,
      { destinationId: "fixture", model: "synthetic", maxOutputTokens: 16_384, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium", sampling: { temperature: 1, top_p: 0.95, top_k: 20 } }, "job", "context");
    const tool = { type: "function" as const, function: { name: "finish", description: "d", parameters: { type: "object", properties: {} } } };
    await heavy.complete([{ role: "user", content: "agent turn" }], [tool], new AbortController().signal);
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ tools: [tool], tool_choice: "auto", parallel_tool_calls: false, max_tokens: 16_384, reasoning_effort: "medium" });
    expect(requests[0]!.purpose).toBe("agent reasoning and tool selection");
    // The judge: no tools at all (an empty array is rejected upstream), thinking off, a short reply, its own purpose; the override cannot widen the output limit.
    await heavy.complete([{ role: "user", content: "judge" }], [], new AbortController().signal, { thinking: "disabled", maxOutputTokens: 256, purpose: "claims entailment judgement" });
    const judge = JSON.parse(requests[1]!.body);
    expect(judge).not.toHaveProperty("tools"); expect(judge).not.toHaveProperty("tool_choice"); expect(judge).not.toHaveProperty("parallel_tool_calls");
    expect(judge).toMatchObject({ max_tokens: 256, chat_template_kwargs: { enable_thinking: false } }); expect(judge).not.toHaveProperty("reasoning_effort");
    expect(requests[1]!.purpose).toBe("claims entailment judgement");
    await heavy.complete([{ role: "user", content: "judge" }], [], new AbortController().signal, { thinking: "disabled", maxOutputTokens: 1_000_000 });
    expect(JSON.parse(requests[2]!.body).max_tokens).toBe(16_384);
  });

  it("accepts a larger profile output limit up to the adapter ceiling and requests thinking when enabled", async () => {
    const bodies: string[] = [];
    const request = vi.fn(async (input, settle) => {
      bodies.push(input.body);
      const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      return { bytes, receipt: { feeMicrousd: settle(bytes) } };
    });
    const config = { destinationId: "fixture", model: "synthetic", inputUsdPerMillion: 0, outputUsdPerMillion: 0 };
    const heavy = new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, { ...config, maxOutputTokens: 8192, thinking: "medium" }, "job", "context");
    await heavy.complete([{ role: "user", content: "synthetic" }], [], new AbortController().signal);
    expect(JSON.parse(bodies[0]!)).toMatchObject({ max_tokens: 8192, reasoning_effort: "medium" });
    expect(JSON.parse(bodies[0]!)).not.toHaveProperty("chat_template_kwargs");
    expect(() => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker,
      { ...config, maxOutputTokens: MAX_MODEL_OUTPUT_TOKENS + 1, thinking: "disabled" }, "job", "context")).toThrow("private_model_configuration_invalid");
    const sampled = new PrivateAgentModel({ request } as unknown as PrivateAgentBroker,
      { ...config, maxOutputTokens: 16_384, thinking: "medium", maxRequestBytes: 640 * 1024, sampling: { temperature: 1, top_p: 0.95, top_k: 20 } }, "job", "context");
    await sampled.complete([{ role: "user", content: "synthetic" }], [], new AbortController().signal);
    expect(JSON.parse(bodies[1]!)).toMatchObject({ max_tokens: 16_384, reasoning_effort: "medium", temperature: 1, top_p: 0.95, top_k: 20 });
    const big = "x".repeat(640 * 1024);
    await expect(sampled.complete([{ role: "user", content: big }], [], new AbortController().signal))
      .rejects.toMatchObject({ limitBytes: 640 * 1024, message: "request_body_size_exceeded" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(() => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker,
      { ...config, maxOutputTokens: 4096, thinking: "disabled", maxRequestBytes: 5 * 1024 * 1024 }, "job", "context")).toThrow("private_model_configuration_invalid");
  });

  it("does not relabel invalid text or an ordinary broker error as the typed size stop", async () => {
    const request = vi.fn(async () => { throw new Error("transport_or_settlement_unknown"); });
    const model = new PrivateAgentModel({ request } as unknown as PrivateAgentBroker,
      { destinationId: "fixture", model: "synthetic", maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" }, "job", "context");
    await expect(model.complete([{ role: "user", content: "\0" }], [], new AbortController().signal)).rejects.toThrow("private_agent_invalid_text");
    expect(request).not.toHaveBeenCalled();
    await expect(model.complete([{ role: "user", content: "synthetic" }], [], new AbortController().signal)).rejects.toThrow("transport_or_settlement_unknown");
  });

  it("requires one strictly validated marker after its exact operation/context/protocol start", () => {
    const start = { type: "model_started", operationId: randomUUID(), contextId: "context", promptProtocolSha256: digest("protocol") };
    const marker = { ...start, type: "model_request_not_dispatched", reason: "request_body_size_exceeded", dispatched: false, bodyBytes: BROKER_MAX_BODY_BYTES + 1, limitBytes: BROKER_MAX_BODY_BYTES };
    expect(modelRequestSizeStop([start, marker], start)).toEqual(marker);
    expect(hasInvalidModelRequestSizeStop([start, marker])).toBe(false);
    for (const events of [
      [start], [marker], [marker, start], [start, marker, marker], [start, start, marker],
      [start, { ...marker, contextId: "other" }], [start, { ...marker, promptProtocolSha256: digest("other") }],
      [start, { ...marker, dispatched: true }], [start, { ...marker, bodyBytes: BROKER_MAX_BODY_BYTES }],
      [start, { ...marker, limitBytes: BROKER_MAX_BODY_BYTES + 1 }], [start, { ...marker, extra: "not admitted" }],
      [start, marker, { ...start, type: "model_finished" }],
    ]) {
      expect(modelRequestSizeStop(events, start)).toBeUndefined();
      expect(hasInvalidModelRequestSizeStop(events)).toBe(events.length !== 1 || events[0] === marker);
    }
  });
});
