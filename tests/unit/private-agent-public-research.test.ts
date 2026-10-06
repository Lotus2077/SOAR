import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateAgentBroker, type BrokerDestination, type BrokerRequest } from "../../src/main/private-agent/broker";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { canonical, digest, restrictedContext } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, type GeneralMessage } from "../../src/main/private-agent/model";
import { readPublicSources, retainPublicSource } from "../../src/main/private-agent/public-sources";
import { GeneralAgentRunner, type GeneralJobOptions } from "../../src/main/private-agent/runner";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { GeneralAgentSession, sessionPhaseIdentity, type GeneralSessionOptions } from "../../src/main/private-agent/session";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { CLAIMS_LEDGER_CHECK_ID, claimsLedgerCheck, publicSourceWorkspacePath } from "../../src/main/private-agent/claims";

const cleanup: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) close(); });
const url = "https://public.example.test/facts?edition=1";
function fixture(classification: "public" | "private" = "public") {
  const root = mkdtempSync(join(tmpdir(), "soar-public-research-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const databasePath = join(root, "state.sqlite"), db = new Database(databasePath); cleanup.push(() => db.close());
  const store = new PrivateAgentStore(db), jobId = randomUUID(), contextId = randomUUID();
  const phase = { files: [], checks: [{ id: "structure", python: "# fixed host fixture" }], contract: {
    version: 1 as const, goal: "Summarize the explicitly approved public source with a citation.",
    requiredArtifacts: [{ path: "output/report.md", description: "Cited public report" }], requiredChecks: ["structure"],
    maxModelCalls: 8, maxToolCalls: 10, maxElapsedMs: 60000 } };
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["model", "web"], maxRequests: 40, maxFeeMicrousd: 0 });
  store.createContext({ id: contextId, jobId, sources: [canonical(phase.contract), canonical([])].map((value, index) => ({
    id: `source_${index}`, version: digest(value), classification, synthetic: true })) });
  const web: BrokerDestination = { id: "web", kind: "public_web", endpoint: "https://public.example.test/", exactUrl: url,
    accountId: "public", credentialVersion: 0, privateDataAdmitted: false, maxResponseBytes: 65536, timeoutMs: 1000 };
  const modelDestination: BrokerDestination = { id: "model", kind: "local_model", endpoint: "http://127.0.0.1:1/v1/chat/completions",
    accountId: "synthetic", credentialVersion: 0, privateDataAdmitted: false, syntheticOnly: true, loopbackFixture: true, maxResponseBytes: 65536, timeoutMs: 1000 };
  const scan = vi.fn(async () => ({ complete: true, blocked: false, detector: "synthetic-unit" }));
  const broker = new PrivateAgentBroker(store, [modelDestination, web], { scan });
  const checkpoints = new PrivateCheckpointStore(join(root, "checkpoints"), jobId);
  const config = { destinationId: "model", model: "synthetic", maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" as const };
  const model = new PrivateAgentModel(broker, config, jobId, contextId);
  const request: BrokerRequest = { jobId, contextId, destinationId: "web", purpose: "public source retrieval", method: "GET", url, maxFeeMicrousd: 0 };
  const settled = (bytes: Buffer, input = request, unknown = false) => {
    const { text: _text, ...preview } = broker.preview(input);
    const receipt = store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "complete", detector: "synthetic-unit" } }, () => {});
    if (unknown) store.unknown(receipt.id); else store.settle(receipt.id, 0, digest(bytes));
    return { bytes, receipt: store.dispatch(receipt.id) };
  };
  return { root, databasePath, db, store, jobId, contextId, phase, broker, checkpoints, model, config, request, settled, web, modelDestination, scan };
}

