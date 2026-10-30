import Database from "better-sqlite3";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ANTHROPIC_API_VERSION } from "../../src/main/private-agent/anthropic";
import { ANTHROPIC_RETRY_DELAYS_MS, PrivateAgentBroker, RETRY_WAIT_CANCELLED, type BrokerDestination, type BrokerRequest } from "../../src/main/private-agent/broker";
import { buildCloudArm } from "../../scripts/private-agent-local-screen";
import { PROBE_MAX_FEE_USD, PROBE_MODEL, PROBE_PRICES, runProbe, summarizeProbe } from "../../scripts/anthropic-probe";
import { ANTHROPIC_MESSAGES_ENDPOINT } from "../../src/main/private-agent/anthropic";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, type PrivateModelConfig } from "../../src/main/private-agent/model";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
type Seen = { headers: http.IncomingHttpHeaders; body: string };
type Answer = (request: http.IncomingMessage, response: http.ServerResponse, index: number) => void;

/** A loopback mock of the Messages endpoint behind a synthetic, grant-free cloud destination like the driver's. */
async function fixture(answer: Answer, options: { anthropic?: boolean; timeoutMs?: number; maxRequests?: number; maxFeeMicrousd?: number; delays?: number[] } = {}) {
  const seen: Seen[] = [];
  const server = http.createServer((request, response) => {
    let body = ""; request.on("data", chunk => { body += chunk; });
    request.on("end", () => { seen.push({ headers: request.headers, body }); answer(request, response, seen.length - 1); });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const port = (server.address() as { port: number }).port;
  const db = new Database(":memory:"); cleanups.push(() => { if (db.open) db.close(); });
  const store = new PrivateAgentStore(db);
  store.createJob({ id: "job", version: 1, revision: 0, cancelled: false, mode: "cloud_help", destinations: ["cloud_coordinator"], maxRequests: options.maxRequests ?? 10,
    maxFeeMicrousd: options.maxFeeMicrousd ?? 1_000_000 });
  store.createContext({ id: "context", jobId: "job", sources: [{ id: "input", version: digest("synthetic input"), classification: "public", synthetic: true }] });
  const destination: BrokerDestination = { id: "cloud_coordinator", kind: "cloud_model", endpoint: `http://127.0.0.1:${port}/v1/messages`, apiKey: "sk-ant-host-0001",
    accountId: "owner_anthropic_account", credentialVersion: 1, privateDataAdmitted: false, syntheticOnly: true, grantFreeSynthetic: true, loopbackFixture: true,
    maxResponseBytes: 64 * 1024, timeoutMs: options.timeoutMs ?? 5000, ...(options.anthropic === false ? {} : { anthropicVersion: ANTHROPIC_API_VERSION }) };
  const broker = new PrivateAgentBroker(store, [destination], { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) },
    { anthropicRetryDelaysMs: options.delays ?? [20, 40] });
  const input: BrokerRequest = { jobId: "job", contextId: "context", destinationId: "cloud_coordinator", purpose: "agent reasoning and tool selection",
    method: "POST", body: "{\"synthetic\":true}", maxFeeMicrousd: 1000 };
  return { broker, store, destination, input, seen, rows: () => store.dispatches("job") };
}
const ok = (response: http.ServerResponse) => { response.writeHead(200, { "content-type": "application/json", "request-id": "req_011okfixture" }); response.end("{\"ok\":true}"); };
const rejectWith = (status: number, type: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => (_: http.IncomingMessage, response: http.ServerResponse) => {
  response.writeHead(status, { "content-type": "application/json", "request-id": `req_011rejected${status}`, ...headers });
  response.end(JSON.stringify({ type: "error", error: { type, message: "provider prose that must never be stored", ...extra }, request_id: `req_011rejected${status}` }));
};

describe("Anthropic destination transport", () => {
  it("sends x-api-key and the fixed version instead of a bearer token, and binds the version header into the packet", async () => {
    const f = await fixture((_, response) => ok(response));
    await f.broker.request(f.input, () => 7);
    expect(f.seen[0]!.headers).toMatchObject({ "x-api-key": "sk-ant-host-0001", "anthropic-version": ANTHROPIC_API_VERSION, "content-type": "application/json" });
    expect(f.seen[0]!.headers).not.toHaveProperty("authorization");
    const preview = f.broker.preview(f.input);
    expect(JSON.parse(preview.text).headers).toEqual({ "anthropic-version": ANTHROPIC_API_VERSION, "content-type": "application/json" });
    expect(preview.text).not.toContain("sk-ant-host-0001");
    const plain = await fixture((_, response) => ok(response), { anthropic: false });
    await plain.broker.request(plain.input, () => 7);
    expect(plain.seen[0]!.headers.authorization).toBe("Bearer sk-ant-host-0001"); expect(plain.seen[0]!.headers).not.toHaveProperty("anthropic-version");
    expect(JSON.parse(plain.broker.preview(plain.input).text).headers).toEqual({ "content-type": "application/json" });
    expect(preview.destinationSha256).not.toBe(plain.broker.preview(plain.input).destinationSha256);
    expect(f.rows().map(row => [row.status, row.feeMicrousd])).toEqual([["settled", 7]]);
  });

  it.each([429, 529])("retries a %s at most twice, one resolved row per attempt, with only fixed diagnostics", async status => {
    const f = await fixture((request, response, index) => index < 2 ? rejectWith(status, status === 429 ? "rate_limit_error" : "overloaded_error")(request, response) : ok(response));
    const result = await f.broker.request(f.input, () => 5);
    expect(result.receipt.status).toBe("settled");
    const rows = f.rows();
    expect(rows.map(row => row.status)).toEqual(["superseded", "superseded", "settled"]);
    expect(rows[0]!.failure).toEqual({ phase: "transport", code: "http_rejected", status, attempt: 1, errorType: status === 429 ? "rate_limit_error" : "overloaded_error",
      requestId: `req_011rejected${status}`, elapsedMs: rows[0]!.failure!.elapsedMs, timeoutMs: 5000 });
    expect(rows[1]!.failure).toMatchObject({ attempt: 2 });
    expect(JSON.stringify(rows)).not.toContain("provider prose");
    expect(f.seen.map(item => item.body)).toEqual([f.input.body, f.input.body, f.input.body]);
  });

  it("waits 30 then 60 seconds in production, and retries only while a session request is left", async () => {
    expect(ANTHROPIC_RETRY_DELAYS_MS).toEqual([30_000, 60_000]);
    const f = await fixture((_, response) => ok(response));
    const scanner = { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) };
    expect((new PrivateAgentBroker(f.store, [f.destination], scanner) as unknown as { anthropicRetryDelaysMs: number[] }).anthropicRetryDelaysMs).toEqual([30_000, 60_000]);
    const last = await fixture(rejectWith(529, "overloaded_error"), { maxRequests: 1 });
    await expect(last.broker.request(last.input, () => 5)).rejects.toThrow("request_failed");
    expect(last.rows().map(row => row.status)).toEqual(["failed"]); expect(last.seen).toHaveLength(1);
  });

  it("retries a 429 whose retry-after is exactly 120 seconds (the wait is cut short here by a cancel)", async () => {
    const f = await fixture(rejectWith(429, "rate_limit_error", {}, { "retry-after": "120" }));
    const controller = new AbortController();
    const pending = f.broker.request({ ...f.input, signal: controller.signal }, () => 5);
    setTimeout(() => controller.abort(), 300);
    await expect(pending).rejects.toThrow(RETRY_WAIT_CANCELLED);
  });

  it("records the request id on a transport-phase unknown row, and ignores an error body beyond 8 KiB", async () => {
    const cut = await fixture((_, response) => {
      response.writeHead(200, { "content-type": "application/json", "request-id": "req_011cutreply" }); response.write("{\"type\":\"mess");
      setTimeout(() => response.socket?.destroy(), 50);
    });
    await expect(cut.broker.request(cut.input, () => 5)).rejects.toThrow("transport_or_settlement_unknown");
    expect(cut.rows()[0]).toMatchObject({ status: "unknown", failure: { phase: "transport", code: "response_interrupted", requestId: "req_011cutreply" } });
    const big = await fixture(rejectWith(400, "invalid_request_error", { message: "x".repeat(9 * 1024) }));
    await expect(big.broker.request(big.input, () => 5)).rejects.toThrow("request_failed");
    expect(big.rows()[0]!.failure).toMatchObject({ status: 400 }); expect(big.rows()[0]!.failure).not.toHaveProperty("errorType");
  });

  it("ends after the third rejected attempt as a failed row", async () => {
    const f = await fixture(rejectWith(529, "overloaded_error"));
    await expect(f.broker.request(f.input, () => 5)).rejects.toThrow("request_failed");
    expect(f.rows().map(row => [row.status, row.failure?.attempt])).toEqual([["superseded", 1], ["superseded", 2], ["failed", 3]]);
  });

  it.each<[string, Answer, Record<string, unknown>]>([
    ["a 500", rejectWith(500, "api_error"), { status: 500, errorType: "api_error" }],
    ["a 400", rejectWith(400, "invalid_request_error"), { status: 400, errorType: "invalid_request_error" }],
    ["a 402", rejectWith(402, "billing_error"), { status: 402, errorType: "billing_error" }],
    ["an owner-set spend limit", rejectWith(400, "invalid_request_error", { message: "You have reached your specified workspace API usage limits. Access resumes later." }),
      { status: 400, errorType: "invalid_request_error", spendLimit: true }],
    ["the monthly spend cap", rejectWith(429, "rate_limit_error", { details: { error_code: "enforced_spend_limit_reached" } }), { status: 429, spendCap: true }],
    ["a retry-after above 120 seconds", rejectWith(429, "rate_limit_error", {}, { "retry-after": "121" }), { status: 429 }],
    ["an error type outside the list", rejectWith(400, "novel_error"), { status: 400 }],
  ])("does not retry %s", async (_name, answer, expected) => {
    const f = await fixture(answer);
    await expect(f.broker.request(f.input, () => 5)).rejects.toThrow("request_failed");
    const rows = f.rows();
    expect(rows.map(row => row.status)).toEqual(["failed"]);
    expect(rows[0]!.failure).toMatchObject({ phase: "transport", code: "http_rejected", attempt: 1, ...expected });
    if (_name === "an error type outside the list") expect(rows[0]!.failure).not.toHaveProperty("errorType");
  });

  it("waits the longer of its delay and a short retry-after", async () => {
    const f = await fixture((request, response, index) => index === 0 ? rejectWith(429, "rate_limit_error", {}, { "retry-after": "1" })(request, response) : ok(response));
    const started = performance.now();
    await f.broker.request(f.input, () => 5);
    expect(performance.now() - started).toBeGreaterThanOrEqual(950);
    expect(f.rows().map(row => row.status)).toEqual(["superseded", "settled"]);
  });

  it("keeps a rejection a rejection when its body stalls past the request timer", async () => {
    const f = await fixture((_, response) => { response.writeHead(429, { "content-type": "application/json", "request-id": "req_011stall" }); response.write("{\"type\":\"err"); },
      { timeoutMs: 300, delays: [10, 10] });
    await expect(f.broker.request(f.input, () => 5)).rejects.toThrow("request_failed");
    const rows = f.rows();
    expect(rows.map(row => row.status)).toEqual(["superseded", "superseded", "failed"]);
    for (const row of rows) { expect(row.failure).toMatchObject({ code: "http_rejected", status: 429, requestId: "req_011stall" }); expect(row.failure).not.toHaveProperty("errorType"); }
  }, 15_000);

  it("still reads a slow spend-cap body after the request deadline has passed, and does not retry it", async () => {
    const f = await fixture((_, response) => {
      response.writeHead(429, { "content-type": "application/json", "request-id": "req_011slowcap" }); response.flushHeaders();
      setTimeout(() => response.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "cap", details: { error_code: "enforced_spend_limit_reached" } } })), 700);
    }, { timeoutMs: 300 });
    await expect(f.broker.request(f.input, () => 5)).rejects.toThrow("request_failed");
    expect(f.rows().map(row => row.status)).toEqual(["failed"]);
    expect(f.rows()[0]!.failure).toMatchObject({ code: "http_rejected", status: 429, errorType: "rate_limit_error", spendCap: true, requestId: "req_011slowcap" });
  });

  it("marks the row superseded only once the retry is certain, as the local retry path does", async () => {
    const f = await fixture((request, response, index) => index === 0 ? rejectWith(529, "overloaded_error")(request, response) : ok(response), { delays: [400, 400] });
    const pending = f.broker.request(f.input, () => 5);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(f.rows().map(row => row.status)).toEqual(["committed"]);
    await pending;
    expect(f.rows().map(row => row.status)).toEqual(["superseded", "settled"]);
  });

  it("resolves the row failed and says so with its own code when a cancel arrives during the wait", async () => {
    const f = await fixture(rejectWith(529, "overloaded_error"), { delays: [500, 500] });
    const controller = new AbortController();
    const pending = f.broker.request({ ...f.input, signal: controller.signal }, () => 5);
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toThrow(RETRY_WAIT_CANCELLED);
    expect(f.rows().map(row => row.status)).toEqual(["failed"]); expect(f.rows()[0]!.failure).toMatchObject({ code: "http_rejected", status: 529 });
  });

  it("keeps the spend-cap code when the socket resets after a complete error body", async () => {
    const f = await fixture((_, response) => {
      response.writeHead(429, { "content-type": "application/json", "request-id": "req_011resetcap" });
      response.write(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "cap", details: { error_code: "enforced_spend_limit_reached" } } }));
      setTimeout(() => response.socket?.destroy(), 50);
    });
    await expect(f.broker.request(f.input, () => 5)).rejects.toThrow("request_failed");
    expect(f.rows().map(row => row.status)).toEqual(["failed"]);
    expect(f.rows()[0]!.failure).toMatchObject({ status: 429, errorType: "rate_limit_error", spendCap: true });
    expect(f.seen).toHaveLength(1);
  });

  it("records the request id on a settlement refusal, and only fixed keys on every Anthropic row", async () => {
    const f = await fixture((_, response) => ok(response));
    await expect(f.broker.request(f.input, () => { throw new Error("model_served_mismatch"); })).rejects.toThrow("transport_or_settlement_unknown");
    expect(f.rows()[0]!.status).toBe("unknown");
    expect(Object.keys(f.rows()[0]!.failure!).sort()).toEqual(["attempt", "code", "elapsedMs", "phase", "requestId", "timeoutMs"]);
    expect(f.rows()[0]!.failure).toMatchObject({ phase: "settlement", code: "response_or_usage_invalid", requestId: "req_011okfixture" });
  });

  it("still rejects at once, unread, on a destination without the field even when the error body stalls", async () => {
    const f = await fixture((_, response) => { response.writeHead(503, { "content-type": "application/json" }); response.write("{\"never"); }, { anthropic: false, timeoutMs: 4000 });
    const started = performance.now();
    await expect(f.broker.request(f.input, () => 5)).rejects.toThrow("request_failed");
    expect(performance.now() - started).toBeLessThan(1500);
    expect(f.rows()[0]!.failure).toEqual({ phase: "transport", code: "http_rejected", status: 503, elapsedMs: f.rows()[0]!.failure!.elapsedMs, timeoutMs: 4000 });
  });

  it("keeps the existing cloud path for a destination without the field: one failed row, no retry, no attempt, no new keys", async () => {
    const f = await fixture(rejectWith(429, "rate_limit_error"), { anthropic: false });
    await expect(f.broker.request(f.input, () => 5)).rejects.toThrow("request_failed");
    expect(f.rows().map(row => row.status)).toEqual(["failed"]);
    expect(Object.keys(f.rows()[0]!.failure!).sort()).toEqual(["code", "elapsedMs", "phase", "status", "timeoutMs"]);
    const g = await fixture((_, response) => ok(response), { anthropic: false });
    await expect(g.broker.request(g.input, () => { throw new Error("x"); })).rejects.toThrow("transport_or_settlement_unknown");
    expect(Object.keys(g.rows()[0]!.failure!).sort()).toEqual(["code", "elapsedMs", "phase", "timeoutMs"]);
  });

  it("drops a diagnostic key whose value is undefined instead of leaving the row committed for good", async () => {
    const f = await fixture((_, response) => ok(response));
    const { text: _text, ...preview } = f.broker.preview(f.input);
    const row = f.store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "complete", detector: "fixture" } }, () => {});
    f.store.unknown(row.id, { phase: "transport", code: "http_rejected", status: 400, errorType: undefined, requestId: undefined, elapsedMs: 1, timeoutMs: 5000 });
    expect(f.store.dispatch(row.id)).toMatchObject({ status: "unknown", failure: { phase: "transport", code: "http_rejected", status: 400, elapsedMs: 1, timeoutMs: 5000 } });
    expect(Object.keys(f.store.dispatch(row.id).failure!).sort()).toEqual(["code", "elapsedMs", "phase", "status", "timeoutMs"]);
  });

  it("refuses the field on any other kind, with retries flagged, or with another version", async () => {
    const f = await fixture((_, response) => ok(response));
    const store = f.store, scanner = { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) };
    const base = f.destination;
    for (const bad of [{ kind: "local_model" as const, grantFreeSynthetic: undefined }, { recoverable: true }, { anthropicVersion: "2023-06-01" as typeof ANTHROPIC_API_VERSION }]) {
      expect(() => new PrivateAgentBroker(store, [{ ...base, ...bad }], scanner)).toThrow(/destination_(anthropic|recoverable)_invalid/u);
    }
    expect(() => new PrivateAgentBroker(store, [base], scanner, { anthropicRetryDelaysMs: [1] })).toThrow("broker_options_invalid");
  });
});

