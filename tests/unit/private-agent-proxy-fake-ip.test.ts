import { EventEmitter } from "node:events";
import https from "node:https";
import { lookup } from "node:dns/promises";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentBroker, isProxyFakeIpAddress, type BrokerDestination } from "../../src/main/private-agent/broker";
import { buildCloudArm, parseLocalArtifactScreenArguments } from "../../scripts/private-agent-local-screen";
import { parseCritiqueArguments } from "../../scripts/phase2-repair";
import { loadConfig } from "../../src/main/config";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
const databases: Database.Database[] = [];
beforeEach(() => { vi.mocked(lookup).mockResolvedValue([{ address: "198.18.0.251", family: 4 }] as never); });
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); for (const db of databases.splice(0)) db.close(); });

type Call = { url: URL; options: https.RequestOptions };
function transportMock() {
  const calls: Call[] = [];
  vi.spyOn(https, "request").mockImplementation(((url: URL, options: https.RequestOptions, receive: (response: unknown) => void) => {
    calls.push({ url, options });
    const request = new EventEmitter() as EventEmitter & { end(): void };
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; destroy(): void };
      response.statusCode = 200; response.headers = {}; response.destroy = () => {};
      receive(response); response.emit("data", Buffer.from("public response")); response.emit("end");
    });
    return request;
  }) as never);
  return calls;
}
const web = (extra: Partial<BrokerDestination> = {}): BrokerDestination => ({ id: "web", kind: "public_web", endpoint: "https://raw.example.org/", accountId: "public_web",
  credentialVersion: 0, privateDataAdmitted: false, maxResponseBytes: 1024, timeoutMs: 5000, ...extra });
function fixture(destination: BrokerDestination) {
  const db = new Database(":memory:"); databases.push(db); const store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: "job", mode: "private", revision: 0, cancelled: false, destinations: ["web"], maxRequests: 1, maxFeeMicrousd: 0 });
  store.createContext({ id: "context", jobId: "job", sources: [{ id: "source", version: digest("synthetic source"), classification: "public", synthetic: true }] });
  const broker = new PrivateAgentBroker(store, [destination], { scan: async () => ({ complete: true, blocked: false, detector: "public-fixture" }) });
  const input = { jobId: "job", contextId: "context", destinationId: "web", purpose: "public source retrieval", method: "GET" as const,
    url: "https://raw.example.org/doc.md", maxFeeMicrousd: 0 };
  return { broker, store, input };
}

