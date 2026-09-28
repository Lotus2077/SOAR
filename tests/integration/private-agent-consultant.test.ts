import Database from "better-sqlite3";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PrivateAgentBroker, type BrokerDestination, type BrokerRequest, type LocalPacketScanner } from "../../src/main/private-agent/broker";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { canonical, digest, ExactApprovalSchema, type ExactApproval } from "../../src/main/private-agent/contracts";
import { CONSULTATION_PURPOSE, consultantPriceProfileSha256, dispatchConsultantText, prepareConsultantRequest,
  type ConsultantTextConfig } from "../../src/main/private-agent/consultant-model";

const config: ConsultantTextConfig = { destinationId: "consultant", model: "synthetic-text-model", maxOutputTokens: 128,
  inputMicrousdPerMillion: 1_000_000, outputMicrousdPerMillion: 2_000_000, cachedInputMicrousdPerMillion: 500_000 };
const messages = [{ role: "user" as const, content: "Check this public synthetic arithmetic: 2 + 3 = 5." }];
const clean: LocalPacketScanner = { scan: async () => ({ complete: true, blocked: false, detector: "synthetic-clean" }) };
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function response() { return { model: config.model, choices: [{ finish_reason: "stop", message: { role: "assistant", content: "The stated addition is correct." } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 4 } } }; }

