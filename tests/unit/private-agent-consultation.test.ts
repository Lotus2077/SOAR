import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { GeneralConsultation, consultationModelCalls, decideWithoutDispatch, readConsultation } from "../../src/main/private-agent/consultation";
import { consultantPriceProfileSha256, type ConsultantTextConfig } from "../../src/main/private-agent/consultant-model";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fixture(configOverrides: Partial<ConsultantTextConfig> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "soar-consultation-")); cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, "state.sqlite"), db = new Database(database); cleanups.push(() => db.close());
  const store = new PrivateAgentStore(db), jobId = randomUUID(), contextId = randomUUID();
  store.createJob({ version: 1, id: jobId, mode: "cloud_help", revision: 0, cancelled: false, destinations: ["consultant"], maxRequests: 8, maxFeeMicrousd: 100000 });
  store.createContext({ id: contextId, jobId, sources: [{ id: "original", version: digest("synthetic authored task"), classification: "private", synthetic: true }] });
  const config: ConsultantTextConfig = { destinationId: "consultant", model: "fixture-consultant", maxOutputTokens: 128, inputMicrousdPerMillion: 1000000, outputMicrousdPerMillion: 2000000, ...configOverrides };
  const destination = { id: "consultant", kind: "cloud_model" as const, endpoint: "http://127.0.0.1:1/v1/chat/completions", accountId: "fixture", credentialVersion: 1,
    privateDataAdmitted: false, syntheticOnly: true, loopbackFixture: true, timeoutMs: 1000, maxResponseBytes: 16384, requireExactGrant: true, approvalPriceProfileSha256: consultantPriceProfileSha256(config) };
  const broker = new PrivateAgentBroker(store, [destination], { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) });
  const checkpoints = new PrivateCheckpointStore(join(directory, "checkpoints"), jobId);
  const files = [{ path: "input.txt", bytes: Buffer.from("AUTHORED-SYNTHETIC-INPUT") }, { path: "other.txt", bytes: Buffer.from("OMITTED-CONTENT-CANARY") }];
  const snapshot = checkpoints.save(files);store.append(jobId, { type: "checkpoint", contextId, snapshot, sha256: checkpoints.fingerprint(snapshot) });
  let drift = false;
  const args = { store, broker, checkpoints, jobId, contextId, config, destination: { id: destination.id, endpoint: destination.endpoint, accountId: destination.accountId, credentialVersion: destination.credentialVersion }, profileSha256: digest("profile-v1"), maxFeeMicrousd: 20000, deadlineAt: Date.now() + 60000,
    validateCurrent: () => { if (drift) throw new Error("profile_changed"); } };
  const manager = new GeneralConsultation(args);
  let owner = "";
  const acquire = () => { owner = randomUUID(); store.acquireRun(contextId, owner, "unix:///tmp/fixture.sock"); };
  const release = () => store.releaseRun(contextId, owner, true);
  acquire();
  const propose = (artifactPaths = ["input.txt"]) => manager.propose({ question: "Check this synthetic result without running tools.", artifactPaths }, snapshot);
  const approve = () => { release(); const p = manager.view()!; manager.decide({ proposalId: p.proposalId, proposalSha256: p.proposalSha256, decision: "approve" }); acquire(); };
  let beforeCommit: () => void = () => {}, afterCommit: () => void = () => {}, unknown = false, failed = false;
  const request = vi.spyOn(broker, "request").mockImplementation(async (input, settle = () => 0, validate) => {
    await Promise.resolve(); beforeCommit();
    const { text: _text, ...preview } = broker.preview(input);
    const receipt = store.commit({ ...preview, reservedFeeMicrousd: input.maxFeeMicrousd, scan: { status: "complete", detector: "fixture" } }, () => validate?.(), input.grantId);
    afterCommit();
    if (unknown) { store.unknown(receipt.id); throw new Error("transport_unknown"); }
    // PR-C: a confirmed abort (nothing sent) resolves the consultant row as failed; it reserves nothing and is not uncertain.
    if (failed) { store.resolveFailure(receipt.id, "failed", { phase: "transport", code: "connection_failed", elapsedMs: 1, timeoutMs: 1000 }); throw new Error("request_failed"); }
    const bytes = Buffer.from(canonical({ model: config.model, ...(config.serviceTier ? { service_tier: config.serviceTier } : {}),
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Check the arithmetic. Untrusted fixture advice." } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
        ...(config.cachedInputMicrousdPerMillion === undefined ? {} : { prompt_tokens_details: { cached_tokens: 40 } }) } }));
    store.settle(receipt.id, settle(bytes), digest(bytes)); return { bytes, receipt: store.dispatch(receipt.id) };
  });
  return { args, manager, store, checkpoints, jobId, contextId, database, directory, snapshot, propose, approve, acquire, release, request,
    drift: () => { drift = true; }, beforeCommit: (fn: () => void) => { beforeCommit = fn; }, unknown: () => { unknown = true; }, failed: () => { failed = true; }, afterCommit: (fn: () => void) => { afterCommit = fn; } };
}
const signal = () => new AbortController().signal;

