import { EventEmitter } from "node:events";
import https from "node:https";
import { lookup } from "node:dns/promises";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCloudArm } from "../../scripts/private-agent-local-screen";
import { ANTHROPIC_API_VERSION, ANTHROPIC_MESSAGES_ENDPOINT } from "../../src/main/private-agent/anthropic";
import { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, type PrivateModelConfig } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { RulePacketScanner } from "../../src/main/private-agent/scanner";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
const databases: Database.Database[] = [];
beforeEach(() => { vi.mocked(lookup).mockResolvedValue([{ address: "198.18.0.77", family: 4 }] as never); });
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); for (const db of databases.splice(0)) db.close(); });

type Call = { url: URL; options: https.RequestOptions; body: string; keepAlive: unknown[][] };
/** https.request stand-in: records what the broker would send and on which socket settings, then answers with `reply`. */
function transportMock(reply: unknown, headers: Record<string, string> = {}) {
  const calls: Call[] = [];
  vi.spyOn(https, "request").mockImplementation(((url: URL, options: https.RequestOptions, receive: (response: unknown) => void) => {
    const call: Call = { url, options, body: "", keepAlive: [] }; calls.push(call);
    const request = new EventEmitter() as EventEmitter & { end(body?: string): void };
    request.end = (body?: string) => queueMicrotask(() => {
      call.body = body ?? "";
      const socket = Object.assign(new EventEmitter(), { setKeepAlive: (...args: unknown[]) => { call.keepAlive.push(args); } });
      request.emit("socket", socket); socket.emit("connect");
      const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: { "content-type": "application/json", ...headers }, destroy: () => {} });
      receive(response); response.emit("data", Buffer.from(JSON.stringify(reply))); response.emit("end");
    });
    return request;
  }) as never);
  return calls;
}
function job(destinationId: string) {
  const db = new Database(":memory:"); databases.push(db); const store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: "job", mode: "cloud_help", revision: 0, cancelled: false, destinations: [destinationId], maxRequests: 4, maxFeeMicrousd: 3_000_000 });
  store.createContext({ id: "context", jobId: "job", sources: [{ id: "source", version: digest("synthetic source"), classification: "public", synthetic: true }] });
  return store;
}
const heavy = COORDINATOR_PROFILES.heavy;
const tool = { type: "function" as const, function: { name: "execute", description: "Run a command.", parameters: { type: "object", properties: { command: { type: "string" } } } } };
const messages = [{ role: "system" as const, content: "You are a synthetic agent." }, { role: "user" as const, content: "Brief." }, { role: "user" as const, content: "Guidance." }];

describe("the H5 Claude destination through the broker's real transport", () => {
  it("resolves for IPv4, admits the fake-IP answer pinned, verifies the hostname, sends x-api-key and the version, and keeps the socket alive", async () => {
    const calls = transportMock({ type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 20, output_tokens: 3, cache_creation_input_tokens: 400, cache_read_input_tokens: 0, service_tier: "standard", inference_geo: "global" } }, { "request-id": "req_011h5" });
    const arm = buildCloudArm({ model: "claude-sonnet-5-5", endpoint: ANTHROPIC_MESSAGES_ENDPOINT, prices: { input: 2, output: 10, cached: 0.1, write: 2.5 }, maxFeeUsd: 3, proxyFakeIp: true },
      { SOAR_CLAUDE_CLOUD_API_KEY: "sk-ant-tport-0001" }, heavy);
    const store = job(arm.destination.id);
    const broker = new PrivateAgentBroker(store, [arm.destination], new RulePacketScanner());
    const model = new PrivateAgentModel(broker, arm.modelConfig as PrivateModelConfig, "job", "context");
    const result = await model.complete(messages, [tool], new AbortController().signal, { trailingTurnMessage: true });
    expect(result).toMatchObject({ content: "ok", usage: { inputTokens: 420, cacheWriteTokens: 400 } });
    expect(vi.mocked(lookup)).toHaveBeenCalledWith("api.anthropic.com", expect.objectContaining({ all: true, family: 4 }));
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url.href).toBe(ANTHROPIC_MESSAGES_ENDPOINT);
    expect(call!.options).toMatchObject({ method: "POST", servername: "api.anthropic.com", rejectUnauthorized: true, agent: false });
    expect(call!.options.headers).toMatchObject({ "x-api-key": "sk-ant-tport-0001", "anthropic-version": ANTHROPIC_API_VERSION, "content-type": "application/json" });
    expect(call!.options.headers).not.toHaveProperty("authorization");
    const pinned = await new Promise(resolve => (call!.options.lookup as (host: string, options: object, cb: (...args: unknown[]) => void) => void)("api.anthropic.com", { all: true }, (_error, addresses) => resolve(addresses)));
    expect(pinned).toEqual([{ address: "198.18.0.77", family: 4 }]);
    expect(call!.keepAlive).toEqual([[true, 30_000]]);
    expect(JSON.parse(call!.body).messages.at(-1)).toEqual({ role: "system", content: "Guidance." });
    expect(store.dispatches("job")).toMatchObject([{ status: "settled", feeMicrousd: Math.ceil(20 * 2 + 400 * 2.5 + 3 * 10) }]);
  });

  it("leaves the OpenAI arm's transport as it was: bearer token, no version header, no keep-alive", async () => {
    const calls = transportMock({ model: "gpt-6-sol", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }],
      usage: { input_tokens: 20, output_tokens: 3 } });
    const arm = buildCloudArm({ model: "gpt-6-sol", endpoint: "https://api.openai.com/v1/responses", prices: { input: 2, output: 10, cached: 0.2, write: 2.5 }, maxFeeUsd: 2.5,
      longContext: { aboveTokens: 272000, input: 4, output: 15, cached: 0.4, write: 5 }, proxyFakeIp: true }, { SOAR_PHASE2_CLOUD_API_KEY: "sk-oai-tport-0001" }, heavy);
    const store = job(arm.destination.id);
    const model = new PrivateAgentModel(new PrivateAgentBroker(store, [arm.destination], new RulePacketScanner()), arm.modelConfig as PrivateModelConfig, "job", "context");
    await model.complete(messages, [tool], new AbortController().signal, { trailingTurnMessage: true });
    expect(calls[0]!.options.headers).toMatchObject({ authorization: "Bearer sk-oai-tport-0001" });
    expect(calls[0]!.options.headers).not.toHaveProperty("anthropic-version"); expect(calls[0]!.options.headers).not.toHaveProperty("x-api-key");
    expect(calls[0]!.keepAlive).toEqual([]);
  });
});
