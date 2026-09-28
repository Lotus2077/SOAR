import { EventEmitter } from "node:events";
import https from "node:https";
import { lookup } from "node:dns/promises";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentBroker, isPublicAddress, type BrokerDestination } from "../../src/main/private-agent/broker";
import { parsePublicDnsAnswer, resolvePublicV4, type PublicDnsEvent } from "../../src/main/private-agent/network-resolver";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
const answer = (records: unknown[] = [{ name: "httpbin.org.", type: 1, TTL: 60, data: "93.184.216.34" }]) =>
  ({ Status: 0, TC: false, Question: [{ name: "httpbin.org.", type: 1 }], Answer: records });
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value));
const databases: Database.Database[] = [];
beforeEach(() => { vi.mocked(lookup).mockResolvedValue([{ address: "198.18.0.1", family: 4 }] as never); });
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); for (const db of databases.splice(0)) db.close(); });

type Call = { url: URL; options: https.RequestOptions };
function transportMock(options: { dnsBody?: unknown; dnsStatus?: number; contentStatus?: number; dnsContentType?: string; abort?: AbortController } = {}) {
  const calls: Call[] = [];
  vi.spyOn(https, "request").mockImplementation(((url: URL, requestOptions: https.RequestOptions, receive: (response: unknown) => void) => {
    calls.push({ url, options: requestOptions });
    const request = new EventEmitter() as EventEmitter & { end(): void };
    request.end = () => queueMicrotask(() => {
      if (options.abort && url.hostname === "cloudflare-dns.com") { options.abort.abort(); request.emit("error", new Error("synthetic abort")); return; }
      const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; destroy(): void };
      response.statusCode = url.hostname === "cloudflare-dns.com" ? options.dnsStatus ?? 200 : options.contentStatus ?? 200;
      response.headers = url.hostname === "cloudflare-dns.com" ? { "content-type": options.dnsContentType ?? "application/dns-json" } : {};
      response.destroy = () => {};
      receive(response);
      response.emit("data", url.hostname === "cloudflare-dns.com" ? encoded(options.dnsBody ?? answer()) : Buffer.from("public response"));
      response.emit("end");
    });
    return request;
  }) as never);
  return calls;
}
function fixture(classification: "public" | "private" = "public", resolver = true) {
  const db = new Database(":memory:"); databases.push(db); const store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: "job", mode: "private", revision: 0, cancelled: false, destinations: ["web"], maxRequests: 1, maxFeeMicrousd: 0 });
  store.createContext({ id: "context", jobId: "job", sources: [{ id: "source", version: digest("synthetic source"), classification, synthetic: true }] });
  const destination: BrokerDestination = { id: "web", kind: "public_web", endpoint: "https://httpbin.org/", accountId: "public_web", credentialVersion: 0,
    privateDataAdmitted: false, maxResponseBytes: 1024, timeoutMs: 5000, ...(resolver ? { publicDnsResolver: "cloudflare_v1" } : {}) };
  const make = (profile = destination) => new PrivateAgentBroker(store, [profile], { scan: async () => ({ complete: true, blocked: false, detector: "public-fixture" }) });
  const input = { jobId: "job", contextId: "context", destinationId: "web", purpose: "public source retrieval", method: "GET" as const, url: "https://httpbin.org/uuid?public_nonce=123", maxFeeMicrousd: 0 };
  return { broker: make(), store, destination, make, input };
}

