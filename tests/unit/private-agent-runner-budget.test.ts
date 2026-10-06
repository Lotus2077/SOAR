import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BROKER_MAX_BODY_BYTES, PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, type GeneralMessage } from "../../src/main/private-agent/model";
import { GeneralAgentRunner, type GeneralJobContract, type GeneralJobOptions } from "../../src/main/private-agent/runner";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { EXECUTION_OBSERVATION_MAX_BYTES, EXECUTION_OBSERVATION_BUDGET_BYTES } from "../../src/main/private-agent/observations";
import { EXECUTION_PROGRESS_STOP, readExecutionProgressStop } from "../../src/main/private-agent/progress";

const cleanup: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const done of cleanup.splice(0).reverse()) done(); });
type Action = { name: string; arguments: string; outputTokens?: number; reply?: "text" | "multi" | "length" };
const write: Action = { name: "execute", arguments: '{"command":"write result"}' };
const finish: Action = { name: "finish", arguments: '{"summary":"Artifacts are ready for host checks."}' };

function fixture(actions: Action[], limits: Partial<Pick<GeneralJobContract, "maxModelCalls" | "maxToolCalls" | "maxElapsedMs">> & { maxRequests?: number; checkExitCode?: number; toolStdout?: string } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "soar-runner-budget-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, "state.sqlite"), db = new Database(dbPath); cleanup.push(() => db.close());
  const store = new PrivateAgentStore(db), jobId = randomUUID(), contextId = randomUUID();
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["model"], maxRequests: limits.maxRequests ?? 10, maxFeeMicrousd: 0 });
  const contract: GeneralJobContract = { version: 1, goal: "Compute a synthetic result from the input and save it.",
    requiredArtifacts: [{ path: "output.txt", description: "Computed output" }], requiredChecks: ["fixture_check"],
    maxModelCalls: limits.maxModelCalls ?? 4, maxToolCalls: limits.maxToolCalls ?? 5, maxElapsedMs: limits.maxElapsedMs ?? 10000 };
  const files = [{ path: "input.txt", bytes: Buffer.from("synthetic input") }];
  store.createContext({ id: contextId, jobId, sources: [canonical(contract), canonical(files.map(file => ({ path: file.path, sha256: digest(file.bytes) }))), ...files.map(file => file.bytes)]
    .map((value, index) => ({ id: `fixture_${index}`, version: digest(value), classification: "private", synthetic: true })) });
  const broker = new PrivateAgentBroker(store, [{ id: "model", kind: "local_model", endpoint: "http://127.0.0.1:1/v1/chat/completions",
    accountId: "fixture", credentialVersion: 0, privateDataAdmitted: true, loopbackFixture: true, maxResponseBytes: 65536, timeoutMs: 1000 }],
  { scan: async () => { throw new Error("No scanner or transport is allowed in this unit fixture."); } });
  const model = new PrivateAgentModel(broker, { destinationId: "model", model: "synthetic", maxOutputTokens: 4096,
    inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" }, jobId, contextId);
  const options: GeneralJobOptions = { jobId, contextId, store, broker, model, files, contract,
    imageId: `sha256:${"a".repeat(64)}`, checkpoints: new PrivateCheckpointStore(join(directory, "checkpoints"), jobId),
    checks: [{ id: "fixture_check", python: "# fixed synthetic host check" }] };
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(DockerSandbox, "currentEndpoint").mockResolvedValue("unix:///tmp/synthetic-docker.sock");
  vi.spyOn(DockerSandbox, "cleanupOwnedContext").mockImplementation(async () => { clock += 5; });
  const commands: string[] = [];
  let currentContents = new Map<string, Buffer>();
  let afterExecute: (command: string) => void = () => {};
  let beforeListFiles: () => void = () => {};
  const create = vi.spyOn(DockerSandbox, "create").mockImplementation(async input => {
    clock += 25;
    const contents = new Map(input.files.map(file => [file.path, Buffer.from(file.bytes)]));
    currentContents = contents;
    return { async execute(command: string) {
      clock += 50; commands.push(command);
      if (command === "write result") contents.set("output.txt", Buffer.from("computed fixture result"));
      if (command === "write empty") contents.set("output.txt", Buffer.alloc(0));
      if (command === "fail with progress") contents.set("diagnostic.txt", Buffer.from(String(commands.length)));
      if (command === "throw failure") throw new Error("PRIVATE-HOST-PATH-AND-DIAGNOSTIC");
      afterExecute(command);
      return { exitCode: command.startsWith("fail ") ? 1 : command.startsWith("python3 -I -c") ? limits.checkExitCode ?? 0 : 0, stdout: limits.toolStdout ?? "synthetic evidence", stderr: "" };
    }, async listFiles() { beforeListFiles(); return [...contents.keys()].sort(); },
    async readFile(path: string) { return Buffer.from(contents.get(path)!); },
    async editFile(mode: "write" | "append" | "replace", path: string, payload: Buffer, replacement?: Buffer) {
      clock += 10; commands.push(`${mode}:${path}`);
      if (mode === "replace") {
        const current = contents.get(path); if (!current) return { ok: false, reason: "file_missing" };
        const count = current.toString("utf8").split(payload.toString("utf8")).length - 1;
        if (count !== 1) return { ok: false, reason: "occurrences_not_one", occurrences: count };
        const next = Buffer.from(current.toString("utf8").replace(payload.toString("utf8"), replacement!.toString("utf8"))); contents.set(path, Buffer.from(next)); return { ok: true, bytes: next.length };
      }
      const next = Buffer.from(mode === "append" ? Buffer.concat([contents.get(path) ?? Buffer.alloc(0), payload]) : payload); contents.set(path, Buffer.from(next)); return { ok: true, bytes: next.length };
    },
    async close() { clock += 5; } } as unknown as DockerSandbox;
  });
  const requests: GeneralMessage[][] = [];
  let afterResponse: (count: number) => void = () => {};
  const complete = vi.spyOn(model, "complete").mockImplementation(async messages => {
    requests.push(structuredClone(messages)); clock += 100;
    const index = requests.length - 1, action = actions[index];
    if (!action) throw new Error("Unexpected model invocation.");
    // Real accounting primitives, isolated fixture database; no HTTP request.
    const { text: _text, ...preview } = broker.preview({ jobId, contextId, destinationId: "model", purpose: "unit fixture", method: "POST", body: canonical(messages), maxFeeMicrousd: 0 });
    const row = store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_inside_boundary" } }, () => {});
    store.settle(row.id, 0, digest(canonical(action)));
    afterResponse(requests.length);
    const call = (suffix = "") => ({ id: `tool_${index}${suffix}`, type: "function" as const, function: { name: action.name, arguments: action.arguments } });
    return { content: action.reply === "text" ? "I will write the result now." : "",
      toolCalls: action.reply === "text" ? [] : action.reply === "multi" ? [call(), call("b")] : [call()],
      finishReason: action.reply === "length" ? "length" : "tool_calls", costUsd: 0, durationMs: 100,
      ...(action.outputTokens === undefined ? {} : { usage: { inputTokens: 100, outputTokens: action.outputTokens, totalTokens: 100 + action.outputTokens } }) };
  });
  return { options, dbPath, requests, complete, create, commands, advance: (ms: number) => { clock += ms; },
    mutateWorkspace: (path: string, bytes: Buffer) => { currentContents.set(path, Buffer.from(bytes)); },
    beforeListFiles: (callback: () => void) => { beforeListFiles = callback; },
    afterExecute: (callback: (command: string) => void) => { afterExecute = callback; },
    afterResponse: (callback: (count: number) => void) => { afterResponse = callback; } };
}

function budget(messages: GeneralMessage[]) {
  expect(messages.filter(message => message.role === "system")).toHaveLength(1);
  const prompt = messages[0]!.content!;
  expect(prompt.match(/Current host budget/gu)).toHaveLength(1);
  return JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
}

describe("general runner host budget and argument recovery", () => {
  const failed: Action = { name: "execute", arguments: '{"command":"fail same"}' };
  it("warns once from two failures across pause/reopen and permits a changed action", async () => {
    const f = fixture([failed, failed, write, finish]);
    const first = new GeneralAgentRunner(f.options);
    f.afterExecute(() => { if (f.commands.length === 2) first.pause(); });
    expect(await first.run()).toMatchObject({ status: "paused", modelCalls: 2 });
    expect(f.requests.every(messages => !messages[0]!.content!.includes("Two completed execute actions"))).toBe(true);
    const reopened = new Database(f.dbPath); cleanup.push(() => reopened.close());
    const result = await new GeneralAgentRunner({ ...f.options, store: new PrivateAgentStore(reopened) }).run();
    expect(result).toMatchObject({ status: "completed", modelCalls: 4 });
    expect(f.requests[2]![0]!.content).toContain("Two completed execute actions");
    expect(f.requests[3]![0]!.content).not.toContain("Current host execution progress");
    const events = f.options.store.events(f.options.jobId);
    expect(events.filter(event => event.type === "model_action_not_started")).toEqual([]);
    expect(events.filter(event => event.type === "tool_started")).toHaveLength(4);
    expect(f.commands.filter(command => command === "fail same")).toHaveLength(2);
  });

  it("stops the unchanged third failure before invocation and preserves the known stop across reopening", async () => {
    const f = fixture([failed, failed, failed, finish]);
    const result = await new GeneralAgentRunner(f.options).run();
    expect(result).toMatchObject({ status: "incomplete", reason: EXECUTION_PROGRESS_STOP, modelCalls: 3 });
    expect(f.commands).toEqual(["fail same", "fail same"]);
    const { store, checkpoints, jobId, contextId } = f.options;
    const events = store.events(jobId);
    expect(events.filter(event => event.type === "tool_started")).toHaveLength(2);
    expect(events.filter(event => event.type === "host_validation_started")).toEqual([]);
    expect(readExecutionProgressStop({ store, checkpoints, jobId, contextId, snapshot: result.snapshot })).toMatchObject({ reason: EXECUTION_PROGRESS_STOP });
    expect(store.dispatches(jobId)).toMatchObject([{ status: "settled" }, { status: "settled" }, { status: "settled" }]);
    const reopened = new Database(f.dbPath); cleanup.push(() => reopened.close());
    expect(await new GeneralAgentRunner({ ...f.options, store: new PrivateAgentStore(reopened) }).run()).toMatchObject({ reason: EXECUTION_PROGRESS_STOP, modelCalls: 3 });
    expect(f.requests).toHaveLength(3); expect(f.create).toHaveBeenCalledTimes(1);
    const { text: _text, ...preview } = f.options.broker.preview({ jobId, contextId, destinationId: "model", purpose: "unknown precedence", method: "POST", body: "{}", maxFeeMicrousd: 0 });
    const unknown = store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_inside_boundary" } }, () => {});
    store.unknown(unknown.id);
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ reason: "unresolved_dispatch_no_replay" });
    expect(f.requests).toHaveLength(3); expect(store.dispatch(unknown.id).status).toBe("unknown");
  });

  it("allows the same failing command after actual workspace changes", async () => {
    const changing: Action = { name: "execute", arguments: '{"command":"fail with progress"}' };
    const f = fixture([changing, changing, changing, write, finish], { maxModelCalls: 5 });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", modelCalls: 5 });
    expect(f.commands.filter(command => command === "fail with progress")).toHaveLength(3);
    expect(f.options.store.events(f.options.jobId).some(event => event.type === "model_action_not_started")).toBe(false);
  });

  it("rechecks live workspace changes before blocking a warned response", async () => {
    const f = fixture([failed, failed, failed, write, finish], { maxModelCalls: 5 });
    f.afterResponse(count => { if (count === 3) f.mutateWorkspace("changed-input.txt", Buffer.from("new input")); });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", modelCalls: 5 });
    expect(f.commands.filter(command => command === "fail same")).toHaveLength(3);
    expect(f.options.store.events(f.options.jobId).some(event => event.type === "model_action_not_started")).toBe(false);
  });

  it.each(["deadline", "cancel"])("does not invoke a changed-workspace retry if %s occurs during the pre-stop capture", async mode => {
    const f = fixture([failed, failed, failed, finish]);
    f.afterResponse(count => {
      if (count !== 3) return;
      f.mutateWorkspace("changed-input.txt", Buffer.from("new input"));
      f.beforeListFiles(() => {
        if (mode === "deadline") f.advance(10001); else f.options.broker.cancelJob(f.options.jobId);
      });
    });
    const result = await new GeneralAgentRunner(f.options).run();
    expect(result).toMatchObject({ status: "incomplete", reason: "cancelled_or_deadline", modelCalls: 3 });
    expect(result.snapshot.some(row => row.path === "changed-input.txt")).toBe(true);
    expect(f.commands).toEqual(["fail same", "fail same"]);
    const markers = f.options.store.events(f.options.jobId).filter(event => event.type === "model_action_not_started");
    expect(markers).toMatchObject([{ reason: "cancelled_or_deadline" }]);
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ reason: "unresolved_operation_no_replay" });
    expect(f.requests).toHaveLength(3);
  });

  it("does not replay a warned response when pre-stop capture fails before a marker can be saved", async () => {
    const f = fixture([failed, failed, failed, finish]);
    f.afterResponse(count => { if (count === 3) f.beforeListFiles(() => { throw new Error("synthetic capture failure"); }); });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "incomplete", reason: "runtime_failure_progress_preserved", modelCalls: 3 });
    expect(f.options.store.events(f.options.jobId).some(event => event.type === "model_action_not_started")).toBe(false);
    expect(f.commands).toEqual(["fail same", "fail same"]);
    const reopened = new Database(f.dbPath); cleanup.push(() => reopened.close());
    expect(await new GeneralAgentRunner({ ...f.options, store: new PrivateAgentStore(reopened) }).run()).toMatchObject({ reason: "unresolved_operation_no_replay" });
    expect(f.requests).toHaveLength(3); expect(f.create).toHaveBeenCalledTimes(1);
  });

  it("keeps a current missing-artifact reminder until the required file is nonempty", async () => {
    const empty: Action = { name: "execute", arguments: '{"command":"write empty"}' };
    const f = fixture([empty, empty, write, finish]);
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed" });
    const progress = f.options.store.events(f.options.jobId).filter(event => event.type === "model_started").map(event => event.executionProgress);
    expect(progress[0]).toMatchObject({ missingArtifacts: { reminder: false, total: 1 } });
    expect(progress[1]).toMatchObject({ missingArtifacts: { reminder: false, total: 1 } });
    expect(progress[2]).toMatchObject({ missingArtifacts: { reminder: true, paths: ["output.txt"], total: 1 } });
    expect(progress[3]).toMatchObject({ missingArtifacts: { reminder: false, paths: [], total: 0 } });
    expect(f.requests[2]![0]!.content).toContain("Required output is still absent or empty");
    expect(f.requests[3]![0]!.content).not.toContain("Required output is still absent or empty");
    // The fourth request is regenerated after a real nonempty write; no old
    // system progress instruction is accumulated in replayed conversation.
    expect(f.requests[3]!.filter(message => message.role === "system")).toHaveLength(1);
    expect(f.requests[3]!.filter(message => message.role === "tool")).toHaveLength(3);
  });

  it.each(["capabilities", "executionProgressPolicyVersion"])("rejects altered persisted %s before resuming a paused job", async field => {
    const f = fixture([write, finish]);
    const first = new GeneralAgentRunner(f.options); f.afterExecute(() => first.pause());
    expect(await first.run()).toMatchObject({ status: "paused", modelCalls: 1 });
    const db = new Database(f.dbPath); cleanup.push(() => db.close());
    const row = db.prepare("SELECT sequence, value FROM private_agent_events WHERE job_id = ? AND json_extract(value, '$.type') = 'started'").get(f.options.jobId) as { sequence: number; value: string };
    const event = JSON.parse(row.value);
    expect(event.capabilities.descriptor).toMatchObject({ qualification: "unverified", tools: { node: { status: "unverified" } } });
    event[field] = field === "capabilities" ? { ...event.capabilities, identity: digest("altered") } : 0;
    db.prepare("UPDATE private_agent_events SET value = ? WHERE job_id = ? AND sequence = ?").run(canonical(event), f.options.jobId, row.sequence);
    expect(await new GeneralAgentRunner({ ...f.options, store: new PrivateAgentStore(db) }).run()).toMatchObject({ reason: "runtime_contract_drift" });
    expect(f.requests).toHaveLength(1); expect(f.create).toHaveBeenCalledTimes(1);
  });

  it("bounds repeated large execution observations without losing stored evidence or model allowances", async () => {
    const stdout = "ordinary output\n".repeat(12000);
    const f = fixture([...Array.from({ length: 12 }, () => write), finish],
      { toolStdout: stdout, maxModelCalls: 13, maxToolCalls: 13, maxRequests: 13 });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", modelCalls: 13 });
    expect(f.requests).toHaveLength(13);
    for (const messages of f.requests) {
      const tools = messages.filter(message => message.role === "tool");
      expect(tools.reduce((sum, message) => sum + Buffer.byteLength(message.content!), 0)).toBeLessThanOrEqual(EXECUTION_OBSERVATION_BUDGET_BYTES);
      expect(tools.every(message => Buffer.byteLength(message.content!) <= EXECUTION_OBSERVATION_MAX_BYTES)).toBe(true);
      expect(JSON.stringify(messages)).not.toContain(stdout);
    }
    const events = f.options.store.events(f.options.jobId);
    const retained = events.filter(event => event.type === "tool_finished" && event.executionCapture === "retained");
    expect(retained).toHaveLength(12);
    for (const event of retained) {
      const reference = event.executionObservation as { snapshot: Parameters<PrivateCheckpointStore["load"]>[0] };
      const blob = JSON.parse(f.options.checkpoints.load(reference.snapshot)[0]!.bytes.toString("utf8"));
      expect(blob).toMatchObject({ jobId: f.options.jobId, contextId: f.options.contextId, operationId: event.operationId, toolCallId: event.toolCallId });
      expect(blob.result).toEqual({ exitCode: 0, stdout, stderr: "" });
    }
    expect(events.filter(event => event.type === "model_started").every(event =>
      Number((event.observationProjection as { bytes: number }).bytes) <= EXECUTION_OBSERVATION_BUDGET_BYTES)).toBe(true);
    expect(f.options.store.dispatches(f.options.jobId)).toHaveLength(13);
  });

  it("does not acknowledge or replay an execution when retaining its observation fails", async () => {
    const f = fixture([write, finish]);
    const save = f.options.checkpoints.save.bind(f.options.checkpoints);
    vi.spyOn(f.options.checkpoints, "save").mockImplementation(files => {
      if (files.some(file => file.path.startsWith("execution-observations/"))) throw Error("synthetic retention failure");
      return save(files);
    });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "incomplete", modelCalls: 1 });
    const events = f.options.store.events(f.options.jobId);
    expect(events.filter(event => event.type === "tool_started")).toHaveLength(1);
    expect(events.filter(event => event.type === "tool_finished")).toHaveLength(0);
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ reason: "unresolved_operation_no_replay" });
    expect(f.requests).toHaveLength(1); expect(f.commands).toEqual(["write result"]);
  });

  it("rolls back checkpoint acknowledgement when a completed execution event cannot be persisted", async () => {
    const f = fixture([write, finish]);
    const append = f.options.store.append.bind(f.options.store);
    vi.spyOn(f.options.store, "append").mockImplementation((jobId, event) => {
      if (event.type === "tool_finished") throw Error("synthetic event failure");
      return append(jobId, event);
    });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "incomplete", modelCalls: 1 });
    const events = f.options.store.events(f.options.jobId);
    expect(events.filter(event => event.type === "checkpoint")).toHaveLength(1);
    expect(events.filter(event => event.type === "tool_finished")).toHaveLength(0);
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ reason: "unresolved_operation_no_replay" });
    expect(f.requests).toHaveLength(1); expect(f.commands).toEqual(["write result"]);
  });

  it("stops before inference when a retained observation is missing after SQLite reopening", async () => {
    const f = fixture([write, finish]);
    const runner = new GeneralAgentRunner(f.options); f.afterExecute(() => runner.pause());
    expect(await runner.run()).toMatchObject({ status: "paused", modelCalls: 1 });
    const event = f.options.store.events(f.options.jobId).find(row => row.executionCapture === "retained")!;
    const reference = event.executionObservation as { sha256: string };
    rmSync(join(dirname(f.dbPath), "checkpoints", f.options.jobId, reference.sha256));
    const reopened = new Database(f.dbPath); cleanup.push(() => reopened.close());
    expect(await new GeneralAgentRunner({ ...f.options, store: new PrivateAgentStore(reopened) }).run()).toMatchObject({ status: "incomplete" });
    expect(f.requests).toHaveLength(1); expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.commands).toEqual(["write result"]);
  });

  it("retains a canonical-body overflow as an unsent terminal attempt across SQLite reopening", async () => {
    const f = fixture([]);
    f.complete.mockRestore();
    const complete = vi.spyOn(f.options.model, "complete");
    const { store, broker, jobId } = f.options;
    const request = vi.spyOn(broker, "request").mockImplementation(async (input, settle) => {
      const { text: _text, ...preview } = broker.preview(input);
      const receipt = store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_inside_boundary" } }, () => {});
      const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: "x".repeat(BROKER_MAX_BODY_BYTES), tool_calls: [{ id: "only_tool", type: "function", function: write }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      store.settle(receipt.id, settle!(bytes), digest(bytes));
      return { bytes, receipt: store.dispatch(receipt.id) };
    });
    const result = await new GeneralAgentRunner(f.options).run();
    expect(result).toMatchObject({ status: "incomplete", reason: "request_body_size_exceeded", modelCalls: 2 });
    expect(result.snapshot.some(row => row.path === "output.txt")).toBe(true);
    expect(f.commands).toEqual(["write result"]);
    expect(complete).toHaveBeenCalledTimes(2); expect(request).toHaveBeenCalledTimes(1);
    const events = store.events(jobId), marker = events.find(event => event.type === "model_request_not_dispatched")!;
    expect(marker).toMatchObject({ reason: "request_body_size_exceeded", dispatched: false, limitBytes: BROKER_MAX_BODY_BYTES });
    expect(Number(marker.bodyBytes)).toBeGreaterThan(BROKER_MAX_BODY_BYTES);
    expect(events.filter(event => event.type === "model_started")).toHaveLength(2);
    expect(events.filter(event => event.type === "model_finished")).toHaveLength(1);
    expect(events.filter(event => event.type === "tool_started")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "run_ended", cleanupConfirmed: true });
    const reopened = new Database(f.dbPath); cleanup.push(() => reopened.close());
    const resumedStore = new PrivateAgentStore(reopened);
    expect(await new GeneralAgentRunner({ ...f.options, store: resumedStore }).run()).toMatchObject({ status: "incomplete", reason: "request_body_size_exceeded", modelCalls: 2 });
    expect(request).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(2); expect(f.create).toHaveBeenCalledTimes(1);
    expect(resumedStore.dispatches(jobId)).toMatchObject([{ status: "settled", feeMicrousd: 0 }]);
    const { text: _text, ...preview } = broker.preview({ jobId, contextId: f.options.contextId, destinationId: "model", purpose: "retained unknown fixture", method: "POST", body: "{}", maxFeeMicrousd: 0 });
    const unknown = store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_inside_boundary" } }, () => {});
    store.unknown(unknown.id);
    expect(await new GeneralAgentRunner({ ...f.options, store: resumedStore }).run()).toMatchObject({ reason: "unresolved_dispatch_no_replay" });
    expect(complete).toHaveBeenCalledTimes(2); expect(store.dispatch(unknown.id).status).toBe("unknown");
  });

  it("keeps an untyped size-looking exception unresolved rather than inferring non-dispatch", async () => {
    const f = fixture([]);
    f.complete.mockRejectedValueOnce(new Error("request_body_size_exceeded"));
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ reason: "runtime_failure_progress_preserved" });
    expect(f.options.store.events(f.options.jobId).some(event => event.type === "model_request_not_dispatched")).toBe(false);
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ reason: "unresolved_operation_no_replay" });
    expect(f.complete).toHaveBeenCalledTimes(1); expect(f.commands).toEqual([]);
  });

  it("decreases actual call/tool/time budgets across invalid arguments, a pause and SQLite reopening", async () => {
    const f = fixture([{ name: "execute", arguments: "{}" }, write, finish]);
    const first = new GeneralAgentRunner(f.options);
    f.afterResponse(count => { if (count === 2) first.pause(); });
    expect(await first.run()).toMatchObject({ status: "paused", modelCalls: 2 });
    expect(f.commands).toEqual(["write result"]);
    expect(f.requests.map(budget)).toEqual([
      { remainingModelCalls: 4, remainingToolCalls: 5, remainingBrokerRequests: 10, remainingActiveMs: 9975 },
      { remainingModelCalls: 3, remainingToolCalls: 4, remainingBrokerRequests: 9, remainingActiveMs: 9875 },
    ]);
    const reopened = new Database(f.dbPath); cleanup.push(() => reopened.close());
    const store = new PrivateAgentStore(reopened);
    // The same model spy writes through the first connection; the resumed runner
    // must obtain its counters/checkpoint/elapsed time through the second one.
    const resumed = await new GeneralAgentRunner({ ...f.options, store }).run();
    expect(resumed).toMatchObject({ status: "completed", modelCalls: 3, checks: [{ id: "fixture_check", passed: true }] });
    expect(budget(f.requests[2]!)).toEqual({ remainingModelCalls: 2, remainingToolCalls: 3, remainingBrokerRequests: 8, remainingActiveMs: 9690 });
    const events = store.events(f.options.jobId);
    expect(events.filter(event => event.type === "model_started").map(event => event.budget)).toEqual(f.requests.map(budget));
    expect(events.filter(event => event.type === "model_started").every(event => event.promptProtocolSha256 === events.find(row => row.type === "started")!.promptProtocolSha256)).toBe(true);
    expect(f.requests[2]!.filter(message => message.role === "tool")).toHaveLength(2);
    expect(store.dispatches(f.options.jobId)).toHaveLength(3);
    expect(store.dispatches(f.options.jobId).every(row => row.status === "settled" && row.feeMicrousd === 0)).toBe(true);
  });

  it.each(["{}", "{", '{"command":42}', '{"command":"write result","unexpected":"PRIVATE-ARGUMENT"}'])("never invokes invalid execute arguments %s and allows one normal bounded continuation", async raw => {
    const f = fixture([{ name: "execute", arguments: raw }, write], { maxModelCalls: 2, maxToolCalls: 2 });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", reason: "critical_checks_passed_at_allowance", modelCalls: 2 });
    expect(f.commands[0]).toBe("write result"); expect(f.commands).toHaveLength(2);
    const feedback = JSON.parse(f.requests[1]!.find(message => message.role === "tool")!.content!);
    expect(feedback).toMatchObject({ error: "invalid_tool_arguments", actionInvoked: false, completed: false,
      requiredArguments: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false } });
    expect(JSON.stringify(feedback)).not.toContain("PRIVATE-ARGUMENT");
    expect(budget(f.requests[1]!)).toMatchObject({ remainingModelCalls: 1, remainingToolCalls: 1 });
    expect(f.options.store.events(f.options.jobId).filter(event => event.type === "tool_started")).toHaveLength(2);
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ reason: "job_already_completed" });
    expect(f.requests).toHaveLength(2);
  });

  it("does not refund an invalid final action or invoke it on a later resume", async () => {
    const f = fixture([{ name: "execute", arguments: "{}" }], { maxModelCalls: 1, maxToolCalls: 1 });
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("bounded_allowance_exhausted");
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("bounded_allowance_exhausted");
    expect(f.requests).toHaveLength(1); expect(f.commands).toEqual([]);
    expect(f.options.store.events(f.options.jobId).filter(row => row.type === "tool_finished")).toHaveLength(1);
  });

  it("reports the observed output limit without invoking invalid arguments, then executes a valid complete call at that limit", async () => {
    const f = fixture([{ name: "execute", arguments: "{}", outputTokens: 4096 }, { ...write, outputTokens: 4096 }, finish]);
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", modelCalls: 3 });
    const feedback = JSON.parse(f.requests[1]!.find(message => message.role === "tool")!.content!);
    expect(feedback).toMatchObject({ error: "invalid_tool_arguments", actionInvoked: false, completed: false,
      observedOutputTokens: 4096, configuredMaxOutputTokens: 4096 });
    expect(feedback.instruction).toContain("Zero command invocations");
    expect(feedback.instruction).toContain("at most 1500 characters");
    expect(feedback.instruction).toContain("incremental file write and read it back");
    expect(f.commands[0]).toBe("write result");
    expect(f.commands).toHaveLength(2); // The valid write and the independent host check.
    expect(f.options.store.events(f.options.jobId).filter(row => row.type === "tool_finished")
      .map(row => row.invalidExecuteAtOutputLimit)).toEqual([true, false, false]);
  });

  it("stops after two consecutive capped invalid execute outcomes, preserving settled requests and the latest checkpoint across resume", async () => {
    const f = fixture([write, { name: "execute", arguments: "{}", outputTokens: 4096 },
      { name: "execute", arguments: "{", outputTokens: 4096 }, finish]);
    const result = await new GeneralAgentRunner(f.options).run();
    expect(result).toMatchObject({ status: "incomplete", reason: "repeated_incomplete_tool_arguments_at_output_limit", modelCalls: 3 });
    expect(f.commands).toEqual(["write result"]);
    expect(f.options.checkpoints.load(result.snapshot).find(file => file.path === "output.txt")!.bytes.toString()).toBe("computed fixture result");
    const events = f.options.store.events(f.options.jobId);
    const lastToolIndex = events.map(row => row.type).lastIndexOf("tool_finished");
    expect(events[lastToolIndex - 1]).toMatchObject({ type: "checkpoint", snapshot: result.snapshot });
    expect(events[lastToolIndex]).toMatchObject({ invalidExecuteAtOutputLimit: true });
    expect(events.at(-1)).toMatchObject({ type: "run_ended", cleanupConfirmed: true });
    expect(events.some(row => row.type === "completed")).toBe(false);
    expect(f.options.store.dispatches(f.options.jobId)).toHaveLength(3);
    expect(f.options.store.dispatches(f.options.jobId).every(row => row.status === "settled" && row.feeMicrousd === 0)).toBe(true);
    const priorCreates = f.create.mock.calls.length;
    const reopened = new Database(f.dbPath); cleanup.push(() => reopened.close());
    const resumed = await new GeneralAgentRunner({ ...f.options, store: new PrivateAgentStore(reopened) }).run();
    expect(resumed).toMatchObject({ reason: result.reason, modelCalls: 3, snapshot: result.snapshot });
    expect(f.requests).toHaveLength(3); expect(f.create).toHaveBeenCalledTimes(priorCreates);
  });

  it("restores a single capped invalid outcome from durable host records after a pause and SQLite reopening", async () => {
    const f = fixture([{ name: "execute", arguments: "{}", outputTokens: 4096 },
      { name: "execute", arguments: '{"command":42}', outputTokens: 4096 }, write]);
    const first = new GeneralAgentRunner(f.options);
    f.afterResponse(count => { if (count === 1) first.pause(); });
    expect(await first.run()).toMatchObject({ status: "paused", modelCalls: 1 });
    const reopened = new Database(f.dbPath); cleanup.push(() => reopened.close());
    expect(await new GeneralAgentRunner({ ...f.options, store: new PrivateAgentStore(reopened) }).run())
      .toMatchObject({ status: "incomplete", reason: "repeated_incomplete_tool_arguments_at_output_limit", modelCalls: 2 });
    expect(f.requests).toHaveLength(2); expect(f.commands).toEqual([]);
    expect(JSON.parse(f.requests[1]!.find(message => message.role === "tool")!.content!)).toMatchObject({ observedOutputTokens: 4096, actionInvoked: false });
    expect(f.options.store.dispatches(f.options.jobId).every(row => row.status === "settled")).toBe(true);
  });

  it.each([
    { ...write, outputTokens: 4096 },
    { name: "remember_plan", arguments: '{"plan":"Write and verify the remaining output."}', outputTokens: 4096 },
    { name: "execute", arguments: "{}", outputTokens: 4095 },
    { name: "remember_plan", arguments: "{}", outputTokens: 4096 },
  ])("resets the capped-invalid streak after another completed action: %j", async action => {
    const invalid = { name: "execute", arguments: "{}", outputTokens: 4096 };
    const f = fixture([invalid, action, invalid, write, finish], { maxModelCalls: 5, maxToolCalls: 5 });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", modelCalls: 5 });
    expect(f.options.store.events(f.options.jobId).filter(row => row.type === "tool_finished")
      .map(row => row.invalidExecuteAtOutputLimit)).toEqual([true, false, true, false, false]);
    const secondOutput = JSON.parse(f.requests[2]!.filter(message => message.role === "tool")[1]!.content!);
    expect(secondOutput).not.toHaveProperty("observedOutputTokens");
  });

  it("keeps execution errors generic instead of claiming that an invoked action never ran", async () => {
    const f = fixture([{ name: "execute", arguments: '{"command":"throw failure"}' }, write], { maxModelCalls: 2 });
    await new GeneralAgentRunner(f.options).run();
    const output = f.requests[1]!.find(message => message.role === "tool")!.content!;
    expect(JSON.parse(output)).toEqual({ error: "action_failed_or_not_permitted", completed: false });
    expect(output).not.toContain("PRIVATE-HOST"); expect(f.commands.slice(0, 2)).toEqual(["throw failure", "write result"]);
  });

  it("stops an old unbound prompt identity before sandbox creation or another model/tool effect", async () => {
    const f = fixture([write]);
    const { contract, imageId, checks, model } = f.options;
    const legacyIdentity = digest(canonical({ contract, imageId, checks, model: model.config, webDestinations: [] }));
    f.options.store.append(f.options.jobId, { type: "started", contextId: f.options.contextId, identity: legacyIdentity });
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("runtime_contract_drift");
    expect(f.create).not.toHaveBeenCalled(); expect(f.complete).not.toHaveBeenCalled(); expect(f.commands).toEqual([]);
    expect(f.options.store.dispatches(f.options.jobId)).toEqual([]);
  });

  it("reports the independent shared request cap and stops when it is consumed", async () => {
    const f = fixture([{ name: "execute", arguments: "{}" }], { maxModelCalls: 3, maxToolCalls: 3, maxRequests: 1 });
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("bounded_allowance_exhausted");
    expect(budget(f.requests[0]!)).toMatchObject({ remainingModelCalls: 3, remainingToolCalls: 3, remainingBrokerRequests: 1 });
    expect(f.requests).toHaveLength(1); expect(f.commands).toEqual([]);
  });

  it("checks the exact remaining time before a dispatch even before the abort timer fires", async () => {
    const f = fixture([write, finish], { maxElapsedMs: 120 });
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("cancelled_or_deadline");
    expect(f.requests).toHaveLength(1);
    expect(f.commands).toEqual([]);
    expect(f.options.store.events(f.options.jobId).filter(event => event.type === "tool_started")).toEqual([]);
    expect(f.options.store.dispatches(f.options.jobId)).toMatchObject([{ status: "settled", feeMicrousd: 0 }]);
    expect(budget(f.requests[0]!)).toMatchObject({ remainingActiveMs: 95 });
    expect(f.options.store.events(f.options.jobId).some(event => event.type === "completed")).toBe(false);
  });

  it("retains a settled response after cancellation without starting or later replaying its tool", async () => {
    const f = fixture([write]), abort = new AbortController();
    f.afterResponse(() => abort.abort());
    expect((await new GeneralAgentRunner(f.options).run(abort.signal)).reason).toBe("cancelled_or_deadline");
    const events = f.options.store.events(f.options.jobId);
    const settled = events.find(event => event.type === "model_finished")!;
    expect(events.find(event => event.type === "model_action_not_started")).toMatchObject({ operationId: settled.operationId, reason: "cancelled_or_deadline" });
    expect(events.filter(event => event.type === "tool_started" || event.type === "tool_finished")).toEqual([]);
    expect(f.options.store.dispatches(f.options.jobId)).toMatchObject([{ status: "settled", feeMicrousd: 0 }]);
    expect(f.commands).toEqual([]);
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("unresolved_operation_no_replay");
    expect(f.requests).toHaveLength(1); expect(f.commands).toEqual([]);
  });

  it.each([{ maxModelCalls: 1 }, { maxModelCalls: 3, maxToolCalls: 1 }])("validates the frozen final write at ordinary allowance exhaustion without another model/tool action: %j", async limits => {
    const f = fixture([write], limits);
    const result = await new GeneralAgentRunner(f.options).run();
    expect(result).toMatchObject({ status: "completed", reason: "critical_checks_passed_at_allowance", modelCalls: 1, checks: [{ id: "fixture_check", passed: true }] });
    expect(f.requests).toHaveLength(1); expect(f.create).toHaveBeenCalledTimes(2);
    expect(f.create.mock.calls[1]![0].files.find(file => file.path === "output.txt")!.bytes.toString()).toBe("computed fixture result");
    const events = f.options.store.events(f.options.jobId);
    expect(events.filter(event => event.type === "tool_started")).toMatchObject([{ name: "execute" }]);
    expect(events.filter(event => event.type === "tool_finished")).toHaveLength(1);
    expect(events.filter(event => event.type === "host_validation_started")).toHaveLength(1);
    expect(events.find(event => event.type === "host_validation_finished")).toMatchObject({ passed: true, verifiedSnapshotSha256: f.options.checkpoints.fingerprint(result.snapshot) });
    expect(events.find(event => event.type === "completed")).toMatchObject({ verifiedSnapshotSha256: f.options.checkpoints.fingerprint(result.snapshot) });
    expect(events.find(event => event.type === "run_ended")).toMatchObject({ cleanupConfirmed: true });
    expect(f.options.store.dispatches(f.options.jobId)).toMatchObject([{ status: "settled", feeMicrousd: 0 }]);
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("job_already_completed");
    expect(f.create).toHaveBeenCalledTimes(2); expect(f.requests).toHaveLength(1);
  });

  it.each(["missing", "failed_check"])("does not submit %s artifacts or repeat terminal verification after SQLite reopening", async kind => {
    const action = kind === "missing" ? { name: "remember_plan", arguments: '{"plan":"No artifact has been produced."}' } : write;
    const f = fixture([action], { maxModelCalls: 1, checkExitCode: 1 });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "incomplete", reason: "bounded_allowance_exhausted", modelCalls: 1 });
    const events = f.options.store.events(f.options.jobId);
    expect(events.find(event => event.type === "host_validation_finished")).toMatchObject({ passed: false });
    expect(events.some(event => event.type === "completed")).toBe(false);
    const priorCreates = f.create.mock.calls.length;
    const reopened = new Database(f.dbPath); cleanup.push(() => reopened.close());
    expect((await new GeneralAgentRunner({ ...f.options, store: new PrivateAgentStore(reopened) }).run()).reason).toBe("host_validation_not_replayed");
    expect(f.create).toHaveBeenCalledTimes(priorCreates); expect(f.requests).toHaveLength(1);
  });

  it.each([
    { name: "execute", arguments: "{}" },
    { name: "execute", arguments: "{}", outputTokens: 4096 },
    { name: "unavailable_tool", arguments: "{}" },
  ])("does not promote an existing artifact after an invalid final action: %j", async invalid => {
    const f = fixture([write, invalid], { maxModelCalls: 2 });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "incomplete", reason: "bounded_allowance_exhausted" });
    expect(f.commands).toEqual(["write result"]);
    expect(f.options.store.events(f.options.jobId).some(event => event.type === "host_validation_started" || event.type === "completed")).toBe(false);
  });

  it.each(["cancel", "deadline"])("does not start terminal verification after %s during the last action", async kind => {
    const f = fixture([write], { maxModelCalls: 1 });
    const abort = new AbortController();
    f.afterExecute(() => { if (kind === "cancel") abort.abort(); else f.advance(10000); });
    expect((await new GeneralAgentRunner(f.options).run(abort.signal)).reason).toBe("cancelled_or_deadline");
    expect(f.commands).toEqual(["write result"]); expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.options.store.events(f.options.jobId).some(event => event.type === "host_validation_started" || event.type === "completed")).toBe(false);
  });

  it("retains uncertain host verification as a no-replay stop", async () => {
    const f = fixture([write], { maxModelCalls: 1 });
    const create = f.create.getMockImplementation()!;
    f.create.mockImplementation(async input => { if (f.create.mock.calls.length === 2) throw Error("synthetic verifier creation failure"); return create(input); });
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("runtime_failure_progress_preserved");
    const events = f.options.store.events(f.options.jobId);
    expect(events.some(event => event.type === "host_validation_started")).toBe(true);
    expect(events.some(event => event.type === "host_validation_finished" || event.type === "completed")).toBe(false);
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("unresolved_operation_no_replay");
    expect(f.create).toHaveBeenCalledTimes(2); expect(f.requests).toHaveLength(1);
  });

  it("does not start terminal verification while a dispatch remains unknown", async () => {
    const f = fixture([write], { maxModelCalls: 1 });
    f.afterExecute(() => {
      const { text: _text, ...preview } = f.options.broker.preview({ jobId: f.options.jobId, contextId: f.options.contextId,
        destinationId: "model", purpose: "synthetic unresolved dispatch", method: "POST", body: "synthetic", maxFeeMicrousd: 0 });
      const row = f.options.store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_inside_boundary" } }, () => {});
      f.options.store.unknown(row.id);
    });
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("unresolved_dispatch_no_replay");
    expect(f.create).toHaveBeenCalledTimes(1); expect(f.requests).toHaveLength(1);
    expect(f.options.store.events(f.options.jobId).some(event => event.type === "host_validation_started" || event.type === "completed")).toBe(false);
  });

  it("does not submit passing terminal checks if a dispatch becomes unknown during verification", async () => {
    const f = fixture([write], { maxModelCalls: 1 });
    f.afterExecute(command => {
      if (!command.startsWith("python3 -I -c")) return;
      const { text: _text, ...preview } = f.options.broker.preview({ jobId: f.options.jobId, contextId: f.options.contextId,
        destinationId: "model", purpose: "synthetic unresolved verification dispatch", method: "POST", body: "synthetic", maxFeeMicrousd: 0 });
      const row = f.options.store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_inside_boundary" } }, () => {});
      f.options.store.unknown(row.id);
    });
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("unresolved_dispatch_no_replay");
    expect(f.requests).toHaveLength(1);
    expect(f.options.store.events(f.options.jobId).some(event => event.type === "completed")).toBe(false);
  });

  it.each(["cancel", "deadline"])("does not submit passing terminal checks after %s during verification", async kind => {
    const f = fixture([write], { maxModelCalls: 1 }), abort = new AbortController();
    f.afterExecute(command => { if (command.startsWith("python3 -I -c")) { if (kind === "cancel") abort.abort(); else f.advance(10000); } });
    expect((await new GeneralAgentRunner(f.options).run(abort.signal)).reason).toBe(kind === "cancel" ? "cancelled_before_completion" : "deadline_before_completion");
    const events = f.options.store.events(f.options.jobId);
    expect(events.find(event => event.type === "host_validation_finished")).toMatchObject({ passed: true });
    expect(events.some(event => event.type === "completed")).toBe(false);
    expect(f.requests).toHaveLength(1);
  });

  it("does not promote passing terminal checks if final cleanup fails", async () => {
    const f = fixture([write], { maxModelCalls: 1 });
    vi.mocked(DockerSandbox.cleanupOwnedContext).mockRejectedValueOnce(Error("synthetic cleanup failure"));
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("cleanup_required");
    const events = f.options.store.events(f.options.jobId);
    expect(events.find(event => event.type === "host_validation_finished")).toMatchObject({ passed: true });
    expect(events.some(event => event.type === "completed")).toBe(false);
    expect(f.options.store.runClaim(f.options.contextId)?.state).toBe("cleanup_required");
  });

});

