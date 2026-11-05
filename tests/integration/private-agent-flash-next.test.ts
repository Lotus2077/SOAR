import Database from "better-sqlite3";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { PrivateAgentBroker, type BrokerRequest } from "../../src/main/private-agent/broker";
import { digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { flashNextAdmissionFixture } from "../helpers/flash-next-admission-fixture";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const modelId = "qualified-flash", secret = "TRANSIENT_REASONING_NEVER_PERSIST";
const usage = { prompt_tokens: 1, completion_tokens: 4 };
const chunk = (delta: Record<string, unknown>, finish: string | null = null, model: unknown = modelId) => ({ model,
  choices: [{ index: 0, delta, finish_reason: finish }] });
const sse = (...chunks: unknown[]) => chunks.map(item => `data: ${JSON.stringify(item)}\n\n`).join("") + "data: [DONE]\n\n";
const json = (message: Record<string, unknown>, model: unknown = modelId) => JSON.stringify({ model, choices: [{ message, finish_reason: "stop" }], usage });

async function fixture(raw: string | Buffer, format: "json" | "sse", thinking: "medium" | "disabled" = "medium", promptTokens = 1) {
  let requests = 0;
  const server = http.createServer((request, response) => {
    request.resume(); request.on("end", () => { requests++; response.writeHead(200, { "content-type": format === "sse" ? "text/event-stream" : "application/json" }); response.end(raw); });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const db = new Database(":memory:"); cleanups.push(() => { db.close(); });
  const store = new PrivateAgentStore(db);
  store.createJob({ id: "job", version: 1, revision: 0, cancelled: false, mode: "private", destinations: ["local"], maxRequests: 10, maxFeeMicrousd: 0 });
  store.createContext({ id: "context", jobId: "job", sources: [{ id: "input", version: digest("synthetic"), classification: "private", synthetic: true }] });
  const destination = { id: "local", kind: "local_model" as const, endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions`,
    // Decoder cases must reach the mock reply even when parallel tests delay synthetic helper process startup.
    accountId: "owned", credentialVersion: 1, privateDataAdmitted: true, loopbackFixture: true, maxResponseBytes: 32768, timeoutMs: 30_000, recoverable: true,
    stream: { inactivityTimeoutMs: 1000, maxRawBytes: 65536 } };
  const admission = flashNextAdmissionFixture({ endpoint: destination.endpoint, model: modelId, promptTokens }); cleanups.push(admission.cleanup);
  const broker = new PrivateAgentBroker(store, [{ ...destination, localTokenAdmissionSha256: admission.descriptor.sha256 }],
    { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) }, { localTokenAdmissions: [admission.admission] });
  const model = new PrivateAgentModel(broker, { destinationId: "local", model: modelId, api: "vllm", localReplyContract: "flash_next_v1", streaming: true,
    maxOutputTokens: 256, localContextTokens: 1024, localTokenAdmissionSha256: admission.descriptor.sha256,
    inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking }, "job", "context");
  return { db, store, broker, model, destination, requests: () => requests,
    complete: (overrides?: { maxOutputTokens?: number }) => model.complete([{ role: "user" as const, content: "synthetic" }], [], new AbortController().signal, overrides) };
}

describe("Flash-Next broker validation before settlement", () => {
  it.each(["json", "sse"] as const)("settles a valid %s reply and returns only counts through the model", async format => {
    const raw = format === "json" ? json({ content: "answer", reasoning_content: secret }) : sse(chunk({ reasoning: secret }), chunk({ content: "answer" }, "stop"), { choices: [], usage });
    const f = await fixture(raw, format), result = await f.complete();
    expect(result.content).toBe("answer"); expect(result).not.toHaveProperty("reasoning"); expect(result).not.toHaveProperty("reasoning_content");
    expect(result.localReplyEvidence).toEqual({ contract: "flash_next_v1", format, reasoningField: format === "json" ? "reasoning_content" : "reasoning", reasoningBytes: secret.length });
    expect(f.store.dispatches("job")).toMatchObject([{ status: "settled", feeMicrousd: 0 }]);
    expect(f.store.dispatches("job")[0]!.localTokenAdmission).toMatchObject({ promptTokens: 1, maxOutputTokens: 256, maxModelLen: 1024, safetyMarginTokens: 0 });
    expect(JSON.stringify([result, f.store.dispatches("job"), f.store.events("job")])).not.toContain(secret);
    expect(f.db.serialize().includes(Buffer.from(secret))).toBe(false); expect(f.requests()).toBe(1);
  });
  it("accepts fragmented native tools and preserves literal tags in arguments", async () => {
    const raw = sse(chunk({ reasoning: secret }), chunk({ tool_calls: [{ index: 0, id: "call-a", type: "function", function: { name: "calculate", arguments: '{"literal":"<think>' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'example</think>"}' } }] }, "tool_calls"), { choices: [], usage });
    const f = await fixture(raw, "sse"), result = await f.complete();
    expect(result.toolCalls).toEqual([{ id: "call-a", type: "function", function: { name: "calculate", arguments: '{"literal":"<think>example</think>"}' } }]);
    expect(f.store.dispatches("job")[0]!.status).toBe("settled");
  });
  it.each(["json", "sse"] as const)("preserves literal closing tags in raw %s JSON-role content", async format => {
    const content = '{"quotes":[{"quote":"The token </think> closes the section."}]}';
    const raw = format === "json" ? json({ content }) : sse(chunk({ content: content.slice(0, 32) }), chunk({ content: content.slice(32) }, "stop"), { choices: [], usage });
    const f = await fixture(raw, format, "disabled"), result = await f.complete();
    expect(result.content).toBe(content); expect(result.localReplyEvidence?.reasoningBytes).toBe(0);
    expect(f.store.dispatches("job")[0]!.status).toBe("settled");
  });
  it.each([256, 128])("settles Flash context boundary using the actual %i output reservation", async maxOutputTokens => {
    const raw = JSON.stringify({ model: modelId, choices: [{ message: { content: "answer" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1024 - maxOutputTokens, completion_tokens: 1 } });
    const f = await fixture(raw, "json", "medium", 1024 - maxOutputTokens);
    expect((await f.complete({ maxOutputTokens })).usage!.inputTokens).toBe(1024 - maxOutputTokens);
    expect(f.store.dispatches("job")[0]!.status).toBe("settled");
  });
  it.each([
    ["JSON wrong alias", "json", json({ content: "answer" }, "different"), "medium"],
    ["JSON missing alias", "json", JSON.stringify({ choices: [{ message: { content: "answer" }, finish_reason: "stop" }], usage }), "medium"],
    ["JSON malformed reasoning", "json", json({ content: "answer", reasoning: 8 }), "medium"],
    ["JSON ambiguous aliases", "json", json({ content: "answer", reasoning: secret, reasoning_content: secret }), "medium"],
    ["JSON off leakage", "json", json({ content: "answer", reasoning_content: secret }), "disabled"],
    ["JSON unpaired closing wrapper", "json", json({ content: "I should calculate this first.\n</think>\n42" }), "disabled"],
    ["JSON absent terminal reason", "json", JSON.stringify({ model: modelId, choices: [{ message: { content: "answer" }, finish_reason: null }], usage }), "medium"],
    ["JSON duplicate native ids", "json", json({ content: null, tool_calls: [1, 2].map(() => ({ id: "same", type: "function", function: { name: "calculate", arguments: "{}" } })) }), "medium"],
    ["JSON over pinned context", "json", JSON.stringify({ model: modelId, choices: [{ message: { content: "answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 769, completion_tokens: 1 } }), "medium"],
    ["JSON prompt usage differs from exact proof", "json", JSON.stringify({ model: modelId, choices: [{ message: { content: "answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1 } }), "medium"],
    ["JSON over output reservation", "json", JSON.stringify({ model: modelId, choices: [{ message: { content: "answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 257 } }), "medium"],
    ["SSE changed alias", "sse", sse(chunk({ reasoning: secret }), chunk({ content: "answer" }, "stop", "different"), { choices: [], usage }), "medium"],
    ["SSE post-finish reasoning", "sse", sse(chunk({ content: "answer" }, "stop"), chunk({ reasoning: secret }), { choices: [], usage }), "medium"],
    ["SSE alias switching", "sse", sse(chunk({ reasoning: secret }), chunk({ reasoning_content: secret }), chunk({ content: "answer" }, "stop"), { choices: [], usage }), "medium"],
    ["SSE off leakage", "sse", sse(chunk({ reasoning: secret }), chunk({ content: "answer" }, "stop"), { choices: [], usage }), "disabled"],
    ["SSE malformed alias", "sse", sse(chunk({ reasoning_content: 8 }), chunk({ content: "answer" }, "stop"), { choices: [], usage }), "medium"],
    ["SSE split inline wrapper", "sse", sse(chunk({ content: "<thi" }), chunk({ content: "nk>leak</think>answer" }, "stop"), { choices: [], usage }), "disabled"],
    ["SSE unpaired closing wrapper", "sse", sse(chunk({ content: "I should calculate this first.\n</thi" }), chunk({ content: "nk>\n42" }, "stop"), { choices: [], usage }), "disabled"],
    ["SSE absent terminal reason", "sse", sse(chunk({ content: "answer" }), { choices: [], usage }), "medium"],
    ["SSE invalid UTF-8", "sse", Buffer.from(sse(chunk({ reasoning: "INVALID_UTF8" }), chunk({ content: "answer" }, "stop"), { choices: [], usage }).replace("INVALID_UTF8", "\xff"), "latin1"), "medium"],
  ] as const)("keeps %s UNKNOWN without any replay", async (_label, format, raw, thinking) => {
    const f = await fixture(raw, format, thinking);
    await expect(f.complete()).rejects.toThrow("transport_or_settlement_unknown");
    expect(f.requests()).toBe(1);
    expect(f.store.dispatches("job")).toMatchObject([{ status: "unknown", failure: { phase: "settlement", code: "response_or_usage_invalid", attempt: 1 } }]);
    expect(f.store.dispatches("job")).toHaveLength(1);
    expect(f.db.serialize().includes(Buffer.from(secret))).toBe(false);
  });
  it("refuses a validator on a cloud/priced destination and request/metadata drift before dispatch", async () => {
    const f = await fixture(json({ content: "answer" }), "json");
    const input: BrokerRequest = { jobId: "job", contextId: "context", destinationId: "local", purpose: "fixture", method: "POST", maxFeeMicrousd: 0,
      body: JSON.stringify({ model: modelId, reasoning_effort: "medium", chat_template_kwargs: { enable_thinking: true, preserve_thinking: false } }),
      localReplyContract: { version: "flash_next_v1", model: modelId, thinking: "medium" } };
    for (const changed of [{ ...input, maxFeeMicrousd: 1 }, { ...input, body: input.body!.replace(modelId, "different") }]) {
      await expect(f.broker.request(changed)).rejects.toThrow("local_reply_contract_invalid");
    }
    const cloud = new PrivateAgentBroker(f.store, [{ ...f.destination, kind: "cloud_model", privateDataAdmitted: false, stream: undefined, recoverable: undefined }], { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) });
    await expect(cloud.request(input)).rejects.toThrow("local_reply_contract_invalid");
    expect(f.requests()).toBe(0); expect(f.store.dispatches("job")).toEqual([]);
  });
});
