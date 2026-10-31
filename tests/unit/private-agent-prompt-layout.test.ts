import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrokerError, PrivateAgentBroker, RETRY_WAIT_CANCELLED } from "../../src/main/private-agent/broker";
import { capabilitiesForImage } from "../../src/main/private-agent/capabilities";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { canonical, contextFingerprint, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, type GeneralMessage } from "../../src/main/private-agent/model";
import { EXECUTION_PROGRESS_POLICY } from "../../src/main/private-agent/progress";
import { CURRENT_PROMPT_LAYOUT_VERSION, GeneralAgentRunner, promptProtocol, type GeneralJobContract, type GeneralJobOptions } from "../../src/main/private-agent/runner";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

const cleanup: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const done of cleanup.splice(0).reverse()) done(); });
type Action = { name: string; arguments: string };
const write: Action = { name: "execute", arguments: '{"command":"write result"}' };
const failed: Action = { name: "execute", arguments: '{"command":"fail same"}' };
const finish: Action = { name: "finish", arguments: '{"summary":"Artifacts are ready for host checks."}' };
const BUDGET = "Current host budget", GUIDANCE = "Current host execution progress";

/**
 * Pinned on 2026-10-22 from the pre-H1 runner (commit cac812d) for exactly this fixture. Layout 1 must keep producing
 * these bytes, or every task paused before H1 would end in runtime_contract_drift on resume.
 */
const PINNED_V1 = {
  plain: { promptProtocolSha256: "68fedda1983d0d5ce0e5349b6b2a70696e007b1159208830a182b7bc0499fa43", identity: "57b05e3be9fce50a2c0c196c4c21428c34d352b2c6136ee6b0917547b60e7a40" },
  public: { promptProtocolSha256: "6b54d8d0298f6bcd38d90bb52ee3457fdbe82b329f9bb177bb754fdbe5de25b6", identity: "bda3bf1f6c35c2001ffff76e6f7e5a514c557447a51c72fbe65afcdcf15850e4" },
};