describe("general runner tolerant loop", () => {
  const text: Action = { ...write, reply: "text" };
  it("nudges a reply without a tool call up to three times, then stops without executing anything", async () => {
    const f = fixture([text, text, text, text, write, finish], { maxModelCalls: 8, maxToolCalls: 5 });
    const result = await new GeneralAgentRunner(f.options).run();
    expect(result).toMatchObject({ status: "incomplete", reason: "one_complete_tool_action_required", modelCalls: 4 });
    expect(f.commands).toEqual([]);
    const nudges = f.options.store.events(f.options.jobId).filter(event => event.type === "nudge");
    expect(nudges).toHaveLength(3);
    expect(nudges.every(event => event.kind === "no_action")).toBe(true);
    expect(f.requests[3]!.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("exactly one tool call") });
  });
  it("recovers after a nudge and treats a multi-call reply as nothing executed", async () => {
    const f = fixture([{ ...write, reply: "multi" }, text, write, finish], { maxModelCalls: 6 });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", reason: "critical_checks_passed", modelCalls: 4 });
    expect(f.commands.filter(command => command === "write result")).toHaveLength(1);
    expect(f.options.store.events(f.options.jobId).filter(event => event.type === "nudge").map(event => event.message)).toEqual([
      expect.stringContaining("More than one tool call"), expect.stringContaining("No tool was called")]);
  });
  it("turns an output-limit reply into durable feedback and continues, stopping only after three in a row", async () => {
    const cut: Action = { ...write, reply: "length", outputTokens: 4096 };
    const f = fixture([cut, write, finish], { maxModelCalls: 6 });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", modelCalls: 3 });
    expect(f.options.store.events(f.options.jobId).filter(event => event.type === "nudge")).toEqual([expect.objectContaining({ kind: "length", message: expect.stringContaining("4096-token output limit") })]);
    expect(f.requests[1]!.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("write_file and append_file") });
    const g = fixture([cut, cut, cut, write], { maxModelCalls: 6 });
    expect(await new GeneralAgentRunner(g.options).run()).toMatchObject({ status: "incomplete", reason: "model_output_incomplete", modelCalls: 3 });
    expect(g.commands).toEqual([]);
  });
  it("writes, appends and replaces file content through the sandbox protocol and reports soft refusals", async () => {
    const f = fixture([
      { name: "write_file", arguments: JSON.stringify({ path: "output.txt", content: "abcdef" }) },
      { name: "append_file", arguments: JSON.stringify({ path: "output.txt", content: "ghi" }) },
      { name: "str_replace", arguments: JSON.stringify({ path: "output.txt", old: "zzz", new: "y" }) },
      { name: "str_replace", arguments: JSON.stringify({ path: "output.txt", old: "cde", new: "XY" }) },
      { name: "write_file", arguments: JSON.stringify({ path: "../escape.txt" }) },
      finish], { maxModelCalls: 8, maxToolCalls: 8 });
    const result = await new GeneralAgentRunner(f.options).run();
    expect(result).toMatchObject({ status: "completed", modelCalls: 6 });
    expect(f.commands.slice(0, 4)).toEqual(["write:output.txt", "append:output.txt", "replace:output.txt", "replace:output.txt"]);
    expect(f.commands.slice(4)).toEqual([expect.stringMatching(/^python3 -I -c/u)]);
    const outputs = f.options.store.events(f.options.jobId).filter(event => event.type === "tool_finished").map(event => JSON.parse(String(event.output)));
    expect(outputs[0]).toMatchObject({ ok: true, bytes: 6, path: "output.txt", completed: true });
    expect(outputs[2]).toMatchObject({ ok: false, reason: "occurrences_not_one", occurrences: 0, completed: false });
    expect(outputs[3]).toMatchObject({ ok: true, bytes: 8 });
    expect(outputs[4]).toMatchObject({ error: "invalid_tool_arguments", actionInvoked: false });
    expect(f.options.checkpoints.load(result.snapshot).find(file => file.path === "output.txt")!.bytes.toString("utf8")).toBe("abXYfghi");
  });

  it("resumes after a nudge instead of reporting an unresolved action: multi-call, output-limit and warned text replies", async () => {
    const cases: { name: string; actions: Action[]; pauseAt: number; nudges: number }[] = [
      { name: "multi-call with execute", actions: [{ ...write, reply: "multi" }, write, finish], pauseAt: 1, nudges: 1 },
      { name: "output limit with a partial execute", actions: [{ ...write, reply: "length", outputTokens: 4096 }, write, finish], pauseAt: 1, nudges: 1 },
      { name: "warned text-only reply", actions: [{ name: "execute", arguments: '{"command":"fail same"}' }, { name: "execute", arguments: '{"command":"fail same"}' },
        { ...write, reply: "text" }, write, finish], pauseAt: 3, nudges: 1 },
    ];
    for (const item of cases) {
      const f = fixture(item.actions, { maxModelCalls: 8, maxToolCalls: 8 });
      const first = new GeneralAgentRunner(f.options);
      f.afterResponse(count => { if (count === item.pauseAt) first.pause(); });
      expect(await first.run(), item.name).toMatchObject({ status: "paused" });
      expect(f.options.store.events(f.options.jobId).filter(event => event.type === "nudge"), item.name).toHaveLength(item.nudges);
      const reopened = new Database(f.dbPath); cleanup.push(() => reopened.close());
      const resumed = await new GeneralAgentRunner({ ...f.options, store: new PrivateAgentStore(reopened) }).run();
      expect(resumed, item.name).toMatchObject({ status: "completed", reason: "critical_checks_passed" });
      expect(f.commands.filter(command => command === "write result"), item.name).toHaveLength(1);
    }
  });
  it("restores nudge streaks exactly as the live loop counts them, so a resumed run ends where a continuous run would", async () => {
    const cut: Action = { ...write, reply: "length", outputTokens: 4096 }, text: Action = { ...write, reply: "text" };
    const script: Action[] = [cut, cut, text, cut, write, finish];
    const continuous = fixture(script, { maxModelCalls: 10 });
    expect(await new GeneralAgentRunner(continuous.options).run()).toMatchObject({ status: "completed", modelCalls: 6 });
    const f = fixture(script, { maxModelCalls: 10 });
    const first = new GeneralAgentRunner(f.options);
    f.afterResponse(count => { if (count === 3) first.pause(); });
    expect(await first.run()).toMatchObject({ status: "paused" });
    const reopened = new Database(f.dbPath); cleanup.push(() => reopened.close());
    expect(await new GeneralAgentRunner({ ...f.options, store: new PrivateAgentStore(reopened) }).run()).toMatchObject({ status: "completed", modelCalls: 6 });
    const g = fixture([text, text, text, text], { maxModelCalls: 10 });
    const paused = new GeneralAgentRunner(g.options);
    g.afterResponse(count => { if (count === 3) paused.pause(); });
    expect(await paused.run()).toMatchObject({ status: "paused" });
    const again = new Database(g.dbPath); cleanup.push(() => again.close());
    expect(await new GeneralAgentRunner({ ...g.options, store: new PrivateAgentStore(again) }).run()).toMatchObject({ status: "incomplete", reason: "one_complete_tool_action_required", modelCalls: 4 });
  });
  it("keeps nudged replies out of the replayed conversation while retaining the unexecuted calls for audit", async () => {
    const f = fixture([{ ...write, reply: "multi" }, write, finish], { maxModelCalls: 6 });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed" });
    const events = f.options.store.events(f.options.jobId);
    const nudgedReply = events.find(event => event.type === "model_finished" && event.nudged === "no_action")!;
    expect((nudgedReply.message as { tool_calls?: unknown }).tool_calls).toBeUndefined();
    expect(nudgedReply.unexecutedToolCalls).toHaveLength(2);
    const replayed = f.requests[1]!;
    expect(replayed.filter(message => message.role === "assistant" && message.tool_calls)).toHaveLength(0);
    expect(replayed.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("More than one tool call") });
  });
  it("runs a heavy-profile contract end to end through the real loop: 47 calls with nudges, edits and a time jump", async () => {
    const script: Action[] = [];
    for (let i = 0; i < 40; i++) {
      script.push({ name: "append_file", arguments: JSON.stringify({ path: "output.txt", content: `line ${i}\n` }) });
      if (i === 5 || i === 20) script.push({ ...write, reply: "text" });
      if (i === 12) script.push({ ...write, reply: "length", outputTokens: 16_384 });
      if (i === 30) script.push({ ...write, reply: "multi" });
    }
    script.push({ name: "str_replace", arguments: JSON.stringify({ path: "output.txt", old: "line 39\n", new: "last line\n" }) }, { ...write, reply: "length", outputTokens: 16_384 }, finish);
    const f = fixture(script, { maxModelCalls: 80, maxToolCalls: 120, maxElapsedMs: 5_400_000, maxRequests: 200 });
    f.afterResponse(count => { if (count === 25) f.advance(1_000_000); });
    const result = await new GeneralAgentRunner(f.options).run();
    expect(result).toMatchObject({ status: "completed", reason: "critical_checks_passed", modelCalls: 47 });
    expect(f.options.store.policy(f.options.jobId).maxRequests).toBe(200);
    expect(f.options.store.events(f.options.jobId).filter(event => event.type === "nudge").map(event => event.kind)).toEqual(["no_action", "length", "no_action", "no_action", "length"]);
    const text = f.options.checkpoints.load(result.snapshot).find(file => file.path === "output.txt")!.bytes.toString("utf8");
    expect(text.split("\n").filter(Boolean)).toHaveLength(40);
    expect(text.endsWith("last line\n")).toBe(true);
  });
});