describe("exact public URL authority and host-retained sources", () => {
  it("binds the exact path/query in destination identity and rejects same-origin expansion before dispatch", () => {
    const f = fixture(), admitted = f.broker.preview(f.request);
    for (const changed of ["https://public.example.test/other?edition=1", `${url}&query=extra`, url.replace("edition=1", "edition=2"), `${url}#fragment`]) {
      expect(() => f.broker.preview({ ...f.request, url: changed })).toThrow("packet_destination_drift");
    }
    const changed = new PrivateAgentBroker(f.store, [{ ...f.web, exactUrl: url.replace("edition=1", "edition=2") }], { scan: f.scan });
    expect(changed.preview({ ...f.request, url: url.replace("edition=1", "edition=2") }).destinationSha256).not.toBe(admitted.destinationSha256);
    expect(f.store.dispatches(f.jobId)).toEqual([]);
  });
  it.each(["https://other.example.test/facts", "http://public.example.test/facts", "https://user:pass@public.example.test/facts", `${url}#fragment`])("rejects invalid exact scope %s", exactUrl => {
    const f = fixture(); expect(() => new PrivateAgentBroker(f.store, [{ ...f.web, exactUrl }], { scan: f.scan })).toThrow();
  });
  it("denies a private context before scan/transport even when the exact URL is approved", async () => {
    const f = fixture("private");
    await expect(f.broker.request(f.request)).rejects.toThrow("private_disclosure_requires_exact_grant");
    expect(f.scan).not.toHaveBeenCalled(); expect(f.store.dispatches(f.jobId)).toEqual([]);
  });
  it("retains original bytes outside writable snapshots and verifies the settled packet and source bytes", () => {
    const f = fixture(), bytes = Buffer.from("Public fact: a test has two stages. 你好"), response = f.settled(bytes);
    const source = retainPublicSource(f.store, f.checkpoints, { ...f.request, url, bytes, receipt: response.receipt });
    expect(readPublicSources(f.store, f.checkpoints, f.jobId, f.contextId)).toEqual([source]);
    expect(source).toMatchObject({ url, sha256: digest(bytes), bytes: bytes.length, dispatchId: response.receipt.id });
    expect(f.phase.files).toEqual([]);
    const event = f.store.events(f.jobId).find(row => row.type === "public_source_retained")!;
    expect(f.checkpoints.load(event.snapshot as never)[0]!.bytes).toEqual(bytes);
    writeFileSync(join(f.root, "checkpoints", f.jobId, source.sha256), "tampered");
    expect(() => readPublicSources(f.store, f.checkpoints, f.jobId)).toThrow();
  });
  it.each(["url", "response", "unknown", "duplicate", "snapshot"])("rejects %s source evidence drift", mutation => {
    const f = fixture(), bytes = Buffer.from("public fact"), response = f.settled(bytes);
    retainPublicSource(f.store, f.checkpoints, { ...f.request, url, bytes, receipt: response.receipt });
    const original = f.store.events(f.jobId).find(row => row.type === "public_source_retained")!;
    const event = structuredClone(original);
    if (mutation === "url") event.url = "https://public.example.test/other";
    if (mutation === "snapshot") (event.snapshot as { path: string }[])[0]!.path = "output/fake.md";
    if (mutation === "response" || mutation === "unknown") {
      const receipt = { ...response.receipt, ...(mutation === "response" ? { responseSha256: digest("different") } : { status: "unknown" }) };
      f.db.prepare("UPDATE private_agent_dispatches SET value=? WHERE id=?").run(canonical(receipt), receipt.id);
    } else if (mutation === "duplicate") f.store.append(f.jobId, event);
    else f.db.prepare("UPDATE private_agent_events SET value=? WHERE job_id=? AND value=?").run(canonical(event), f.jobId, canonical(original));
    expect(() => readPublicSources(f.store, f.checkpoints, f.jobId)).toThrow();
  });
});

