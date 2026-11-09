import Database from "better-sqlite3";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { BROKER_RETRY_BACKOFF_MS, BrokerError, PrivateAgentBroker, type BrokerDestination } from "../../src/main/private-agent/broker";
import { PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE } from "../../src/main/private-agent/dispatch-purposes";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { diagnosticRetention, digest, restrictedContext } from "../../src/main/private-agent/contracts";
import { GeneralAgentSession, RESEARCH_TRANSFER_CHECK_ID, researchStageUnfinished, sessionPhaseIdentity, type GeneralSessionOptions, type SessionPhase } from "../../src/main/private-agent/session";
import { RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET, type ResearchDiagnostic } from "../../src/main/private-agent/research-pipeline";
import { researchV4Reply } from "../helpers/research-v4-fixture";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const done of cleanups.splice(0).reverse()) await done(); });
const imageId = `sha256:${"a".repeat(64)}`;
const SOURCE = "# Storage\nCapacity nearly doubled in 2024, from 15 GW to 29 GW.\n";
function phase(): SessionPhase {
  const files = [{ path: "input/corpus/a.md", bytes: Buffer.from(SOURCE) }, { path: "brief.md", bytes: Buffer.from("Write a cited briefing.") }];
  return { files, checks: [{ id: "structure", python: "# fixed fixture" }], contract: { version: 1, goal: "Write a cited briefing on storage from input/corpus.",
    requiredArtifacts: [{ path: "output/report.md", description: "report" }], requiredChecks: ["structure"], maxModelCalls: 40, maxToolCalls: 80, maxElapsedMs: 1_800_000 } };
}
/** A loopback model whose reply depends on the stage named by the system prompt; `planReply` lets a test break the plan; `onRequest` lets one pause mid-call. */
/** `recoverable` flags both destinations for owner decision D4's bounded retry; `onRequest` may return "destroy" to drop the socket before any reply, or "hold" to never answer. */
async function fixture(planReply?: () => string, options: { recoverable?: boolean } = {}) {
  const bodies: { system: string; user: string }[] = [];
  const hooks: { onRequest?: (system: string, request: http.IncomingMessage) => void | "destroy" | "hold"; onCloud?: (response: http.ServerResponse) => void } = {};
  const server = http.createServer((request, response) => {
    let raw = ""; request.on("data", chunk => { raw += chunk; }); request.on("end", () => {
      // The cloud destination (E1) never answers inside its timeout unless a test answers it itself.
      if (request.url?.startsWith("/cloud")) { hooks.onCloud?.(response); return; }
      const body = JSON.parse(raw) as { messages: { content: string }[] }, system = body.messages[0]!.content, user = body.messages[1]!.content;
      bodies.push({ system, user });
      const decision = hooks.onRequest?.(system, request);
      if (decision === "destroy") { request.socket.destroy(); return; }
      if (decision === "hold") return;
      const content = system.startsWith("You plan") && planReply ? planReply() : researchV4Reply(system, user);
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
  const base = { kind: "local_model" as const, endpoint: `${endpoint}/v1/chat/completions`, accountId: "fixture", credentialVersion: 0, loopbackFixture: true, timeoutMs: 2000, maxResponseBytes: 65536,
    ...(options.recoverable ? { recoverable: true } : {}) };
  // "model" admits synthetic lineage only (the shape of a cloud destination); "private-model" admits private data (the owned local server).
  const destinations: BrokerDestination[] = [{ id: "model", ...base, privateDataAdmitted: false, syntheticOnly: true }, { id: "private-model", ...base, privateDataAdmitted: true },
    // A priced cloud planner on loopback (backlog item 6): a pause that aborts its call leaves the row unknown.
    { id: "priced-planner", kind: "cloud_model", endpoint: base.endpoint, accountId: "fixture", credentialVersion: 1, loopbackFixture: true, timeoutMs: 2000, maxResponseBytes: 65536,
      privateDataAdmitted: false, syntheticOnly: true, grantFreeSynthetic: true },
    // A grant-free synthetic cloud destination like the headless driver's split arm, used only by the assist emulation (E1, gate clause 3).
    { id: "cloud", kind: "cloud_model", endpoint: `${endpoint}/cloud/v1/messages`, accountId: "fixture-cloud", credentialVersion: 0, privateDataAdmitted: false, syntheticOnly: true,
      grantFreeSynthetic: true, loopbackFixture: true, timeoutMs: 200, maxResponseBytes: 65536 }];
  const broker = new PrivateAgentBroker(store, destinations, { scan: async () => ({ complete: true, blocked: false, detector: "deliberate-false-negative-fixture" }) });
  return { store, broker, root, bodies, hooks };
}
type Run = { files: string[]; goal: string; checks: string[]; required: string[]; restricted: boolean; initialEvidence?: string };
/** The research stage events of a job as [stage, calls, denied]: every call the stage stops records one, even before its row is committed. */
const stageEvents = (store: PrivateAgentStore, jobId: string) => store.events(jobId).filter(event => event.type === "research_stage").map(event => [event.stage, event.calls, event.denied]);
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
      runs.push({ files: input.files.map(file => file.path), goal: input.contract.goal, checks: input.checks.map(check => check.id), required: input.contract.requiredChecks, restricted: restrictedContext(f.store.context(input.contextId)), initialEvidence: input.initialEvidence?.rendered });
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
    expect(run.goal).toContain("A host-run research stage"); expect(run.goal).toContain(RESEARCH_FILES.evidence); expect(run.goal).toContain("initial untrusted evidence");
    expect(run.required).toContain(RESEARCH_TRANSFER_CHECK_ID); expect(run.checks).toContain(RESEARCH_TRANSFER_CHECK_ID);
    expect(run.restricted).toBe(true);
    expect(run.initialEvidence).toContain("BEGIN HOST-RETAINED RESEARCH DATA");
    expect(run.initialEvidence).toContain("Capacity nearly doubled in 2024");
    expect(run.goal).not.toContain("BEGIN HOST-RETAINED RESEARCH DATA");
    const events = f.store.events("job-research");
    const start = events.find(event => event.type === "session_started")!;
    expect(start.readerContextId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(start.readerContextId).not.toBe(start.privateContextId); expect(start.readerContextId).not.toBe(start.publicContextId);
    const stages = events.filter(event => event.type === "research_stage");
    expect(stages.map(event => event.stage)).toEqual(["index", "plan", "extract", "synthesise"]);
    expect(stages.every(event => event.contextId === start.readerContextId && event.denied === undefined)).toBe(true);
    expect(JSON.stringify(stages)).not.toContain("doubled");
    const transfer = events.find(event => event.type === "research_transfer")!;
    expect(events.findIndex(event => event.type === "research_input")).toBeLessThan(events.findIndex(event => event.type === "research_stage"));
    expect((transfer.binding as { producer: { kind: string; receipts: unknown[] } }).producer).toMatchObject({ kind: "session", receipts: expect.any(Array) });
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

  it("passes the original shared deadline to the writer after research and a pause/resume", async () => {
    const f = await fixture(), runs: Run[] = [], config = options(f, "job-shared-time", runs);
    let monotonic = 1_000, wall = Date.now();
    vi.spyOn(performance, "now").mockImplementation(() => monotonic);
    vi.spyOn(Date, "now").mockImplementation(() => wall);
    f.hooks.onRequest = () => { monotonic += 100_000; wall += 100_000; };
    const observed: { deadline: number | undefined; remaining: number }[] = [];
    config.trustedHostRunnerFactory = input => ({ pause() {}, cancel() {}, async run(signal) {
      expect(signal?.aborted).toBe(false);
      observed.push({ deadline: input.sessionDeadlineMs, remaining: input.sessionDeadlineMs! - performance.now() });
      return { status: "paused", reason: "checkpoint_saved", snapshot: [], checks: [], modelCalls: 0 };
    } });
    expect(await new GeneralAgentSession(config).run()).toMatchObject({ status: "paused" });
    expect(f.bodies).toHaveLength(4);  // Real pipeline, synthetic loopback replies only.
    expect(observed).toEqual([{ deadline: 1_801_000, remaining: 1_400_000 }]);
    monotonic += 500_000; wall += 500_000;
    expect(await new GeneralAgentSession(config).run()).toMatchObject({ status: "paused" });
    expect(f.bodies).toHaveLength(4);  // The retained research packet is not regenerated.
    expect(observed[1]).toEqual({ deadline: 1_801_000, remaining: 900_000 });
    expect(f.store.events(config.jobId).filter(event => event.type === "session_started")).toHaveLength(1);
  });

  it("propagates a failed stage as an incomplete session, writes nothing, and binds the budget into the identity", async () => {
    const f = await fixture(() => "not a plan"), runs: Run[] = [];
    const result = await new GeneralAgentSession(options(f, "job-noplan", runs)).run();
    expect(result).toMatchObject({ status: "incomplete", reason: "research_plan_invalid" });
    expect(runs).toHaveLength(0);
    expect(f.store.events("job-noplan").filter(event => event.type === "research_stage").map(event => event.stage)).toEqual(["index", "plan"]);
    expect(f.store.events("job-noplan").some(event => event.type === "research_transfer")).toBe(false);
    const spent = f.store.dispatches("job-noplan").length;
    expect(f.store.dispatches("job-noplan").every(row => row.status === "settled")).toBe(true);
    expect(await new GeneralAgentSession(options(f, "job-noplan", runs)).run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(f.store.dispatches("job-noplan")).toHaveLength(spent);
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

  it("backlog item 6 (A7): a pause after a settled stage call ends the task incomplete at once, never paused, and the next run refuses the same way", async () => {
    const f = await fixture(), runs: Run[] = [], config = options(f, "job-settled-pause", runs);
    const make = config.research!.models;
    let session: GeneralAgentSession;
    config.research = { ...config.research!, models: contextId => {
      const models = make(contextId), complete = models.reader.complete.bind(models.reader);
      models.reader.complete = async (...args) => { const reply = await complete(...args); session.pause(); return reply; };
      return models;
    } };
    session = new GeneralAgentSession(config);
    expect(await session.run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    // The planner's call is refused before dispatch: no row was aborted, and the stopped call still records its stage event.
    expect(f.store.dispatches(config.jobId)).toMatchObject([{ status: "settled" }]);
    expect(stageEvents(f.store, config.jobId)).toEqual([["index", 1, undefined], ["plan", 0, "cancelled"]]);
    expect(researchStageUnfinished(f.store.events(config.jobId), f.store.dispatches(config.jobId))).toBe(true);
    expect(await new GeneralAgentSession(options(f, config.jobId, runs)).run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(f.store.dispatches(config.jobId)).toHaveLength(1); expect(f.bodies).toHaveLength(1); expect(runs).toHaveLength(0);
  });

  it("backlog item 6 (A7): a pause mid-call ends the task incomplete, its aborted zero-fee row failed and never unknown, and reserves the stage's paths before any call", async () => {
    const f = await fixture(), runs: Run[] = [], config = options(f, "job-pause", runs);
    const session = new GeneralAgentSession(config);
    f.hooks.onRequest = system => { if (system.startsWith("You plan")) session.pause(); };
    expect(await session.run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(runs).toHaveLength(0);
    expect(f.store.dispatches("job-pause").map(row => [row.purpose, row.status])).toEqual([["research source index", "settled"], ["research plan", "failed"]]);
    expect(f.store.dispatches("job-pause")[1]!.failure).toMatchObject({ code: "cancelled" });
    expect(stageEvents(f.store, "job-pause")).toEqual([["index", 1, undefined], ["plan", 0, "cancelled"]]);
    expect(f.store.events("job-pause").some(event => event.type === "research_transfer")).toBe(false);
    f.hooks.onRequest = undefined;
    const sent = f.bodies.length;
    expect(await new GeneralAgentSession(options(f, "job-pause", runs)).run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(f.store.dispatches("job-pause")).toHaveLength(2); expect(f.bodies).toHaveLength(sent); expect(runs).toHaveLength(0);
    const reserved = options(f, "job-reserved", []);
    reserved.privatePhase = { ...reserved.privatePhase, files: [...reserved.privatePhase.files, { path: RESEARCH_FILES.evidence, bytes: Buffer.from("{}") }] };
    expect(() => new GeneralAgentSession(reserved)).toThrow("session_research_paths_reserved");
  });

  it("D14: a stage whose extraction call was retried once still reaches the writer, and the producer binds the superseded row uncounted", async () => {
    const f = await fixture(undefined, { recoverable: true }), runs: Run[] = [], config = options(f, "job-retried", runs);
    let dropped = false;
    // The first extraction request is cut after it was sent: a confirmed upstream_closed on a zero-fee packet, retried once by the broker (D4).
    f.hooks.onRequest = system => { if (system.startsWith("You extract") && !dropped) { dropped = true; return "destroy"; } return undefined; };
    const result = await new GeneralAgentSession(config).run();
    expect(result).toMatchObject({ status: "submitted" });
    expect(runs).toHaveLength(1);
    const rows = f.store.dispatches("job-retried");
    expect(rows.map(row => [row.purpose, row.status])).toEqual([["research source index", "settled"], ["research plan", "settled"],
      ["research evidence extraction", "superseded"], ["research evidence extraction", "settled"], ["research synthesis", "settled"]]);
    expect(rows[2]!.failure).toMatchObject({ phase: "transport", code: "upstream_closed", attempt: 1 });
    const stages = f.store.events("job-retried").filter(event => event.type === "research_stage");
    expect(stages.map(event => [event.stage, event.calls])).toEqual([["index", 1], ["plan", 1], ["extract", 1], ["synthesise", 1]]);
    const transfer = f.store.events("job-retried").find(event => event.type === "research_transfer")!;
    const producer = (transfer.binding as { producer: { receipts: { id: string; stage: string; status?: string }[] } }).producer;
    expect(producer.receipts.map(receipt => [receipt.stage, receipt.status])).toEqual([["index", undefined], ["plan", undefined], ["extract", "superseded"], ["extract", undefined], ["synthesise", undefined]]);
    expect(producer.receipts.map(receipt => receipt.id)).toEqual(rows.map(row => row.id));
    // A resume re-validates the same producer against the ledger and reuses the packet without another stage call.
    expect(await new GeneralAgentSession(options(f, "job-retried", runs)).run()).toMatchObject({ status: "submitted" });
    expect(f.store.dispatches("job-retried")).toHaveLength(5); expect(f.bodies).toHaveLength(5);
  }, 20_000);

  it("leaves a session without the stage byte-for-byte unchanged: no reader context, no research events", async () => {
    const f = await fixture(), runs: Run[] = [], config = options(f, "job-plain", runs);
    delete config.research;
    expect(await new GeneralAgentSession(config).run()).toMatchObject({ status: "submitted" });
    const start = f.store.events("job-plain").find(event => event.type === "session_started")!;
    expect(start).not.toHaveProperty("readerContextId");
    expect(f.store.events("job-plain").some(event => String(event.type).startsWith("research_"))).toBe(false);
    expect(runs[0]!.files).not.toContain(RESEARCH_FILES.evidence); expect(runs[0]!.goal).not.toContain("reading stage");
  });

  it("backlog item 4: forwards the diagnostics sink for a synthetic-attested job and withholds it for a labelled one, with no other difference in events or receipts", async () => {
    const f = await fixture(() => "not a plan");
    const retained: ResearchDiagnostic[] = [], withheld: ResearchDiagnostic[] = [];
    // The headless driver's shape: private sources under the synthetic attestation, so the reader context's retention is raw.
    const synthetic = options(f, "job-raw", []); synthetic.research = { ...synthetic.research!, diagnostics: { retain: entry => retained.push(entry) } };
    expect(await new GeneralAgentSession(synthetic).run()).toMatchObject({ status: "incomplete", reason: "research_plan_invalid" });
    expect(retained.map(entry => [entry.stage, entry.ordinal, entry.purpose, entry.content])).toEqual([["plan", 1, "research plan", "not a plan"], ["plan", 2, "research plan", "not a plan"]]);
    expect(retained.every(entry => entry.reasons.length === 1 && entry.reasons[0]!.code === "invalid_json")).toBe(true);
    // A labelled job: private lineage without the attestation, every role on the destination that admits private data; the sink is never called.
    const labelled = options(f, "job-labelled", [], "private-model"); delete labelled.syntheticInputApproval;
    labelled.research = { ...labelled.research!, diagnostics: { retain: entry => withheld.push(entry) } };
    expect(await new GeneralAgentSession(labelled).run()).toMatchObject({ status: "incomplete", reason: "research_plan_invalid" });
    expect(withheld).toEqual([]);
    const reader = (jobId: string) => String(f.store.events(jobId).find(event => event.type === "session_started")!.readerContextId);
    expect(diagnosticRetention(f.store.context(reader("job-raw")))).toBe("raw"); expect(diagnosticRetention(f.store.context(reader("job-labelled")))).toBe("hash_only");
    // Beside the sink, nothing differs: the same stage events (hash-only, no reply text) and the same receipts, purpose for purpose.
    const stages = (jobId: string) => f.store.events(jobId).filter(event => event.type === "research_stage").map(({ contextId: _context, ...rest }) => rest);
    expect(stages("job-labelled")).toEqual(stages("job-raw")); expect(JSON.stringify(stages("job-raw"))).not.toContain("not a plan");
    const rows = (jobId: string) => f.store.dispatches(jobId).map(row => [row.purpose, row.status, row.responseSha256]);
    expect(rows("job-labelled")).toEqual(rows("job-raw")); expect(rows("job-raw")).toHaveLength(3);
    // A sink is no part of the session identity: the same job without one starts with the same identity and records the same events.
    const plain = options(f, "job-plain-sink", []);
    expect(await new GeneralAgentSession(plain).run()).toMatchObject({ reason: "research_plan_invalid" });
    const start = (jobId: string) => f.store.events(jobId).find(event => event.type === "session_started")!;
    expect(start("job-plain-sink").identity).toBe(start("job-raw").identity); expect(stages("job-plain-sink")).toEqual(stages("job-raw"));
  });

  it("backlog item 6 (A7): a pause before the stage starts (the session's own check) stays paused with nothing spent, and the next run executes the whole stage", async () => {
    const f = await fixture(), runs: Run[] = [], config = options(f, "job-early-pause", runs);
    const session = new GeneralAgentSession(config), append = f.store.append.bind(f.store);
    // The pause lands as the stage's input is recorded, before the session's last check ahead of the stage.
    vi.spyOn(f.store, "append").mockImplementation((jobId, event) => { const out = append(jobId, event); if (event.type === "research_input") session.pause(); return out; });
    expect(await session.run()).toMatchObject({ status: "paused", reason: "session_stopped" });
    vi.restoreAllMocks();
    expect(f.store.dispatches("job-early-pause")).toEqual([]); expect(stageEvents(f.store, "job-early-pause")).toEqual([]);
    expect(f.store.events("job-early-pause").some(event => event.type === "research_input")).toBe(true);
    expect(researchStageUnfinished(f.store.events("job-early-pause"), f.store.dispatches("job-early-pause"))).toBe(false);
    expect(await new GeneralAgentSession(options(f, "job-early-pause", runs)).run()).toMatchObject({ status: "submitted" });
    expect(f.store.dispatches("job-early-pause")).toHaveLength(4); expect(runs).toHaveLength(1);
    expect(stageEvents(f.store, "job-early-pause").map(([stage]) => stage)).toEqual(["index", "plan", "extract", "synthesise"]);
  });

  it("limitation until backlog items 7 and 8: a pause inside the stage before its first request is committed still ends the task, with nothing sent", async () => {
    const f = await fixture(), runs: Run[] = [], config = options(f, "job-uncommitted-pause", runs);
    const make = config.research!.models;
    let session: GeneralAgentSession;
    // The pause lands as the stage's first call begins, before the broker commits its row, as a pause during a cloud call's scan or
    // local token admission would: the stopped call records a stage event, so the stage has started.
    config.research = { ...config.research!, models: contextId => {
      const models = make(contextId), complete = models.reader.complete.bind(models.reader);
      models.reader.complete = async (...args) => { session.pause(); return complete(...args); };
      return models;
    } };
    session = new GeneralAgentSession(config);
    expect(await session.run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(f.store.dispatches(config.jobId)).toEqual([]); expect(f.bodies).toHaveLength(0);
    expect(stageEvents(f.store, config.jobId)).toEqual([["index", 0, "cancelled"]]);
    expect(await new GeneralAgentSession(options(f, config.jobId, runs)).run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(f.store.dispatches(config.jobId)).toEqual([]); expect(f.bodies).toHaveLength(0); expect(runs).toHaveLength(0);
  });

  it("backlog item 6 (A7): a cancel or an external abort mid-stage keeps its result, a failure while a pause was pending keeps its own reason, and each next run ends as pinned", async () => {
    const f = await fixture(), cancelled = options(f, "job-cancel", []);
    const session = new GeneralAgentSession(cancelled);
    f.hooks.onRequest = system => { if (system.startsWith("You plan")) session.cancel(); };
    expect(await session.run()).toMatchObject({ status: "incomplete", reason: "session_cancelled" });
    const aborted = options(f, "job-abort", []), controller = new AbortController();
    f.hooks.onRequest = system => { if (system.startsWith("You plan")) controller.abort(); };
    expect(await new GeneralAgentSession(aborted).run(controller.signal)).toMatchObject({ status: "incomplete", reason: "research_cancelled" });
    // A pause and an external abort at the same moment: the pause branch applies, so the run ends with the next run's refusal.
    const both = options(f, "job-pause-abort", []), stop = new AbortController(), pausing = new GeneralAgentSession(both);
    f.hooks.onRequest = system => { if (system.startsWith("You plan")) { stop.abort(); pausing.pause(); } };
    expect(await pausing.run(stop.signal)).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    f.hooks.onRequest = undefined;
    const sent = f.bodies.length;
    // A cancel changed the job's policy, so every later run ends cancelled; an aborted stage started and cannot continue.
    expect(await new GeneralAgentSession(options(f, "job-cancel", [])).run()).toMatchObject({ status: "incomplete", reason: "session_cancelled" });
    expect(await new GeneralAgentSession(options(f, "job-abort", [])).run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(f.bodies).toHaveLength(sent);
    // An invalid plan while a pause was pending (asked after the planner's last reply, so nothing was cut) is that failure, not a pause.
    const g = await fixture(() => "not a plan"), invalid = options(g, "job-invalid", []), make = invalid.research!.models;
    let paused: GeneralAgentSession, replies = 0;
    invalid.research = { ...invalid.research!, models: contextId => {
      const models = make(contextId), complete = models.planner.complete.bind(models.planner);
      models.planner.complete = async (...args) => { const reply = await complete(...args); if (++replies === 2) paused.pause(); return reply; };
      return models;
    } };
    paused = new GeneralAgentSession(invalid);
    expect(await paused.run()).toMatchObject({ status: "incomplete", reason: "research_plan_invalid" });
    expect(replies).toBe(2);  // the pause was asked, after the planner's last reply
    expect(await new GeneralAgentSession(options(g, "job-invalid", [])).run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
  });

  it("backlog item 6 (A7): a settled reader row with no stage event (a crash during the index stage) is refused by the next run with nothing sent", async () => {
    const f = await fixture(), runs: Run[] = [], config = options(f, "job-rows-only", runs);
    const session = new GeneralAgentSession(config), append = f.store.append.bind(f.store);
    vi.spyOn(f.store, "append").mockImplementation((jobId, event) => { const out = append(jobId, event); if (event.type === "research_input") session.pause(); return out; });
    expect(await session.run()).toMatchObject({ status: "paused", reason: "session_stopped" });
    vi.restoreAllMocks();
    // A stage records its event at its end or on a denial, so an index stage of several calls that crashed after one leaves only that row.
    const reader = String(f.store.events("job-rows-only").find(event => event.type === "session_started")!.readerContextId);
    const { text: _text, ...preview } = f.broker.preview({ jobId: "job-rows-only", contextId: reader, destinationId: "model", purpose: "research source index", method: "POST", body: "{}", maxFeeMicrousd: 0 });
    f.store.settle(f.store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_for_synthetic_local_test" } }, () => {}).id, 0, digest("reply"));
    expect(stageEvents(f.store, "job-rows-only")).toEqual([]);
    const sent = f.bodies.length;
    expect(await new GeneralAgentSession(options(f, "job-rows-only", runs)).run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(f.bodies).toHaveLength(sent); expect(runs).toHaveLength(0);
  });

  it("backlog item 6 (A7): the defensive paused arm: a pause between the session's check and the pipeline's entry stays paused, and the next run executes the stage whole", async () => {
    // No production caller can pause there (pause() always runs in its own event-loop task); a synchronous pause inside the stage's set-up can.
    const f = await fixture(), runs: Run[] = [], config = options(f, "job-defensive", runs);
    config.research = { ...config.research!, diagnostics: { retain() {} } };
    const session = new GeneralAgentSession(config), append = f.store.append.bind(f.store), context = f.store.context.bind(f.store);
    let armed = false;
    vi.spyOn(f.store, "append").mockImplementation((jobId, event) => { const out = append(jobId, event); if (event.type === "research_input") armed = true; return out; });
    vi.spyOn(f.store, "context").mockImplementation(id => { const out = context(id); if (armed) { armed = false; session.pause(); } return out; });
    expect(await session.run()).toMatchObject({ status: "paused", reason: "session_stopped" });
    vi.restoreAllMocks();
    expect(stageEvents(f.store, "job-defensive")).toEqual([]); expect(f.store.dispatches("job-defensive")).toEqual([]);
    const again = options(f, "job-defensive", runs); again.research = { ...again.research!, diagnostics: { retain() {} } };
    expect(await new GeneralAgentSession(again).run()).toMatchObject({ status: "submitted" });
  });

  it("researchStageUnfinished holds only for a stage that started and never transferred", () => {
    const input = { type: "research_input", contextId: "reader" }, stage = { type: "research_stage", contextId: "reader" }, transfer = { type: "research_transfer", contextId: "reader" };
    expect(researchStageUnfinished([], [])).toBe(false);
    expect(researchStageUnfinished([input], [])).toBe(false);
    expect(researchStageUnfinished([input, stage], [])).toBe(true);
    expect(researchStageUnfinished([input], [{ contextId: "reader" }])).toBe(true);
    expect(researchStageUnfinished([input], [{ contextId: "writer" }])).toBe(false);
    expect(researchStageUnfinished([input, { type: "research_stage", contextId: "writer" }], [])).toBe(false);
    expect(researchStageUnfinished([input, stage, transfer], [{ contextId: "reader" }])).toBe(false);
    expect(researchStageUnfinished([stage], [{ contextId: "reader" }])).toBe(false);
    // A call stopped before its row was committed records a zero-call stage event: the stage has started.
    expect(researchStageUnfinished([input, { type: "research_stage", contextId: "reader", stage: "index", calls: 0, denied: "cancelled" }], [])).toBe(true);
    // A public phase's rows sit in their own context, recorded before the stage's input.
    expect(researchStageUnfinished([input], [{ contextId: "public" }])).toBe(false);
  });

  it("pinned until backlog item 10.b retires the plain-purpose split arm (E1 bug (b)): a pause aborts a priced stage call at once, leaving its row unknown, and the task ends unresolved_dispatch_no_replay", async () => {
    const f = await fixture(), runs: Run[] = [], config = options(f, "job-priced-pause", runs);
    const priced = { destinationId: "priced-planner", model: "fixture", maxOutputTokens: 4096, inputUsdPerMillion: 1, outputUsdPerMillion: 1, thinking: "disabled" as const };
    const local = config.research!.models;
    config.research = { ...config.research!, models: contextId => ({ ...local(contextId), planner: new PrivateAgentModel(f.broker, priced, config.jobId, contextId) }) };
    config.cloudArm = { destinationId: "priced-planner", maxFeeMicrousd: 8_000_000 };
    const session = new GeneralAgentSession(config);
    f.hooks.onRequest = system => { if (system.startsWith("You plan")) session.pause(); };
    expect(await session.run()).toMatchObject({ status: "incomplete", reason: "unresolved_dispatch_no_replay" });
    expect(f.store.dispatches(config.jobId).map(row => [row.purpose, row.status])).toEqual([["research source index", "settled"], ["research plan", "unknown"]]);
    // The request was on the wire when the pause aborted it; its reservation stays counted for the job's life.
    const plan = f.store.dispatches(config.jobId)[1]!;
    expect(plan.failure).toMatchObject({ code: "cancelled" }); expect(plan.reservedFeeMicrousd).toBeGreaterThan(0);
    f.hooks.onRequest = undefined;
    const sent = f.bodies.length;
    expect(await new GeneralAgentSession(config).run()).toMatchObject({ status: "incomplete", reason: "unresolved_dispatch_no_replay" });
    expect(f.bodies).toHaveLength(sent); expect(runs).toHaveLength(0);
  });
});

describe("E1 recoverability: a research stage stopped mid-call on the real broker (S1)", () => {
  const stages = [["index", "You index"], ["plan", "You plan"], ["extract", "You extract"], ["synthesise", "You write"]] as const;
  const purposes = { index: "research source index", plan: "research plan", extract: "research evidence extraction", synthesise: "research synthesis" } as const;
  type Mode = "cancel" | "external abort" | "session deadline";
  /** The fixture's phase with a second source, so the extraction stage makes two calls, one per source's chunk. */
  function withSecondSource(config: GeneralSessionOptions): GeneralSessionOptions {
    const privatePhase = { ...config.privatePhase, files: [...config.privatePhase.files, { path: "input/corpus/b.md", bytes: Buffer.from("# Prices\nPack prices fell by a fifth in 2024, to 115 USD per kWh.\n") }] };
    return { ...config, privatePhase, syntheticInputApproval: { ...config.syntheticInputApproval!, privatePhaseSha256: sessionPhaseIdentity(privatePhase) } };
  }
  /**
   * Runs a session whose `nth` call at `stage` is held open and stopped by `mode`; returns what a test asserts on, and a resume. With
   * `nth` 2 the phase has a second source, so the stop falls on the extraction stage's second call.
   */
  async function stoppedAt(stage: (typeof stages)[number], mode: Mode, nth = 1) {
    const f = await fixture(), runs: Run[] = [], jobId = `job-${mode.replace(" ", "-")}-${stage[0]}-${nth}`;
    const phaseOf = (config: GeneralSessionOptions) => nth > 1 ? withSecondSource(config) : config, config = phaseOf(options(f, jobId, runs));
    if (mode === "session deadline") config.limits = { ...config.limits!, maxElapsedMs: 400 };
    const session = new GeneralAgentSession(config), external = new AbortController();
    let seen = 0;
    f.hooks.onRequest = system => {
      if (!system.startsWith(stage[1]) || ++seen < nth) return undefined;
      if (mode === "cancel") session.cancel(); else if (mode === "external abort") external.abort();
      return "hold";
    };
    const result = await session.run(external.signal);
    f.hooks.onRequest = undefined;
    const sent = f.bodies.length, rows = f.store.dispatches(jobId);
    const stageEvents = f.store.events(jobId).filter(event => event.type === "research_stage");
    // The resume keeps the same phase and limits: they are part of the session's identity.
    const again = phaseOf(options(f, jobId, runs)); again.limits = config.limits;
    const resumed = await new GeneralAgentSession(again).run();
    return { f, jobId, runs, result, rows, stageEvents, sent, resumed };
  }
  /** The run's own outcome and the resume's, per stop: a cancel ends the job; an external abort or the session's deadline ends the run. */
  const outcomes: Record<Mode, [string, string]> = { cancel: ["session_cancelled", "session_cancelled"], "external abort": ["research_cancelled", "research_stage_not_replayed"],
    "session deadline": ["research_cancelled", "session_deadline"] };
  it.each(stages.flatMap(stage => (["cancel", "external abort", "session deadline"] as const).map(mode => [stage[0], mode, stage] as const)))(
    "%s, %s: the stopped call resolves failed with code cancelled, the stage records denied cancelled, the run ends, and a resume sends nothing again", async (name, mode, stage) => {
      const { f, jobId, runs, result, rows, stageEvents, sent, resumed } = await stoppedAt(stage, mode);
      expect(result).toMatchObject({ status: "incomplete", reason: outcomes[mode][0] }); expect(resumed).toMatchObject({ status: "incomplete", reason: outcomes[mode][1] });
      expect(rows.some(row => row.status === "unknown" || row.status === "committed")).toBe(false);
      expect(rows.at(-1)).toMatchObject({ purpose: purposes[name], status: "failed", failure: { phase: "transport", code: "cancelled" } });
      expect(rows.slice(0, -1).every(row => row.status === "settled")).toBe(true);
      expect(stageEvents.at(-1)).toMatchObject({ stage: name, denied: "cancelled" });
      expect(runs).toHaveLength(0);
      expect(f.bodies).toHaveLength(sent); expect(f.store.dispatches(jobId)).toHaveLength(rows.length);
    }, 20_000);
  it.each(["cancel", "external abort"] as const)("extract, %s on the second of two chunks: the first chunk's call stays settled, the stage records one call and denied cancelled, and a resume sends nothing again", async mode => {
    const { f, jobId, runs, result, rows, stageEvents, sent, resumed } = await stoppedAt(stages[2], mode, 2);
    expect(result).toMatchObject({ status: "incomplete", reason: outcomes[mode][0] }); expect(resumed).toMatchObject({ status: "incomplete", reason: outcomes[mode][1] });
    expect(rows.filter(row => row.purpose === purposes.extract).map(row => [row.status, row.failure?.code])).toEqual([["settled", undefined], ["failed", "cancelled"]]);
    expect(rows.some(row => row.status === "unknown" || row.status === "committed")).toBe(false);
    expect(stageEvents.at(-1)).toMatchObject({ stage: "extract", calls: 1, denied: "cancelled" });
    expect(runs).toHaveLength(0);
    expect(f.bodies).toHaveLength(sent); expect(f.store.dispatches(jobId)).toHaveLength(rows.length);
  }, 20_000);
});

describe("E1 recoverability: a research stage whose call the broker retried still reaches the writer (S2, D14, gate clause 2)", () => {
  // The extraction stage's own case is the D14 reproduction above; here the other three stages.
  const stages = [["index", "You index", "research source index"], ["plan", "You plan", "research plan"], ["synthesise", "You write", "research synthesis"]] as const;
  it.each(stages)("%s: one cut call is retried (D4), the writer is reached, the producer binds the superseded row uncounted, and a resume reuses the packet", async (name, prompt, purpose) => {
    const f = await fixture(undefined, { recoverable: true }), runs: Run[] = [], jobId = `job-retried-${name}`, config = options(f, jobId, runs);
    let cut = false;
    f.hooks.onRequest = system => { if (system.startsWith(prompt) && !cut) { cut = true; return "destroy"; } return undefined; };
    expect(await new GeneralAgentSession(config).run()).toMatchObject({ status: "submitted" });
    expect(runs).toHaveLength(1);
    const rows = f.store.dispatches(jobId);
    expect(rows.filter(row => row.status === "superseded").map(row => [row.purpose, row.failure?.code, row.failure?.attempt])).toEqual([[purpose, "upstream_closed", 1]]);
    expect(rows.every(row => row.status === "settled" || row.status === "superseded")).toBe(true);
    const stageEvents = f.store.events(jobId).filter(event => event.type === "research_stage");
    expect(stageEvents.map(event => [event.stage, event.calls, event.denied])).toEqual(["index", "plan", "extract", "synthesise"].map(stage => [stage, 1, undefined]));
    const transfer = f.store.events(jobId).find(event => event.type === "research_transfer")!;
    const receipts = (transfer.binding as { producer: { receipts: { id: string; stage: string; status?: string }[] } }).producer.receipts;
    expect(receipts.map(receipt => receipt.id)).toEqual(rows.map(row => row.id));
    expect(receipts.filter(receipt => receipt.status !== undefined)).toEqual([expect.objectContaining({ stage: name, status: "superseded" })]);
    const sent = f.bodies.length;
    expect(await new GeneralAgentSession(options(f, jobId, runs)).run()).toMatchObject({ status: "submitted" });
    expect(f.bodies).toHaveLength(sent); expect(f.store.dispatches(jobId)).toHaveLength(rows.length);
  }, 20_000);
  it("a cancel during the broker's D4 backoff ends the retry: the cut plan call resolves failed, nothing more is sent, and the stage records the cancel", async () => {
    const f = await fixture(undefined, { recoverable: true }), runs: Run[] = [], jobId = "job-backoff-cancel", session = new GeneralAgentSession(options(f, jobId, runs));
    let cut = false, cancelled = false;
    f.hooks.onRequest = system => { if (system.startsWith("You plan") && !cut) { cut = true; return "destroy"; } return undefined; };
    // The first 1,000 ms timer started after the cut is the broker's first D4 backoff (the destination's own timeout is 2,000 ms). The cancel
    // runs in the next microtask, so inside that wait, never after a guessed delay.
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: (...args: unknown[]) => void, timeout?: number, ...rest: unknown[]) => {
      if (cut && !cancelled && timeout === BROKER_RETRY_BACKOFF_MS[0]) { cancelled = true; queueMicrotask(() => session.cancel()); }
      return real(handler, timeout, ...rest);
    }) as unknown as typeof setTimeout);
    expect(await session.run()).toMatchObject({ status: "incomplete", reason: "session_cancelled" });
    expect(cancelled).toBe(true);
    expect(f.store.dispatches(jobId).map(row => [row.purpose, row.status, row.failure?.code, row.failure?.attempt])).toEqual([["research source index", "settled", undefined, undefined],
      ["research plan", "failed", "upstream_closed", 1]]);
    expect(f.bodies.map(body => body.system.split(" ").slice(0, 2).join(" "))).toEqual(["You index", "You plan"]);
    expect(f.store.events(jobId).filter(event => event.type === "research_stage").at(-1)).toMatchObject({ stage: "plan", calls: 0, denied: "cancelled" });
    expect(runs).toHaveLength(0);
    expect(await new GeneralAgentSession(options(f, jobId, runs)).run()).toMatchObject({ status: "incomplete", reason: "session_cancelled" });
    expect(f.bodies).toHaveLength(2); expect(f.store.dispatches(jobId)).toHaveLength(2);
  }, 20_000);
});

describe("E1 recoverability: known limitations of the research stage, pinned until the item that changes them", () => {
  it("pins the item-7 gap: a call whose retries are exhausted is final, the stage is denied request_failed with nothing unresolved, and a resume does not replay it", async () => {
    // BL-20261107-0809 decision 6: a denied call ends its stage, and item 7 must reconcile the failed-row binding with the ready-packet
    // check before a stage may continue after a failed call.
    const f = await fixture(undefined, { recoverable: true }), runs: Run[] = [], jobId = "job-exhausted-plan", config = options(f, jobId, runs);
    f.hooks.onRequest = system => system.startsWith("You plan") ? "destroy" : undefined;
    expect(await new GeneralAgentSession(config).run()).toMatchObject({ status: "incomplete", reason: "research_request_denied" });
    const rows = f.store.dispatches(jobId);
    expect(rows.filter(row => row.purpose === "research plan").map(row => [row.status, row.failure?.attempt])).toEqual([["superseded", 1], ["superseded", 2], ["failed", 3]]);
    expect(rows.some(row => row.status === "unknown" || row.status === "committed")).toBe(false);
    expect(f.store.events(jobId).filter(event => event.type === "research_stage").at(-1)).toMatchObject({ stage: "plan", denied: "request_failed" });
    expect(runs).toHaveLength(0);
    const sent = f.bodies.length;
    f.hooks.onRequest = undefined;
    expect(await new GeneralAgentSession(options(f, jobId, runs)).run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(f.bodies).toHaveLength(sent); expect(runs).toHaveLength(0);
  }, 20_000);
  it.each(["no answer", "external abort"] as const)("pins a limitation item 10's PR 10.b flips: the legacy split arm's cloud planner left UNKNOWN by %s stops the stage, and the job cannot resume", async mode => {
    // The split arm's planner calls the cloud with the plain `research plan` purpose, so its uncertain row blocks like any other. A cloud
    // call stopped mid-request is never a confirmed abort, so an external abort leaves it UNKNOWN too.
    const f = await fixture(), runs: Run[] = [], jobId = `job-split-${mode.replace(" ", "-")}`, config = options(f, jobId, runs), external = new AbortController();
    if (mode === "external abort") f.hooks.onCloud = () => external.abort();
    config.cloudArm = { destinationId: "cloud", maxFeeMicrousd: 1000 };
    const make = config.research!.models;
    const cloudPlanner = (contextId: string) => new PrivateAgentModel(f.broker, { destinationId: "cloud", model: "fixture", maxOutputTokens: 4096, inputUsdPerMillion: 0,
      outputUsdPerMillion: 0, thinking: "disabled" }, jobId, contextId);
    config.research = { ...config.research!, models: contextId => ({ ...make(contextId), planner: cloudPlanner(contextId) }) };
    expect(await new GeneralAgentSession(config).run(external.signal)).toMatchObject({ status: "incomplete", reason: mode === "no answer" ? "research_request_denied" : "research_cancelled" });
    expect(f.store.dispatches(jobId).map(row => [row.purpose, row.destinationId, row.status, row.failure?.code])).toEqual([["research source index", "model", "settled", undefined],
      ["research plan", "cloud", "unknown", mode === "no answer" ? "request_timeout" : "cancelled"]]);
    expect(f.store.events(jobId).filter(event => event.type === "research_stage").at(-1)).toMatchObject({ stage: "plan", denied: mode === "no answer" ? "transport_or_settlement_unknown" : "cancelled" });
    const again = options(f, jobId, runs); again.cloudArm = config.cloudArm; again.research = config.research;
    expect(await new GeneralAgentSession(again).run()).toMatchObject({ status: "incomplete", reason: "unresolved_dispatch_no_replay" });
    expect(runs).toHaveLength(0);
  }, 20_000);
});

describe("E1 recoverability: local work continues after a cloud assist stays UNKNOWN, emulated test-locally until 10.b (S4, gate clause 3)", () => {
  // Item 10's wrapper does not exist yet: here the planner and the synthesiser are wrapped in the test, the way it will call a sealed cloud
  // one-shot before the local stage call. Its PR (10.b) re-proves this end to end; this case proves the ledger, broker, session and producer
  // parts on the real broker.
  it("lets a plan assist that timed out stay unknown with its reservation pinned, refuses any later cloud call before a row, and reaches the writer", async () => {
    const f = await fixture(), runs: Run[] = [], jobId = "job-assist-unknown", config = options(f, jobId, runs);
    config.cloudArm = { destinationId: "cloud", maxFeeMicrousd: 1000 };
    const make = config.research!.models;
    const assist = (contextId: string, purpose: string) => f.broker.request({ jobId, contextId, destinationId: "cloud", purpose, method: "POST", body: "{\"assist\":true}", maxFeeMicrousd: 500 })
      .then(() => undefined, (error: unknown) => error);
    const refusals: unknown[] = [];
    config.research = { ...config.research!, models: contextId => {
      const models = make(contextId), plan = models.planner.complete.bind(models.planner), write = models.synthesiser.complete.bind(models.synthesiser);
      models.planner.complete = async (...args) => { refusals.push(await assist(contextId, PLAN_ASSIST_PURPOSE)); return plan(...args); };
      models.synthesiser.complete = async (...args) => { refusals.push(await assist(contextId, SYNTHESIS_ASSIST_PURPOSE)); return write(...args); };
      return models;
    } };
    expect(await new GeneralAgentSession(config).run()).toMatchObject({ status: "submitted" });
    expect(runs).toHaveLength(1);
    // The plan assist's outcome stayed uncertain; the synthesis assist was refused before any row existed.
    expect(refusals).toHaveLength(2);
    expect(refusals[0]).toBeInstanceOf(BrokerError); expect((refusals[0] as BrokerError).code).toBe("transport_or_settlement_unknown");
    expect(refusals[1]).toBeInstanceOf(BrokerError); expect((refusals[1] as BrokerError).code).toBe("cloud_after_assist_unknown");
    const rows = f.store.dispatches(jobId);
    const assists = rows.filter(row => row.destinationId === "cloud");
    expect(assists).toEqual([expect.objectContaining({ purpose: PLAN_ASSIST_PURPOSE, status: "unknown", reservedFeeMicrousd: 500, failure: expect.objectContaining({ code: "request_timeout" }) })]);
    expect(rows.filter(row => row.destinationId !== "cloud").every(row => row.status === "settled")).toBe(true);
    // The producer binds the skipped assist to its stage, uncounted, beside the plan stage's own call.
    const transfer = f.store.events(jobId).find(event => event.type === "research_transfer")!;
    const receipts = (transfer.binding as { producer: { receipts: { id: string; stage: string; status?: string; role?: string }[] } }).producer.receipts;
    expect(receipts.filter(receipt => receipt.role === "assist")).toEqual([expect.objectContaining({ id: assists[0]!.id, stage: "plan", role: "assist", status: "unknown" })]);
    // The reservation stays pinned: of the job's 1,000 fee cap exactly 500 are left, so a later row reserving 501 is refused and one reserving 500 is admitted.
    const reader = String(f.store.events(jobId).find(event => event.type === "session_started")!.readerContextId);
    const reserving = (fee: number) => { const { text: _text, ...packet } = f.broker.preview({ jobId, contextId: reader, destinationId: "model", purpose: "research evidence extraction", method: "POST", body: "{}", maxFeeMicrousd: fee });
      return () => f.store.commit({ ...packet, reservedFeeMicrousd: fee, scan: { status: "not_required_for_synthetic_local_test" } }, () => {}); };
    expect(reserving(501)).toThrow("private_agent_budget_denied");
    expect(reserving(500)()).toMatchObject({ status: "committed", reservedFeeMicrousd: 500 });
  }, 20_000);
});
