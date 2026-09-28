import Database from "better-sqlite3";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BROKER_MAX_BODY_BYTES, BrokerError, PrivateAgentBroker, isPublicAddress, type BrokerDestination, type BrokerRequest, type LocalPacketScanner } from "../../src/main/private-agent/broker";
import { PrivateAgentStore, UnknownRequestDiagnosticSchema, type UnknownRequestDiagnostic } from "../../src/main/private-agent/store";
import { digest } from "../../src/main/private-agent/contracts";

const clean: LocalPacketScanner = { scan: async () => ({ complete: true, blocked: false, detector: "deliberate-false-negative-fixture" }) };
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(options: { mode?: "private" | "cloud_help" | "offline"; classification?: "private" | "public";
  scanner?: LocalPacketScanner; synthetic?: boolean; kind?: BrokerDestination["kind"]; privateDataAdmitted?: boolean;
  databasePath?: string; handler?: http.RequestListener; timeoutMs?: number; maxResponseBytes?: number } = {}) {
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
  store.createJob({ id: "job", version: 1, revision: 0, cancelled: false, mode: options.mode ?? "cloud_help", destinations: ["target"], maxRequests: 10, maxFeeMicrousd: 1000 });
  store.createContext({ id: "context", jobId: "job", sources: [{ id: "input", version: digest("private input"), classification: options.classification ?? "private", synthetic: options.synthetic ?? true }] });
  const destination: BrokerDestination = { id: "target", kind: options.kind ?? "cloud_model", endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
    accountId: "synthetic-account", credentialVersion: 1, privateDataAdmitted: options.privateDataAdmitted ?? false,
    loopbackFixture: true, maxResponseBytes: options.maxResponseBytes ?? 2048, timeoutMs: options.timeoutMs ?? 1000,
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

  it("does not follow redirects or retry an unknown result after store reopening", async () => {
    const dir = mkdtempSync(join(tmpdir(), "soar-private-broker-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const f = await fixture({ classification: "public", databasePath: join(dir, "state.sqlite"), handler: (_request, response) => {
      response.writeHead(302, { location: "/canary-exfiltration" }); response.end();
    } });
    await expect(f.broker.request(f.input)).rejects.toThrow("transport_or_settlement_unknown");
    expect(f.store.dispatches("job")[0]).toMatchObject({ status: "unknown", reservedFeeMicrousd: 100,
      failure: { phase: "transport", code: "http_rejected", timeoutMs: 1000 } });
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

  it.each(["http", "declared_oversize", "streamed_oversize", "socket_failure"] as const)("classifies controlled %s without storing provider text", async kind => {
    const f = await fixture({ classification: "public", maxResponseBytes: 8, handler: (request, response) => {
      if (kind === "http") { response.writeHead(503); response.end(sensitive); }
      else if (kind === "declared_oversize") { response.writeHead(200, { "content-length": String(sensitive.length) }); response.end(sensitive); }
      else if (kind === "streamed_oversize") { response.write(sensitive); response.end(); }
      else request.socket.destroy(new Error(sensitive));
    } });
    await expect(f.broker.request(f.input)).rejects.toThrow("transport_or_settlement_unknown");
    diagnostic(f, "transport", kind === "http" ? "http_rejected" : kind === "socket_failure" ? "transport_failed" : "response_oversize");
    await expect(f.broker.request(f.input)).rejects.toThrow("private_agent_unresolved_dispatch");
    expect(f.requests).toHaveLength(1);
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
      { elapsedMs: Number.NaN }, { elapsedMs: 0.5 }, { timeoutMs: 300001 }, { timeoutMs: 0 }, { detail: sensitive }]) {
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
});