describe("the local retry path is unchanged", () => {
  it("records exactly the keys it recorded before on a retried local rejection", async () => {
    const server = http.createServer((_, response) => { response.writeHead(503); response.end(); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
    const db = new Database(":memory:"); cleanups.push(() => { if (db.open) db.close(); });
    const store = new PrivateAgentStore(db);
    store.createJob({ id: "job", version: 1, revision: 0, cancelled: false, mode: "private", destinations: ["local"], maxRequests: 10, maxFeeMicrousd: 0 });
    store.createContext({ id: "context", jobId: "job", sources: [{ id: "input", version: digest("synthetic"), classification: "public", synthetic: true }] });
    const broker = new PrivateAgentBroker(store, [{ id: "local", kind: "local_model", endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions`,
      accountId: "local", credentialVersion: 1, privateDataAdmitted: false, syntheticOnly: true, recoverable: true, maxResponseBytes: 1024, timeoutMs: 5000 }],
      { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) });
    await expect(broker.request({ jobId: "job", contextId: "context", destinationId: "local", purpose: "local", method: "POST", body: "{}", maxFeeMicrousd: 0 })).rejects.toThrow("request_failed");
    const rows = store.dispatches("job");
    expect(rows.map(row => row.status)).toEqual(["superseded", "superseded", "failed"]);
    for (const [index, row] of rows.entries()) expect(row.failure).toEqual({ phase: "transport", code: "http_rejected", status: 503, attempt: index + 1, elapsedMs: row.failure!.elapsedMs, timeoutMs: 5000 });
  }, 15_000);
});

describe("the shape probe through real fee admission", () => {
  const think = [{ type: "thinking", thinking: "", signature: "c2ln" }];
  const answer = (reads: boolean): Answer => (_, response, index) => {
    const usage = (extra: Record<string, unknown>) => ({ input_tokens: 40, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, service_tier: "standard",
      inference_geo: "global", output_tokens_details: { thinking_tokens: 9 }, ...extra });
    const body = index === 0 ? { content: [{ type: "text", text: "ready" }], stop_reason: "end_turn", usage: usage({}) }
      : index < 3 ? { content: [...think, { type: "tool_use", id: `toolu_${index}`, name: "calculate", input: { op: "add", a: 1, b: index } }], stop_reason: "tool_use",
        usage: usage(index === 1 ? { cache_creation_input_tokens: 900 } : { cache_read_input_tokens: reads ? 900 : 0 }) }
      : { content: [...think, { type: "text", text: "4" }], stop_reason: "end_turn", usage: usage({ cache_read_input_tokens: reads ? 950 : 0 }) };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ type: "message", role: "assistant", model: PROBE_MODEL, ...body }));
  };
  async function probe(reads: boolean) {
    const arm = buildCloudArm({ model: PROBE_MODEL, endpoint: ANTHROPIC_MESSAGES_ENDPOINT, prices: PROBE_PRICES, maxFeeUsd: PROBE_MAX_FEE_USD },
      { SOAR_CLAUDE_CLOUD_API_KEY: "sk-ant-probe-0001" }, COORDINATOR_PROFILES.heavy);
    const f = await fixture(answer(reads), { maxFeeMicrousd: arm.maxFeeMicrousd });
    // The probe's own arm, pointed at the loopback mock: same model configuration, cap and Anthropic destination fields.
    const broker = new PrivateAgentBroker(f.store, [{ ...arm.destination, endpoint: f.destination.endpoint, loopbackFixture: true }],
      { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) });
    const result = await runProbe(broker, arm.modelConfig as never, "job", "context");
    return { result, rows: f.rows(), summary: summarizeProbe(result, f.rows().map(row => ({ status: row.status, feeMicrousd: row.feeMicrousd ?? 0 }))) };
  }

  it("admits all four calls under its USD 0.30 cap, settles every row and passes", async () => {
    const { result, rows, summary } = await probe(true);
    expect(rows.map(row => row.status)).toEqual(["settled", "settled", "settled", "settled"]);
    expect(rows.slice(1).every(row => row.reservedFeeMicrousd > 160_000)).toBe(true);
    expect(result.pass).toBe(true); expect(summary).toMatchObject({ pass: true, allSettled: true, exitCode: 0 });
  });

  it("fails when the loop never reads its cache, and when a row did not settle", async () => {
    const { summary } = await probe(false);
    expect(summary).toMatchObject({ pass: false, exitCode: 2, checks: { cacheWriteThenReads: false } });
    const { result } = await probe(true);
    expect(summarizeProbe(result, [{ status: "superseded", feeMicrousd: 0 }, ...Array.from({ length: 3 }, () => ({ status: "settled", feeMicrousd: 1 }))]))
      .toMatchObject({ pass: false, allSettled: false, exitCode: 2 });
  });
});

describe("Anthropic model through the real broker and a mock Messages server", () => {
  const config: PrivateModelConfig = { destinationId: "cloud_coordinator", model: "claude-sonnet-5-5", api: "anthropic_messages", maxOutputTokens: 4096,
    inputUsdPerMillion: 2, outputUsdPerMillion: 10, cachedInputUsdPerMillion: 0.1, cacheWriteUsdPerMillion: 2.5, thinking: "medium", promptCaching: "anthropic_explicit_5m_v1" };
  const tool = { type: "function" as const, function: { name: "execute", description: "Run a command.", parameters: { type: "object", properties: { command: { type: "string" } } } } };

  it("runs a tool turn with thinking, settles writes and reads, and records the fee on the receipt", async () => {
    const f = await fixture((_, response) => {
      response.writeHead(200, { "content-type": "application/json", "request-id": "req_011turn" });
      response.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "tool_use", stop_sequence: null,
        content: [{ type: "thinking", thinking: "", signature: "c2ln" }, { type: "tool_use", id: "toolu_2", name: "execute", input: { command: "ls" } }],
        usage: { input_tokens: 30, cache_creation_input_tokens: 200, cache_read_input_tokens: 400, output_tokens: 60, service_tier: "standard", inference_geo: "global",
          output_tokens_details: { thinking_tokens: 25 } } }));
    });
    const model = new PrivateAgentModel(f.broker, config, "job", "context");
    const result = await model.complete([{ role: "system", content: "S" }, { role: "user", content: `brief ${"x".repeat(2000)}` },
      { role: "assistant", content: null, tool_calls: [{ id: "toolu_1", type: "function", function: { name: "execute", arguments: "{\"command\":\"pwd\"}" } }] },
      { role: "tool", tool_call_id: "toolu_1", content: "/work" }, { role: "user", content: "guidance" }], [tool], new AbortController().signal, { trailingTurnMessage: true });
    expect(result).toMatchObject({ finishReason: "tool_calls", toolCalls: [{ id: "toolu_2", function: { arguments: "{\"command\":\"ls\"}" } }],
      usage: { inputTokens: 630, cacheReadTokens: 400, cacheWriteTokens: 200, outputTokens: 60, thinkingTokens: 25 } });
    expect(f.rows()[0]).toMatchObject({ status: "settled", feeMicrousd: Math.ceil(30 * 2 + 200 * 2.5 + 400 * 0.1 + 60 * 10) });
    const sent = JSON.parse(f.seen[0]!.body);
    expect(sent.messages.at(-1)).toEqual({ role: "system", content: "guidance" });
    expect(f.seen[0]!.headers["anthropic-version"]).toBe(ANTHROPIC_API_VERSION);
  });
});