describe("fake-IP system proxy opt-in", () => {
  it("matches only 198.18.0.0/15", () => {
    for (const address of ["198.18.0.0", "198.18.0.251", "198.19.255.255"]) expect(isProxyFakeIpAddress(address)).toBe(true);
    for (const address of ["198.17.255.255", "198.20.0.0", "10.0.0.1", "127.0.0.1", "::ffff:198.18.0.1", "fc00::1", "not-an-ip"]) expect(isProxyFakeIpAddress(address)).toBe(false);
  });

  it("refuses a fake-IP answer by default, before anything is sent", async () => {
    const calls = transportMock(), f = fixture(web());
    await expect(f.broker.request(f.input)).rejects.toThrow();
    expect(calls).toEqual([]);
    expect(f.store.dispatches("job")).toMatchObject([{ status: "failed", failure: { code: "connection_failed" } }]);
  });

  it("admits it when opted in, pinned to that address, with the certificate verified for the hostname", async () => {
    const calls = transportMock(), f = fixture(web({ proxyFakeIp: true }));
    await expect(f.broker.request(f.input)).resolves.toBeDefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.hostname).toBe("raw.example.org");
    expect(calls[0]!.options).toMatchObject({ servername: "raw.example.org", rejectUnauthorized: true });
    const pinned = await new Promise<string>(resolve => (calls[0]!.options.lookup as (h: string, o: object, cb: (e: null, a: string) => void) => void)("raw.example.org", {}, (_e, a) => resolve(a)));
    expect(pinned).toBe("198.18.0.251");
    expect(f.store.dispatches("job")).toMatchObject([{ status: "settled" }]);
  });

  it.each([["10.0.0.1"], ["127.0.0.1"], ["192.168.1.1"], ["100.64.0.1"], ["169.254.169.254"], ["fc00::1"]])("still refuses %s when opted in", async address => {
    vi.mocked(lookup).mockResolvedValue([{ address, family: 4 }] as never);
    const calls = transportMock(), f = fixture(web({ proxyFakeIp: true }));
    await expect(f.broker.request(f.input)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("refuses an answer that mixes a fake-IP address with a private one", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "198.18.0.251", family: 4 }, { address: "10.0.0.1", family: 4 }] as never);
    const calls = transportMock(), f = fixture(web({ proxyFakeIp: true }));
    await expect(f.broker.request(f.input)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it.each<[string, Partial<BrokerDestination>]>([
    ["a local model", { kind: "local_model", endpoint: "https://model.example.org/v1" }],
    ["plain HTTP", { endpoint: "http://raw.example.org/" }],
    ["an IP-literal endpoint", { endpoint: "https://198.18.0.5/" }],
    ["the DoH resolver route", { publicDnsResolver: "cloudflare_v1" }],
    ["a loopback fixture", { endpoint: "https://127.0.0.1/", loopbackFixture: true }],
    ["a value other than true", { proxyFakeIp: false as unknown as true }],
  ])("refuses the opt-in on %s at construction", (_name, extra) => {
    // Plain HTTP to a public site is already refused by the TLS rule; every other case by the opt-in's own rule.
    expect(() => fixture(web({ proxyFakeIp: true, ...extra }))).toThrow(/destination_(proxy_fake_ip_invalid|tls_required)/u);
  });

  it("is carried by the cloud arm and its freeze only when set", () => {
    const input = { model: "m", endpoint: "https://api.example.org/v1/chat/completions", prices: { input: 2, output: 10, cached: 0.2 }, maxFeeUsd: 8 };
    const coordinator = { maxOutputTokens: 16_384, thinking: "medium" as const, maxRequestBytes: 640 * 1024 };
    const environment = { SOAR_PHASE2_CLOUD_API_KEY: "sk-synthetic-key-0001" };
    const plain = buildCloudArm(input, environment, coordinator);
    expect(plain.destination).not.toHaveProperty("proxyFakeIp"); expect(plain.freeze).not.toHaveProperty("proxyFakeIp");
    const opted = buildCloudArm({ ...input, proxyFakeIp: true }, environment, coordinator);
    expect(opted.destination.proxyFakeIp).toBe(true); expect(opted.freeze.proxyFakeIp).toBe(true);
  });

  it("is a cloud-only flag on the driver and the critique command lines", () => {
    const h = (c: string) => c.repeat(64);
    const driver = ["--execute-synthetic-local", "--task-directory", "t", "--job-sha256", h("a"), "--brief-sha256", h("b"), "--authority-sha256", h("c"),
      "--image-id", `sha256:${h("d")}`, "--output-directory", "o", "--runtime-sha256", h("e")];
    const cloud = ["--arm", "cloud", "--cloud-model", "m", "--cloud-endpoint", "https://e.invalid/v1", "--cloud-prices", "1,1,1", "--max-fee-usd", "1", "--cloud-long-context", "272000,2,2,1"];
    expect(parseLocalArtifactScreenArguments([...driver, ...cloud]).cloudArm).not.toHaveProperty("proxyFakeIp");
    expect(parseLocalArtifactScreenArguments([...driver, ...cloud, "--proxy-fake-ip", "true"]).cloudArm?.proxyFakeIp).toBe(true);
    expect(() => parseLocalArtifactScreenArguments([...driver, "--proxy-fake-ip", "true"])).toThrow("local_screen_cli_invalid");
    expect(() => parseLocalArtifactScreenArguments([...driver, ...cloud, "--proxy-fake-ip", "false"])).toThrow("local_screen_cli_invalid");
    const base = ["--critique", "--run-directory", "r", "--task-directory", "t", "--job-sha256", h("a"), "--brief-sha256", h("b"), "--image-id", `sha256:${h("c")}`, "--output-directory", "o"];
    const critic = ["--critic", "cloud", "--cloud-model", "m", "--cloud-endpoint", "https://e.invalid/v1", "--cloud-prices", "2,8,0.5", "--max-fee-usd", "1"];
    expect(parseCritiqueArguments([...base, ...critic, "--proxy-fake-ip", "true"]).cloudArm?.proxyFakeIp).toBe(true);
    expect(() => parseCritiqueArguments([...base, "--critic", "local", "--proxy-fake-ip", "true"])).toThrow("repair_cli_invalid");
  });

  it("is off in the desktop configuration unless SOAR_PROXY_FAKE_IP=true", () => {
    const environment = { SOAR_PROVIDER_MODE: "fake" } as NodeJS.ProcessEnv;
    const roots = { cwd: "/nonexistent-soar-root", appPath: "/nonexistent-soar-root" };
    expect(loadConfig({ ...roots, environment }).proxyFakeIp).toBe(false);
    expect(loadConfig({ ...roots, environment: { ...environment, SOAR_PROXY_FAKE_IP: "true" } }).proxyFakeIp).toBe(true);
    expect(() => loadConfig({ ...roots, environment: { ...environment, SOAR_PROXY_FAKE_IP: "yes" } })).toThrow();
  });
});