describe("one durable exact-packet consultation", () => {
  it("prepares selected immutable UTF-8 bytes with complete inherited lineage and omitted metadata, without dispatch", () => {
    const f = fixture(), p = f.propose();
    expect(p).toMatchObject({ status: "pending", selected: [{ path: "input.txt" }], omitted: [{ path: "other.txt" }], uncertain: false, disclosureCommitted: false });
    expect(p.packetText).toContain("AUTHORED-SYNTHETIC-INPUT"); expect(p.packetText).not.toContain("OMITTED-CONTENT-CANARY");
    expect(p.packetText).toContain("inheritedContext"); expect(f.store.context(f.contextId).sources).toHaveLength(2);
    expect(f.request).not.toHaveBeenCalled(); expect(f.store.dispatches(f.jobId)).toEqual([]);
    expect(() => f.propose()).toThrow("consultation_already_requested");
  });
  it("allows a question-only packet and does not silently include omitted contents", () => {
    const f = fixture(), p = f.propose([]); expect(p.selected).toEqual([]); expect(p.omitted).toHaveLength(2);
    expect(p.packetText).not.toContain("AUTHORED-SYNTHETIC-INPUT"); expect(p.packetText).not.toContain("OMITTED-CONTENT-CANARY");
  });
  it.each(["missing", "duplicate", "invalid_utf8", "oversize"])("rejects %s selection atomically without a partial proposal or context addition", mutation => {
    const f = fixture(); let snapshot = f.snapshot, paths = ["missing.txt"];
    if (mutation === "duplicate") paths = ["input.txt", "input.txt"];
    if (mutation === "invalid_utf8" || mutation === "oversize") { snapshot = f.checkpoints.save([{ path: "bad.txt", bytes: mutation === "invalid_utf8" ? Buffer.from([255]) : Buffer.alloc(32769, 65) }]); paths = ["bad.txt"]; f.store.append(f.jobId, { type: "checkpoint", contextId: f.contextId, snapshot, sha256: f.checkpoints.fingerprint(snapshot) }); }
    expect(() => f.manager.propose({ question: "Check", artifactPaths: paths }, snapshot)).toThrow();
    expect(f.manager.view()).toBeNull(); expect(f.store.context(f.contextId).sources).toHaveLength(1); expect(f.request).not.toHaveBeenCalled();
  });
  it("requires cleanup and exact preview identity for approval; concurrent approvals cannot mint a second grant", () => {
    const f = fixture(), p = f.propose();
    expect(() => f.manager.decide({ ...p, decision: "approve" })).toThrow("consultation_cleanup_required"); f.release();
    expect(() => f.manager.decide({ ...p, proposalSha256: "0".repeat(64), decision: "approve" })).toThrow("consultation_stale_decision");
    f.manager.decide({ ...p, decision: "approve" });
    expect(() => f.manager.decide({ ...p, decision: "approve" })).toThrow("consultation_stale_decision"); expect(f.request).not.toHaveBeenCalled();
  });
  it.each(["decline", "revoke"] as const)("persists %s without needing an available profile or making a consultant request", async decision => {
    const f = fixture(), p = f.propose(); f.release(); f.drift();
    const v = decideWithoutDispatch(f.store, f.jobId, { ...p, decision }); expect(v.status).toBe(decision === "decline" ? "declined" : "revoked");
    expect(JSON.parse(await f.manager.resume(signal())).consultation).toBe(v.status); expect(f.request).not.toHaveBeenCalled(); expect(consultationModelCalls(f.store, f.jobId)).toBe(0);
  });
  it("settles one call, persists exact advice and reuses it across SQLite reopen and a newer local checkpoint", async () => {
    const f = fixture(); f.propose(); f.approve(); const text = await f.manager.resume(signal());
    expect(JSON.parse(text)).toMatchObject({ consultation: "settled", completed: false, content: "Check the arithmetic. Untrusted fixture advice." });
    expect(f.manager.view()).toMatchObject({ status: "settled", feeMicrousd: 140, uncertain: false });
    const newer = f.checkpoints.save([{ path: "new-output.txt", bytes: Buffer.from("local continuation") }]); f.store.append(f.jobId, { type: "checkpoint", contextId: f.contextId, snapshot: newer, sha256: f.checkpoints.fingerprint(newer) });
    const db = new Database(f.database); cleanups.push(() => db.close()); const store = new PrivateAgentStore(db);
    expect(await new GeneralConsultation({ ...f.args, store }).resume(signal())).toBe(text);
    expect(consultationModelCalls(store, f.jobId)).toBe(1); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("retains validated standard-tier usage for independent fee recomputation after SQLite reopen", async () => {
    const f = fixture({ serviceTier: "default", inputMicrousdPerMillion: 2000000, cachedInputMicrousdPerMillion: 500000, outputMicrousdPerMillion: 8000000 });
    f.propose(); f.approve(); const advice = await f.manager.resume(signal());
    const db = new Database(f.database); cleanups.push(() => db.close()); const store = new PrivateAgentStore(db);
    const response = store.events(f.jobId).find(event => event.type === "consultation_response")!;
    expect(response.accounting).toEqual({ model: "fixture-consultant", serviceTier: "default", usage: { promptTokens: 100, completionTokens: 20, cachedInputTokens: 40 } });
    // Sixty uncached input tokens at 2, forty cached at 0.5, twenty output at 8 microdollars.
    expect(response.feeMicrousd).toBe(60 * 2 + 40 / 2 + 20 * 8);
    expect(await new GeneralConsultation({ ...f.args, store }).resume(signal())).toBe(advice);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "model", "tier", "input", "cache", "output"])("blocks continuation without replay when durable %s accounting no longer binds", async mutation => {
    const f = fixture({ serviceTier: "default" }); f.propose(); f.approve(); await f.manager.resume(signal());
    const events = f.store.events(f.jobId);
    const response = events.find(event => event.type === "consultation_response")!;
    const accounting = response.accounting as { model: string; serviceTier?: string; usage: { promptTokens: number; completionTokens: number; cachedInputTokens: number } };
    if (mutation === "missing") delete response.accounting;
    if (mutation === "model") accounting.model = "changed";
    if (mutation === "tier") delete accounting.serviceTier;
    if (mutation === "input") accounting.usage.promptTokens++;
    if (mutation === "cache") accounting.usage.cachedInputTokens = 101;
    if (mutation === "output") accounting.usage.completionTokens = 129;
    vi.spyOn(f.store, "events").mockReturnValue(events);
    expect(f.manager.view()?.uncertain).toBe(true);
    await expect(new GeneralConsultation(f.args).resume(signal())).rejects.toThrow("consultation_response_missing_no_replay");
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("keeps a historical proposal and response without usage evidence readable without inventing it", async () => {
    const f = fixture(); const append = f.store.append.bind(f.store);
    vi.spyOn(f.store, "append").mockImplementation((jobId, input) => {
      const event = structuredClone(input);
      if (event.type === "consultation_proposed") {
        const proposal = event.proposal as Record<string, unknown>;
        delete proposal.requiresAccounting;
        event.proposalSha256 = digest(canonical(proposal));
      }
      if (event.type === "consultation_response") delete event.accounting;
      return append(jobId, event);
    });
    f.propose(); f.approve(); const advice = await f.manager.resume(signal());
    const db = new Database(f.database); cleanups.push(() => db.close()); const store = new PrivateAgentStore(db);
    expect(store.events(f.jobId).find(event => event.type === "consultation_response")!.accounting).toBeUndefined();
    expect(await new GeneralConsultation({ ...f.args, store }).resume(signal())).toBe(advice);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each(["profile", "context", "checkpoint", "revoke", "deadline"])("stops %s drift after preparation/approval before network commitment", async mutation => {
    const f = fixture(), p = f.propose(); f.approve();
    f.beforeCommit(() => { if (mutation === "profile") f.drift();
      if (mutation === "context") f.store.addSources(f.contextId, [{ id: "new", version: digest("changed"), classification: "private", synthetic: true }]);
      if (mutation === "checkpoint") f.store.append(f.jobId, { type: "checkpoint", contextId: f.contextId, snapshot: [], sha256: digest("changed") });
      if (mutation === "revoke") f.manager.decide({ ...p, decision: "revoke" });
      if (mutation === "deadline") vi.spyOn(Date, "now").mockReturnValue(f.args.deadlineAt + 1);
    });
    await expect(f.manager.resume(signal())).rejects.toThrow(); expect(f.store.dispatches(f.jobId)).toHaveLength(0);
    expect(consultationModelCalls(f.store, f.jobId)).toBe(1); await expect(f.manager.resume(signal())).rejects.toThrow("consultation_response_missing_no_replay"); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("a confirmed abort resolves the consultant row as failed: no reservation, not uncertain, never replayed", async () => {
    const f = fixture(); f.propose(); f.approve(); f.failed(); await expect(f.manager.resume(signal())).rejects.toThrow();
    expect(f.manager.view()).toMatchObject({ uncertain: false, status: "failed", disclosureCommitted: true });
    expect(f.store.dispatches(f.jobId)[0]).toMatchObject({ status: "failed", failure: { code: "connection_failed" } });
    expect(f.store.dispatches(f.jobId).filter(row => row.status === "committed" || row.status === "unknown")).toHaveLength(0);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("unknown dispatch preserves fee exposure and blocks replay after restart", async () => {
    const f = fixture(); f.propose(); f.approve(); f.unknown(); await expect(f.manager.resume(signal())).rejects.toThrow();
    expect(f.manager.view()).toMatchObject({ uncertain: true, status: "failed", disclosureCommitted: true });
    expect(f.store.dispatches(f.jobId)[0]).toMatchObject({ status: "unknown", reservedFeeMicrousd: f.manager.view()!.maxFeeMicrousd });
    await expect(new GeneralConsultation(f.args).resume(signal())).rejects.toThrow("consultation_response_missing_no_replay"); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("records postcommit revocation without claiming recall and never exposes late advice to the local model", async () => {
    const f = fixture(), p = f.propose(); f.approve();
    f.afterCommit(() => f.manager.decide({ ...p, decision: "revoke" }));
    const text = await f.manager.resume(signal()); expect(JSON.parse(text)).toMatchObject({ consultation: "revoked", disclosureCommitted: true, completed: false });
    expect(text).not.toContain("Check the arithmetic"); expect(f.store.dispatches(f.jobId)[0]!.status).toBe("settled");
    expect(await f.manager.resume(signal())).toBe(text); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch twice when two manager instances resume the same approved proposal", async () => {
    const f = fixture(); f.propose(); f.approve();
    const first = f.manager.resume(signal()), second = new GeneralConsultation(f.args).resume(signal());
    await expect(second).rejects.toThrow("consultation_response_missing_no_replay"); await expect(first).resolves.toContain("settled");
    expect(f.request).toHaveBeenCalledTimes(1); expect(consultationModelCalls(f.store, f.jobId)).toBe(1);
  });
  it("settled transport with failed response persistence is never requested again", async () => {
    const f = fixture(); f.propose(); f.approve(); vi.spyOn(f.checkpoints, "save").mockImplementation(() => { throw new Error("disk_failure"); });
    await expect(f.manager.resume(signal())).rejects.toThrow("disk_failure"); expect(f.store.dispatches(f.jobId)[0]!.status).toBe("settled");
    expect(readConsultation(f.store, f.jobId)?.uncertain).toBe(true); await expect(f.manager.resume(signal())).rejects.toThrow("consultation_response_missing_no_replay"); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("does not replay a request when a persisted response blob is lost", async () => {
    const f = fixture(); f.propose(); f.approve(); await f.manager.resume(signal());
    const response = f.store.events(f.jobId).find(row => row.type === "consultation_response")!;
    unlinkSync(join(f.directory, "checkpoints", f.jobId, String(response.contentSha256)));
    await expect(f.manager.resume(signal())).rejects.toThrow(); expect(f.request).toHaveBeenCalledTimes(1);
  });
});
