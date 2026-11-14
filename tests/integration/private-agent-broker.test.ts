import Database from "better-sqlite3";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STREAM_BYTES_PER_TOKEN_BOUND, localStreamSettings } from "../../src/main/liveness";
import { BROKER_MAX_BODY_BYTES, BrokerError, PrivateAgentBroker, dispatchDisclosure, STREAM_MAX_RAW_BYTES, SseStreamError, SseTruncated, assembleSseChatCompletion, isPublicAddress, type BrokerDestination, type BrokerRequest, type LocalPacketScanner } from "../../src/main/private-agent/broker";
import { PrivateAgentStore, SETTLEMENT_SUBCODES, UnknownRequestDiagnosticSchema, isBlockingDispatch, isConfirmedAbort, isRetryableAbort, type DispatchReceipt, type UnknownRequestDiagnostic } from "../../src/main/private-agent/store";
import { digest } from "../../src/main/private-agent/contracts";
import { PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE } from "../../src/main/private-agent/dispatch-purposes";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { everySupersededRowHasASuccessor, watchWaits } from "../helpers/retry-waits";

const clean: LocalPacketScanner = { scan: async () => ({ complete: true, blocked: false, detector: "deliberate-false-negative-fixture" }) };
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(options: { mode?: "private" | "cloud_help" | "offline"; classification?: "private" | "public";
  scanner?: LocalPacketScanner; synthetic?: boolean; kind?: BrokerDestination["kind"]; privateDataAdmitted?: boolean;
  databasePath?: string; handler?: http.RequestListener; timeoutMs?: number; maxResponseBytes?: number; recoverable?: boolean; maxRequests?: number } = {}) {
  const requests: { body: string; authorization?: string; url?: string }[] = [];
  const server = http.createServer((request, response) => {
    let body = ""; request.on("data", chunk => { body += chunk; });
    request.on("end", () => { requests.push({ body, authorization: request.headers.authorization, url: request.url });
      if (options.handler) options.handler(request, response);
      else response.end('{"ok":true}'); });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const port = (server.address() as { port: number }).port;
  const db = new Database(options.databasePath ?? ":memory:"); cleanups.push(() => { if (db.open) db.close(); });
  const store = new PrivateAgentStore(db);
  store.createJob({ id: "job", version: 1, revision: 0, cancelled: false, mode: options.mode ?? "cloud_help", destinations: ["target"], maxRequests: options.maxRequests ?? 10, maxFeeMicrousd: 1000 });
  store.createContext({ id: "context", jobId: "job", sources: [{ id: "input", version: digest("private input"), classification: options.classification ?? "private", synthetic: options.synthetic ?? true }] });
  const destination: BrokerDestination = { id: "target", kind: options.kind ?? "cloud_model", endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
    accountId: "synthetic-account", credentialVersion: 1, privateDataAdmitted: options.privateDataAdmitted ?? false,
    loopbackFixture: true, maxResponseBytes: options.maxResponseBytes ?? 2048, timeoutMs: options.timeoutMs ?? 1000,
    ...(options.recoverable ? { recoverable: true } : {}),
    ...(options.kind === "public_web" ? {} : { apiKey: "synthetic-host-only-credential" }) };
  const broker = new PrivateAgentBroker(store, [destination], options.scanner ?? clean);
  const input: BrokerRequest = { jobId: "job", contextId: "context", destinationId: "target", purpose: "bounded consultation",
    method: options.kind === "public_web" ? "GET" : "POST", ...(options.kind === "public_web" ? {} : { body: '{"question":"synthetic secret"}' }), maxFeeMicrousd: 100 };
  const release = (id = "grant", overrides = {}) => {
    const { text: _text, ...preview } = broker.preview(input);
    store.grant({ ...preview, id, expiresAt: Date.now() + 60000, remainingUses: 1, revoked: false, ...overrides });
    return { ...input, grantId: id };
  };
  return { broker, store, db, input, release, requests, destination };
}

describe("private agent real host transport", () => {
  it("keeps the exact byte cap and rejects overflow before scan, commit or transport", async () => {
    let scans = 0;
    const f = await fixture({ classification: "public", scanner: { scan: async () => { scans++; return { complete: true, blocked: false, detector: "fixture" }; } } });
    const body = "é".repeat(BROKER_MAX_BODY_BYTES / 2);
    expect(() => f.broker.preview({ ...f.input, body })).not.toThrow();
    await expect(f.broker.request({ ...f.input, body: `${body}x` })).rejects.toThrow("packet_size_exceeded");
    expect(scans).toBe(0); expect(f.requests).toEqual([]); expect(f.store.dispatches("job")).toEqual([]);
  });

  it("never sends private-derived packets when every detector returns clean", async () => {
    const f = await fixture();
    await expect(f.broker.request(f.input)).rejects.toThrow("private_disclosure_requires_exact_grant");
    expect(f.requests).toEqual([]); expect(f.store.dispatches("job")).toEqual([]);
  });

  it("sends an exact released packet once with the credential injected only by the host", async () => {
    const f = await fixture(); const released = f.release();
    const response = await f.broker.request(released, () => 70);
    expect(response.bytes.toString()).toBe('{"ok":true}');
    expect(f.requests).toEqual([{ body: f.input.body, authorization: "Bearer synthetic-host-only-credential", url: "/v1/chat/completions" }]);
    expect(f.broker.preview(f.input).text).not.toContain("synthetic-host-only-credential");
    expect(f.store.dispatches("job")[0]).toMatchObject({ status: "settled", feeMicrousd: 70 });
    await expect(f.broker.request(released)).rejects.toThrow();
    expect(f.requests).toHaveLength(1);
  });

  it.each(["private", "offline"] as const)("%s mode blocks cloud even for public inputs", async mode => {
    const f = await fixture({ mode, classification: "public" });
    await expect(f.broker.request(f.input)).rejects.toThrow();
    expect(f.requests).toEqual([]);
  });

  it("keeps public-only requests useful without a private release", async () => {
    const f = await fixture({ classification: "public" });
    await f.broker.request(f.input);
    expect(f.requests).toHaveLength(1);
  });

  it("requires independently admitted local deployment for non-synthetic private text", async () => {
    const f = await fixture({ kind: "local_model", mode: "private", synthetic: false });
    await expect(f.broker.request(f.input)).rejects.toThrow("local_destination_unverified");
    expect(f.requests).toEqual([]);
  });

  it.each(["payload", "purpose", "destination", "account", "policy", "lineage", "expired", "revoked"])("denies %s drift before a receiver sees bytes", async drift => {
    const f = await fixture(); let request = f.release("grant", drift === "expired" ? { expiresAt: Date.now() - 100 } : {});
    if (drift === "payload") request = { ...request, body: request.body + " " };
    if (drift === "purpose") request = { ...request, purpose: "another purpose" };
    if (drift === "destination") request = { ...request, url: f.destination.endpoint + "?changed=1" };
    if (drift === "account") f.broker = new PrivateAgentBroker(f.store, [{ ...f.destination, accountId: "different-account" }], clean);
    if (drift === "policy") f.store.revisePolicy("job", { mode: "cloud_help", destinations: ["target"] });
    if (drift === "lineage") f.store.addSources("context", [{ id: "new-file", version: digest("new context"), classification: "private", synthetic: true }]);
    if (drift === "revoked") f.store.revoke("grant");
    await expect(f.broker.request(request)).rejects.toThrow();
    expect(f.requests).toEqual([]); expect(f.store.dispatches("job")).toEqual([]);
  });

  it("rechecks revocation after a slow detector returns", async () => {
    let finish!: () => void;
    const scan = new Promise<void>(resolve => { finish = resolve; });
    const f = await fixture({ scanner: { scan: async () => { await scan; return clean.scan(""); } } });
    const pending = f.broker.request(f.release()); f.store.revoke("grant"); finish();
    await expect(pending).rejects.toThrow(); expect(f.requests).toEqual([]);
  });

  it("permits at most one concurrent consumer of a one-use grant", async () => {
    const f = await fixture(); const request = f.release();
    const results = await Promise.allSettled([f.broker.request(request), f.broker.request(request)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(f.requests).toHaveLength(1);
  });

  it("blocks incomplete scans and cancellation before dispatch", async () => {
    const f = await fixture({ classification: "public", scanner: { scan: async () => ({ complete: false, blocked: false, detector: "failed" }) } });
    await expect(f.broker.request(f.input)).rejects.toThrow("packet_scan_incomplete_or_blocked");
    f.broker.cancelJob("job");
    await expect(f.broker.request(f.input)).rejects.toThrow("job_cancelled");
    expect(f.requests).toEqual([]);
  });

  it("rejects ambient key values even with exact disclosure authority", async () => {
    const f = await fixture({ classification: "public" });
    await expect(f.broker.request({ ...f.input, body: "synthetic-host-only-credential" })).rejects.toThrow("credential_in_packet");
    expect(f.requests).toEqual([]);
  });

  it("does not follow redirects: a redirect is a confirmed rejection, resolved without retry", async () => {
    const f = await fixture({ classification: "public", handler: (_request, response) => {
      response.writeHead(302, { location: "/canary-exfiltration" }); response.end();
    } });
    await expect(f.broker.request(f.input)).rejects.toThrow("request_failed");
    expect(f.store.dispatches("job")[0]).toMatchObject({ status: "failed", reservedFeeMicrousd: 100,
      failure: { phase: "transport", code: "http_rejected", status: 302, timeoutMs: 1000 } });
    expect(f.requests).toHaveLength(1); expect(f.requests[0]!.url).not.toContain("canary");
  });
  it("never retries an unknown result after store reopening", async () => {
    const dir = mkdtempSync(join(tmpdir(), "soar-private-broker-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const f = await fixture({ classification: "public", databasePath: join(dir, "state.sqlite"), timeoutMs: 200, handler: () => {} });
    await expect(f.broker.request(f.input)).rejects.toThrow("transport_or_settlement_unknown");
    expect(f.store.dispatches("job")[0]).toMatchObject({ status: "unknown", reservedFeeMicrousd: 100, failure: { phase: "transport", code: "request_timeout", timeoutMs: 200 } });
    const reopened = new Database(join(dir, "state.sqlite")); cleanups.push(() => { reopened.close(); });
    const second = new PrivateAgentBroker(new PrivateAgentStore(reopened), [f.destination], clean);
    expect(new PrivateAgentStore(reopened).dispatches("job")).toEqual(f.store.dispatches("job"));
    await expect(second.request(f.input)).rejects.toMatchObject({ code: "unresolved_dispatch" });
    expect(f.requests).toHaveLength(1);
  });

  it("accounts an already committed cancellation as possibly disclosed and stops future commits", async () => {
    let arrived!: () => void; const seen = new Promise<void>(resolve => { arrived = resolve; });
    const f = await fixture({ classification: "public", handler: () => arrived() });
    const pending = f.broker.request(f.input); await seen; f.broker.cancelJob("job");
    await expect(pending).rejects.toThrow("transport_or_settlement_unknown");
    await expect(f.broker.request(f.input)).rejects.toThrow("job_cancelled");
    expect(f.requests).toHaveLength(1); expect(f.store.dispatches("job")[0]).toMatchObject({ status: "unknown",
      failure: { phase: "transport", code: "cancelled", timeoutMs: 1000 } });
  });

  it("keeps public web GET requests behind the same disclosure boundary", async () => {
    const f = await fixture({ kind: "public_web" });
    await expect(f.broker.request(f.input)).rejects.toThrow("private_disclosure_requires_exact_grant");
    await f.broker.request(f.release());
    expect(f.requests).toHaveLength(1); expect(f.requests[0]?.authorization).toBeUndefined();
  });

  it("prevents task and context mixing", async () => {
    const f = await fixture({ classification: "public" });
    f.store.createJob({ ...f.store.policy("job"), id: "another-job" });
    await expect(f.broker.request({ ...f.input, jobId: "another-job" })).rejects.toThrow("packet_context_invalid");
    expect(f.requests).toEqual([]);
  });

  it("excludes host-classified credential sources from every model context", async () => {
    const f = await fixture({ classification: "public", kind: "local_model", privateDataAdmitted: true });
    const credential = { id: "imported-credential", version: digest("synthetic imported credential"), classification: "credential" as const, synthetic: true };
    expect(() => f.store.createContext({ id: "credential-context", jobId: "job", sources: [credential] })).toThrow("private_agent_credential_in_context");
    expect(() => f.store.addSources("context", [credential])).toThrow("private_agent_credential_in_context");
    expect(f.store.context("context").sources).toHaveLength(1);
    expect(f.requests).toEqual([]);
  });

  it("retains admitted local computation if learned filtering is unavailable", async () => {
    const f = await fixture({ kind: "local_model", mode: "private", privateDataAdmitted: true,
      scanner: { scan: async () => { throw new Error("synthetic detector unavailable"); } } });
    const result = await f.broker.request(f.input);
    expect(result.receipt.scan).toEqual({ status: "not_required_inside_boundary" });
    expect(f.requests).toHaveLength(1);
  });
});

describe("unknown request diagnostics", () => {
  const sensitive = "synthetic-private-provider-detail";
  function diagnostic(f: Awaited<ReturnType<typeof fixture>>, phase: string, code: string) {
    const receipt = f.store.dispatches("job")[0]!;
    expect(receipt).toMatchObject({ status: "unknown", reservedFeeMicrousd: 100,
      failure: { phase, code, timeoutMs: f.destination.timeoutMs } });
    expect(receipt.feeMicrousd).toBeUndefined(); expect(receipt.responseSha256).toBeUndefined();
    expect(UnknownRequestDiagnosticSchema.safeParse(receipt.failure).success).toBe(true);
    expect(receipt.failure!.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(receipt)).not.toContain(sensitive);
    expect(Object.keys(receipt.failure!).sort()).toEqual(phase === "settlement" ? ["code", "elapsedMs", "phase", "subcode", "timeoutMs"] : ["code", "elapsedMs", "phase", "timeoutMs"]);
    return receipt.failure!;
  }

  it("records its own timeout and cannot be relabelled by later cancellation", async () => {
    const external = new AbortController();
    const dir = mkdtempSync(join(tmpdir(), "soar-private-timeout-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const databasePath = join(dir, "state.sqlite");
    const f = await fixture({ classification: "public", databasePath, timeoutMs: 100, handler: () => {} });
    await expect(f.broker.request({ ...f.input, signal: external.signal })).rejects.toThrow("transport_or_settlement_unknown");
    const failure = diagnostic(f, "transport", "request_timeout");
    expect(failure.elapsedMs).toBeGreaterThanOrEqual(90);
    external.abort(new Error(sensitive));
    expect(f.store.dispatches("job")[0]!.failure).toEqual(failure);
    await expect(f.broker.request(f.input)).rejects.toMatchObject({ code: "unresolved_dispatch" });
    const originalReceipts = f.store.dispatches("job");
    f.db.close();
    const reopened = new Database(databasePath, { fileMustExist: true }); cleanups.push(() => { reopened.close(); });
    const restored = new PrivateAgentStore(reopened);
    expect(restored.dispatches("job")).toEqual(originalReceipts);
    await expect(new PrivateAgentBroker(restored, [f.destination], clean).request(f.input)).rejects.toMatchObject({ code: "unresolved_dispatch" });
    expect(f.requests).toHaveLength(1);
  });

  it("external task cancellation before the request timer is a cancellation, without its raw reason", async () => {
    let arrived!: () => void; const seen = new Promise<void>(resolve => { arrived = resolve; });
    const f = await fixture({ classification: "public", timeoutMs: 1000, handler: () => arrived() });
    const external = new AbortController(), pending = f.broker.request({ ...f.input, signal: external.signal });
    await seen; external.abort(new Error(sensitive));
    await expect(pending).rejects.toThrow("transport_or_settlement_unknown");
    diagnostic(f, "transport", "cancelled");
    await expect(f.broker.request(f.input)).rejects.toMatchObject({ code: "unresolved_dispatch" });
    expect(f.requests).toHaveLength(1);
  });

  it.each(["declared_oversize", "streamed_oversize"] as const)("classifies controlled %s as uncertain without storing provider text", async kind => {
    const f = await fixture({ classification: "public", maxResponseBytes: 8, handler: (_request, response) => {
      if (kind === "declared_oversize") { response.writeHead(200, { "content-length": String(sensitive.length) }); response.end(sensitive); }
      else { response.write(sensitive); response.end(); }
    } });
    await expect(f.broker.request(f.input)).rejects.toThrow("transport_or_settlement_unknown");
    diagnostic(f, "transport", "response_oversize");
    await expect(f.broker.request(f.input)).rejects.toMatchObject({ code: "unresolved_dispatch" });
    expect(f.requests).toHaveLength(1);
  });
  it("classifies an error answer as a confirmed abort for any destination: resolved, never retried without the flag, never blocking", async () => {
    const f = await fixture({ classification: "public", maxResponseBytes: 8, handler: (_request, response) => { response.writeHead(503); response.end(sensitive); } });
    await expect(f.broker.request(f.input)).rejects.toThrow("request_failed");
    const receipt = f.store.dispatches("job")[0]!;
    expect(receipt).toMatchObject({ status: "failed", reservedFeeMicrousd: 100, failure: { phase: "transport", code: "http_rejected", status: 503, timeoutMs: f.destination.timeoutMs } });
    expect(receipt.failure).not.toHaveProperty("attempt"); expect(JSON.stringify(receipt)).not.toContain(sensitive);
    expect(UnknownRequestDiagnosticSchema.safeParse(receipt.failure).success).toBe(true);
    // A resolved failure does not block the job: the next request is admitted (and fails the same way here).
    await expect(f.broker.request(f.input)).rejects.toThrow("request_failed");
    expect(f.requests).toHaveLength(2);
    // A status outside the schema's range is still an answer, recorded without the status.
    const odd = await fixture({ classification: "public", handler: (_request, response) => { response.writeHead(999); response.end(); } });
    await expect(odd.broker.request(odd.input)).rejects.toThrow("request_failed");
    expect(odd.store.dispatches("job")[0]).toMatchObject({ status: "failed", failure: { code: "http_rejected" } }); expect(odd.store.dispatches("job")[0]!.failure).not.toHaveProperty("status");
  });
  it("keeps a peer close uncertain for a priced or cloud packet, and confirmed only for a zero-risk one", async () => {
    const cloud = await fixture({ classification: "public", handler: request => request.socket.destroy(new Error(sensitive)) });
    await expect(cloud.broker.request(cloud.input)).rejects.toThrow("transport_or_settlement_unknown");
    expect(cloud.store.dispatches("job")[0]).toMatchObject({ status: "unknown", failure: { phase: "transport", code: "upstream_closed" } });
    expect(JSON.stringify(cloud.store.dispatches("job")[0])).not.toContain(sensitive);
    await expect(cloud.broker.request(cloud.input)).rejects.toMatchObject({ code: "unresolved_dispatch" });
    const local = await fixture({ kind: "local_model", privateDataAdmitted: true, classification: "public", handler: request => request.socket.destroy(new Error(sensitive)) });
    await expect(local.broker.request({ ...local.input, maxFeeMicrousd: 0 })).rejects.toThrow("request_failed");
    expect(local.store.dispatches("job")[0]).toMatchObject({ status: "failed", failure: { code: "upstream_closed" } });
    // A close after the response started is its own code; confirmed only for the zero-risk packet.
    // Headers and a first byte reach the client before the peer drops the connection.
    const interrupted = (request: http.IncomingMessage, response: http.ServerResponse) => { response.writeHead(200); response.write("{"); setTimeout(() => request.socket.destroy(), 80); };
    const cloudMid = await fixture({ classification: "public", handler: interrupted });
    await expect(cloudMid.broker.request(cloudMid.input)).rejects.toThrow("transport_or_settlement_unknown");
    expect(cloudMid.store.dispatches("job")[0]).toMatchObject({ status: "unknown", failure: { code: "response_interrupted" } });
    const localMid = await fixture({ kind: "local_model", privateDataAdmitted: true, classification: "public", handler: interrupted });
    await expect(localMid.broker.request({ ...localMid.input, maxFeeMicrousd: 0 })).rejects.toThrow("request_failed");
    expect(localMid.store.dispatches("job")[0]).toMatchObject({ status: "failed", failure: { code: "response_interrupted" } });
  });

  it.each(["invalid_json", "invalid_usage", "spoofed_transport"] as const)("settlement validation %s cannot impersonate transport failure", async kind => {
    const f = await fixture({ classification: "public", handler: (_request, response) => response.end(sensitive) });
    await expect(f.broker.request(f.input, bytes => {
      if (kind === "invalid_json") return JSON.parse(bytes.toString()).fee;
      if (kind === "spoofed_transport") throw new BrokerError("transport_status_denied");
      throw new Error(sensitive);
    })).rejects.toThrow("transport_or_settlement_unknown");
    diagnostic(f, "settlement", "response_or_usage_invalid");
    await expect(f.broker.request(f.input)).rejects.toMatchObject({ code: "unresolved_dispatch" });
  });

  it.each([101, Number.NaN, -1])("records invalid settled fee %s as settlement, retaining the reservation", async fee => {
    const f = await fixture({ classification: "public" });
    await expect(f.broker.request(f.input, () => fee)).rejects.toThrow("transport_or_settlement_unknown");
    diagnostic(f, "settlement", "fee_settlement_failed");
  });

  it("validates fixed metadata before writes and preserves legacy unknown rows unchanged", async () => {
    const f = await fixture({ classification: "public" });
    const { text: _text, ...preview } = f.broker.preview(f.input);
    const row = f.store.commit({ ...preview, reservedFeeMicrousd: 100, scan: { status: "complete", detector: "synthetic" } }, () => {});
    const valid = { phase: "transport", code: "request_timeout", elapsedMs: 101, timeoutMs: 100 } as const;
    for (const change of [{ code: sensitive }, { phase: "settlement" }, { elapsedMs: -1 }, { elapsedMs: 3_600_001 },
      { elapsedMs: Number.NaN }, { elapsedMs: 0.5 }, { timeoutMs: 900_001 }, { timeoutMs: 0 }, { detail: sensitive }, { subcode: "other" }]) {
      expect(() => f.store.unknown(row.id, { ...valid, ...change } as UnknownRequestDiagnostic)).toThrow("private_agent_unknown_diagnostic_invalid");
      expect(f.store.dispatch(row.id)).toEqual(row);
    }
    expect(() => f.store.commit({ ...row, failure: valid } as never, () => {})).toThrow("private_agent_admission_changed");
    f.store.unknown(row.id);
    const legacy = f.store.dispatch(row.id); expect(legacy.failure).toBeUndefined();
    f.store.unknown(row.id, valid); expect(f.store.dispatch(row.id)).toEqual(legacy);
    expect(f.requests).toEqual([]);
    // A settlement diagnostic may name the refusing check from the fixed list only; rows written before the field have none.
    const settlement = { phase: "settlement", code: "fee_settlement_failed", elapsedMs: 1, timeoutMs: 100 } as const;
    expect(UnknownRequestDiagnosticSchema.safeParse(settlement).success).toBe(true);
    for (const subcode of SETTLEMENT_SUBCODES) expect(UnknownRequestDiagnosticSchema.safeParse({ ...settlement, subcode }).success).toBe(true);
    expect(UnknownRequestDiagnosticSchema.safeParse({ ...settlement, subcode: sensitive }).success).toBe(false);
    expect(UnknownRequestDiagnosticSchema.safeParse({ ...settlement, subcode: "" }).success).toBe(false);
  });
});

describe("public address admission", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.168.1.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2001:0db8:0000::1", "2001::1", "2001:0000::1", "3fff::1"])("rejects %s", address => expect(isPublicAddress(address)).toBe(false));
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("accepts global address %s", address => expect(isPublicAddress(address)).toBe(true));

  it("admits a per-destination request body cap only within the ceiling and applies it to packets", async () => {
    const f = await fixture({ classification: "public" });
    const larger = { ...f.destination, id: "larger", maxRequestBytes: 640 * 1024 };
    const scanner: LocalPacketScanner = { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) };
    const broker = new PrivateAgentBroker(f.store, [f.destination, larger], scanner);
    const base = { jobId: "job", contextId: "context", purpose: "cap fixture", method: "POST" as const, maxFeeMicrousd: 0 };
    const body = "x".repeat(BROKER_MAX_BODY_BYTES + 1);
    expect(() => broker.preview({ ...base, destinationId: f.destination.id, body })).toThrow("packet_size_exceeded");
    expect(broker.preview({ ...base, destinationId: "larger", body }).packetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => broker.preview({ ...base, destinationId: "larger", body: "x".repeat(640 * 1024 + 1) })).toThrow("packet_size_exceeded");
    for (const bad of [{ maxRequestBytes: 4095 }, { maxRequestBytes: 4 * 1024 * 1024 + 1 }, { maxRequestBytes: 1.5 }, { timeoutMs: 900_001 }]) {
      expect(() => new PrivateAgentBroker(f.store, [{ ...f.destination, ...bad }], scanner)).toThrow();
    }
    expect(() => new PrivateAgentBroker(f.store, [{ ...f.destination, timeoutMs: 900_000, maxRequestBytes: 4 * 1024 * 1024 }], scanner)).not.toThrow();
  });
});

describe("cloud arm admission and fee cap (PR-E)", () => {
  it("admits only an explicitly grant-free synthetic-only cloud destination to a wholly synthetic lineage under cloud_help", async () => {
    const grantFree = { syntheticOnly: true, grantFreeSynthetic: true };
    const f = await fixture({ kind: "cloud_model", synthetic: true, classification: "private", mode: "cloud_help" });
    const broker = new PrivateAgentBroker(f.store, [{ ...f.destination, ...grantFree }], clean);
    expect((await broker.request({ ...f.input, purpose: "agent reasoning and tool selection" })).receipt.status).toBe("settled");
    expect(f.requests).toHaveLength(1);
    // Synthetic-only alone (no grant-free declaration) still needs an exact grant; so does a plain cloud destination.
    const plain = await fixture({ kind: "cloud_model", synthetic: true, classification: "private", mode: "cloud_help" });
    await expect(plain.broker.request(plain.input)).rejects.toThrow("private_disclosure_requires_exact_grant");
    await expect(new PrivateAgentBroker(plain.store, [{ ...plain.destination, syntheticOnly: true }], clean).request(plain.input)).rejects.toThrow("private_disclosure_requires_exact_grant");
    // The desktop consultant's real shape (synthetic-only with an exact-grant binding) is denied at the grant check, never admitted.
    const consultantShape = { ...plain.destination, syntheticOnly: true, requireExactGrant: true, approvalPriceProfileSha256: "a".repeat(64) };
    await expect(new PrivateAgentBroker(plain.store, [consultantShape], clean).request(plain.input)).rejects.toThrow("exact_grant_required");
    // The declaration is refused at construction anywhere it could widen access.
    for (const bad of [{ ...consultantShape, grantFreeSynthetic: true }, { ...plain.destination, grantFreeSynthetic: true }, { ...plain.destination, syntheticOnly: true, grantFreeSynthetic: true, privateDataAdmitted: true }]) {
      expect(() => new PrivateAgentBroker(plain.store, [bad as BrokerDestination], clean)).toThrow("destination_grant_free_invalid");
    }
    const local = await fixture({ kind: "local_model", synthetic: true, classification: "private", mode: "cloud_help", privateDataAdmitted: true });
    expect(() => new PrivateAgentBroker(local.store, [{ ...local.destination, ...grantFree }], clean)).toThrow("destination_grant_free_invalid");
    // A non-synthetic private source is denied before anything else, and a private policy denies cloud outright.
    const real = await fixture({ kind: "cloud_model", synthetic: false, classification: "private", mode: "cloud_help" });
    await expect(new PrivateAgentBroker(real.store, [{ ...real.destination, ...grantFree }], clean).request(real.input)).rejects.toThrow("synthetic_destination_private_data_denied");
    const offline = await fixture({ kind: "cloud_model", synthetic: true, classification: "private", mode: "private" });
    await expect(new PrivateAgentBroker(offline.store, [{ ...offline.destination, ...grantFree }], clean).request(offline.input)).rejects.toThrow("cloud_mode_denied");
    expect(plain.requests).toHaveLength(0); expect(real.requests).toHaveLength(0); expect(offline.requests).toHaveLength(0);
  });
  it("refuses a request the fee cap cannot cover with a broker code and no row", async () => {
    const f = await fixture({ classification: "public" });
    await expect(f.broker.request({ ...f.input, maxFeeMicrousd: 1001 })).rejects.toThrow("budget_denied");
    expect(f.store.dispatches("job")).toEqual([]); expect(f.requests).toHaveLength(0);
  });
});

describe("recoverable dispatch (owner decision D4)", () => {
  const local = { kind: "local_model" as const, privateDataAdmitted: true, classification: "public" as const, recoverable: true };
  const zeroFee = (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.input, maxFeeMicrousd: 0, purpose: "agent reasoning and tool selection" });
  function flaky(failures: number, mode: "socket" | "503" | "400" | "429") {
    let count = 0;
    const handler: http.RequestListener = (request, response) => {
      count++;
      if (count > failures) { response.end('{"ok":true}'); return; }
      if (mode === "socket") request.socket.destroy(new Error("synthetic reset"));
      else { response.writeHead(Number(mode)); response.end("synthetic provider error"); }
    };
    return handler;
  }
  it.each(["socket", "503", "429"] as const)("retries a zero-fee local request after a confirmed %s abort, at most twice, one row per attempt", async mode => {
    const f = await fixture({ ...local, handler: flaky(2, mode) });
    const started = Date.now();
    const result = await f.broker.request(zeroFee(f));
    expect(result.receipt.status).toBe("settled"); expect(f.requests).toHaveLength(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(3_900);
    const rows = f.store.dispatches("job");
    expect(rows.map(row => row.status)).toEqual(["superseded", "superseded", "settled"]); everySupersededRowHasASuccessor(rows);
    expect(rows[0]!.failure).toMatchObject({ phase: "transport", code: mode === "socket" ? "upstream_closed" : "http_rejected", attempt: 1, ...(mode === "socket" ? {} : { status: Number(mode) }) });
    expect(rows[1]!.failure).toMatchObject({ attempt: 2 });
    expect(rows.every(row => JSON.stringify(row).includes("synthetic provider error") === false)).toBe(true);
    // Every attempt consumed a session request; superseded rows reserve no fee.
    expect(rows.every(row => row.reservedFeeMicrousd === 0)).toBe(true);
  }, 20_000);
  it("gives up after the third confirmed abort with a resolved failed row and a distinct error", async () => {
    const f = await fixture({ ...local, handler: flaky(3, "socket") });
    await expect(f.broker.request(zeroFee(f))).rejects.toThrow("request_failed");
    expect(f.store.dispatches("job").map(row => row.status)).toEqual(["superseded", "superseded", "failed"]); everySupersededRowHasASuccessor(f.store.dispatches("job"));
    expect(f.store.dispatches("job")[2]!.failure).toMatchObject({ code: "upstream_closed", attempt: 3 });
    await f.broker.request(zeroFee(f)); // a later request is admitted: nothing is unresolved
    expect(f.store.dispatches("job").at(-1)!.status).toBe("settled");
  }, 20_000);
  it("does not retry a deterministic 4xx, a timeout, a priced request or a flagless destination", async () => {
    const bad = await fixture({ ...local, handler: flaky(1, "400") });
    await expect(bad.broker.request(zeroFee(bad))).rejects.toThrow("request_failed");
    expect(bad.store.dispatches("job").map(row => row.status)).toEqual(["failed"]); expect(bad.requests).toHaveLength(1);
    // A zero-fee timeout resolves `failed` (backlog item 1) and is not worth another attempt.
    const slow = await fixture({ ...local, timeoutMs: 200, handler: () => {} });
    await expect(slow.broker.request(zeroFee(slow))).rejects.toThrow("request_failed");
    expect(slow.store.dispatches("job").map(row => [row.status, row.failure?.code])).toEqual([["failed", "request_timeout"]]); expect(slow.requests).toHaveLength(1);
    // A priced request is not zero-risk: a peer close stays uncertain and is never retried.
    const priced = await fixture({ ...local, handler: flaky(1, "socket") });
    await expect(priced.broker.request({ ...zeroFee(priced), maxFeeMicrousd: 1 })).rejects.toThrow("transport_or_settlement_unknown");
    expect(priced.store.dispatches("job").map(row => row.status)).toEqual(["unknown"]); expect(priced.requests).toHaveLength(1);
    const flagless = await fixture({ ...local, recoverable: false, handler: flaky(1, "socket") });
    await expect(flagless.broker.request(zeroFee(flagless))).rejects.toThrow("request_failed");
    expect(flagless.store.dispatches("job").map(row => row.status)).toEqual(["failed"]); expect(flagless.requests).toHaveLength(1);
  });
  it("retries an idempotent public GET but never a cloud destination, and stops at the session request allowance or on cancel", async () => {
    const web = await fixture({ kind: "public_web", classification: "public", recoverable: true, handler: flaky(1, "503") });
    const result = await web.broker.request({ ...web.input, maxFeeMicrousd: 0, purpose: "public source retrieval" });
    expect(result.receipt.status).toBe("settled"); expect(web.store.dispatches("job").map(row => row.status)).toEqual(["superseded", "settled"]);
    await expect(fixture({ kind: "cloud_model", recoverable: true })).rejects.toThrow("destination_recoverable_invalid");
    // No session request left for another attempt: the last admissible attempt resolves as failed, never a superseded row without a successor.
    const capped = await fixture({ ...local, maxRequests: 2, handler: flaky(3, "socket") });
    await expect(capped.broker.request(zeroFee(capped))).rejects.toThrow("request_failed");
    expect(capped.store.dispatches("job").map(row => row.status)).toEqual(["superseded", "failed"]);
    // Cancelled during the backoff: the row is resolved as failed and the caller sees the confirmed failure.
    const cancel = new AbortController(), cancelled = await fixture({ ...local, handler: flaky(3, "socket") });
    setTimeout(() => cancel.abort(), 300);
    await expect(cancelled.broker.request({ ...zeroFee(cancelled), signal: cancel.signal })).rejects.toThrow("request_failed");
    expect(cancelled.store.dispatches("job").map(row => row.status)).toEqual(["failed"]);
  }, 20_000);
});

describe("streamed replies (PR-B)", () => {
  // The exact chunk shape the owned vLLM server sent on 2026-10-07 (one probe each for text, reasoning and a tool call).
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ id: "chatcmpl-8e9db066ff8ab022", object: "chat.completion.chunk", created: 1791375149,
    model: "served-model", choices: [{ index: 0, delta, logprobs: null, finish_reason: finish, ...(finish ? { stop_reason: null } : {}), token_ids: null }] });
  const usage = (prompt: number, completion: number) => ({ id: "chatcmpl-8e9db066ff8ab022", object: "chat.completion.chunk", created: 1791375149, model: "served-model", choices: [],
    usage: { prompt_tokens: prompt, total_tokens: prompt + completion, completion_tokens: completion, prompt_tokens_details: { cached_tokens: 0, created_cache_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 } }, system_fingerprint: "fixture" });
  const sse = (chunks: unknown[], done = true) => chunks.map(item => `data: ${JSON.stringify(item)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : "");
  const toolStream = [chunk({ role: "assistant", content: "" }),
    chunk({ tool_calls: [{ id: "chatcmpl-tool-bffa86f0f2505cde", type: "function", index: 0, function: { name: "write_file" } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"path": "' } }] }), chunk({ tool_calls: [{ index: 0, function: { arguments: 'notes.txt", "content": "alpha beta gamma' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"}' } }] }, "tool_calls"), usage(351, 41)];
  const parse = (raw: string) => JSON.parse(assembleSseChatCompletion(raw).toString("utf8"));
  const local = { kind: "local_model" as const, privateDataAdmitted: true, classification: "public" as const };
  const declared = (f: Awaited<ReturnType<typeof fixture>>, stream: { inactivityTimeoutMs: number; maxRawBytes: number }) =>
    new PrivateAgentBroker(f.store, [{ ...f.destination, stream }], clean);
  const zeroFee = (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.input, maxFeeMicrousd: 0, purpose: "agent reasoning and tool selection" });
  const streamed = (body: string, options: { gapMs?: number; firstByteMs?: number; batch?: number } = {}): http.RequestListener => (_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    const events = body.split(/(?<=\n\n)/u).filter(Boolean), batch = options.batch ?? 1;
    let index = 0;
    const send = () => {
      if (index >= events.length) { response.end(); return; }
      response.write(events.slice(index, index + batch).join("")); index += batch; setTimeout(send, options.gapMs ?? 0);
    };
    setTimeout(send, options.firstByteMs ?? 0);
  };

  it("assembles the server's exact tool-call stream and an empty reply into the non-streaming shape", () => {
    expect(parse(sse(toolStream))).toEqual({ id: "chatcmpl-8e9db066ff8ab022", object: "chat.completion", model: "served-model",
      choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "chatcmpl-tool-bffa86f0f2505cde", type: "function",
        function: { name: "write_file", arguments: '{"path": "notes.txt", "content": "alpha beta gamma"}' } }] }, finish_reason: "tool_calls" }],
      usage: usage(351, 41).usage });
    const text = parse(sse([chunk({ role: "assistant", content: "" }), chunk({ reasoning: "dropped" }), chunk({ content: "Hel" }), chunk({ content: "lo" }, "stop"), usage(3, 4)]));
    expect(text.choices[0]).toEqual({ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" });
    expect(parse(sse([chunk({ content: "" }, "stop"), usage(1, 0)])).choices[0].message.content).toBeNull();
    // CRLF framing and SSE comments are protocol.
    expect(parse(": keep-alive\r\n" + sse([chunk({ content: "x" }, "stop"), usage(1, 1)]).replaceAll("\n", "\r\n")).choices[0].message.content).toBe("x");
  });
  it("refuses out-of-protocol streams, and types the server's own error and an early end", () => {
    const invalid = [
      sse([chunk({ content: "x" }, "stop")]),                                                     // [DONE] without usage
      sse([{ ...chunk({ content: "a" }), choices: [{ index: 1, delta: { content: "b" }, finish_reason: null }] }, usage(1, 1)]), // a second choice index
      sse([chunk({ content: "a" }, "stop"), chunk({ content: "late" }), usage(1, 2)]),            // text after the finish reason
      sse([chunk({ content: "a" }, "stop"), usage(1, 1), chunk({ content: "" })]),                // a chunk after the usage chunk
      sse([5, chunk({ content: "" }, "stop"), usage(1, 0)]), sse([[], usage(1, 0)]),              // non-object payloads
      "garbage line\n" + sse([usage(1, 0)]),                                                       // a line that is not SSE
      sse([chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "n", arguments: "" } }] }), chunk({ tool_calls: [{ index: 0, id: "b", function: { arguments: "{}" } }] }, "tool_calls"), usage(1, 1)]),
      sse([chunk({ tool_calls: [{ id: "c", function: { name: "n", arguments: "" } }] }, "tool_calls"), usage(1, 1)]), // a fragment without an index
      sse([chunk({ content: "x" }, "stop"), usage(1, 1)]) + "data: {}\n\n",                        // anything after [DONE]
    ];
    for (const raw of invalid) {
      expect(() => assembleSseChatCompletion(raw)).toThrow();
      try { assembleSseChatCompletion(raw); } catch (error) { expect(error).not.toBeInstanceOf(SseStreamError); expect(error).not.toBeInstanceOf(SseTruncated); }
    }
    const typed = (raw: string) => { try { assembleSseChatCompletion(raw); } catch (error) { return error; } throw new Error("expected a throw"); };
    const failure = typed(sse([chunk({ content: "partial" }), { error: { object: "error", message: "EngineDeadError", type: "InternalServerError", param: null, code: 500 } }]));
    expect(failure).toBeInstanceOf(SseStreamError); expect((failure as SseStreamError).status).toBe(500);
    expect((typed(sse([{ error: { message: "no code" } }])) as SseStreamError).status).toBeUndefined();
    expect(typed(sse([chunk({ content: "a" })], false))).toBeInstanceOf(SseTruncated);
    expect(typed(sse([chunk({ content: "a" })], false) + 'data: {"id":"chatcmpl-8e9d')).toBeInstanceOf(SseTruncated); // cut mid-line
  });
  it("settles a heavy-profile turn of one-token chunks under the token-derived raw cap, assembled far below the reply cap", async () => {
    const reasoning = Array.from({ length: 16_000 }, (_, index) => chunk({ reasoning: ` r${index % 10}` }));
    const answer = Array.from({ length: 384 }, () => chunk({ content: " w" }));
    const raw = sse([chunk({ role: "assistant", content: "" }), ...reasoning, ...answer.slice(0, -1), chunk({ content: " w" }, "length"), usage(9000, 16_384)]);
    const settings = localStreamSettings(900_000, 256 * 1024, 16_384);
    expect(raw.length).toBeGreaterThan(256 * 1024 * 4); expect(raw.length).toBeLessThan(settings.maxRawBytes);
    const f = await fixture({ ...local, maxResponseBytes: 256 * 1024, timeoutMs: 20_000, handler: streamed(raw, { batch: 512 }) });
    let assembled = 0;
    const result = await declared(f, { ...settings, inactivityTimeoutMs: 5000 }).request(zeroFee(f), bytes => { assembled = bytes.length; expect(JSON.parse(bytes.toString("utf8")).choices[0].finish_reason).toBe("length"); return 0; });
    expect(result.receipt.status).toBe("settled"); expect(assembled).toBeLessThan(4096);
  }, 30_000);
  it("returns an undeclared destination's event stream as received, and a declared one's JSON answer as before", async () => {
    const raw = sse([chunk({ content: "ok" }, "stop"), usage(1, 1)]);
    const undeclared = await fixture({ ...local, maxResponseBytes: 64 * 1024, handler: streamed(raw) });
    await undeclared.broker.request(zeroFee(undeclared), bytes => { expect(bytes.toString("utf8")).toBe(raw); return 0; });
    const json = await fixture({ ...local, handler: (_request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end('{"ok":true}'); } });
    await declared(json, { inactivityTimeoutMs: 1000, maxRawBytes: 4096 }).request(zeroFee(json), bytes => { expect(bytes.toString("utf8")).toBe('{"ok":true}'); return 0; });
  });
  it("starts the inactivity clock at the first byte, and records a mid-stream stall as a failed inactivity_timeout that is never retried", async () => {
    const body = sse([chunk({ content: "a" }), chunk({ content: "b" }, "stop"), usage(1, 2)]);
    // Prefill: headers at once, the first byte 1.5 s later, past the 1 s inactivity limit but inside the request deadline.
    const prefill = await fixture({ ...local, recoverable: true, timeoutMs: 5000, handler: streamed(body, { firstByteMs: 1500 }) });
    expect((await declared(prefill, { inactivityTimeoutMs: 1000, maxRawBytes: 64 * 1024 }).request(zeroFee(prefill), () => 0)).receipt.status).toBe("settled");
    const stalled = await fixture({ ...local, recoverable: true, timeoutMs: 5000, handler: streamed(body, { gapMs: 1500 }) });
    await expect(declared(stalled, { inactivityTimeoutMs: 1000, maxRawBytes: 64 * 1024 }).request(zeroFee(stalled))).rejects.toThrow("request_failed");
    expect(stalled.store.dispatches("job").map(row => [row.status, row.failure?.code])).toEqual([["failed", "inactivity_timeout"]]); expect(stalled.requests).toHaveLength(1);
  }, 20_000);
  it("caps the raw stream and the assembled reply separately, both as a failed oversize on a zero-fee packet", async () => {
    const chatty = sse([...Array.from({ length: 40 }, () => chunk({ reasoning: "x".repeat(40) })), chunk({ content: "ok" }, "stop"), usage(1, 41)]);
    const raw = await fixture({ ...local, maxResponseBytes: 2048, handler: streamed(chatty) });
    await expect(declared(raw, { inactivityTimeoutMs: 1000, maxRawBytes: 4096 }).request(zeroFee(raw))).rejects.toThrow("request_failed");
    expect(raw.store.dispatches("job")[0]).toMatchObject({ status: "failed", failure: { code: "response_oversize" } });
    const long = sse([chunk({ content: "y".repeat(3000) }, "stop"), usage(1, 1)]);
    const assembled = await fixture({ ...local, maxResponseBytes: 2048, handler: streamed(long) });
    await expect(declared(assembled, { inactivityTimeoutMs: 1000, maxRawBytes: 64 * 1024 }).request(zeroFee(assembled))).rejects.toThrow("request_failed");
    expect(assembled.store.dispatches("job")[0]).toMatchObject({ status: "failed", failure: { code: "response_oversize" } });
    // Priced, the same oversize reply is not zero-risk and stays uncertain.
    const priced = await fixture({ ...local, maxResponseBytes: 2048, handler: streamed(long) });
    await expect(declared(priced, { inactivityTimeoutMs: 1000, maxRawBytes: 64 * 1024 }).request({ ...zeroFee(priced), maxFeeMicrousd: 1 })).rejects.toThrow("transport_or_settlement_unknown");
    expect(priced.store.dispatches("job")[0]).toMatchObject({ status: "unknown", failure: { code: "response_oversize" } });
  });
  it("treats the server's in-band error like an HTTP error and an early end like a cut connection; a malformed stream resolves failed without a retry", async () => {
    const stream = { inactivityTimeoutMs: 1000, maxRawBytes: 64 * 1024 };
    const error = (code?: number) => sse([chunk({ role: "assistant", content: "" }), { error: { object: "error", message: "synthetic engine failure", type: "InternalServerError", param: null, ...(code ? { code } : {}) } }]);
    const engine = await fixture({ ...local, recoverable: true, handler: streamed(error(500)) });
    await expect(declared(engine, stream).request(zeroFee(engine))).rejects.toThrow("request_failed");
    expect(engine.store.dispatches("job").map(row => [row.status, row.failure?.code, row.failure && "status" in row.failure ? row.failure.status : undefined]))
      .toEqual([["superseded", "stream_error", 500], ["superseded", "stream_error", 500], ["failed", "stream_error", 500]]);
    expect(engine.store.dispatches("job").some(row => JSON.stringify(row).includes("synthetic engine failure"))).toBe(false);
    const rejected = await fixture({ ...local, recoverable: true, handler: streamed(error(400)) });
    await expect(declared(rejected, stream).request(zeroFee(rejected))).rejects.toThrow("request_failed");
    expect(rejected.store.dispatches("job").map(row => row.status)).toEqual(["failed"]); expect(rejected.requests).toHaveLength(1);
    const uncoded = await fixture({ ...local, recoverable: true, handler: streamed(error()) });
    await expect(declared(uncoded, stream).request(zeroFee(uncoded))).rejects.toThrow("request_failed");
    expect(uncoded.store.dispatches("job").map(row => row.status)).toEqual(["failed"]);
    const cut = await fixture({ ...local, handler: streamed(sse([chunk({ content: "a" })], false)) });
    await expect(declared(cut, stream).request(zeroFee(cut))).rejects.toThrow("request_failed");
    expect(cut.store.dispatches("job")[0]).toMatchObject({ status: "failed", failure: { code: "response_interrupted" } });
    // Priced, the same in-band error is not zero-risk and stays uncertain.
    const priced = await fixture({ ...local, handler: streamed(error(500)) });
    await expect(declared(priced, stream).request({ ...zeroFee(priced), maxFeeMicrousd: 1 })).rejects.toThrow("transport_or_settlement_unknown");
    const broken = await fixture({ ...local, recoverable: true, handler: streamed(sse([chunk({ content: "x" }, "stop")])) });
    await expect(declared(broken, stream).request(zeroFee(broken))).rejects.toThrow("request_failed");
    expect(broken.store.dispatches("job").map(row => [row.status, row.failure?.code])).toEqual([["failed", "stream_invalid"]]); expect(broken.requests).toHaveLength(1);
    // Priced, the malformed stream stays uncertain.
    const brokenPriced = await fixture({ ...local, handler: streamed(sse([chunk({ content: "x" }, "stop")])) });
    await expect(declared(brokenPriced, stream).request({ ...zeroFee(brokenPriced), maxFeeMicrousd: 1 })).rejects.toThrow("transport_or_settlement_unknown");
    expect(brokenPriced.store.dispatches("job").map(row => [row.status, row.failure?.code])).toEqual([["unknown", "stream_invalid"]]);
  }, 20_000);
  it("admits a stream declaration only on a local model destination with sane bounds", async () => {
    const f = await fixture(local);
    const make = (change: Partial<BrokerDestination>) => () => new PrivateAgentBroker(f.store, [{ ...f.destination, ...change }], clean);
    expect(make({ stream: { inactivityTimeoutMs: 1000, maxRawBytes: 4096 } })).not.toThrow();
    for (const stream of [{ inactivityTimeoutMs: 999, maxRawBytes: 4096 }, { inactivityTimeoutMs: 1001, maxRawBytes: 4096 }, { inactivityTimeoutMs: 1000, maxRawBytes: 2047 },
      { inactivityTimeoutMs: 1000, maxRawBytes: STREAM_MAX_RAW_BYTES + 1 }, { inactivityTimeoutMs: 1000, maxRawBytes: 4096, extra: 1 }]) {
      expect(make({ stream: stream as BrokerDestination["stream"] })).toThrow("destination_stream_invalid");
    }
    expect(make({ kind: "cloud_model", privateDataAdmitted: false, stream: { inactivityTimeoutMs: 1000, maxRawBytes: 4096 } })).toThrow("destination_stream_invalid");
    expect(localStreamSettings(300_000, 256 * 1024, 4096)).toEqual({ inactivityTimeoutMs: 120_000, maxRawBytes: 256 * 1024 + 4096 * STREAM_BYTES_PER_TOKEN_BOUND });
    expect(localStreamSettings(60_000, 1024, 1).inactivityTimeoutMs).toBe(60_000);
  });
});

describe("zero-risk failures resolve (backlog item 1 of the 2026-11-05 review)", () => {
  const local = { kind: "local_model" as const, privateDataAdmitted: true, classification: "public" as const };
  const zeroFee = (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.input, maxFeeMicrousd: 0, purpose: "agent reasoning and tool selection" });
  const sensitive = "synthetic-private-provider-detail";
  /** The one row of the job resolved `failed` with its fixed diagnostic: no fee, no response, nothing uncertain left behind. */
  function resolved(f: Awaited<ReturnType<typeof fixture>>, phase: string, code: string, extra: Record<string, unknown> = {}) {
    const rows = f.store.dispatches("job");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", reservedFeeMicrousd: 0, failure: { phase, code, timeoutMs: f.destination.timeoutMs, ...extra } });
    expect(rows[0]!.feeMicrousd).toBeUndefined(); expect(rows[0]!.responseSha256).toBeUndefined();
    expect(UnknownRequestDiagnosticSchema.safeParse(rows[0]!.failure).success).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain(sensitive);
    return rows[0]!;
  }
  it("resolves a zero-fee request timeout as failed, never retried, and admits the next request", async () => {
    const f = await fixture({ ...local, recoverable: true, timeoutMs: 200, handler: () => {} });
    await expect(f.broker.request(zeroFee(f))).rejects.toThrow("request_failed");
    resolved(f, "transport", "request_timeout", { attempt: 1 }); expect(f.requests).toHaveLength(1);
    await expect(f.broker.request(zeroFee(f))).rejects.toThrow("request_failed");
    expect(f.store.dispatches("job").map(row => row.status)).toEqual(["failed", "failed"]); expect(f.requests).toHaveLength(2);
  });
  it("resolves an external cancel and a job cancel mid-request as failed `cancelled` rows without the raw reason", async () => {
    let arrived!: () => void; const seen = new Promise<void>(resolve => { arrived = resolve; });
    let held = true;
    const f = await fixture({ ...local, handler: (_request, response) => { if (held) { held = false; arrived(); return; } response.end('{"ok":true}'); } });
    const external = new AbortController(), pending = f.broker.request({ ...zeroFee(f), signal: external.signal });
    await seen; external.abort(new Error(sensitive));
    await expect(pending).rejects.toThrow("request_failed");
    resolved(f, "transport", "cancelled");
    await f.broker.request(zeroFee(f), () => 0); // nothing is unresolved: the next request settles
    expect(f.store.dispatches("job").map(row => row.status)).toEqual(["failed", "settled"]);
    let arrivedAgain!: () => void; const seenAgain = new Promise<void>(resolve => { arrivedAgain = resolve; });
    const g = await fixture({ ...local, recoverable: true, handler: () => arrivedAgain() });
    const cancelled = g.broker.request(zeroFee(g)); await seenAgain; g.broker.cancelJob("job");
    await expect(cancelled).rejects.toThrow("request_failed");
    resolved(g, "transport", "cancelled", { attempt: 1 }); expect(g.requests).toHaveLength(1);
    await expect(g.broker.request(zeroFee(g))).rejects.toThrow("job_cancelled");
  });
  it("resolves a declared and a streamed oversize reply and an unclassified transport failure as failed", async () => {
    const declared = await fixture({ ...local, maxResponseBytes: 8, handler: (_request, response) => { response.writeHead(200, { "content-length": String(sensitive.length) }); response.end(sensitive); } });
    await expect(declared.broker.request(zeroFee(declared))).rejects.toThrow("request_failed");
    resolved(declared, "transport", "response_oversize");
    const streamed = await fixture({ ...local, maxResponseBytes: 8, handler: (_request, response) => { response.write(sensitive); response.end(); } });
    await expect(streamed.broker.request(zeroFee(streamed))).rejects.toThrow("request_failed");
    resolved(streamed, "transport", "response_oversize");
    // An unclassified socket error before anything was sent is a non-dispatch for every destination; after the request was
    // written and with no fixed code it is `transport_failed`, confirmed only because the packet is zero-risk.
    const odd = await fixture({ ...local });
    await expect(odd.broker.request({ ...zeroFee(odd), url: odd.destination.endpoint })).resolves.toMatchObject({ receipt: { status: "settled" } });
  });
  it("resolves the settlement failures of a zero-fee reply as failed with the refusing check as the sub-code", async () => {
    const decoder = await fixture(local);
    await expect(decoder.broker.request(zeroFee(decoder), () => { throw new Error("private_model_response_invalid"); })).rejects.toThrow("request_failed");
    resolved(decoder, "settlement", "response_or_usage_invalid", { subcode: "private_model_response_invalid" });
    const unlisted = await fixture(local);
    await expect(unlisted.broker.request(zeroFee(unlisted), () => { throw new Error(sensitive); })).rejects.toThrow("request_failed");
    resolved(unlisted, "settlement", "response_or_usage_invalid", { subcode: "other" });
    const spoofed = await fixture(local);
    await expect(spoofed.broker.request(zeroFee(spoofed), () => { throw new BrokerError("transport_status_denied"); })).rejects.toThrow("request_failed");
    resolved(spoofed, "settlement", "response_or_usage_invalid", { subcode: "other" });
    // A zero-fee reply that reports a fee cannot settle: the store's check is the sub-code, and the job is not blocked.
    const fee = await fixture(local);
    await expect(fee.broker.request(zeroFee(fee), () => 1)).rejects.toThrow("request_failed");
    resolved(fee, "settlement", "fee_settlement_failed", { subcode: "private_agent_settlement_invalid" });
    await fee.broker.request(zeroFee(fee), () => 0);
    expect(fee.store.dispatches("job").map(row => row.status)).toEqual(["failed", "settled"]);
  });
  it("keeps the same failures uncertain for a priced packet, now with the sub-code recorded, and still blocks the job", async () => {
    const f = await fixture({ classification: "public" });
    await expect(f.broker.request(f.input, () => { throw new Error("model_usage_outside_envelope"); })).rejects.toThrow("transport_or_settlement_unknown");
    expect(f.store.dispatches("job")[0]).toMatchObject({ status: "unknown", reservedFeeMicrousd: 100, failure: { phase: "settlement", code: "response_or_usage_invalid", subcode: "model_usage_outside_envelope" } });
    await expect(f.broker.request(f.input)).rejects.toMatchObject({ code: "unresolved_dispatch" });
    const slow = await fixture({ classification: "public", timeoutMs: 200, handler: () => {} });
    await expect(slow.broker.request(slow.input)).rejects.toThrow("transport_or_settlement_unknown");
    expect(slow.store.dispatches("job")[0]).toMatchObject({ status: "unknown", failure: { code: "request_timeout" } });
    // A local request with a fee reservation is priced too: its timeout stays uncertain.
    const pricedLocal = await fixture({ ...local, timeoutMs: 200, handler: () => {} });
    await expect(pricedLocal.broker.request({ ...zeroFee(pricedLocal), maxFeeMicrousd: 1 })).rejects.toThrow("transport_or_settlement_unknown");
    expect(pricedLocal.store.dispatches("job")[0]).toMatchObject({ status: "unknown", failure: { code: "request_timeout" } });
  });
  it("resolves a zero-risk public GET timeout as failed, but not a granted one", async () => {
    const web = await fixture({ kind: "public_web", classification: "public", timeoutMs: 200, handler: () => {} });
    await expect(web.broker.request({ ...web.input, maxFeeMicrousd: 0, purpose: "public source retrieval" })).rejects.toThrow("request_failed");
    resolved(web, "transport", "request_timeout");
    const granted = await fixture({ kind: "public_web", timeoutMs: 200, handler: () => {} });
    await expect(granted.broker.request({ ...granted.release(), maxFeeMicrousd: 100 })).rejects.toThrow();
    expect(granted.store.dispatches("job").map(row => row.status)).toEqual(["unknown"]);
  });
  it("exposes the request timeout and the zero-risk predicate it applies itself", async () => {
    const f = await fixture({ ...local, timeoutMs: 1234 });
    expect(f.broker.requestTimeoutMs("target")).toBe(1234);
    expect(() => f.broker.requestTimeoutMs("missing")).toThrow("destination_missing");
    const shape = { destinationId: "target", method: "POST" as const };
    expect(f.broker.zeroRiskDispatch({ ...shape, maxFeeMicrousd: 0 })).toBe(true);
    expect(f.broker.zeroRiskDispatch({ ...shape, maxFeeMicrousd: 1 })).toBe(false);
    expect(f.broker.zeroRiskDispatch({ ...shape, maxFeeMicrousd: 0, grantId: "grant" })).toBe(false);
    expect(f.broker.zeroRiskDispatch({ ...shape, maxFeeMicrousd: 0, approval: { proposalId: "p", priceProfileSha256: "a".repeat(64), maxFeeMicrousd: 0 } as never })).toBe(false);
    const cloud = await fixture({ classification: "public" });
    expect(cloud.broker.zeroRiskDispatch({ ...shape, maxFeeMicrousd: 0 })).toBe(false);
    const web = await fixture({ kind: "public_web", classification: "public" });
    expect(web.broker.zeroRiskDispatch({ destinationId: "target", method: "GET", maxFeeMicrousd: 0 })).toBe(true);
    expect(web.broker.zeroRiskDispatch({ destinationId: "target", method: "GET", maxFeeMicrousd: 0, grantId: "grant" })).toBe(false);
    expect(() => web.broker.zeroRiskDispatch({ destinationId: "missing", method: "GET", maxFeeMicrousd: 0 })).toThrow("destination_missing");
  });
  it("confirms every zero-risk failure but retries only the transient aborts", () => {
    const transport = (code: string, status?: number) => ({ phase: "transport", code, elapsedMs: 1, timeoutMs: 1000, ...(status === undefined ? {} : { status }) }) as UnknownRequestDiagnostic;
    for (const code of ["connection_failed", "upstream_closed", "response_interrupted"]) expect(isRetryableAbort(transport(code))).toBe(true);
    for (const status of [500, 503, 429]) { expect(isRetryableAbort(transport("http_rejected", status))).toBe(true); expect(isRetryableAbort(transport("stream_error", status))).toBe(true); }
    for (const status of [400, 404, 302, undefined]) { expect(isRetryableAbort(transport("http_rejected", status))).toBe(false); expect(isRetryableAbort(transport("stream_error", status))).toBe(false); }
    for (const code of ["request_timeout", "cancelled", "response_oversize", "transport_failed", "inactivity_timeout", "stream_invalid"]) {
      expect(isConfirmedAbort(transport(code), true)).toBe(true); expect(isConfirmedAbort(transport(code))).toBe(false); expect(isRetryableAbort(transport(code))).toBe(false);
    }
    for (const code of ["connection_failed", "http_rejected"]) expect(isConfirmedAbort(transport(code))).toBe(true);
    for (const code of ["response_or_usage_invalid", "fee_settlement_failed"] as const) {
      const settlement = { phase: "settlement", code, elapsedMs: 1, timeoutMs: 1000 } as UnknownRequestDiagnostic;
      expect(isConfirmedAbort(settlement, true)).toBe(true); expect(isConfirmedAbort(settlement)).toBe(false); expect(isRetryableAbort(settlement)).toBe(false);
    }
    expect(isConfirmedAbort(undefined, true)).toBe(false);
  });
});

describe("E1 recoverability: zero-fee bad bodies and eight zero-fee failure modes leave nothing unresolved (S3, gate clause 1)", () => {
  const local = { kind: "local_model" as const, privateDataAdmitted: true, classification: "public" as const };
  const reply = JSON.stringify({ model: "synthetic", choices: [{ message: { content: "ready" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  it("resolves two consecutive zero-fee replies that are not JSON as failed settlement rows with sub-code `other` through the real decoder, and admits the next request", async () => {
    let count = 0;
    const f = await fixture({ ...local, handler: (_request, response) => { response.setHeader("content-type", "application/json"); response.end(++count <= 2 ? "{\"choices\": [ not json" : reply); } });
    const model = new PrivateAgentModel(f.broker, { destinationId: "target", model: "synthetic", maxOutputTokens: 256, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" }, "job", "context");
    const call = () => model.complete([{ role: "user", content: "synthetic" }], [], new AbortController().signal);
    // The decoder's SyntaxError is not one of the listed sub-codes, so it records `other`. This destination is not recoverable, so the request count
    // shows only that nothing is retried here; that a settlement failure is never retried is the isRetryableAbort case of the zero-risk tests above.
    for (let attempt = 0; attempt < 2; attempt++) await expect(call()).rejects.toMatchObject({ code: "request_failed" });
    expect(f.store.dispatches("job").map(row => [row.status, row.failure])).toEqual([0, 1].map(() =>
      ["failed", expect.objectContaining({ phase: "settlement", code: "response_or_usage_invalid", subcode: "other" })]));
    await expect(call()).resolves.toMatchObject({ content: "ready" });
    expect(f.store.dispatches("job").map(row => row.status)).toEqual(["failed", "failed", "settled"]); expect(f.requests).toHaveLength(3);
  });
  it("never leaves a zero-fee row unknown or blocking across eight failure modes in one job, and the next request settles after each", async () => {
    // The stream codes have end-to-end cases in the stream tests above. A zero-fee connection_failed or transport_failed row is covered only at the
    // predicate level, by "confirms every zero-risk failure but retries only the transient aborts" above.
    type Step = "hang" | "cut" | "oversize" | "invalid" | "rejected" | "interrupted" | "fee" | "cancel" | "ok";
    const failures: Step[] = ["hang", "cut", "oversize", "invalid", "rejected", "interrupted", "fee", "cancel"];
    // Each failing request is followed by one that answers, in arrival order.
    const plan: Step[] = failures.flatMap(step => [step, "ok" as const]);
    let index = 0, current: Step = "ok", arrived = () => {};
    const f = await fixture({ ...local, maxResponseBytes: 64, maxRequests: 20, handler: (request, response) => {
      const step = current = plan[index++] ?? "ok";
      arrived();
      if (step === "hang" || step === "cancel") return;
      if (step === "cut") { request.socket.destroy(new Error("synthetic reset")); return; }
      if (step === "oversize") { response.end("x".repeat(65)); return; }
      if (step === "invalid") { response.end("not json"); return; }
      if (step === "rejected") { response.writeHead(503); response.end(); return; }
      if (step === "interrupted") { response.writeHead(200, { "content-length": "40" }); response.write('{"ok":'); setTimeout(() => response.socket?.destroy(), 20); return; }
      response.end('{"ok":true}');
    } });
    // The fee step's reply reports a fee on a zero reservation, which the store refuses at settlement.
    const settle = (bytes: Buffer) => { JSON.parse(bytes.toString("utf8")); return current === "fee" ? 1 : 0; };
    const zeroFee = { ...f.input, maxFeeMicrousd: 0, purpose: "agent reasoning and tool selection" };
    const codes: string[] = [];
    for (const step of failures) {
      const external = new AbortController();
      if (step === "cancel") arrived = () => { arrived = () => {}; external.abort(); };
      const failure = await f.broker.request({ ...zeroFee, signal: external.signal }, settle).then(() => undefined, (error: unknown) => error);
      expect(failure, step).toBeInstanceOf(BrokerError); expect((failure as BrokerError).code, step).toBe("request_failed");
      const rows = f.store.dispatches("job");
      expect(rows.some(row => row.status === "unknown" || row.status === "committed" || isBlockingDispatch(row)), step).toBe(false);
      codes.push(rows.at(-1)!.failure!.code);
      // Nothing is unresolved: the next request of the job is admitted and settles.
      await expect(f.broker.request(zeroFee, settle), step).resolves.toMatchObject({ receipt: { status: "settled" } });
    }
    expect(codes).toEqual(["request_timeout", "upstream_closed", "response_oversize", "response_or_usage_invalid", "http_rejected", "response_interrupted", "fee_settlement_failed", "cancelled"]);
    expect(f.store.dispatches("job").map(row => row.status)).toEqual(failures.flatMap(() => ["failed", "settled"]));
  });
});

describe("the assist-purpose exception in the ledger (backlog item 10)", () => {
  const scan = { status: "complete" as const, detector: "synthetic" };
  it("lets local work continue past a skipped assist while pinning its reservation and barring a second assist", async () => {
    // A sealed cloud one-shot whose outcome stayed uncertain: the cloud destination never answers inside its timeout.
    const f = await fixture({ classification: "public", timeoutMs: 200, handler: () => {} });
    await expect(f.broker.request({ ...f.input, purpose: PLAN_ASSIST_PURPOSE })).rejects.toThrow("transport_or_settlement_unknown");
    expect(f.store.dispatches("job")[0]).toMatchObject({ status: "unknown", purpose: PLAN_ASSIST_PURPOSE, reservedFeeMicrousd: 100, failure: { code: "request_timeout" } });
    // A local-stage dispatch of the job commits and settles: nothing blocks it.
    const { text: _text, ...local } = f.broker.preview({ ...f.input, purpose: "research evidence extraction", maxFeeMicrousd: 0 });
    const row = f.store.commit({ ...local, reservedFeeMicrousd: 0, scan }, () => {});
    f.store.settle(row.id, 0, digest("reply"));
    // The job may make no second assist: the cloud row stays at-most-once.
    const { text: _assist, ...assist } = f.broker.preview({ ...f.input, purpose: SYNTHESIS_ASSIST_PURPOSE });
    expect(() => f.store.commit({ ...assist, reservedFeeMicrousd: 100, scan }, () => {})).toThrow("private_agent_assist_after_unknown");
    expect(() => f.store.commit({ ...assist, purpose: PLAN_ASSIST_PURPOSE, reservedFeeMicrousd: 100, scan }, () => {})).toThrow("private_agent_assist_after_unknown");
    // The skipped assist's reservation stays pinned: the cap (1,000) has 900 left for later rows.
    expect(() => f.store.commit({ ...local, reservedFeeMicrousd: 901, scan }, () => {})).toThrow("private_agent_budget_denied");
    const admitted = f.store.commit({ ...local, reservedFeeMicrousd: 900, scan }, () => {}); f.store.settle(admitted.id, 0, digest("reply"));
    expect(f.store.dispatches("job").map(row => row.status)).toEqual(["unknown", "settled", "settled"]);
  });
  it("admits an assist purpose on a cloud destination only, before any row or request", async () => {
    const localModel = await fixture({ kind: "local_model", privateDataAdmitted: true, classification: "public" });
    expect(() => localModel.broker.preview({ ...localModel.input, purpose: PLAN_ASSIST_PURPOSE, maxFeeMicrousd: 0 })).toThrow("assist_destination_invalid");
    await expect(localModel.broker.request({ ...localModel.input, purpose: SYNTHESIS_ASSIST_PURPOSE, maxFeeMicrousd: 0 })).rejects.toThrow("assist_destination_invalid");
    const web = await fixture({ kind: "public_web", classification: "public" });
    expect(() => web.broker.preview({ ...web.input, purpose: PLAN_ASSIST_PURPOSE, maxFeeMicrousd: 0 })).toThrow("assist_destination_invalid");
    expect(localModel.requests).toEqual([]); expect(localModel.store.dispatches("job")).toEqual([]); expect(web.store.dispatches("job")).toEqual([]);
    const cloud = await fixture({ classification: "public" });
    expect(cloud.broker.preview({ ...cloud.input, purpose: PLAN_ASSIST_PURPOSE }).purpose).toBe(PLAN_ASSIST_PURPOSE);
  });
  it("refuses every grant-free cloud dispatch after a skipped assist, admits the job's local work, and leaves a granted consultation to its own rules", async () => {
    const f = await fixture({ classification: "public", timeoutMs: 200, handler: () => {} });
    await expect(f.broker.request({ ...f.input, purpose: PLAN_ASSIST_PURPOSE })).rejects.toThrow("transport_or_settlement_unknown");
    // The same job gains a local destination served by the same loopback server, which answers at once.
    const local: BrokerDestination = { ...f.destination, id: "local", kind: "local_model", privateDataAdmitted: true, timeoutMs: 1000 };
    f.store.revisePolicy("job", { mode: "cloud_help", destinations: ["target", "local"] });
    const broker = new PrivateAgentBroker(f.store, [f.destination, local], clean);
    for (const purpose of [SYNTHESIS_ASSIST_PURPOSE, PLAN_ASSIST_PURPOSE, "agent reasoning and tool selection", "bounded consultation"]) {
      await expect(broker.request({ ...f.input, purpose })).rejects.toThrow("cloud_after_assist_unknown");
    }
    expect(f.requests).toHaveLength(1); expect(f.store.dispatches("job")).toHaveLength(1);
    // Local work goes on: a zero-fee local request commits, but the server never answers it inside its timeout here, so it resolves failed.
    const settledLocal = await fixture({ classification: "public" });
    const result = await broker.request({ ...f.input, destinationId: "local", purpose: "research evidence extraction", maxFeeMicrousd: 0 }).catch(error => error);
    expect(result).toBeInstanceOf(BrokerError); expect((result as BrokerError).code).toBe("request_failed");
    expect(f.store.dispatches("job").map(row => [row.destinationId, row.status])).toEqual([["target", "unknown"], ["local", "failed"]]);
    expect(settledLocal.store.dispatches("job")).toEqual([]);
    // A grant-backed cloud call (the owner's exact-packet consultation) is not refused by this rule: it keeps its own semantics
    // and, here, ends uncertain like any priced request the server never answers. Item 13 decides where it is declined instead.
    const granted = f.release("grant");
    await expect(broker.request(granted)).rejects.toThrow("transport_or_settlement_unknown");
    expect(f.requests).toHaveLength(3);
  });
  it("still blocks everything on an unknown row of any other purpose and on a committed assist row", async () => {
    const f = await fixture({ classification: "public", timeoutMs: 200, handler: () => {} });
    await expect(f.broker.request(f.input)).rejects.toThrow("transport_or_settlement_unknown");
    const { text: _text, ...local } = f.broker.preview({ ...f.input, purpose: "research evidence extraction", maxFeeMicrousd: 0 });
    expect(() => f.store.commit({ ...local, reservedFeeMicrousd: 0, scan }, () => {})).toThrow("private_agent_unresolved_dispatch");
    // A committed assist row (the process died mid-dispatch) has no diagnostic and nothing resolves it: it blocks too.
    const g = await fixture({ classification: "public" });
    const { text: _preview, ...assist } = g.broker.preview({ ...g.input, purpose: PLAN_ASSIST_PURPOSE });
    g.store.commit({ ...assist, reservedFeeMicrousd: 100, scan }, () => {});
    const { text: _local, ...localG } = g.broker.preview({ ...g.input, purpose: "research evidence extraction", maxFeeMicrousd: 0 });
    expect(() => g.store.commit({ ...localG, reservedFeeMicrousd: 0, scan }, () => {})).toThrow("private_agent_unresolved_dispatch");
    expect(g.requests).toEqual([]);
  });
});

describe("E1 recoverability: a D4 retry wait cut short never leaves a superseded row without a successor (E1-R)", () => {
  // The transport timeout (5 s) differs from both D4 backoffs (1 s, then 3 s), so a watched wait is never a transport timer.
  const local = { kind: "local_model" as const, privateDataAdmitted: true, classification: "public" as const, recoverable: true, timeoutMs: 5000 };
  /** A production caller always passes a signal; here it is never aborted, so only the job's own cancel or policy can stop the retry. */
  const zeroFee = (f: Awaited<ReturnType<typeof fixture>>, signal = new AbortController().signal) => ({ ...f.input, maxFeeMicrousd: 0, purpose: "agent reasoning and tool selection", signal });
  /** The first `cuts` requests have their socket destroyed after arriving (a confirmed, retryable abort for a zero-risk packet); later ones answer. */
  const cutFirst = (cuts: number, before: () => void = () => {}): http.RequestListener => {
    let count = 0;
    return (request, response) => { if (++count <= cuts) { before(); request.socket.destroy(new Error("synthetic reset")); } else response.end('{"ok":true}'); };
  };
  async function brokerRejection(pending: Promise<unknown>): Promise<BrokerError> {
    const error = await pending.then(() => undefined, (failure: unknown) => failure);
    expect(error).toBeInstanceOf(BrokerError);
    return error as BrokerError;
  }
  const shape = (rows: readonly DispatchReceipt[]) => rows.map(row => [row.status, row.failure?.code, row.failure?.attempt]);

  it("stops the backoff at once when the job is cancelled while the caller's signal is not aborted, and resolves the cut attempt failed", async () => {
    // Attempt 1 is cut and retried after 1 s; attempt 2 is cut, and the job is cancelled as its 3 s backoff starts.
    const f = await fixture({ ...local, handler: cutFirst(3) });
    let cancelledAt = 0;
    const waits = watchWaits(cleanups, 3000, () => { cancelledAt = performance.now(); f.broker.cancelJob("job"); });
    expect((await brokerRejection(f.broker.request(zeroFee(f)))).code).toBe("request_failed");
    expect(performance.now() - cancelledAt).toBeLessThan(1500);
    expect(waits.filter(ms => ms === 1000 || ms === 3000)).toEqual([1000, 3000]); expect(f.requests).toHaveLength(2);
    const rows = f.store.dispatches("job");
    expect(shape(rows)).toEqual([["superseded", "upstream_closed", 1], ["failed", "upstream_closed", 2]]);
    everySupersededRowHasASuccessor(rows);
    await expect(f.broker.request(zeroFee(f))).rejects.toThrow("job_cancelled");
  }, 15_000);

  it.each([
    ["a policy revision", (f: Awaited<ReturnType<typeof fixture>>) => { f.store.revisePolicy("job", { mode: "cloud_help", destinations: ["target"] }); }, false],
    ["a cancel recorded by another host", (f: Awaited<ReturnType<typeof fixture>>) => { f.store.cancel("job"); }, true],
  ] as const)("resolves the retried attempt failed when %s lands during the backoff, and never re-sends under the changed policy", async (_name, change, cancelled) => {
    const f = await fixture({ ...local, handler: cutFirst(1) });
    watchWaits(cleanups, 1000, () => change(f));
    expect((await brokerRejection(f.broker.request(zeroFee(f)))).code).toBe("request_failed");
    expect(f.requests).toHaveLength(1);
    const rows = f.store.dispatches("job");
    expect(shape(rows)).toEqual([["failed", "upstream_closed", 1]]);
    everySupersededRowHasASuccessor(rows);
    // Nothing is left unresolved: under the new revision a fresh request is admitted, or the cancelled job refuses it before any row.
    if (cancelled) await expect(f.broker.request(zeroFee(f))).rejects.toThrow("job_cancelled");
    else await expect(f.broker.request(zeroFee(f))).resolves.toMatchObject({ receipt: { status: "settled" } });
    expect(f.requests).toHaveLength(cancelled ? 1 : 2);
  }, 15_000);

  it("does not wait at all when another host's cancel is recorded before the retry would start", async () => {
    let f!: Awaited<ReturnType<typeof fixture>>;
    f = await fixture({ ...local, handler: cutFirst(1, () => f.store.cancel("job")) });
    const waits = watchWaits(cleanups);
    expect((await brokerRejection(f.broker.request(zeroFee(f)))).code).toBe("request_failed");
    expect(waits).not.toContain(1000);
    expect(shape(f.store.dispatches("job"))).toEqual([["failed", "upstream_closed", 1]]); expect(f.requests).toHaveLength(1);
  });

  it("keeps request_failed, D4's one cancel code, when another host's cancel lands between the backoff and the successor's commit", async () => {
    const f = await fixture({ ...local, handler: cutFirst(1) });
    const commit = f.store.commit.bind(f.store);
    let commits = 0;
    const spy = vi.spyOn(f.store, "commit").mockImplementation((...args: Parameters<typeof commit>) => { if (++commits === 2) f.store.cancel("job"); return commit(...args); });
    cleanups.push(() => spy.mockRestore());
    expect((await brokerRejection(f.broker.request(zeroFee(f)))).code).toBe("request_failed");
    expect(commits).toBe(2); expect(f.requests).toHaveLength(1);
    expect(shape(f.store.dispatches("job"))).toEqual([["failed", "upstream_closed", 1]]);
  }, 15_000);

  it.each(["private_agent_budget_denied", "private_agent_unresolved_dispatch"])("ends a retry whose commit is refused with %s as a dispatched failure, never as the pre-dispatch code", async message => {
    const f = await fixture({ ...local, handler: cutFirst(1) });
    let commits = 0;
    const pending = f.broker.request(zeroFee(f), () => 0, () => { if (++commits === 2) throw new Error(message); });
    expect((await brokerRejection(pending)).code).toBe("request_failed");
    expect(shape(f.store.dispatches("job"))).toEqual([["failed", "upstream_closed", 1]]); expect(f.requests).toHaveLength(1);
  }, 15_000);

  it("resolves the earlier attempt failed when the caller's own commit-time check refuses the retry, and sends nothing more", async () => {
    const f = await fixture({ ...local, handler: cutFirst(1) });
    let commits = 0;
    const pending = f.broker.request(zeroFee(f), () => 0, () => { if (++commits === 2) throw new Error("synthetic_commit_check_refused"); });
    expect((await brokerRejection(pending)).code).toBe("request_failed");
    expect(commits).toBe(2); expect(f.requests).toHaveLength(1);
    expect(shape(f.store.dispatches("job"))).toEqual([["failed", "upstream_closed", 1]]);
    await expect(f.broker.request(zeroFee(f))).resolves.toMatchObject({ receipt: { status: "settled" } });
  }, 15_000);

  /** Store level: what the broker relies on. The supersede is written first inside the commit, so every check sees today's ledger. */
  const scan = { status: "not_required_inside_boundary" as const };
  const cutAttempt = (attempt = 1): UnknownRequestDiagnostic => ({ phase: "transport", code: "upstream_closed", attempt, elapsedMs: 3, timeoutMs: 5000 });
  function previewOf(f: Awaited<ReturnType<typeof fixture>>, over: Partial<BrokerRequest> = {}) {
    const { text: _text, ...preview } = f.broker.preview({ ...f.input, maxFeeMicrousd: 0, purpose: "agent reasoning and tool selection", ...over });
    return preview;
  }

  it("closes the earlier attempt superseded inside the successor's commit, exactly as resolveFailure wrote such a row, and resolveFailure itself writes only failed", async () => {
    const f = await fixture(local), preview = previewOf(f);
    const first = f.store.commit({ ...preview, reservedFeeMicrousd: 0, scan }, () => {});
    // An undefined key is dropped as before, so the stored diagnostic keeps exactly the broker's keys.
    const second = f.store.commit({ ...preview, reservedFeeMicrousd: 0, scan }, () => {}, undefined, undefined,
      { supersedes: { id: first.id, failure: { ...cutAttempt(), requestId: undefined }, zeroRisk: true } });
    const rows = f.store.dispatches("job");
    expect(rows).toEqual([{ ...first, status: "superseded", failure: cutAttempt() }, second]);
    expect(Object.keys(rows[0]!.failure!).sort()).toEqual(["attempt", "code", "elapsedMs", "phase", "timeoutMs"]);
    everySupersededRowHasASuccessor(rows);
    // The caller's commit-time check already reads the earlier attempt as superseded, as it did when the broker closed it first.
    const g = await fixture(local), gPreview = previewOf(g), earlier = g.store.commit({ ...gPreview, reservedFeeMicrousd: 0, scan }, () => {});
    let seen: string | undefined;
    g.store.commit({ ...gPreview, reservedFeeMicrousd: 0, scan }, () => { seen = g.store.dispatch(earlier.id).status; }, undefined, undefined, { supersedes: { id: earlier.id, failure: cutAttempt(), zeroRisk: true } });
    expect(seen).toBe("superseded");
    // resolveFailure writes `failed` only, so commit is the one writer of `superseded`.
    const open = g.store.dispatches("job")[1]!;
    expect(() => (g.store.resolveFailure as (id: string, status: string, failure: UnknownRequestDiagnostic, zeroRisk: boolean) => void)(open.id, "superseded", cutAttempt(), true))
      .toThrow("private_agent_resolution_invalid");
    expect(g.store.dispatch(open.id).status).toBe("committed");
  });

  it("treats the earlier attempt as superseded for the blocking rule, the assist rule and the fee exposure, and still counts it toward the allowance", async () => {
    // A priced cloud assist answered 529 reserved 600 of the job's 1,000: without the supersede its successor is blocked by it, and 600 + 600 would exceed the cap.
    const f = await fixture({ classification: "public" }), preview = previewOf(f, { maxFeeMicrousd: 600, purpose: PLAN_ASSIST_PURPOSE });
    const rejected: UnknownRequestDiagnostic = { phase: "transport", code: "http_rejected", status: 529, attempt: 1, elapsedMs: 3, timeoutMs: 1000 };
    const first = f.store.commit({ ...preview, reservedFeeMicrousd: 600, scan }, () => {});
    expect(() => f.store.commit({ ...preview, reservedFeeMicrousd: 600, scan }, () => {})).toThrow("private_agent_unresolved_dispatch");
    f.store.commit({ ...preview, reservedFeeMicrousd: 600, scan }, () => {}, undefined, undefined, { supersedes: { id: first.id, failure: rejected, zeroRisk: false } });
    expect(f.store.dispatches("job").map(row => [row.purpose, row.status, row.reservedFeeMicrousd])).toEqual([[PLAN_ASSIST_PURPOSE, "superseded", 600], [PLAN_ASSIST_PURPOSE, "committed", 600]]);
    // The allowance still counts every attempt: with one request allowed the successor is refused, and the refusal rolls the supersede back.
    const capped = await fixture({ ...local, maxRequests: 1 }), cappedPreview = previewOf(capped);
    const only = capped.store.commit({ ...cappedPreview, reservedFeeMicrousd: 0, scan }, () => {});
    expect(() => capped.store.commit({ ...cappedPreview, reservedFeeMicrousd: 0, scan }, () => {}, undefined, undefined, { supersedes: { id: only.id, failure: cutAttempt(), zeroRisk: true } }))
      .toThrow("private_agent_budget_denied");
    expect(capped.store.dispatches("job").map(row => row.status)).toEqual(["committed"]);
  });

  it("refuses a supersede that names anything but this packet's committed attempt with a confirmed abort, and rolls every refusal back", async () => {
    const f = await fixture(local), preview = previewOf(f);
    const first = f.store.commit({ ...preview, reservedFeeMicrousd: 0, scan }, () => {});
    const valid = { id: first.id, failure: cutAttempt(), zeroRisk: true };
    const attempt = (over: Record<string, unknown>, supersedes: typeof valid, validate: () => void = () => {}) =>
      () => f.store.commit({ ...preview, reservedFeeMicrousd: 0, scan, ...over }, validate, undefined, undefined, { supersedes });
    // Each identity field is compared with the earlier row itself; the admission check only compares the successor with the job's current state.
    for (const over of [{ packetSha256: digest("another packet") }, { destinationSha256: digest("another destination") }, { purpose: "another purpose" }, { reservedFeeMicrousd: 1 }]) {
      expect(attempt(over, valid), JSON.stringify(over)).toThrow("private_agent_supersede_invalid");
    }
    expect(attempt({}, { ...valid, id: "missing-row" })).toThrow("private_agent_supersede_invalid");
    // A timeout is a confirmed abort only for a zero-risk packet, so one claimed as not zero-risk can never be superseded.
    expect(attempt({}, { ...valid, failure: { phase: "transport", code: "request_timeout", attempt: 1, elapsedMs: 3, timeoutMs: 5000 }, zeroRisk: false })).toThrow("private_agent_supersede_invalid");
    expect(attempt({}, { ...valid, failure: { ...cutAttempt(), elapsedMs: -1 } })).toThrow("private_agent_unknown_diagnostic_invalid");
    // A refusal after the supersede (here the caller's own check) rolls it back with the insert.
    expect(attempt({}, valid, () => { throw new Error("synthetic_refusal"); })).toThrow("synthetic_refusal");
    expect(f.store.dispatches("job").map(row => [row.id, row.status])).toEqual([[first.id, "committed"]]);
    // A revised policy refuses the successor before anything is written.
    f.store.revisePolicy("job", { mode: "cloud_help", destinations: ["target"] });
    expect(attempt({}, valid)).toThrow("private_agent_admission_changed");
    expect(f.store.dispatches("job").map(row => [row.id, row.status])).toEqual([[first.id, "committed"]]);
    // A successor in another context of the job, after a context change, or at a later policy revision passes the admission check but not the
    // supersede: each must name an earlier row of its own context, context hash and revision.
    const h = await fixture(local), hPreview = previewOf(h), hFirst = h.store.commit({ ...hPreview, reservedFeeMicrousd: 0, scan }, () => {});
    const hValid = { id: hFirst.id, failure: cutAttempt(), zeroRisk: true };
    h.store.createContext({ id: "second-context", jobId: "job", sources: [{ id: "input", version: digest("private input"), classification: "public", synthetic: true }] });
    expect(() => h.store.commit({ ...previewOf(h, { contextId: "second-context" }), reservedFeeMicrousd: 0, scan }, () => {}, undefined, undefined, { supersedes: hValid }))
      .toThrow("private_agent_supersede_invalid");
    h.store.addSources("context", [{ id: "added", version: digest("added source"), classification: "public", synthetic: true }]);
    expect(() => h.store.commit({ ...previewOf(h), reservedFeeMicrousd: 0, scan }, () => {}, undefined, undefined, { supersedes: hValid })).toThrow("private_agent_supersede_invalid");
    h.store.revisePolicy("job", { mode: "cloud_help", destinations: ["target"] });
    expect(() => h.store.commit({ ...previewOf(h), reservedFeeMicrousd: 0, scan }, () => {}, undefined, undefined, { supersedes: hValid })).toThrow("private_agent_supersede_invalid");
    expect(h.store.dispatches("job").map(row => row.status)).toEqual(["committed"]);
    // An attempt already resolved, or another job's row, cannot be superseded.
    const g = await fixture(local), gPreview = previewOf(g), settled = g.store.commit({ ...gPreview, reservedFeeMicrousd: 0, scan }, () => {});
    g.store.settle(settled.id, 0, digest("reply"));
    expect(() => g.store.commit({ ...gPreview, reservedFeeMicrousd: 0, scan }, () => {}, undefined, undefined, { supersedes: { ...valid, id: settled.id } })).toThrow("private_agent_supersede_invalid");
    g.store.createJob({ id: "other", version: 1, revision: 0, cancelled: false, mode: "cloud_help", destinations: ["target"], maxRequests: 10, maxFeeMicrousd: 1000 });
    g.store.createContext({ id: "other-context", jobId: "other", sources: [{ id: "input", version: digest("private input"), classification: "public", synthetic: true }] });
    const { text: _text, ...otherPreview } = g.broker.preview({ ...g.input, jobId: "other", contextId: "other-context", maxFeeMicrousd: 0, purpose: "agent reasoning and tool selection" });
    const foreign = g.store.commit({ ...otherPreview, reservedFeeMicrousd: 0, scan }, () => {});
    expect(() => g.store.commit({ ...gPreview, reservedFeeMicrousd: 0, scan }, () => {}, undefined, undefined, { supersedes: { ...valid, id: foreign.id } })).toThrow("private_agent_supersede_invalid");
    expect(g.store.dispatches("job").map(row => row.status)).toEqual(["settled"]); expect(g.store.dispatches("other").map(row => row.status)).toEqual(["committed"]);
  });
});

describe("receipt disclosure fields (plan 11.4, BL-20261114-1504)", () => {
  it("records the destination kind, the body bytes and HARN-27's disclosed bytes: a POST's body, a GET's URL, nothing to a local model or a loopback URL", () => {
    const body = '{"question":"synthetic é"}', remote = new URL("https://api.example.invalid/v1/messages"), page = new URL("https://www.example.invalid/a?b=c");
    expect(dispatchDisclosure("cloud_model", remote, "POST", body)).toEqual({ destinationKind: "cloud_model", bodyBytes: Buffer.byteLength(body), disclosedBytes: Buffer.byteLength(body) });
    expect(dispatchDisclosure("public_web", page, "GET", undefined)).toEqual({ destinationKind: "public_web", bodyBytes: 0, disclosedBytes: Buffer.byteLength(page.href) });
    expect(dispatchDisclosure("local_model", remote, "POST", body)).toMatchObject({ bodyBytes: Buffer.byteLength(body), disclosedBytes: 0 });
    for (const loopback of ["http://127.0.0.1:8080/v1/chat/completions", "http://[::1]:8080/v1/chat/completions"]) {
      expect(dispatchDisclosure("cloud_model", new URL(loopback), "POST", body)).toMatchObject({ disclosedBytes: 0 });
    }
  });
  it("writes the fields on every committed row, keeps them through settlement, and leaves the packet and destination hashes as the preview gives them", async () => {
    const f = await fixture({ classification: "public" });
    const preview = f.broker.preview(f.input);
    await f.broker.request(f.input, () => 70);
    const [row] = f.store.dispatches("job");
    expect(row).toMatchObject({ status: "settled", feeMicrousd: 70, destinationKind: "cloud_model", bodyBytes: Buffer.byteLength(f.input.body!), disclosedBytes: 0,
      packetSha256: preview.packetSha256, destinationSha256: preview.destinationSha256 });
    const web = await fixture({ kind: "public_web" });
    await web.broker.request(web.release());
    expect(web.store.dispatches("job")[0]).toMatchObject({ destinationKind: "public_web", bodyBytes: 0, disclosedBytes: 0 });
  });
  it("refuses a present field that is not a known kind or a safe byte count, and commits nothing", async () => {
    const f = await fixture({ classification: "public" });
    const { text: _text, ...identity } = f.broker.preview(f.input);
    const commit = (extra: Partial<DispatchReceipt>) => f.store.commit({ ...identity, reservedFeeMicrousd: 100, scan: { status: "not_required_inside_boundary" }, ...extra }, () => undefined);
    for (const extra of [{ destinationKind: "satellite" }, { bodyBytes: -1 }, { disclosedBytes: 1.5 }, { bodyBytes: Number.MAX_SAFE_INTEGER + 2 }] as Partial<DispatchReceipt>[]) {
      expect(() => commit(extra)).toThrow("private_agent_receipt_invalid");
    }
    expect(f.store.dispatches("job")).toEqual([]);
    expect(commit({ destinationKind: "cloud_model", bodyBytes: 12, disclosedBytes: 12 })).toMatchObject({ status: "committed", bodyBytes: 12 });
  });
});