function runnerFixture(actions: string[], options: { unknown?: boolean; body?: Buffer; maxPublicFetches?: number; claimsLedger?: boolean } = {}) {
  const f = fixture();
  if (options.claimsLedger) {
    f.phase.checks.push(claimsLedgerCheck({ reportPath: "output/report.md", sources: [], publicSources: true }));
    f.phase.contract = { ...f.phase.contract, requiredChecks: [...f.phase.contract.requiredChecks, CLAIMS_LEDGER_CHECK_ID] };
    f.store.addSources(f.contextId, [{ id: "ledger_contract", version: digest(canonical(f.phase.contract)), classification: "public", synthetic: true }]);
  }
  vi.spyOn(DockerSandbox, "currentEndpoint").mockResolvedValue("unix:///tmp/public-research-unit.sock");
  vi.spyOn(DockerSandbox, "cleanupOwnedContext").mockResolvedValue();
  const workspaceFiles: string[][] = [], writes: string[] = [], commands: string[] = [], snapshots: Map<string, Buffer>[] = [];
  vi.spyOn(DockerSandbox, "create").mockImplementation(async input => {
    workspaceFiles.push(input.files.map(file => file.path)); const files = new Map(input.files.map(file => [file.path, file.bytes]));
    snapshots.push(new Map(input.files.map(file => [file.path, Buffer.from(file.bytes)])));
    return { async execute(command: string) { commands.push(command); if (command === "write report") files.set("output/report.md", Buffer.from("Public report with citation.")); return { exitCode: 0, stdout: "", stderr: "" }; },
      async editFile(mode: string, path: string, payload: Buffer) { if (mode !== "write") throw new Error("unexpected edit mode"); files.set(path, Buffer.from(payload)); writes.push(path); return { ok: true, bytes: payload.length }; },
      async listFiles() { return [...files.keys()]; }, async readFile(name: string) { return files.get(name)!; }, async close() {} } as unknown as DockerSandbox;
  });
  const messages: GeneralMessage[][] = [];
  let afterResponse = () => {};
  vi.spyOn(f.model, "complete").mockImplementation(async input => {
    messages.push(structuredClone(input)); const index = messages.length - 1, name = actions[index];
    if (!name) throw new Error("unexpected model call");
    f.settled(Buffer.from(name), { ...f.request, destinationId: "model", purpose: "synthetic model fixture", method: "POST", url: f.modelDestination.endpoint, body: canonical(input) });
    afterResponse();
    return { content: "", finishReason: "tool_calls", toolCalls: [{ id: `tool_${index}`, type: "function", function: { name,
      arguments: canonical(name === "fetch_public" ? { destinationId: "web", url } : name === "execute" ? { command: "write report" }
        : name === "write_file" ? { path: publicSourceWorkspacePath(url), content: "forged source text" } : name === "check_claims" ? {} : { summary: "Submit the public report." }) } }], costUsd: 0, durationMs: 1 };
  });
  const requests = vi.spyOn(f.broker, "request").mockImplementation(async request => {
    const response = f.settled(options.body ?? Buffer.from("Public source body."), request, options.unknown);
    if (options.unknown) throw new Error("transport_or_settlement_unknown");
    return response;
  });
  const args: GeneralJobOptions = { ...f.phase, jobId: f.jobId, contextId: f.contextId, imageId: `sha256:${"a".repeat(64)}`,
    store: f.store, broker: f.broker, model: f.model, checkpoints: f.checkpoints, webDestinations: ["web"], maxPublicFetches: options.maxPublicFetches ?? 2 };
  return { ...f, args, requests, messages, writes, workspaceFiles, commands, snapshots, afterResponse: (fn: () => void) => { afterResponse = fn; } };
}