async function fixture(options: { scanner?: LocalPacketScanner; body?: string; databasePath?: string; classification?: "public" | "private"; config?: ConsultantTextConfig } = {}) {
  const activeConfig = options.config ?? config;
  const requests: string[] = [];
  const server = http.createServer((request, reply) => {
    let body = ""; request.on("data", chunk => { body += chunk; });
    request.on("end", () => { requests.push(body); reply.end(options.body ?? JSON.stringify(response())); });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const db = new Database(options.databasePath ?? ":memory:"); cleanups.push(() => { if (db.open) db.close(); });
  const store = new PrivateAgentStore(db);
  store.createJob({ id: "job", version: 1, revision: 0, cancelled: false, mode: "cloud_help", destinations: [activeConfig.destinationId], maxRequests: 10, maxFeeMicrousd: 100_000 });
  store.createContext({ id: "context", jobId: "job", sources: [{ id: "source", version: digest("synthetic input"), classification: options.classification ?? "public", synthetic: true }] });
  const destination: BrokerDestination = { id: activeConfig.destinationId, kind: "cloud_model", endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions`,
    accountId: "synthetic-account", credentialVersion: 1, privateDataAdmitted: false, loopbackFixture: true, syntheticOnly: true, maxResponseBytes: 16_384,
    timeoutMs: 1000, requireExactGrant: true, approvalPriceProfileSha256: consultantPriceProfileSha256(activeConfig) };
  const broker = new PrivateAgentBroker(store, [destination], options.scanner ?? clean);
  const prepared = prepareConsultantRequest(activeConfig, messages);
  const approval: ExactApproval = { proposalId: randomUUID(), proposalSha256: digest("synthetic proposal"),
    priceProfileSha256: prepared.priceProfileSha256, maxFeeMicrousd: prepared.maxFeeMicrousd };
  const request: BrokerRequest = { jobId: "job", contextId: "context", destinationId: activeConfig.destinationId,
    purpose: CONSULTATION_PURPOSE, method: "POST", body: prepared.body, maxFeeMicrousd: prepared.maxFeeMicrousd, approval };
  const grant = (id = randomUUID(), overrides: Partial<ExactApproval> = {}) => {
    const { text: _text, ...preview } = broker.preview({ ...request, approval: { ...approval, ...overrides } });
    store.grant({ ...preview, id, expiresAt: Date.now() + 60_000, remainingUses: 1, revoked: false });
    return id;
  };
  const dispatch = (grantId: string, validateAtCommit?: () => void) => dispatchConsultantText({ broker, jobId: "job", contextId: "context", config: activeConfig,
    prepared, approval, grantId, signal: new AbortController().signal, validateAtCommit });
  return { db, store, broker, destination, prepared, approval, request, grant, dispatch, requests };
}

describe("priced exact consultation", () => {
  it("prepares deterministic text-only bytes and conservative exact integer fee ceilings", () => {
    const prepared = prepareConsultantRequest(config, messages);
    expect(JSON.parse(prepared.body)).toEqual({ model: config.model, messages, stream: false, max_tokens: 128 });
    expect(prepared.bodySha256).toBe(digest(prepared.body));
    expect(prepared.maxFeeMicrousd).toBe(Buffer.byteLength(prepared.body) + 256);
    const rates = { ...config, inputMicrousdPerMillion: 3, outputMicrousdPerMillion: 7, cachedInputMicrousdPerMillion: 11 };
    expect(prepareConsultantRequest(rates, messages).maxFeeMicrousd).toBe(Math.ceil((Buffer.byteLength(prepared.body) * 11 + 128 * 7) / 1_000_000));
    expect(consultantPriceProfileSha256(rates)).not.toBe(prepared.priceProfileSha256);
    expect(() => prepareConsultantRequest({ ...config, maxOutputTokens: 4097 }, messages)).toThrow("consultant_configuration_invalid");
    expect(() => prepareConsultantRequest({ ...config, inputMicrousdPerMillion: 0.5 }, messages)).toThrow("consultant_configuration_invalid");
    expect(() => prepareConsultantRequest(config, [{ role: "user", content: "x".repeat(192 * 1024) }])).toThrow("consultant_body_exceeded");
  });

  it("previews public bytes before approval but sends neither ungranted nor unpriced requests", async () => {
    const f = await fixture();
    expect(f.broker.preview({ ...f.request, approval: undefined }).text).toContain(f.prepared.body.replaceAll('"', '\\"'));
    await expect(f.broker.request(f.request)).rejects.toThrow("exact_grant_required");
    await expect(f.broker.request({ ...f.request, approval: undefined, grantId: f.grant() })).rejects.toThrow("exact_grant_required");
    expect(f.requests).toEqual([]); expect(f.store.dispatches("job")).toEqual([]);
  });

  it("dispatches the exact purpose/body once and settles actual cached usage within the approved cap", async () => {
    const f = await fixture({ classification: "private" }), grantId = f.grant();
    const result = await f.dispatch(grantId);
    expect(f.requests).toEqual([f.prepared.body]); expect(result.content).toBe(response().choices[0]!.message.content);
    expect(result.feeMicrousd).toBe(18);
    expect(result).toMatchObject({ model: config.model, usage: { promptTokens: 10, completionTokens: 5, cachedInputTokens: 4 } });
    expect(result).not.toHaveProperty("serviceTier");
    expect(f.store.dispatch(result.dispatchId)).toMatchObject({ purpose: CONSULTATION_PURPOSE, approval: f.approval,
      reservedFeeMicrousd: f.prepared.maxFeeMicrousd, status: "settled", feeMicrousd: 18, responseSha256: result.responseSha256 });
    await expect(f.dispatch(grantId)).rejects.toThrow(); expect(f.requests).toHaveLength(1);
  });

  it("binds an optional standard tier without changing unconfigured bytes or price identity", () => {
    const legacy = prepareConsultantRequest(config, messages), tiered = prepareConsultantRequest({ ...config, serviceTier: "default" }, messages);
    expect(legacy.body).toBe(canonical({ model: config.model, messages, stream: false, max_tokens: 128 }));
    expect(legacy.priceProfileSha256).toBe(digest(canonical({ schemaVersion: 1, algorithm: "ceil_linear_token_microusd_v1", config })));
    expect(prepareConsultantRequest({ ...config, serviceTier: undefined }, messages)).toEqual(legacy);
    expect(JSON.parse(tiered.body)).toEqual({ ...JSON.parse(legacy.body), service_tier: "default" });
    expect(tiered.bodySha256).not.toBe(legacy.bodySha256);
    expect(tiered.priceProfileSha256).not.toBe(legacy.priceProfileSha256);
    expect(() => prepareConsultantRequest({ ...config, serviceTier: "priority" } as unknown as ConsultantTextConfig, messages)).toThrow("consultant_configuration_invalid");
  });

  it("returns validated standard-tier usage that survives disk reopen and reproduces the settled fee", async () => {
    const dir = mkdtempSync(join(tmpdir(), "soar-consultation-tier-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const databasePath = join(dir, "state.sqlite"), f = await fixture({ databasePath, config: { ...config, serviceTier: "default" },
      body: canonical({ ...response(), service_tier: "default" }) });
    const result = await f.dispatch(f.grant());
    expect(JSON.parse(f.requests[0]!)).toMatchObject({ service_tier: "default" });
    expect(result).toMatchObject({ model: config.model, serviceTier: "default", usage: { promptTokens: 10, completionTokens: 5, cachedInputTokens: 4 } });
    f.store.append("job", { type: "synthetic_validated_usage", ...result }); f.db.close();
    const reopened = new Database(databasePath, { fileMustExist: true }); cleanups.push(() => { reopened.close(); });
    const restored = new PrivateAgentStore(reopened), saved = restored.events("job")[0] as unknown as typeof result;
    const { promptTokens, completionTokens, cachedInputTokens } = saved.usage;
    const recomputed = Math.ceil(((promptTokens - cachedInputTokens) * config.inputMicrousdPerMillion +
      cachedInputTokens * config.cachedInputMicrousdPerMillion! + completionTokens * config.outputMicrousdPerMillion) / 1_000_000);
    expect(saved).toMatchObject(result);
    expect(restored.dispatch(saved.dispatchId)).toMatchObject({ status: "settled", feeMicrousd: recomputed, responseSha256: saved.responseSha256 });
    await expect(new PrivateAgentBroker(restored, [f.destination], clean).request({ ...f.request, grantId: randomUUID() })).rejects.toThrow();
    expect(f.requests).toHaveLength(1);
  });

  it.each([undefined, "priority", null])("keeps missing or mismatched configured service tier %s unknown without replay", async serviceTier => {
    const f = await fixture({ config: { ...config, serviceTier: "default" },
      body: canonical({ ...response(), ...(serviceTier === undefined ? {} : { service_tier: serviceTier }) }) });
    await expect(f.dispatch(f.grant())).rejects.toThrow("transport_or_settlement_unknown");
    expect(f.store.dispatches("job")[0]).toMatchObject({ status: "unknown", reservedFeeMicrousd: f.prepared.maxFeeMicrousd,
      failure: { phase: "settlement", code: "response_or_usage_invalid" } });
    expect(f.store.dispatches("job")[0]!.feeMicrousd).toBeUndefined();
    await expect(f.dispatch(f.grant())).rejects.toThrow("private_agent_unresolved_dispatch");
    expect(f.requests).toHaveLength(1);
  });

  it("refuses adding or removing the tier after packet preparation before transport", async () => {
    const f = await fixture(), grantId = f.grant();
    await expect(dispatchConsultantText({ broker: f.broker, jobId: "job", contextId: "context", config: { ...config, serviceTier: "default" },
      prepared: f.prepared, approval: f.approval, grantId, signal: new AbortController().signal })).rejects.toThrow("consultant_prepared_changed");
    const tiered = await fixture({ config: { ...config, serviceTier: "default" } });
    await expect(dispatchConsultantText({ broker: tiered.broker, jobId: "job", contextId: "context", config,
      prepared: tiered.prepared, approval: tiered.approval, grantId: tiered.grant(), signal: new AbortController().signal })).rejects.toThrow("consultant_prepared_changed");
    expect(f.requests).toEqual([]); expect(tiered.requests).toEqual([]);
  });

  it.each(["proposal", "price", "cap", "purpose", "destination"])("denies %s drift without receiver bytes", async drift => {
    const f = await fixture(), grantId = f.grant();
    let request = { ...f.request, grantId };
    if (drift === "proposal") request = { ...request, approval: { ...f.approval, proposalSha256: digest("changed") } };
    if (drift === "price") request = { ...request, approval: { ...f.approval, priceProfileSha256: digest("changed") } };
    if (drift === "cap") request = { ...request, maxFeeMicrousd: request.maxFeeMicrousd + 1 };
    if (drift === "purpose") request = { ...request, purpose: "different consultation purpose" };
    const broker = drift === "destination" ? new PrivateAgentBroker(f.store, [{ ...f.destination, accountId: "different" }], clean) : f.broker;
    await expect(broker.request(request)).rejects.toThrow(); expect(f.requests).toEqual([]); expect(f.store.dispatches("job")).toEqual([]);
  });

  it("rejects partial approval objects, non-one-use priced grants and unpaired destination bindings", async () => {
    const f = await fixture();
    expect(ExactApprovalSchema.safeParse({ proposalId: f.approval.proposalId }).success).toBe(false);
    const { text: _text, ...preview } = f.broker.preview(f.request);
    expect(() => f.store.grant({ ...preview, id: randomUUID(), expiresAt: Date.now() + 60_000, remainingUses: 2, revoked: false })).toThrow();
    expect(() => new PrivateAgentBroker(f.store, [{ ...f.destination, requireExactGrant: undefined }], clean)).toThrow("destination_approval_invalid");
    expect(() => new PrivateAgentBroker(f.store, [{ ...f.destination, approvalPriceProfileSha256: undefined }], clean)).toThrow("destination_approval_invalid");
    expect(f.requests).toEqual([]);
  });

  it("rejects a second grant for the same settled proposal after disk close and reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "soar-consultation-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const databasePath = join(dir, "state.sqlite"), f = await fixture({ databasePath });
    const first = f.grant(), second = f.grant(); await f.dispatch(first);
    const receipt = f.store.dispatches("job"); f.db.close();
    const reopened = new Database(databasePath, { fileMustExist: true }); cleanups.push(() => { reopened.close(); });
    const restored = new PrivateAgentStore(reopened), broker = new PrivateAgentBroker(restored, [f.destination], clean);
    expect(restored.dispatches("job")).toEqual(receipt);
    await expect(broker.request({ ...f.request, grantId: second })).rejects.toThrow("private_agent_proposal_already_dispatched");
    expect(f.requests).toHaveLength(1);
  });

  it("commits at most one concurrent grant sharing a proposal", async () => {
    const f = await fixture(), grants = [f.grant(), f.grant()];
    const results = await Promise.allSettled(grants.map(grant => f.dispatch(grant)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(f.requests).toHaveLength(1); expect(f.store.dispatches("job")).toHaveLength(1);
  });

  it("does not reuse a proposal ID through a different job and fresh grant", async () => {
    const f = await fixture(); await f.dispatch(f.grant());
    f.store.createJob({ ...f.store.policy("job"), id: "other-job" });
    f.store.createContext({ ...f.store.context("context"), id: "other-context", jobId: "other-job" });
    const request = { ...f.request, jobId: "other-job", contextId: "other-context", grantId: randomUUID() };
    const { text: _text, ...preview } = f.broker.preview(request);
    f.store.grant({ ...preview, id: request.grantId, expiresAt: Date.now() + 60_000, remainingUses: 1, revoked: false });
    await expect(f.broker.request(request)).rejects.toThrow("private_agent_proposal_already_dispatched");
    expect(f.requests).toHaveLength(1); expect(f.store.dispatches("other-job")).toEqual([]);
  });

  it("runs the host CAS after scanning within the same rollback boundary as grant and dispatch", async () => {
    let resolveScan!: () => void; const scanned = new Promise<void>(resolve => { resolveScan = resolve; });
    const f = await fixture({ scanner: { scan: async () => { await scanned; return clean.scan(""); } } }), grantId = f.grant();
    let called = 0;
    const result = f.dispatch(grantId, () => { called++; expect(f.db.inTransaction).toBe(true);
      f.store.append("job", { type: "synthetic_atomic_marker" }); throw new Error("synthetic_stale_host_state"); });
    expect(called).toBe(0); resolveScan();
    await expect(result).rejects.toThrow("synthetic_stale_host_state");
    expect(called).toBe(1); expect(f.store.events("job")).toEqual([]); expect(f.store.dispatches("job")).toEqual([]); expect(f.requests).toEqual([]);
    await f.dispatch(grantId); expect(f.requests).toHaveLength(1);
  });

  it("atomically rolls back host approval events and grant insertion", async () => {
    const f = await fixture(), id = randomUUID();
    expect(() => f.store.atomic(() => { f.store.append("job", { type: "approval" }); f.grant(id); throw new Error("rollback"); })).toThrow("rollback");
    expect(f.store.events("job")).toEqual([]); expect(() => f.grant(id)).not.toThrow();
  });

  it("rechecks grant revocation after a slow clean scan", async () => {
    let resolveScan!: () => void; const scanned = new Promise<void>(resolve => { resolveScan = resolve; });
    const f = await fixture({ scanner: { scan: async () => { await scanned; return clean.scan(""); } } }), grantId = f.grant();
    const result = f.dispatch(grantId); f.store.revoke(grantId); resolveScan();
    await expect(result).rejects.toThrow(); expect(f.requests).toEqual([]); expect(f.store.dispatches("job")).toEqual([]);
  });

  it.each(["body", "hash", "fee", "config"])("refuses prepared %s changes before transport", async drift => {
    const f = await fixture(), grantId = f.grant(), prepared = { ...f.prepared };
    if (drift === "body") { prepared.body += " "; prepared.bodySha256 = digest(prepared.body); }
    if (drift === "hash") prepared.bodySha256 = digest("different");
    if (drift === "fee") prepared.maxFeeMicrousd++;
    await expect(dispatchConsultantText({ broker: f.broker, jobId: "job", contextId: "context", config: drift === "config" ? { ...config, model: "other" } : config,
      prepared, grantId, approval: f.approval, signal: new AbortController().signal })).rejects.toThrow("consultant_prepared_changed");
    expect(f.requests).toEqual([]); expect(f.store.dispatches("job")).toEqual([]);
  });

  it.each(["json", "model", "tools", "finish", "empty", "usage", "cache", "output"])("retains unknown reservation and forbids replay for invalid %s", async defect => {
    const value = response();
    if (defect === "model") value.model = "wrong-model";
    if (defect === "tools") Object.assign(value.choices[0]!.message, { tool_calls: [{ id: "unexpected-tool" }] });
    if (defect === "finish") value.choices[0]!.finish_reason = "length";
    if (defect === "empty") value.choices[0]!.message.content = "  ";
    if (defect === "usage") value.usage.total_tokens = 14;
    if (defect === "cache") value.usage.prompt_tokens_details.cached_tokens = 11;
    if (defect === "output") { value.usage.completion_tokens = 129; value.usage.total_tokens = 139; }
    const f = await fixture({ body: defect === "json" ? "not-json" : canonical(value) }), grantId = f.grant();
    await expect(f.dispatch(grantId)).rejects.toThrow("transport_or_settlement_unknown");
    expect(f.store.dispatches("job")[0]).toMatchObject({ approval: f.approval, status: "unknown", reservedFeeMicrousd: f.prepared.maxFeeMicrousd,
      failure: { phase: "settlement", code: "response_or_usage_invalid" } });
    expect(f.store.dispatches("job")[0]!.feeMicrousd).toBeUndefined();
    await expect(f.dispatch(f.grant())).rejects.toThrow("private_agent_unresolved_dispatch"); expect(f.requests).toHaveLength(1);
  });
});