/** The same synthetic job the pin was taken from: fixed contract, input, image, checks and model configuration. */
function fixture(actions: Action[], variant: "plain" | "public" = "plain", limits: { maxModelCalls?: number; maxToolCalls?: number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "soar-prompt-layout-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, "state.sqlite"), db = new Database(dbPath); cleanup.push(() => db.close());
  const store = new PrivateAgentStore(db), jobId = randomUUID(), contextId = randomUUID();
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["model"], maxRequests: 10, maxFeeMicrousd: 0 });
  const contract: GeneralJobContract = { version: 1, goal: "Compute a synthetic result from the input and save it.",
    requiredArtifacts: [{ path: "output.txt", description: "Computed output" }], requiredChecks: ["fixture_check"],
    maxModelCalls: limits.maxModelCalls ?? 4, maxToolCalls: limits.maxToolCalls ?? 5, maxElapsedMs: 10000 };
  const files = [{ path: "input.txt", bytes: Buffer.from("synthetic input") }];
  store.createContext({ id: contextId, jobId, sources: [canonical(contract), canonical(files.map(file => ({ path: file.path, sha256: digest(file.bytes) }))), ...files.map(file => file.bytes)]
    .map((value, index) => ({ id: `fixture_${index}`, version: digest(value), classification: "private", synthetic: true })) });
  const broker = new PrivateAgentBroker(store, [{ id: "model", kind: "local_model", endpoint: "http://127.0.0.1:1/v1/chat/completions",
    accountId: "fixture", credentialVersion: 0, privateDataAdmitted: true, loopbackFixture: true, maxResponseBytes: 65536, timeoutMs: 1000 }],
  { scan: async () => { throw new Error("No scanner or transport is allowed in this unit fixture."); } });
  const model = new PrivateAgentModel(broker, { destinationId: "model", model: "synthetic", maxOutputTokens: 4096,
    inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" }, jobId, contextId);
  const checkpoints = new PrivateCheckpointStore(join(directory, "checkpoints"), jobId);
  const options: GeneralJobOptions = { jobId, contextId, store, broker, model, files, contract, imageId: `sha256:${"a".repeat(64)}`, checkpoints,
    checks: [{ id: "fixture_check", python: "# fixed synthetic host check" }],
    ...(variant === "public" ? { webDestinations: ["public-docs"], maxPublicFetches: 2 } : {}) };
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(DockerSandbox, "currentEndpoint").mockResolvedValue("unix:///tmp/synthetic-docker.sock");
  vi.spyOn(DockerSandbox, "cleanupOwnedContext").mockImplementation(async () => { clock += 5; });
  const commands: string[] = [];
  vi.spyOn(DockerSandbox, "create").mockImplementation(async input => {
    clock += 25;
    const contents = new Map(input.files.map(file => [file.path, Buffer.from(file.bytes)]));
    return { async execute(command: string) {
      clock += 50; commands.push(command);
      if (command === "write result") contents.set("output.txt", Buffer.from("computed fixture result"));
      return { exitCode: command.startsWith("fail ") ? 1 : 0, stdout: "synthetic evidence", stderr: "" };
    }, async listFiles() { return [...contents.keys()].sort(); },
    async readFile(path: string) { return Buffer.from(contents.get(path)!); },
    async editFile() { return { ok: true, bytes: 0 }; }, async close() { clock += 5; } } as unknown as DockerSandbox;
  });
  const requests: GeneralMessage[][] = [], overrides: unknown[] = [];
  vi.spyOn(model, "complete").mockImplementation(async (messages, _tools, _signal, options) => {
    requests.push(structuredClone(messages)); overrides.push(options); clock += 100;
    const index = requests.length - 1, action = actions[index];
    if (!action) throw new Error("Unexpected model invocation.");
    const { text: _text, ...preview } = broker.preview({ jobId, contextId, destinationId: "model", purpose: "unit fixture", method: "POST", body: canonical(messages), maxFeeMicrousd: 0 });
    const row = store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_inside_boundary" } }, () => {});
    store.settle(row.id, 0, digest(canonical(action)));
    return { content: "", toolCalls: [{ id: `tool_${index}`, type: "function" as const, function: { name: action.name, arguments: action.arguments } }],
      finishReason: "tool_calls", costUsd: 0, durationMs: 100 };
  });
  /** An existing task: a `started` event written by the pre-H1 runner (no layout field, projector policy 1) and its root checkpoint. */
  const seedVersion1 = (overrides: Record<string, unknown> = {}) => {
    const v1 = promptProtocol(options, 1), snapshot = checkpoints.save(files);
    store.append(jobId, { type: "started", contextId, identity: v1.identity, promptProtocolSha256: v1.promptProtocolSha256, executionObservationPolicyVersion: 1,
      executionProgressPolicyVersion: EXECUTION_PROGRESS_POLICY.version, capabilities: capabilitiesForImage(options.imageId),
      contextSha256: contextFingerprint(store.context(contextId)), ...overrides });
    store.append(jobId, { type: "checkpoint", contextId, snapshot, sha256: checkpoints.fingerprint(snapshot) });
    return v1;
  };
  return { options, dbPath, requests, overrides, commands, seedVersion1, events: () => store.events(jobId) };
}
const turnBudget = (message: GeneralMessage) => JSON.parse(message.content!.slice(message.content!.lastIndexOf("\n") + 1)) as Record<string, number>;

describe("prompt protocol per layout version", () => {
  it.each(["plain", "public"] as const)("pins the layout 1 protocol inputs and identity for the %s fixture to the pre-H1 bytes", variant => {
    const f = fixture([], variant), v1 = promptProtocol(f.options, 1);
    expect(v1.promptProtocolSha256).toBe(PINNED_V1[variant].promptProtocolSha256);
    expect(v1.identity).toBe(PINNED_V1[variant].identity);
    expect(v1.layout).toMatchObject({ version: 1, observationPolicyVersion: 1 });
    expect(Object.keys(v1.protocol).sort()).toEqual(["argumentFeedback", "budgetMessage", "capabilitiesIdentity", "claimsVerified", "commandTimeoutMs", "definitions",
      "executionObservationPolicy", "executionProgressPolicy", "incompleteExecuteLimit", "incompleteExecuteStop", "nudges", "outputLimitFeedback", "prompt", "publicSourceObservationBytes", "version"]);
    expect(v1.protocol).toMatchObject({ version: 18, executionObservationPolicy: { version: 1, maxBytes: 8192, budgetBytes: 48 * 1024 } });
    expect(String(v1.protocol.budgetMessage).includes('"remainingPublicFetches":0')).toBe(variant === "public");
    expect(v1.prompt).not.toContain(BUDGET); expect(v1.prompt).not.toContain(GUIDANCE);
    expect(v1.promptProtocolSha256).toBe(digest(canonical(v1.protocol)));
  });

  it("gives layout 2 its own protocol and identity over the same static prompt and tool definitions", () => {
    const f = fixture([]), v1 = promptProtocol(f.options, 1), v2 = promptProtocol(f.options, 2);
    expect(v2.prompt).toBe(v1.prompt); expect(v2.definitions).toEqual(v1.definitions);
    expect(v2.layout).toMatchObject({ version: 2, observationPolicyVersion: 2 });
    expect(v2.protocol).toMatchObject({ version: 20, executionObservationPolicy: { version: 2, maxBytes: 8192, budgetBytes: 48 * 1024, demoteToBytes: 24 * 1024 },
      promptLayout: { version: 2 } });
    expect(v2.promptProtocolSha256).not.toBe(v1.promptProtocolSha256); expect(v2.identity).not.toBe(v1.identity);
    expect(CURRENT_PROMPT_LAYOUT_VERSION).toBe(2);
  });
});

describe("layout 2: static prefix and trailing turn message", () => {
  it("keeps the system message and the brief byte-identical across turns and sends the budget last, after the latest tool result", async () => {
    const f = fixture([write, write, write, finish], "plain", { maxModelCalls: 4, maxToolCalls: 5 });
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", modelCalls: 4 });
    expect(f.requests).toHaveLength(4);
    const v2 = promptProtocol(f.options, 2), first = f.requests[0]!;
    expect(first.map(message => message.role)).toEqual(["system", "user", "user"]);
    expect(first[0]!.content).toBe(v2.prompt); expect(first[1]!.content).toBe(f.options.contract.goal);
    for (const [turn, messages] of f.requests.entries()) {
      expect(messages.filter(message => message.role === "system")).toHaveLength(1);
      expect(messages[0]).toEqual(first[0]); expect(messages[1]).toEqual(first[1]);
      expect(messages[0]!.content).not.toContain(BUDGET); expect(messages[0]!.content).not.toContain(GUIDANCE);
      const last = messages.at(-1)!;
      expect(last.role).toBe("user"); expect(last.content!.match(/Current host budget/gu)).toHaveLength(1);
      expect(last.content!.startsWith(BUDGET)).toBe(true);
      expect(messages.slice(0, -1).some(message => message.content?.includes(BUDGET))).toBe(false);
      if (turn > 0) { expect(messages.at(-2)!.role).toBe("tool"); expect(messages.at(-2)!.tool_call_id).toBe(`tool_${turn - 1}`); }
      expect(turnBudget(last)).toMatchObject({ remainingModelCalls: 4 - turn, remainingToolCalls: 5 - turn });
    }
    const events = f.events(), begin = events.find(event => event.type === "started")!;
    expect(begin).toMatchObject({ promptLayoutVersion: 2, executionObservationPolicyVersion: 2, executionProgressPolicyVersion: 1,
      identity: v2.identity, promptProtocolSha256: v2.promptProtocolSha256 });
    expect(begin.identity).not.toBe(promptProtocol(f.options, 1).identity);
    const starts = events.filter(event => event.type === "model_started");
    expect(starts.every(event => event.promptProtocolSha256 === v2.promptProtocolSha256 && (event.observationProjection as { version: number }).version === 2)).toBe(true);
    expect(starts.map(event => event.budget)).toEqual(f.requests.map(messages => turnBudget(messages.at(-1)!)));
  });

  it("carries the progress guidance ahead of the budget in the trailing message, and nothing of it in the system message", async () => {
    const f = fixture([failed, failed, write, finish]);
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", modelCalls: 4 });
    const warned = f.requests[2]!.at(-1)!;
    expect(warned.role).toBe("user"); expect(warned.content!.startsWith(`${GUIDANCE}\n`)).toBe(true);
    expect(warned.content).toContain("Two completed execute actions");
    expect(warned.content!.indexOf(GUIDANCE)).toBeLessThan(warned.content!.indexOf(BUDGET));
    expect(f.requests[2]![0]!.content).toBe(f.requests[0]![0]!.content);
    expect(f.requests.every(messages => !messages[0]!.content!.includes(GUIDANCE))).toBe(true);
    expect(f.requests[3]!.at(-1)!.content!.startsWith(BUDGET)).toBe(true);
  });
});

describe("resume across layout versions", () => {
  it("resumes a task started before H1 under layout 1: budget inside the system message, no trailing message, rolling projector", async () => {
    const f = fixture([write, finish]), v1 = f.seedVersion1();
    expect(v1.promptProtocolSha256).toBe(PINNED_V1.plain.promptProtocolSha256);
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "completed", modelCalls: 2 });
    expect(f.requests[0]!.map(message => message.role)).toEqual(["system", "user"]);
    expect(f.requests[1]!.map(message => message.role)).toEqual(["system", "user", "assistant", "tool"]);
    for (const messages of f.requests) {
      expect(messages[0]!.content!.startsWith(v1.prompt)).toBe(true);
      expect(messages[0]!.content!.match(/Current host budget/gu)).toHaveLength(1);
      expect(messages.slice(1).some(message => message.content?.includes(BUDGET))).toBe(false);
    }
    expect(turnBudget(f.requests[1]![0]!)).toMatchObject({ remainingModelCalls: 3, remainingToolCalls: 4 });
    const events = f.events();
    expect(events.filter(event => event.type === "started")).toHaveLength(1);
    expect(events.filter(event => event.type === "model_started").every(event =>
      event.promptProtocolSha256 === v1.promptProtocolSha256 && (event.observationProjection as { version: number }).version === 1)).toBe(true);
    expect(f.commands).toEqual(["write result", expect.stringContaining("python3 -I -c")]);
  });

  it("starts a fresh task under layout 2 while the same fixture seeded as layout 1 stays on layout 1", async () => {
    const fresh = fixture([write, finish]);
    expect(await new GeneralAgentRunner(fresh.options).run()).toMatchObject({ status: "completed" });
    expect(fresh.events().find(event => event.type === "started")).toMatchObject({ promptLayoutVersion: 2, executionObservationPolicyVersion: 2 });
    expect(fresh.requests[0]!.map(message => message.role)).toEqual(["system", "user", "user"]);
    const seeded = fixture([write, finish]); seeded.seedVersion1();
    expect(await new GeneralAgentRunner(seeded.options).run()).toMatchObject({ status: "completed" });
    expect(seeded.events().find(event => event.type === "started")).not.toHaveProperty("promptLayoutVersion");
    expect(seeded.requests[0]!.map(message => message.role)).toEqual(["system", "user"]);
    // Only layout 2 ends on a turn message, so only it asks the Anthropic shape to send that tail as a system message.
    expect(fresh.overrides).toEqual(fresh.requests.map(() => ({ trailingTurnMessage: true })));
    expect(seeded.overrides).toEqual(seeded.requests.map(() => undefined));
  });

  it("ends a run cancelled, not as an unavailable model, when a cancel arrives during the Anthropic retry wait, and closes the operation", async () => {
    const f = fixture([write, finish]);
    vi.mocked(f.options.model.complete).mockRejectedValueOnce(new BrokerError(RETRY_WAIT_CANCELLED));
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "incomplete", reason: "cancelled_or_deadline" });
    const events = f.events(), started = events.find(event => event.type === "model_started")!;
    expect(events.filter(event => event.type === "model_request_failed")).toEqual([expect.objectContaining({ operationId: started.operationId, dispatched: true })]);
  });

  it.each([
    ["an unknown layout version", { promptLayoutVersion: 3 }],
    ["a layout 1 record claiming projector policy 2", { executionObservationPolicyVersion: 2 }],
    ["a layout 2 field on a layout 1 identity", { promptLayoutVersion: 2 }],
  ])("refuses to resume %s as runtime contract drift without a model call", async (_label, overrides) => {
    const f = fixture([write, finish]); f.seedVersion1(overrides);
    expect(await new GeneralAgentRunner(f.options).run()).toMatchObject({ status: "incomplete", reason: "runtime_contract_drift" });
    expect(f.requests).toHaveLength(0); expect(f.commands).toEqual([]);
  });
});
