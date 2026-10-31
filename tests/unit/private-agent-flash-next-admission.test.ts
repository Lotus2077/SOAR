import Database from "better-sqlite3";
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateAgentBroker, type BrokerRequest } from "../../src/main/private-agent/broker";
import { digest } from "../../src/main/private-agent/contracts";
import { LocalTokenAdmissionError, LOCAL_TOKEN_ADMISSION_STOP } from "../../src/main/private-agent/flash-next-admission";
import { hasInvalidModelRequestSizeStop, modelRequestTokenAdmissionStop } from "../../src/main/private-agent/model";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { flashNextAdmissionFixture } from "../helpers/flash-next-admission-fixture";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fixture(options: Parameters<typeof flashNextAdmissionFixture>[0] = {}) {
  const value = flashNextAdmissionFixture(options); cleanups.push(value.cleanup); return value;
}
const body = (max = 256) => JSON.stringify({ model: "qualified-flash", max_tokens: max,
  messages: [{ role: "user", content: "synthetic" }], reasoning_effort: "medium",
  chat_template_kwargs: { enable_thinking: true, preserve_thinking: false } });

function brokerFixture(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture(options), db = new Database(":memory:"); cleanups.push(() => db.close());
  const store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: "job", mode: "private", revision: 0, cancelled: false,
    destinations: ["local"], maxRequests: 5, maxFeeMicrousd: 0 });
  store.createContext({ id: "context", jobId: "job", sources: [{ id: "source", version: digest("synthetic"), classification: "private", synthetic: true }] });
  const destination = { id: "local", kind: "local_model" as const, endpoint: f.endpoint, accountId: "fixture", credentialVersion: 0,
    // Real helper startup competes with the parallel suite; the explicit hung-helper test owns the short-timeout assertion.
    privateDataAdmitted: true, loopbackFixture: true, timeoutMs: 30_000, maxResponseBytes: 8192, localTokenAdmissionSha256: f.descriptor.sha256 };
  const broker = new PrivateAgentBroker(store, [destination], { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) },
    { localTokenAdmissions: [f.admission] });
  const request: BrokerRequest = { jobId: "job", contextId: "context", destinationId: "local", purpose: "fixture", method: "POST", body: body(),
    maxFeeMicrousd: 0, localReplyContract: { version: "flash_next_v1", model: "qualified-flash", thinking: "medium" },
    localTokenAdmission: { policySha256: f.descriptor.sha256, contextTokens: f.contextTokens } };
  const wire = vi.spyOn(http, "request").mockImplementation(() => { throw new Error("HTTP must not start"); });
  return { ...f, store, db, destination, broker, request, wire };
}

describe("Flash exact-token proof", () => {
  it("admits exact context equality with explicit zero margin and counts above raw bytes", async () => {
    const f = fixture({ promptTokens: 768 });
    expect(Buffer.byteLength(body())).toBeLessThan(768);
    const proof = await f.admission.admit(body(), f.endpoint, f.model, 1024);
    expect(proof).toMatchObject({ promptTokens: 768, maxOutputTokens: 256, safetyMarginTokens: 0, maxModelLen: 1024, bodySha256: digest(body()) });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(JSON.stringify(proof)).not.toContain("synthetic");
  });
  it("uses the actual per-call output reservation and explicit safety margin", async () => {
    const f = fixture({ promptTokens: 768, safetyMarginTokens: 1 });
    await expect(f.admission.admit(body(), f.endpoint, f.model, 1024)).rejects.toMatchObject({ code: "local_token_context_exceeded" });
    await expect(f.admission.admit(body(128), f.endpoint, f.model, 1024)).resolves.toMatchObject({ maxOutputTokens: 128 });
  });
  it.each(["bad-body", "bad-fit", "invalid-json"] as const)("refuses invalid helper proof %s", async mode => {
    const f = fixture({ mode });
    await expect(f.admission.admit(body(), f.endpoint, f.model, 1024)).rejects.toMatchObject({ code: "local_token_admission_proof_invalid", bodySha256: digest(body()) });
  });
  it("refuses endpoint/model/context drift before helper admission", async () => {
    const f = fixture();
    for (const [endpoint, model, context] of [[f.endpoint + "x", f.model, 1024], [f.endpoint, "other", 1024], [f.endpoint, f.model, 2048]] as const) {
      await expect(f.admission.admit(body(), endpoint, model, context)).rejects.toMatchObject({ code: "local_token_admission_invalid" });
    }
  });
  it.each(["policy", "serving", "helper", "config"])("refuses %s byte drift", async target => {
    const f = fixture(), path = target === "policy" ? f.descriptor.path : target === "serving" ? f.policy.servingManifest.path :
      target === "helper" ? f.policy.helper.path : f.policy.helper.configPath;
    writeFileSync(path, "changed");
    await expect(f.admission.admit(body(), f.endpoint, f.model, 1024)).rejects.toMatchObject({ code: "local_token_admission_pin_drift" });
  });
  it("bounds a hung helper and honors cancellation without exposing its text", async () => {
    const f = fixture({ mode: "hang", timeoutMs: 20 });
    await expect(f.admission.admit(body(), f.endpoint, f.model, 1024)).rejects.toMatchObject({ code: "local_token_admission_timeout" });
    const controller = new AbortController(); controller.abort();
    await expect(f.admission.admit(body(), f.endpoint, f.model, 1024, controller.signal)).rejects.toMatchObject({ code: "local_token_admission_cancelled" });
  });
});

