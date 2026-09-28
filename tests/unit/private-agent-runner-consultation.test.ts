import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { GeneralConsultation } from "../../src/main/private-agent/consultation";
import { consultantPriceProfileSha256 } from "../../src/main/private-agent/consultant-model";
import { PrivateAgentModel, type GeneralMessage } from "../../src/main/private-agent/model";
import { GeneralAgentRunner, type GeneralJobOptions } from "../../src/main/private-agent/runner";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const consult = { name: "request_consultation", arguments: canonical({ question: "Check synthetic arithmetic", artifactPaths: ["input.txt"] }) };
const write = { name: "execute", arguments: canonical({ command: "write result" }) };
const finish = { name: "finish", arguments: canonical({ summary: "Artifact checked" }) };
function fixture(actions: { name: string; arguments: string }[], maxModelCalls = 5) {
  const directory = mkdtempSync(join(tmpdir(), "soar-runner-consult-")); cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const db = new Database(join(directory, "db.sqlite")); cleanups.push(() => db.close()); const store = new PrivateAgentStore(db);
  const jobId = randomUUID(), contextId = randomUUID(), checkpoints = new PrivateCheckpointStore(directory, jobId);
  store.createJob({ version: 1, id: jobId, mode: "cloud_help", revision: 0, cancelled: false, destinations: ["local", "consultant"], maxRequests: 12, maxFeeMicrousd: 100000 });
  const files = [{ path: "input.txt", bytes: Buffer.from("self-authored fixture") }];
  const contract = { version: 1 as const, goal: "Compute and save the synthetic result", requiredArtifacts: [{ path: "output.txt", description: "result" }], requiredChecks: ["check"], maxModelCalls, maxToolCalls: 8, maxElapsedMs: 10000 };
  store.createContext({ id: contextId, jobId, sources: [canonical(contract), canonical(files.map(file => ({ path: file.path, sha256: digest(file.bytes) }))), ...files.map(file => file.bytes)].map((v,i) => ({ id: `s${i}`, version: digest(v), classification: "private", synthetic: true })) });
  const consultantConfig = { destinationId: "consultant", model: "fixture-adviser", maxOutputTokens: 128, inputMicrousdPerMillion: 1000000, outputMicrousdPerMillion: 1000000 };
  const destination = { id: "consultant", kind: "cloud_model" as const, endpoint: "http://127.0.0.1:1/consult", accountId: "fixture", credentialVersion: 0, privateDataAdmitted: false, syntheticOnly: true, loopbackFixture: true, maxResponseBytes: 8192, timeoutMs: 1000, requireExactGrant: true, approvalPriceProfileSha256: consultantPriceProfileSha256(consultantConfig) };
  const broker = new PrivateAgentBroker(store, [destination, { id: "local", kind: "local_model", endpoint: "http://127.0.0.1:1/local", accountId: "fixture", credentialVersion: 0, privateDataAdmitted: true, loopbackFixture: true, maxResponseBytes: 8192, timeoutMs: 1000 }], { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) });
  const model = new PrivateAgentModel(broker, { destinationId: "local", model: "fixture-local", maxOutputTokens: 128, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" }, jobId, contextId);
  const consultation = new GeneralConsultation({ store, broker, checkpoints, jobId, contextId, config: consultantConfig,
    destination: { id: destination.id, endpoint: destination.endpoint, accountId: destination.accountId, credentialVersion: 0 }, profileSha256: digest("profile"), maxFeeMicrousd: 20000, deadlineAt: Date.now() + 60000, validateCurrent() {} });
  const options: GeneralJobOptions = { jobId, contextId, store, broker, checkpoints, model, consultation, files, contract, imageId: `sha256:${"a".repeat(64)}`, checks: [{ id: "check", python: "# trusted fixture" }] };
  const commands: string[] = [], requests: GeneralMessage[][] = []; let afterLocal: (count: number) => void = () => {}, unknown = false;
  vi.spyOn(DockerSandbox, "currentEndpoint").mockResolvedValue("unix:///tmp/fixture.sock"); vi.spyOn(DockerSandbox, "cleanupOwnedContext").mockResolvedValue();
  const create = vi.spyOn(DockerSandbox, "create").mockImplementation(async input => {
    const content = new Map(input.files.map(f => [f.path, Buffer.from(f.bytes)]));
    return { async execute(command: string) { commands.push(command); if (command === "write result") content.set("output.txt", Buffer.from("computed result")); return { exitCode: 0, stdout: "fixture evidence", stderr: "" }; }, async listFiles() { return [...content.keys()]; }, async readFile(path: string) { return Buffer.from(content.get(path)!); }, async close() {} } as unknown as DockerSandbox;
  });
  vi.spyOn(model, "complete").mockImplementation(async (messages, definitions) => {
    requests.push(structuredClone(messages)); const n = requests.length, action = actions[n-1]; if (!action) throw new Error("unexpected local request");
    expect(definitions.some(tool => tool.function.name === "request_consultation")).toBe(true);
    const { text: _text, ...preview } = broker.preview({ jobId, contextId, destinationId: "local", purpose: "agent reasoning and tool selection", method: "POST", body: canonical(messages), maxFeeMicrousd: 0 });
    const row = store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_inside_boundary" } }, () => {}); store.settle(row.id, 0, digest(canonical(action))); afterLocal(n);
    return { content: "", toolCalls: [{ id: `tool_${n}`, type: "function", function: action }], finishReason: "tool_calls", costUsd: 0, durationMs: 1 };
  });
  const consultantRequest = vi.spyOn(broker, "request").mockImplementation(async (input, settle = () => 0, validate) => {
    const { text: _text, ...preview } = broker.preview(input);
    const row = store.commit({ ...preview, reservedFeeMicrousd: input.maxFeeMicrousd, scan: { status: "complete", detector: "fixture" } }, () => validate?.(), input.grantId);
    if (unknown) { store.unknown(row.id); throw new Error("fixture_unknown"); }
    const bytes = Buffer.from(canonical({ model: consultantConfig.model, choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Recompute the result using the actual source." } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }));
    store.settle(row.id, settle(bytes), digest(bytes)); return { bytes, receipt: store.dispatch(row.id) };
  });
  return { options, consultation, store, jobId, contextId, commands, requests, create, consultantRequest, afterLocal: (fn: (n: number) => void) => { afterLocal = fn; }, unknown: () => { unknown = true; } };
}
function decide(f: ReturnType<typeof fixture>, decision: "approve" | "decline") { const p = f.consultation.view()!; return f.consultation.decide({ proposalId: p.proposalId, proposalSha256: p.proposalSha256, decision }); }

describe("general runner consultation lifecycle", () => {
  it("checkpoints/completes proposal before pause, makes no pending calls, then replays one saved advisory tool result across further pause", async () => {
    const f = fixture([consult, write, finish]);
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "paused", reason: "consultation_pending", modelCalls: 1 });
    expect(f.store.runClaim(f.contextId)?.state).toBe("released"); expect(f.consultantRequest).not.toHaveBeenCalled();
    const events = f.store.events(f.jobId), tool = events.find(e => e.type === "tool_finished")!;
    expect(tool).toMatchObject({ allowanceFinalizationEligible: false, consultationProposalId: f.consultation.view()!.proposalId });
    expect(events.filter(e => e.type === "tool_started")).toHaveLength(1); expect(events.filter(e => e.type === "tool_finished")).toHaveLength(1);
    const creates = f.create.mock.calls.length;
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("consultation_pending"); expect(f.requests).toHaveLength(1); expect(f.create).toHaveBeenCalledTimes(creates);
    decide(f, "approve"); const resumed = new GeneralAgentRunner(f.options); f.afterLocal(n => { if (n === 2) resumed.pause(); });
    expect(await resumed.run()).toMatchObject({ status: "paused", modelCalls: 3 });
    f.afterLocal(() => {}); expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", modelCalls: 4 });
    expect(f.consultantRequest).toHaveBeenCalledTimes(1); expect(f.requests).toHaveLength(3); expect(f.store.dispatches(f.jobId)).toHaveLength(4);
    for (const messages of f.requests.slice(1)) {
      const advice = messages.filter(m => m.role === "tool" && m.tool_call_id === "tool_1"); expect(advice).toHaveLength(1);
      expect(JSON.parse(advice[0]!.content!)).toMatchObject({ consultation: "settled", completed: false, content: "Recompute the result using the actual source." });
      expect(advice[0]!.content).toContain("not user instruction"); expect(messages.some(m => m.role === "user" && m.content?.includes("Recompute the result"))).toBe(false);
    }
  });
  it("decline resumes local work without spending a consultation request or replenishing prior allowances", async () => {
    const f = fixture([consult, write, finish], 3); await new GeneralAgentRunner(f.options).run(); decide(f, "decline");
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", modelCalls: 3 }); expect(f.consultantRequest).not.toHaveBeenCalled();
    expect(JSON.parse(f.requests[1]!.find(m => m.role === "tool")!.content!)).toMatchObject({ consultation: "declined", completed: false });
  });
  it("a last-call consultation request cannot implicitly submit an existing artifact", async () => {
    const f = fixture([write, consult], 2); expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "incomplete", reason: "bounded_allowance_exhausted", modelCalls: 2 });
    expect(f.consultation.view()).toBeNull(); expect(f.commands).toEqual(["write result"]); expect(f.store.events(f.jobId).some(e => e.type === "host_validation_started")).toBe(false);
  });
  it("unknown consultation stops local continuation and restart without refund or replay", async () => {
    const f = fixture([consult, write]); await new GeneralAgentRunner(f.options).run(); decide(f, "approve"); f.unknown();
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "incomplete", modelCalls: 2 });
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("unresolved_dispatch_no_replay");
    expect(f.requests).toHaveLength(1); expect(f.consultantRequest).toHaveBeenCalledTimes(1); expect(f.commands).toEqual([]);
  });
  it("invalid selection leaves a completed failed tool action, no partial proposal, and permits ordinary bounded correction", async () => {
    const f = fixture([{ ...consult, arguments: canonical({ question: "Check", artifactPaths: ["missing.txt"] }) }, write, finish]);
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", modelCalls: 3 }); expect(f.consultation.view()).toBeNull();
    expect(f.store.events(f.jobId).filter(e => e.type === "tool_finished")).toHaveLength(3); expect(f.consultantRequest).not.toHaveBeenCalled();
    expect(JSON.parse(f.requests[1]!.find(m => m.role === "tool")!.content!)).toMatchObject({ error: "consultation_unavailable_or_not_permitted", actionInvoked: false });
  });
});