describe("public retrieval through the single bounded runner", () => {
  it("preserves fetch counts and original responses across pause/database reopen without replay", async () => {
    const f = runnerFixture(["fetch_public", "fetch_public", "fetch_public", "execute", "finish"]), runner = new GeneralAgentRunner(f.args);
    f.afterResponse(() => { if (f.messages.length === 1) runner.pause(); });
    expect((await runner.run()).status).toBe("paused"); expect(f.requests).toHaveBeenCalledTimes(1);
    const first = readPublicSources(f.store, f.checkpoints, f.jobId);
    const reopened = new Database(f.databasePath); cleanup.push(() => reopened.close()); const store = new PrivateAgentStore(reopened);
    expect((await new GeneralAgentRunner({ ...f.args, store }).run()).status).toBe("completed");
    expect(f.requests).toHaveBeenCalledTimes(2); expect(f.messages).toHaveLength(5);
    expect(readPublicSources(store, f.checkpoints, f.jobId)[0]).toEqual(first[0]);
    const observations = store.events(f.jobId).filter(row => row.type === "tool_finished").map(row => JSON.parse(String(row.output)));
    expect(observations[2]).toMatchObject({ error: "public_fetch_limit_reached", actionInvoked: false });
    expect(f.messages.map(items => JSON.parse(items[0]!.content!.split("\n").at(-1)!)).map(budget => budget.remainingPublicFetches)).toEqual([2, 1, 0, 0, 0]);
    expect(f.workspaceFiles.flat().some(name => name.startsWith("public-sources/"))).toBe(false);
    expect(store.dispatches(f.jobId)).toHaveLength(7);
  });
  it("retains the full UTF-8 source while clearly marking an observation shortened at a character boundary", async () => {
    const body = Buffer.from("文".repeat(15000)), f = runnerFixture(["fetch_public"], { body });
    f.args.contract = { ...f.args.contract, maxModelCalls: 1 };
    // Contract identity must match the independently built context inputs.
    f.store.addSources(f.contextId, [{ id: "bounded_contract", version: digest(canonical(f.args.contract)), classification: "public", synthetic: true }]);
    await new GeneralAgentRunner(f.args).run();
    const output = JSON.parse(String(f.store.events(f.jobId).find(row => row.type === "tool_finished")!.output));
    expect(output).toMatchObject({ truncated: true, bytes: body.length, sha256: digest(body), observedBytes: 32766, workspaceCopy: true, workspacePath: expect.stringMatching(/^sources\/[a-f0-9]{16}\.bin$/u) });
    expect(f.writes).toEqual([output.workspacePath]);
    expect(output.text).not.toContain("�"); expect(output.instruction).toContain("unseen content");
    expect(readPublicSources(f.store, f.checkpoints, f.jobId)[0]!.bytes).toBe(body.length);
  });
  it("restores the host's retained bytes over a forged sources/ copy before check_claims and in the verifier, and passes the digest to the check", async () => {
    const f = runnerFixture(["fetch_public", "write_file", "check_claims", "execute", "finish"], { claimsLedger: true });
    expect((await new GeneralAgentRunner(f.args).run()).status).toBe("completed");
    const path = publicSourceWorkspacePath(url), hostBytes = Buffer.from("Public source body.");
    // Host copy at fetch, the model's forgery, then the host's restore before the check.
    expect(f.writes).toEqual([path, path, path]);
    const command = f.commands.find(entry => entry.includes("SOAR_CLAIMS_RETAINED="))!;
    expect(JSON.parse(Buffer.from(command.match(/^SOAR_CLAIMS_RETAINED='([^']*)'/u)![1]!, "base64").toString("utf8"))).toEqual([{ url, path, sha256: digest(hostBytes) }]);
    // The verifier container receives the retained bytes, never the workspace copy.
    expect(f.snapshots.at(-1)!.get(path)!.equals(hostBytes)).toBe(true);
    expect(f.commands.filter(entry => entry.includes("SOAR_CLAIMS_RETAINED="))).toHaveLength(2);
  });
  it("stops immediately after an unknown fetch and never retries it on resume", async () => {
    const f = runnerFixture(["fetch_public", "execute"], { unknown: true });
    expect((await new GeneralAgentRunner(f.args).run()).reason).toBe("unresolved_dispatch_no_replay");
    expect(f.messages).toHaveLength(1); expect(f.requests).toHaveBeenCalledTimes(1);
    expect(f.store.dispatches(f.jobId).map(row => row.status)).toEqual(["settled", "unknown"]);
    expect((await new GeneralAgentRunner(f.args).run()).reason).toBe("unresolved_operation_no_replay");
    expect(f.messages).toHaveLength(1); expect(f.requests).toHaveBeenCalledTimes(1);
    expect(f.store.events(f.jobId).some(row => row.type === "completed" || row.type === "public_source_retained")).toBe(false);
  });
  it("rejects a changed fetch allowance on resume before another model action", async () => {
    const f = runnerFixture(["fetch_public", "execute"]), runner = new GeneralAgentRunner(f.args);
    f.afterResponse(() => runner.pause()); await runner.run();
    expect((await new GeneralAgentRunner({ ...f.args, maxPublicFetches: 3 }).run()).reason).toBe("runtime_contract_drift");
    expect(f.messages).toHaveLength(1); expect(f.requests).toHaveBeenCalledTimes(1);
  });
});

describe("explicitly public primary session", () => {
  function publicOptions(f: ReturnType<typeof fixture>): GeneralSessionOptions {
    return { jobId: f.jobId, imageId: `sha256:${"a".repeat(64)}`, store: f.store, broker: f.broker, checkpoints: f.checkpoints, privatePhase: f.phase,
      publicInputApproval: { phaseSha256: sessionPhaseIdentity(f.phase), authoritySha256: digest("public-only host approval"), webDestinations: ["web"] },
      trustedHostModelFactory: contextId => new PrivateAgentModel(f.broker, f.config, f.jobId, contextId) };
  }
  it("runs the empty-input primary phase once as public and retains its legacy primary context ID", async () => {
    const f = fixture(), config = publicOptions(f), invocations: GeneralJobOptions[] = [];
    config.trustedHostRunnerFactory = input => ({ pause() {}, cancel() {}, async run() {
      invocations.push(input); expect(restrictedContext(f.store.context(input.contextId))).toBe(false);
      const snapshot = f.checkpoints.save([{ path: "output/report.md", bytes: Buffer.from("public fixture") }]), checks = [{ id: "structure", passed: true }];
      f.store.append(f.jobId, { type: "completed", contextId: input.contextId, snapshot, checks, verifiedSnapshotSha256: f.checkpoints.fingerprint(snapshot) });
      return { status: "completed", reason: "fixture", snapshot, checks, modelCalls: 0 };
    } });
    expect((await new GeneralAgentSession(config).run()).status).toBe("submitted");
    expect(invocations).toHaveLength(1); expect(invocations[0]).toMatchObject({ files: [], webDestinations: ["web"], maxPublicFetches: 5 });
    expect(f.store.events(f.jobId).find(row => row.type === "session_started")!.privateContextId).toBe(invocations[0]!.contextId);
    expect((await new GeneralAgentSession(config).run()).status).toBe("submitted"); expect(invocations).toHaveLength(1);
    const changed = publicOptions(f); changed.publicInputApproval!.authoritySha256 = digest("changed authority");
    expect((await new GeneralAgentSession(changed).run()).reason).toBe("session_contract_drift");
  });
  it("requires complete primary-phase approval and prohibits contradictory private attestation", () => {
    const f = fixture(), config = publicOptions(f);
    expect(() => new GeneralAgentSession({ ...config, publicInputApproval: { ...config.publicInputApproval!, phaseSha256: digest("other") } })).toThrow("session_public_input_approval_invalid");
    expect(() => new GeneralAgentSession({ ...config, privatePhase: { ...f.phase, contract: { ...f.phase.contract, goal: "changed goal" } } })).toThrow("session_public_input_approval_invalid");
    expect(() => new GeneralAgentSession({ ...config, syntheticInputApproval: { privatePhaseSha256: sessionPhaseIdentity(f.phase), authoritySha256: digest("synthetic") } })).toThrow("session_public_input_approval_invalid");
    expect(() => new GeneralAgentSession({ ...config, publicInputApproval: { ...config.publicInputApproval!, webDestinations: [] } })).toThrow("session_public_input_approval_invalid");
  });
});