describe("bounded public DNS resolver", () => {
  it.each(["deadline", "cancel"])("stops awaiting a stalled system lookup after %s without a late HTTP request or retry", async reason => {
    vi.useFakeTimers();
    try {
      let resolve!: (value: never) => void;
      vi.mocked(lookup).mockReturnValue(new Promise(yes => { resolve = yes; }) as never);
      const calls = transportMock(), f = fixture("public", false), abort = new AbortController();
      const result = expect(f.broker.request({ ...f.input, signal: abort.signal })).rejects.toThrow("transport_or_settlement_unknown");
      await vi.advanceTimersByTimeAsync(0);
      expect(lookup).toHaveBeenCalledTimes(1);
      if (reason === "cancel") abort.abort(); else await vi.advanceTimersByTimeAsync(5000);
      await result;
      expect(f.store.dispatches("job")).toMatchObject([{ status: "unknown" }]);
      expect(calls).toEqual([]);
      resolve([{ address: "93.184.216.34", family: 4 }] as never);
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual([]); expect(lookup).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("accepts only complete A answers belonging to the original name or its bounded CNAME chain", () => {
    expect(parsePublicDnsAnswer(encoded(answer()), "httpbin.org", isPublicAddress)).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(parsePublicDnsAnswer(encoded(answer([{ name: "httpbin.org.", type: 5, TTL: 60, data: "public.example." },
      { name: "public.example.", type: 1, TTL: 60, data: "1.1.1.1" }])), "httpbin.org", isPublicAddress)).toEqual([{ address: "1.1.1.1", family: 4 }]);
  });
  it.each([
    { ...answer(), Status: 2 }, { ...answer(), TC: true }, { ...answer(), Question: [{ name: "wrong.example.", type: 1 }] },
    { ...answer(), Question: [{ name: "httpbin.org.", type: 28 }] },
    answer([{ name: "httpbin.org.", type: 1, TTL: 60, data: "198.18.0.1" }]),
    answer([{ name: "httpbin.org.", type: 1, TTL: 60, data: "127.0.0.1" }]),
    answer([{ name: "unrelated.example.", type: 1, TTL: 60, data: "1.1.1.1" }]),
    answer([{ name: "httpbin.org.", type: 5, TTL: 60, data: "alias.example." }, { name: "alias.example.", type: 5, TTL: 60, data: "httpbin.org." }]),
    answer([{ name: "httpbin.org.", type: 28, TTL: 60, data: "2606:4700:4700::1111" }]),
    answer([{ name: "httpbin.org.", type: 1, TTL: -1, data: "1.1.1.1" }]),
    answer(Array.from({ length: 65 }, () => ({ name: "httpbin.org.", type: 1, TTL: 60, data: "1.1.1.1" }))),
  ])("rejects malformed, unrelated, truncated or nonpublic DNS records %j", value => {
    expect(() => parsePublicDnsAnswer(encoded(value), "httpbin.org", isPublicAddress)).toThrow();
  });
  it("rejects malformed/oversize JSON and conflicting duplicate DNS data", () => {
    expect(() => parsePublicDnsAnswer(Buffer.from("{"), "httpbin.org", isPublicAddress)).toThrow();
    expect(() => parsePublicDnsAnswer(encoded({ ...answer(), padding: "a".repeat(16384) }), "httpbin.org", isPublicAddress)).toThrow();
    expect(() => parsePublicDnsAnswer(encoded(answer([...answer().Answer, ...answer().Answer])), "httpbin.org", isPublicAddress)).toThrow();
  });
  it("pins the resolver and target separately, preserves TLS identity, and records metadata within one logical fetch", async () => {
    const calls = transportMock(), f = fixture(); const response = await f.broker.request(f.input);
    expect(response.bytes.toString()).toBe("public response"); expect(calls).toHaveLength(2); expect(lookup).not.toHaveBeenCalled();
    expect(calls[0]!.url.href).toBe("https://cloudflare-dns.com/dns-query?name=httpbin.org&type=A&cd=false");
    expect(calls[0]!.options).toMatchObject({ method: "GET", servername: "cloudflare-dns.com", rejectUnauthorized: true, agent: false, headers: { accept: "application/dns-json" } });
    expect(calls[1]!.url.href).toBe(f.input.url);
    expect(calls[1]!.options).toMatchObject({ method: "GET", servername: "httpbin.org", rejectUnauthorized: true, agent: false, headers: {} });
    for (const [i, expected] of [[0, "1.1.1.1"], [1, "93.184.216.34"]] as const) {
      const callback = vi.fn(); (calls[i]!.options.lookup as Function)("unused", {}, callback); expect(callback).toHaveBeenCalledWith(null, expected, 4);
    }
    const badCertificate = { subject: { CN: "attacker.invalid" }, subjectaltname: "DNS:attacker.invalid" };
    expect(calls[0]!.options.checkServerIdentity!("ignored", badCertificate as never)).toBeInstanceOf(Error);
    expect(f.store.dispatches("job")).toHaveLength(1); expect(response.receipt.status).toBe("settled");
    expect(f.store.events("job")).toMatchObject([{ type: "public_dns_started", status: "started", dispatchId: response.receipt.id },
      { type: "public_dns_finished", status: "settled", responseSha256: digest(encoded(answer())), addressCount: 1, dispatchId: response.receipt.id }]);
    expect(canonical(f.store.events("job"))).not.toContain("public_nonce"); expect(canonical(f.store.events("job"))).not.toContain("93.184.216.34");
  });
  it("retains system-DNS rejection when the resolver option is absent", async () => {
    const calls = transportMock(), f = fixture("public", false);
    await expect(f.broker.request(f.input)).rejects.toThrow("transport_or_settlement_unknown");
    expect(lookup).toHaveBeenCalledOnce(); expect(calls).toEqual([]); expect(f.store.events("job")).toEqual([]);
  });
  it("never discloses a private-context hostname to DoH even with an exact content grant", async () => {
    const calls = transportMock(), f = fixture("private"); const { text: _text, ...preview } = f.broker.preview(f.input);
    f.store.grant({ ...preview, id: "grant", expiresAt: Date.now() + 10000, remainingUses: 1, revoked: false });
    await expect(f.broker.request({ ...f.input, grantId: "grant" })).rejects.toThrow("public_dns_requires_public_context");
    expect(calls).toEqual([]); expect(f.store.dispatches("job")).toEqual([]);
  });
  it("binds the resolver route into the destination identity and rejects an old exact grant", async () => {
    const calls = transportMock(), f = fixture("public", false); const { text: _text, ...preview } = f.broker.preview(f.input);
    f.store.grant({ ...preview, id: "grant", expiresAt: Date.now() + 10000, remainingUses: 1, revoked: false });
    const changed = f.make({ ...f.destination, publicDnsResolver: "cloudflare_v1" });
    expect(changed.preview(f.input).destinationSha256).not.toBe(preview.destinationSha256);
    await expect(changed.request({ ...f.input, grantId: "grant" })).rejects.toThrow(); expect(calls).toEqual([]);
  });
  it.each([{ kind: "local_model" }, { endpoint: "http://httpbin.org/" }, { endpoint: "https://127.0.0.1/" }, { publicDnsResolver: "custom" }])("rejects unsupported resolver profiles %j", overrides => {
    const f = fixture(); expect(() => f.make({ ...f.destination, ...overrides } as BrokerDestination)).toThrow();
  });
  it("records failed metadata and never connects to any target if one DNS answer is nonpublic", async () => {
    const calls = transportMock({ dnsBody: answer([...answer().Answer, { name: "httpbin.org.", type: 1, TTL: 60, data: "10.0.0.1" }]) }), f = fixture();
    await expect(f.broker.request(f.input)).rejects.toThrow("transport_or_settlement_unknown"); expect(calls).toHaveLength(1);
    expect(f.store.events("job")[1]).toMatchObject({ status: "failed", errorCode: "public_dns_address_denied" });
    expect(f.store.dispatches("job")[0]!.status).toBe("unknown");
  });
  it.each([{ dnsStatus: 302 }, { dnsContentType: "text/html" }])("does not follow a resolver redirect or accept an unrecognized response %j", options => {
    const calls = transportMock(options), f = fixture();
    return expect(f.broker.request(f.input)).rejects.toThrow("transport_or_settlement_unknown").then(() => {
      expect(calls).toHaveLength(1); expect(f.store.events("job")[1]).toMatchObject({ status: "failed", errorCode: "public_dns_transport_failed" });
    });
  });
  it("records mid-resolution cancellation and performs no target request", async () => {
    const abort = new AbortController(), calls = transportMock({ abort }), f = fixture();
    await expect(f.broker.request({ ...f.input, signal: abort.signal })).rejects.toThrow("transport_or_settlement_unknown");
    expect(calls).toHaveLength(1); expect(f.store.events("job")[1]).toMatchObject({ status: "failed", errorCode: "public_dns_cancelled" });
  });
  it("performs no resolver exchange or metadata event when already cancelled", async () => {
    const calls = transportMock(), abort = new AbortController(); abort.abort(); const events: PublicDnsEvent[] = [];
    await expect(resolvePublicV4("httpbin.org", abort.signal, isPublicAddress, event => events.push(event))).rejects.toThrow("public_dns_cancelled");
    expect(calls).toEqual([]); expect(events).toEqual([]);
  });
  it("does not follow a content redirect after successful metadata resolution", async () => {
    const calls = transportMock({ contentStatus: 302 }), f = fixture();
    await expect(f.broker.request(f.input)).rejects.toThrow("transport_or_settlement_unknown"); expect(calls).toHaveLength(2);
    expect(f.store.events("job")[1]).toMatchObject({ status: "settled" });
  });
});