describe("Flash broker preparation before dispatch", () => {
  it("fails closed without a loaded guard or request policy metadata", async () => {
    const f = brokerFixture();
    const unguarded = new PrivateAgentBroker(f.store, [f.destination], { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) });
    await expect(unguarded.request(f.request)).rejects.toBeInstanceOf(LocalTokenAdmissionError);
    await expect(f.broker.request({ ...f.request, localTokenAdmission: undefined })).rejects.toMatchObject({ code: "local_token_admission_missing" });
    expect(f.store.dispatches("job")).toEqual([]); expect(f.wire).not.toHaveBeenCalled();
  });
  it("exposes the immutable exact proof at commit, and callback refusal rolls everything back", async () => {
    const f = brokerFixture({ promptTokens: 600 });
    await expect(f.broker.request(f.request, () => 0, proof => {
      expect(proof).toMatchObject({ promptTokens: 600, bodySha256: digest(body()), policySha256: f.descriptor.sha256 });
      expect(Object.isFrozen(proof)).toBe(true); throw new Error("row envelope refused");
    })).rejects.toThrow("row envelope refused");
    expect(f.store.dispatches("job")).toEqual([]); expect(f.wire).not.toHaveBeenCalled();
  });
  it("cancelJob during a pending helper leaves no receipt/HTTP or UNKNOWN", async () => {
    const f = brokerFixture({ delayMs: 200 });
    const result = f.broker.request(f.request); setTimeout(() => f.broker.cancelJob("job"), 20);
    await expect(result).rejects.toMatchObject({ code: "local_token_admission_cancelled", bodySha256: digest(body()) });
    expect(f.store.dispatches("job")).toEqual([]); expect(f.wire).not.toHaveBeenCalled();
  });
  it("refuses a helper result that returns despite cancellation", async () => {
    const f = brokerFixture(), original = f.admission.admit.bind(f.admission);
    vi.spyOn(f.admission, "admit").mockImplementation(async (...args) => { const proof = await original(...args); f.broker.cancelJob("job"); return proof; });
    await expect(f.broker.request(f.request)).rejects.toMatchObject({ code: "local_token_admission_cancelled" });
    expect(f.store.dispatches("job")).toEqual([]); expect(f.wire).not.toHaveBeenCalled();
  });
  it("rechecks config drift after the asynchronous proof inside commit", async () => {
    const f = brokerFixture(), original = f.admission.admit.bind(f.admission);
    vi.spyOn(f.admission, "admit").mockImplementation(async (...args) => {
      const proof = await original(...args); writeFileSync(f.policy.helper.configPath, "changed after proof"); return proof;
    });
    await expect(f.broker.request(f.request)).rejects.toMatchObject({ code: "local_token_admission_pin_drift", bodySha256: digest(body()) });
    expect(f.store.dispatches("job")).toEqual([]); expect(f.wire).not.toHaveBeenCalled();
  });
  it("refuses a changed context CAS before commit as proven non-dispatch", async () => {
    const f = brokerFixture(), original = f.admission.admit.bind(f.admission);
    vi.spyOn(f.admission, "admit").mockImplementation(async (...args) => {
      const proof = await original(...args);
      f.store.addSources("context", [{ id: "new-source", version: digest("new"), classification: "private", synthetic: true }]);
      return proof;
    });
    await expect(f.broker.request(f.request)).rejects.toMatchObject({ code: "local_token_admission_invalid", bodySha256: digest(body()) });
    expect(f.store.dispatches("job")).toEqual([]); expect(f.wire).not.toHaveBeenCalled();
  });
  it("freezes caller body and token metadata before awaiting the helper", async () => {
    const f = brokerFixture({ delayMs: 20 }), originalBody = f.request.body!;
    const result = f.broker.request(f.request, () => 0, proof => {
      expect(proof?.bodySha256).toBe(digest(originalBody)); throw new Error("stop before fixture HTTP");
    });
    f.request.body = "mutated"; f.request.localTokenAdmission!.contextTokens = 9999;
    await expect(result).rejects.toThrow("stop before fixture HTTP");
    expect(f.store.dispatches("job")).toEqual([]); expect(f.wire).not.toHaveBeenCalled();
  });
  it("joins only one exact host nondispatch marker and rejects orphan/duplicate proof", () => {
    const operationId = randomUUID(), start = { type: "model_started", operationId, contextId: "context", promptProtocolSha256: digest("prompt") };
    const marker = { type: "model_request_not_dispatched", operationId, contextId: "context", promptProtocolSha256: digest("prompt"),
      reason: LOCAL_TOKEN_ADMISSION_STOP, dispatched: false, code: "local_token_context_exceeded", bodySha256: digest(body()) };
    expect(modelRequestTokenAdmissionStop([start, marker], start)).toEqual(marker);
    expect(hasInvalidModelRequestSizeStop([start, marker])).toBe(false);
    expect(hasInvalidModelRequestSizeStop([marker])).toBe(true);
    expect(hasInvalidModelRequestSizeStop([start, marker, marker])).toBe(true);
    expect(JSON.stringify(marker)).not.toContain("synthetic");
  });
});
