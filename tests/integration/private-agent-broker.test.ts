import Database from "better-sqlite3";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STREAM_BYTES_PER_TOKEN_BOUND, localStreamSettings } from "../../src/main/liveness";
import { BROKER_MAX_BODY_BYTES, BrokerError, PrivateAgentBroker, STREAM_MAX_RAW_BYTES, SseStreamError, SseTruncated, assembleSseChatCompletion, isPublicAddress, type BrokerDestination, type BrokerRequest, type LocalPacketScanner } from "../../src/main/private-agent/broker";
import { PrivateAgentStore, UnknownRequestDiagnosticSchema, type UnknownRequestDiagnostic } from "../../src/main/private-agent/store";
import { digest } from "../../src/main/private-agent/contracts";

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
    await expect(second.request(f.input)).rejects.toThrow("private_agent_unresolved_dispatch");
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
    expect(Object.keys(receipt.failure!).sort()).toEqual(["code", "elapsedMs", "phase", "timeoutMs"]);
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
    await expect(f.broker.request(f.input)).rejects.toThrow("private_agent_unresolved_dispatch");
    const originalReceipts = f.store.dispatches("job");
    f.db.close();
    const reopened = new Database(databasePath, { fileMustExist: true }); cleanups.push(() => { reopened.close(); });
    const restored = new PrivateAgentStore(reopened);
    expect(restored.dispatches("job")).toEqual(originalReceipts);
    await expect(new PrivateAgentBroker(restored, [f.destination], clean).request(f.input)).rejects.toThrow("private_agent_unresolved_dispatch");
    expect(f.requests).toHaveLength(1);
  });

  it("external task cancellation before the request timer is a cancellation, without its raw reason", async () => {
    let arrived!: () => void; const seen = new Promise<void>(resolve => { arrived = resolve; });
    const f = await fixture({ classification: "public", timeoutMs: 1000, handler: () => arrived() });
    const external = new AbortController(), pending = f.broker.request({ ...f.input, signal: external.signal });
    await seen; external.abort(new Error(sensitive));
    await expect(pending).rejects.toThrow("transport_or_settlement_unknown");
    diagnostic(f, "transport", "cancelled");
    await expect(f.broker.request(f.input)).rejects.toThrow("private_agent_unresolved_dispatch");
    expect(f.requests).toHaveLength(1);
  });

  it.each(["declared_oversize", "streamed_oversize"] as const)("classifies controlled %s as uncertain without storing provider text", async kind => {
    const f = await fixture({ classification: "public", maxResponseBytes: 8, handler: (_request, response) => {
      if (kind === "declared_oversize") { response.writeHead(200, { "content-length": String(sensitive.length) }); response.end(sensitive); }
      else { response.write(sensitive); response.end(); }
    } });
    await expect(f.broker.request(f.input)).rejects.toThrow("transport_or_settlement_unknown");
    diagnostic(f, "transport", "response_oversize");
    await expect(f.broker.request(f.input)).rejects.toThrow("private_agent_unresolved_dispatch");
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
    await expect(cloud.broker.request(cloud.input)).rejects.toThrow("private_agent_unresolved_dispatch");
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
    await expect(f.broker.request(f.input)).rejects.toThrow("private_agent_unresolved_dispatch");
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
      { elapsedMs: Number.NaN }, { elapsedMs: 0.5 }, { timeoutMs: 900_001 }, { timeoutMs: 0 }, { detail: sensitive }]) {
      expect(() => f.store.unknown(row.id, { ...valid, ...change } as UnknownRequestDiagnostic)).toThrow("private_agent_unknown_diagnostic_invalid");
      expect(f.store.dispatch(row.id)).toEqual(row);
    }
    expect(() => f.store.commit({ ...row, failure: valid } as never, () => {})).toThrow("private_agent_admission_changed");
    f.store.unknown(row.id);
    const legacy = f.store.dispatch(row.id); expect(legacy.failure).toBeUndefined();
    f.store.unknown(row.id, valid); expect(f.store.dispatch(row.id)).toEqual(legacy);
    expect(f.requests).toEqual([]);
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
    expect(rows.map(row => row.status)).toEqual(["superseded", "superseded", "settled"]);
    expect(rows[0]!.failure).toMatchObject({ phase: "transport", code: mode === "socket" ? "upstream_closed" : "http_rejected", attempt: 1, ...(mode === "socket" ? {} : { status: Number(mode) }) });
    expect(rows[1]!.failure).toMatchObject({ attempt: 2 });
    expect(rows.every(row => JSON.stringify(row).includes("synthetic provider error") === false)).toBe(true);
    // Every attempt consumed a session request; superseded rows reserve no fee.
    expect(rows.every(row => row.reservedFeeMicrousd === 0)).toBe(true);
  }, 20_000);
  it("gives up after the third confirmed abort with a resolved failed row and a distinct error", async () => {
    const f = await fixture({ ...local, handler: flaky(3, "socket") });
    await expect(f.broker.request(zeroFee(f))).rejects.toThrow("request_failed");
    expect(f.store.dispatches("job").map(row => row.status)).toEqual(["superseded", "superseded", "failed"]);
    expect(f.store.dispatches("job")[2]!.failure).toMatchObject({ code: "upstream_closed", attempt: 3 });
    await f.broker.request(zeroFee(f)); // a later request is admitted: nothing is unresolved
    expect(f.store.dispatches("job").at(-1)!.status).toBe("settled");
  }, 20_000);
  it("does not retry a deterministic 4xx, a timeout, a priced request or a flagless destination", async () => {
    const bad = await fixture({ ...local, handler: flaky(1, "400") });
    await expect(bad.broker.request(zeroFee(bad))).rejects.toThrow("request_failed");
    expect(bad.store.dispatches("job").map(row => row.status)).toEqual(["failed"]); expect(bad.requests).toHaveLength(1);
    const slow = await fixture({ ...local, timeoutMs: 200, handler: () => {} });
    await expect(slow.broker.request(zeroFee(slow))).rejects.toThrow("transport_or_settlement_unknown");
    expect(slow.store.dispatches("job").map(row => row.status)).toEqual(["unknown"]);
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
  it("starts the inactivity clock at the first byte, and records a mid-stream stall as an unknown inactivity_timeout that is never retried", async () => {
    const body = sse([chunk({ content: "a" }), chunk({ content: "b" }, "stop"), usage(1, 2)]);
    // Prefill: headers at once, the first byte 1.5 s later, past the 1 s inactivity limit but inside the request deadline.
    const prefill = await fixture({ ...local, recoverable: true, timeoutMs: 5000, handler: streamed(body, { firstByteMs: 1500 }) });
    expect((await declared(prefill, { inactivityTimeoutMs: 1000, maxRawBytes: 64 * 1024 }).request(zeroFee(prefill), () => 0)).receipt.status).toBe("settled");
    const stalled = await fixture({ ...local, recoverable: true, timeoutMs: 5000, handler: streamed(body, { gapMs: 1500 }) });
    await expect(declared(stalled, { inactivityTimeoutMs: 1000, maxRawBytes: 64 * 1024 }).request(zeroFee(stalled))).rejects.toThrow("transport_or_settlement_unknown");
    expect(stalled.store.dispatches("job").map(row => [row.status, row.failure?.code])).toEqual([["unknown", "inactivity_timeout"]]); expect(stalled.requests).toHaveLength(1);
  }, 20_000);
  it("caps the raw stream and the assembled reply separately, both as unknown oversize", async () => {
    const chatty = sse([...Array.from({ length: 40 }, () => chunk({ reasoning: "x".repeat(40) })), chunk({ content: "ok" }, "stop"), usage(1, 41)]);
    const raw = await fixture({ ...local, maxResponseBytes: 2048, handler: streamed(chatty) });
    await expect(declared(raw, { inactivityTimeoutMs: 1000, maxRawBytes: 4096 }).request(zeroFee(raw))).rejects.toThrow("transport_or_settlement_unknown");
    expect(raw.store.dispatches("job")[0]).toMatchObject({ status: "unknown", failure: { code: "response_oversize" } });
    const long = sse([chunk({ content: "y".repeat(3000) }, "stop"), usage(1, 1)]);
    const assembled = await fixture({ ...local, maxResponseBytes: 2048, handler: streamed(long) });
    await expect(declared(assembled, { inactivityTimeoutMs: 1000, maxRawBytes: 64 * 1024 }).request(zeroFee(assembled))).rejects.toThrow("transport_or_settlement_unknown");
    expect(assembled.store.dispatches("job")[0]).toMatchObject({ status: "unknown", failure: { code: "response_oversize" } });
  });
  it("treats the server's in-band error like an HTTP error and an early end like a cut connection; only a malformed stream stays unknown", async () => {
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
    await expect(declared(broken, stream).request(zeroFee(broken))).rejects.toThrow("transport_or_settlement_unknown");
    expect(broken.store.dispatches("job").map(row => [row.status, row.failure?.code])).toEqual([["unknown", "stream_invalid"]]);
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
