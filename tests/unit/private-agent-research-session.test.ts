import Database from "better-sqlite3";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { PrivateAgentBroker, type BrokerDestination } from "../../src/main/private-agent/broker";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { digest, restrictedContext } from "../../src/main/private-agent/contracts";
import { GeneralAgentSession, RESEARCH_TRANSFER_CHECK_ID, sessionPhaseIdentity, type GeneralSessionOptions, type SessionPhase } from "../../src/main/private-agent/session";
import { RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET } from "../../src/main/private-agent/research-pipeline";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const done of cleanups.splice(0).reverse()) await done(); });
const imageId = `sha256:${"a".repeat(64)}`;
const SOURCE = "# Storage\nCapacity nearly doubled in 2024, from 15 GW to 29 GW.\n";
function phase(): SessionPhase {
  const files = [{ path: "input/corpus/a.md", bytes: Buffer.from(SOURCE) }, { path: "brief.md", bytes: Buffer.from("Write a cited briefing.") }];
  return { files, checks: [{ id: "structure", python: "# fixed fixture" }], contract: { version: 1, goal: "Write a cited briefing on storage from input/corpus.",
    requiredArtifacts: [{ path: "output/report.md", description: "report" }], requiredChecks: ["structure"], maxModelCalls: 40, maxToolCalls: 80, maxElapsedMs: 1_800_000 } };
}
/** A loopback model whose reply depends on the stage named by the system prompt; `planReply` lets a test break the plan; `onRequest` lets one pause mid-call. */
async function fixture(planReply = () => JSON.stringify({ version: 1, questions: [{ id: "Q1", text: "How did capacity develop?", sourceIds: ["input/corpus/a.md"] }] })) {
  const bodies: { system: string; user: string }[] = [], hooks: { onRequest?: (system: string) => void } = {};
  const server = http.createServer((request, response) => {
    let raw = ""; request.on("data", chunk => { raw += chunk; }); request.on("end", () => {
      const body = JSON.parse(raw) as { messages: { content: string }[] }, system = body.messages[0]!.content, user = body.messages[1]!.content;
      bodies.push({ system, user }); hooks.onRequest?.(system);
      const content = system.startsWith("You index") ? JSON.stringify({ sources: [{ sourceId: "input/corpus/a.md", gist: "Doubling." }] })
        : system.startsWith("You plan") ? planReply()
        : system.startsWith("You extract") ? JSON.stringify({ quotes: [{ quote: "Capacity nearly doubled in 2024, from 15 GW to 29 GW.", note: "headline" }] })
        : "Capacity doubled [E1].\n\n## Conflicting evidence\nNone.\n\n## Unanswered questions\nNone.";
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  await new Promise<void>((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
  cleanups.push(() => new Promise<void>(yes => { server.closeAllConnections(); server.close(() => yes()); }));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const root = mkdtempSync(join(tmpdir(), "soar-research-session-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const db = new Database(":memory:"); cleanups.push(() => { db.close(); });
  const store = new PrivateAgentStore(db);
  const base = { kind: "local_model" as const, endpoint: `${endpoint}/v1/chat/completions`, accountId: "fixture", credentialVersion: 0, loopbackFixture: true, timeoutMs: 2000, maxResponseBytes: 65536 };
  // "model" admits synthetic lineage only (the shape of a cloud destination); "private-model" admits private data (the owned local server).
  const destinations: BrokerDestination[] = [{ id: "model", ...base, privateDataAdmitted: false, syntheticOnly: true }, { id: "private-model", ...base, privateDataAdmitted: true }];
  const broker = new PrivateAgentBroker(store, destinations, { scan: async () => ({ complete: true, blocked: false, detector: "deliberate-false-negative-fixture" }) });
  return { store, broker, root, bodies, hooks };
}
type Run = { files: string[]; goal: string; checks: string[]; required: string[]; restricted: boolean };
function options(f: Awaited<ReturnType<typeof fixture>>, jobId: string, runs: Run[], destination = "model"): GeneralSessionOptions {
  const privatePhase = phase(), checkpoints = new PrivateCheckpointStore(f.root, jobId);
  const config = (destinationId: string) => ({ destinationId, model: "fixture", maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" as const });
  const model = (contextId: string, destinationId = destination) => new PrivateAgentModel(f.broker, config(destinationId), jobId, contextId);
  // The heavy profile's pool: the H2c guard refuses a pool that cannot hold the reader's 68 calls and the writer's 40.
  return { jobId, imageId, store: f.store, broker: f.broker, checkpoints, privatePhase, limits: { maxRequests: 200, maxElapsedMs: 1_800_000 },
    syntheticInputApproval: { privatePhaseSha256: sessionPhaseIdentity(privatePhase), authoritySha256: digest("host-authored-fixture") },
    trustedHostModelFactory: contextId => model(contextId),
    research: { models: contextId => ({ reader: model(contextId), planner: model(contextId), synthesiser: model(contextId) }) },
    trustedHostRunnerFactory: input => ({ pause() {}, cancel() {}, async run() {
      runs.push({ files: input.files.map(file => file.path), goal: input.contract.goal, checks: input.checks.map(check => check.id), required: input.contract.requiredChecks, restricted: restrictedContext(f.store.context(input.contextId)) });
      const snapshot = checkpoints.save([...input.files, { path: "output/report.md", bytes: Buffer.from("Capacity doubled [C1].") }]), checks = input.checks.map(check => ({ id: check.id, passed: true }));
      f.store.append(jobId, { type: "completed", contextId: input.contextId, snapshot, checks, verifiedSnapshotSha256: checkpoints.fingerprint(snapshot) });
      return { status: "completed" as const, reason: "critical_checks_passed", snapshot, checks, modelCalls: 1 };
    } }) };
}

describe("H2b/H2c: the research stage inside a session", () => {
  it("runs the pipeline in its own reader context, pins its files into the write phase, records counts only, and skips it on resume", async () => {
    const f = await fixture(), runs: Run[] = [], config = options(f, "job-research", runs);
    const result = await new GeneralAgentSession(config).run();
    expect(result).toMatchObject({ status: "submitted" });
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.files).toEqual(expect.arrayContaining(["input/corpus/a.md", ...Object.values(RESEARCH_FILES)]));
    expect(run.goal).toContain("A host-run reading stage"); expect(run.goal).toContain(RESEARCH_FILES.evidence); expect(run.goal).toContain("untrusted source evidence");
    expect(run.required).toContain(RESEARCH_TRANSFER_CHECK_ID); expect(run.checks).toContain(RESEARCH_TRANSFER_CHECK_ID);
    expect(run.restricted).toBe(true);
    const events = f.store.events("job-research");
    const start = events.find(event => event.type === "session_started")!;
    expect(start.readerContextId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(start.readerContextId).not.toBe(start.privateContextId); expect(start.readerContextId).not.toBe(start.publicContextId);
    const stages = events.filter(event => event.type === "research_stage");
    expect(stages.map(event => event.stage)).toEqual(["index", "plan", "extract", "synthesise"]);
    expect(stages.every(event => event.contextId === start.readerContextId && event.denied === undefined)).toBe(true);
    expect(JSON.stringify(stages)).not.toContain("doubled");
    const transfer = events.find(event => event.type === "research_transfer")!;
    expect((transfer.binding as { files: { path: string }[] }).files.map(file => file.path).sort()).toEqual(Object.values(RESEARCH_FILES).sort());
    // Every pipeline dispatch sits in the reader context, none in the write context.
    const dispatches = f.store.dispatches("job-research");
    expect(dispatches.length).toBe(4); expect(dispatches.every(row => row.contextId === start.readerContextId)).toBe(true);
    expect(f.bodies.map(body => body.system.split(" ").slice(0, 2).join(" "))).toEqual(["You index", "You plan", "You extract", "You write"]);
    // A resume reuses the transferred files: no new pipeline call, same files pinned, identity unchanged.
    const again = await new GeneralAgentSession(options(f, "job-research", runs)).run();
    expect(again.status).toBe("submitted");
    expect(f.store.dispatches("job-research")).toHaveLength(4);
    expect(f.store.events("job-research").filter(event => event.type === "research_transfer")).toHaveLength(1);
  });

  it("propagates a failed stage as an incomplete session, writes nothing, and binds the budget into the identity", async () => {
    const f = await fixture(() => "not a plan"), runs: Run[] = [];
    const result = await new GeneralAgentSession(options(f, "job-noplan", runs)).run();
    expect(result).toMatchObject({ status: "incomplete", reason: "research_plan_invalid" });
    expect(runs).toHaveLength(0);
    expect(f.store.events("job-noplan").filter(event => event.type === "research_stage").map(event => event.stage)).toEqual(["index", "plan"]);
    expect(f.store.events("job-noplan").some(event => event.type === "research_transfer")).toBe(false);
    // The same job resumed with another reader budget is a different contract.
    const drift = options(f, "job-noplan", runs); drift.research = { ...drift.research!, budget: { ...RESEARCH_PIPELINE_BUDGET, extractionCalls: 3 } };
    expect(await new GeneralAgentSession(drift).run()).toMatchObject({ status: "incomplete", reason: "session_contract_drift" });
  });

  it("refuses a cloud-shaped planner on a private lineage at the broker, stops the stage with the denial code, and dispatches nothing to it", async () => {
    const f = await fixture(), runs: Run[] = [], config = options(f, "job-private", runs, "private-model");
    delete config.syntheticInputApproval;  // a labelled job: private lineage, no synthetic approval
    config.research = { models: contextId => ({ reader: new PrivateAgentModel(f.broker, { destinationId: "private-model", model: "fixture", maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" }, "job-private", contextId),
      planner: new PrivateAgentModel(f.broker, { destinationId: "model", model: "fixture", maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" }, "job-private", contextId),
      synthesiser: new PrivateAgentModel(f.broker, { destinationId: "model", model: "fixture", maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" }, "job-private", contextId) }) };
    const result = await new GeneralAgentSession(config).run();
    expect(result).toMatchObject({ status: "incomplete", reason: "research_request_denied" });
    expect(runs).toHaveLength(0);
    const stages = f.store.events("job-private").filter(event => event.type === "research_stage");
    expect(stages.map(event => [event.stage, event.calls, event.denied])).toEqual([["index", 1, undefined], ["plan", 0, "synthetic_destination_private_data_denied"]]);
    expect(f.store.dispatches("job-private").map(row => row.destinationId)).toEqual(["private-model"]);
    expect(f.bodies).toHaveLength(1);
  });

  it("refuses a session whose request pool cannot hold the reader's budget and the writer's calls", async () => {
    const f = await fixture(), config = options(f, "job-small", []);
    config.limits = { maxRequests: 100, maxElapsedMs: 1_800_000 };  // reader 68 + writer 40 = 108 > 100
    expect(await new GeneralAgentSession(config).run()).toMatchObject({ status: "incomplete", reason: "session_limits_invalid" });
    expect(f.bodies).toHaveLength(0);
    config.limits = { maxRequests: 108, maxElapsedMs: 1_800_000 };
    expect(await new GeneralAgentSession(config).run()).toMatchObject({ status: "submitted" });
  });

  it("honours pause during the stage and reserves the stage's output paths before any call", async () => {
    const f = await fixture(), runs: Run[] = [], config = options(f, "job-pause", runs);
    const session = new GeneralAgentSession(config);
    f.hooks.onRequest = system => { if (system.startsWith("You plan")) session.pause(); };
    const paused = await session.run();
    expect(paused).toMatchObject({ status: "paused", reason: "research_cancelled" });
    expect(runs).toHaveLength(0);
    expect(f.store.events("job-pause").some(event => event.type === "research_transfer")).toBe(false);
    f.hooks.onRequest = undefined;
    // The paused call left no settled receipt the stage could reuse; the resume restarts the stage or refuses to replay past an unresolved row.
    const resumed = await new GeneralAgentSession(options(f, "job-pause", runs)).run();
    expect(["submitted", "incomplete"]).toContain(resumed.status);
    if (resumed.status === "incomplete") expect(resumed.reason).toBe("unresolved_dispatch_no_replay");
    const reserved = options(f, "job-reserved", []);
    reserved.privatePhase = { ...reserved.privatePhase, files: [...reserved.privatePhase.files, { path: RESEARCH_FILES.evidence, bytes: Buffer.from("{}") }] };
    expect(() => new GeneralAgentSession(reserved)).toThrow("session_research_paths_reserved");
  });

  it("leaves a session without the stage byte-for-byte unchanged: no reader context, no research events", async () => {
    const f = await fixture(), runs: Run[] = [], config = options(f, "job-plain", runs);
    delete config.research;
    expect(await new GeneralAgentSession(config).run()).toMatchObject({ status: "submitted" });
    const start = f.store.events("job-plain").find(event => event.type === "session_started")!;
    expect(start).not.toHaveProperty("readerContextId");
    expect(f.store.events("job-plain").some(event => String(event.type).startsWith("research_"))).toBe(false);
    expect(runs[0]!.files).not.toContain(RESEARCH_FILES.evidence); expect(runs[0]!.goal).not.toContain("reading stage");
  });
});
