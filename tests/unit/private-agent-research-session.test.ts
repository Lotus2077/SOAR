import Database from "better-sqlite3";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { PrivateAgentBroker, type BrokerDestination } from "../../src/main/private-agent/broker";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { PrivateCheckpointStore, type WorkspaceSnapshot } from "../../src/main/private-agent/checkpoints";
import { CLAIMS_LEDGER_CHECK_ID } from "../../src/main/private-agent/claims";
import { diagnosticRetention, digest, restrictedContext } from "../../src/main/private-agent/contracts";
import { GeneralAgentSession, RESEARCH_TRANSFER_CHECK_ID, researchStageUnfinished, sessionPhaseIdentity, type GeneralSessionOptions, type SessionPhase } from "../../src/main/private-agent/session";
import { RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET, type ResearchDiagnostic } from "../../src/main/private-agent/research-pipeline";
import { RESEARCH_FALLBACK_POLICY } from "../../src/main/private-agent/research-fallback";
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
/**
 * A loopback model whose reply depends on the stage named by the system prompt; `reply` lets a test break a stage (since 7c a
 * broken plan falls back, so tests break extraction); `onRequest` lets one pause mid-call. The options are one object, so a
 * caller written for the old `fixture(() => "not a plan")` shape no longer compiles instead of silently breaking every stage.
 */
/** `recoverable` flags both destinations for owner decision D4's bounded retry; `onRequest` may return "destroy" to drop the socket before any reply. */
async function fixture(options: { reply?: (system: string) => string | undefined; recoverable?: boolean } = {}) {
  const bodies: { system: string; user: string }[] = [], hooks: { onRequest?: (system: string, request: http.IncomingMessage) => void | "destroy" } = {};
  const server = http.createServer((request, response) => {
    let raw = ""; request.on("data", chunk => { raw += chunk; }); request.on("end", () => {
      const body = JSON.parse(raw) as { messages: { content: string }[] }, system = body.messages[0]!.content, user = body.messages[1]!.content;
      bodies.push({ system, user }); if (hooks.onRequest?.(system, request) === "destroy") { request.socket.destroy(); return; }
      const content = options.reply?.(system) ?? researchV4Reply(system, user);
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
      privateDataAdmitted: false, syntheticOnly: true, grantFreeSynthetic: true }];
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

  it("records the write phase's host flags with the transferred packet's coverage and misses, once across a resume (BL-20261110-1509)", async () => {
    const f = await fixture(), runs: Run[] = [], written = phase();
    const claimsPhase: SessionPhase = { ...written, checks: [...written.checks, { id: CLAIMS_LEDGER_CHECK_ID, python: "# fixed fixture" }],
      contract: { ...written.contract, requiredChecks: [...written.contract.requiredChecks, CLAIMS_LEDGER_CHECK_ID] } };
    const config = { ...options(f, "job-research-flags", runs), privatePhase: claimsPhase,
      syntheticInputApproval: { privatePhaseSha256: sessionPhaseIdentity(claimsPhase), authoritySha256: digest("host-authored-fixture") } };
    expect((await new GeneralAgentSession(config).run()).status).toBe("submitted");
    const events = f.store.events("job-research-flags"), start = events.find(event => event.type === "session_started")!;
    const transfer = events.find(event => event.type === "research_transfer")!.binding as { snapshot: WorkspaceSnapshot };
    const coverage = new PrivateCheckpointStore(f.root, "job-research-flags").load(transfer.snapshot).find(file => file.path === RESEARCH_FILES.coverage)!;
    const flags = events.filter(event => event.type === "host_flags");
    expect(flags).toEqual([expect.objectContaining({ contextId: start.privateContextId, packet: { coverageSha256: digest(coverage.bytes) },
      misses: { briefUnits: 1, questionsWithoutEvidence: 0, unresolvedQuestions: 0, noEvidenceOutcomes: 0, extractionRetries: 0, droppedQuotes: 0, fetchFailures: 0, fetchLimitRefusals: 0 },
      report: expect.objectContaining({ scanned: true, hits: [] }), argument: expect.objectContaining({ scanned: true, hits: [] }) })]);
    expect(flags[0]!.counts).toMatchObject({ briefSingleUnit: 1, reportAbsence: 0, argumentAbsence: 0 });
    // The resume reloads the packet from the transfer and records nothing more.
    expect((await new GeneralAgentSession(config).run()).status).toBe("submitted");
    expect(f.store.events("job-research-flags").filter(event => event.type === "host_flags")).toEqual(flags);
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
    const f = await fixture({ reply: system => system.startsWith("You extract") ? "not an extraction" : undefined }), runs: Run[] = [];
    const result = await new GeneralAgentSession(options(f, "job-noplan", runs)).run();
    expect(result).toMatchObject({ status: "incomplete", reason: "research_extraction_incomplete" });
    expect(runs).toHaveLength(0);
    expect(f.store.events("job-noplan").filter(event => event.type === "research_stage").map(event => event.stage)).toEqual(["index", "plan", "extract"]);
    expect(f.store.events("job-noplan").some(event => event.type === "research_transfer")).toBe(false);
    const spent = f.store.dispatches("job-noplan").length;
    expect(f.store.dispatches("job-noplan").every(row => row.status === "settled")).toBe(true);
    expect(await new GeneralAgentSession(options(f, "job-noplan", runs)).run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(f.store.dispatches("job-noplan")).toHaveLength(spent);
    // The same job resumed with another reader budget is a different contract.
    const drift = options(f, "job-noplan", runs); drift.research = { ...drift.research!, budget: { ...RESEARCH_PIPELINE_BUDGET, extractionCalls: 3 } };
    expect(await new GeneralAgentSession(drift).run()).toMatchObject({ status: "incomplete", reason: "session_contract_drift" });
  });

  it("7c: a run whose every plan and synthesis reply is rejected reaches the writer with the host plan and the host skeleton, both disclosed", async () => {
    const f = await fixture({ reply: system => system.startsWith("You plan") ? "not a plan" : system.startsWith("You write") ? "not a synthesis" : undefined }), runs: Run[] = [];
    expect(await new GeneralAgentSession(options(f, "job-fallback", runs)).run()).toMatchObject({ status: "submitted" });
    expect(runs).toHaveLength(1);
    const stages = f.store.events("job-fallback").filter(event => event.type === "research_stage") as unknown as { stage: string; calls: number; fallback?: string }[];
    expect(stages.map(event => [event.stage, event.calls, event.fallback])).toEqual([["index", 1, undefined], ["plan", 2, "host_plan"], ["extract", 1, undefined], ["synthesise", 2, "skeleton"]]);
    // The writer reads the host plan and the skeleton from the packet, and coverage.json discloses both.
    const evidence = runs[0]!.initialEvidence!;
    expect(evidence).toContain("Host fallback question: what does the corpus establish for brief requirement U1?");
    expect(evidence).toContain(RESEARCH_FALLBACK_POLICY.skeleton.opening);
    const packet = JSON.parse(evidence.slice(evidence.indexOf("\n{") + 1, evidence.lastIndexOf("\nEND HOST-RETAINED RESEARCH DATA"))) as { files: { path: string; text: string }[] };
    expect(JSON.parse(packet.files.find(file => file.path === RESEARCH_FILES.coverage)!.text)).toMatchObject({ version: 2, fallbacks: { plan: "host_plan", synthesis: "skeleton" }, synthesis: { status: "skeleton" } });
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
    const f = await fixture({ recoverable: true }), runs: Run[] = [], config = options(f, "job-retried", runs);
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
    const f = await fixture({ reply: system => system.startsWith("You extract") ? "not an extraction" : undefined });
    const retained: ResearchDiagnostic[] = [], withheld: ResearchDiagnostic[] = [];
    // The headless driver's shape: private sources under the synthetic attestation, so the reader context's retention is raw.
    const synthetic = options(f, "job-raw", []); synthetic.research = { ...synthetic.research!, diagnostics: { retain: entry => retained.push(entry) } };
    expect(await new GeneralAgentSession(synthetic).run()).toMatchObject({ status: "incomplete", reason: "research_extraction_incomplete" });
    expect(retained.map(entry => [entry.stage, entry.ordinal, entry.purpose, entry.content])).toEqual([["extract", 1, "research evidence extraction", "not an extraction"], ["extract", 2, "research evidence extraction", "not an extraction"]]);
    expect(retained.every(entry => entry.reasons.length === 1 && entry.reasons[0]!.code === "invalid_json")).toBe(true);
    // A labelled job: private lineage without the attestation, every role on the destination that admits private data; the sink is never called.
    const labelled = options(f, "job-labelled", [], "private-model"); delete labelled.syntheticInputApproval;
    labelled.research = { ...labelled.research!, diagnostics: { retain: entry => withheld.push(entry) } };
    expect(await new GeneralAgentSession(labelled).run()).toMatchObject({ status: "incomplete", reason: "research_extraction_incomplete" });
    expect(withheld).toEqual([]);
    const reader = (jobId: string) => String(f.store.events(jobId).find(event => event.type === "session_started")!.readerContextId);
    expect(diagnosticRetention(f.store.context(reader("job-raw")))).toBe("raw"); expect(diagnosticRetention(f.store.context(reader("job-labelled")))).toBe("hash_only");
    // Beside the sink, nothing differs: the same stage events (hash-only, no reply text) and the same receipts, purpose for purpose.
    const stages = (jobId: string) => f.store.events(jobId).filter(event => event.type === "research_stage").map(({ contextId: _context, ...rest }) => rest);
    expect(stages("job-labelled")).toEqual(stages("job-raw")); expect(JSON.stringify(stages("job-raw"))).not.toContain("not an extraction");
    const rows = (jobId: string) => f.store.dispatches(jobId).map(row => [row.purpose, row.status, row.responseSha256]);
    expect(rows("job-labelled")).toEqual(rows("job-raw")); expect(rows("job-raw")).toHaveLength(4);
    // A sink is no part of the session identity: the same job without one starts with the same identity and records the same events.
    const plain = options(f, "job-plain-sink", []);
    expect(await new GeneralAgentSession(plain).run()).toMatchObject({ reason: "research_extraction_incomplete" });
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

  it("limitation the merged parts of backlog items 7 and 8 (7a.1, 7b.1, 7d.A, 8.2a) do not lift: a pause inside the stage before its first request is committed still ends the task, with nothing sent", async () => {
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
    // A failed stage while a pause was pending (asked after the stage's last reply, so nothing was cut) is that failure, not a pause.
    // Since 7c a broken plan falls back to the host plan, so the stage is broken at extraction instead: the pause is asked after the
    // reader's last extraction reply, the one chunk's repair.
    const g = await fixture({ reply: system => system.startsWith("You extract") ? "not an extraction" : undefined }), invalid = options(g, "job-invalid", []), make = invalid.research!.models;
    let paused: GeneralAgentSession, replies = 0;
    invalid.research = { ...invalid.research!, models: contextId => {
      const models = make(contextId), complete = models.reader.complete.bind(models.reader);
      models.reader.complete = async (...args) => { const reply = await complete(...args); if (args[0][0]?.content?.startsWith("You extract") && ++replies === 2) paused.pause(); return reply; };
      return models;
    } };
    paused = new GeneralAgentSession(invalid);
    expect(await paused.run()).toMatchObject({ status: "incomplete", reason: "research_extraction_incomplete" });
    expect(replies).toBe(2);  // the pause was asked, after the reader's last extraction reply
    expect(await new GeneralAgentSession(options(g, "job-invalid", [])).run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    // The plan case since 7c: two broken plans, and a pause asked after the planner's last reply. A cancel never completes as the
    // host fallback, so the stage ends cancelled, and the session reports the refusal the next run gives (it started), not a pause.
    const h = await fixture({ reply: system => system.startsWith("You plan") ? "not a plan" : undefined }), fallback = options(h, "job-fallback-paused", []), makePlan = fallback.research!.models;
    let pausedPlan: GeneralAgentSession, planReplies = 0;
    fallback.research = { ...fallback.research!, models: contextId => {
      const models = makePlan(contextId), complete = models.planner.complete.bind(models.planner);
      models.planner.complete = async (...args) => { const reply = await complete(...args); if (++planReplies === 2) pausedPlan.pause(); return reply; };
      return models;
    } };
    pausedPlan = new GeneralAgentSession(fallback);
    expect(await pausedPlan.run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(planReplies).toBe(2);
    expect(stageEvents(h.store, "job-fallback-paused")).toEqual([["index", 1, undefined], ["plan", 2, "cancelled"]]);
  });

  // The train-1 integration check (part f3): 7a.1 holds a first extraction attempt that lost every quote of a question it marked evidence_found,
  // and repairs it after every other chunk. A pause or a cancel around that repair ends the task as BL-20261109-0501 decided.
  const held = (nth: number) => nth === 1 ? JSON.stringify({ questions: [{ questionId: "Q1", status: "evidence_found" }],
    quotes: [{ quote: "This sentence appears in no source at all.", questionIds: ["Q1"], note: "" }], conflicts: [] }) : undefined;
  // 7c's fixture takes one reply function: the nth extraction reply (from 1) is `held`'s, and undefined keeps the fixture's own.
  const heldBy = () => { let n = 0; return (system: string) => system.startsWith("You extract") ? held(++n) : undefined; };
  const extractStage = (store: PrivateAgentStore, jobId: string) => store.events(jobId).find(event => event.type === "research_stage" && event.stage === "extract");
  it("backlog item 6 (A7): a pause between a held extraction attempt and its repair ends the task incomplete, and the next run refuses with nothing sent", async () => {
    // Control: unpaused, the held attempt is repaired and the stage completes.
    const c = await fixture({ reply: heldBy() }), control = options(c, "job-held-control", []);
    expect((await new GeneralAgentSession(control).run()).status).toBe("submitted");
    expect(stageEvents(c.store, control.jobId)).toEqual([["index", 1, undefined], ["plan", 1, undefined], ["extract", 2, undefined], ["synthesise", 1, undefined]]);
    expect(extractStage(c.store, control.jobId)).toMatchObject({ invalidReplies: 1, repairCalls: 1 });
    const f = await fixture({ reply: heldBy() }), runs: Run[] = [], config = options(f, "job-held-pause", runs), make = config.research!.models;
    let session: GeneralAgentSession, extractions = 0;
    config.research = { ...config.research!, models: contextId => {
      const models = make(contextId), complete = models.reader.complete.bind(models.reader);
      models.reader.complete = async (...args) => {
        const reply = await complete(...args);
        if (String(args[0][0]?.content).startsWith("You extract") && ++extractions === 1) session.pause();
        return reply;
      };
      return models;
    } };
    session = new GeneralAgentSession(config);
    expect(await session.run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    // The repair is refused before dispatch; the held attempt counts as invalid.
    expect(stageEvents(f.store, config.jobId)).toEqual([["index", 1, undefined], ["plan", 1, undefined], ["extract", 1, "cancelled"]]);
    expect(extractStage(f.store, config.jobId)).toMatchObject({ invalidReplies: 1 });
    expect(f.store.dispatches(config.jobId).map(row => row.status)).toEqual(["settled", "settled", "settled"]);
    expect(researchStageUnfinished(f.store.events(config.jobId), f.store.dispatches(config.jobId))).toBe(true);
    const sent = f.bodies.length;
    expect(await new GeneralAgentSession(options(f, config.jobId, runs)).run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(f.bodies).toHaveLength(sent); expect(f.store.dispatches(config.jobId)).toHaveLength(3); expect(runs).toHaveLength(0);
  });
  it("backlog item 6 (A7): a pause during a held attempt's repair call fails its zero-fee row as cancelled, never unknown, and ends the task incomplete", async () => {
    const f = await fixture({ reply: heldBy() }), runs: Run[] = [], config = options(f, "job-held-repair-pause", runs);
    const session = new GeneralAgentSession(config);
    let extractions = 0;
    f.hooks.onRequest = system => { if (system.startsWith("You extract") && ++extractions === 2) session.pause(); };
    expect(await session.run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(stageEvents(f.store, config.jobId)).toEqual([["index", 1, undefined], ["plan", 1, undefined], ["extract", 1, "cancelled"]]);
    const rows = f.store.dispatches(config.jobId);
    expect(rows.map(row => row.status)).toEqual(["settled", "settled", "settled", "failed"]);
    expect(rows[3]).toMatchObject({ purpose: "research evidence extraction", failure: { code: "cancelled" } }); expect(rows[3]!.feeMicrousd ?? 0).toBe(0);
    f.hooks.onRequest = undefined;
    const sent = f.bodies.length;
    expect(await new GeneralAgentSession(options(f, config.jobId, runs)).run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(f.bodies).toHaveLength(sent); expect(f.store.dispatches(config.jobId)).toHaveLength(4); expect(runs).toHaveLength(0);
  });
  it("backlog item 6 (A7): a cancel during a held attempt's repair call ends the task cancelled, and so does every later run", async () => {
    const f = await fixture({ reply: heldBy() }), runs: Run[] = [], config = options(f, "job-held-repair-cancel", runs);
    const session = new GeneralAgentSession(config);
    let extractions = 0;
    f.hooks.onRequest = system => { if (system.startsWith("You extract") && ++extractions === 2) session.cancel(); };
    expect(await session.run()).toMatchObject({ status: "incomplete", reason: "session_cancelled" });
    f.hooks.onRequest = undefined;
    const sent = f.bodies.length;
    expect(await new GeneralAgentSession(options(f, config.jobId, runs)).run()).toMatchObject({ status: "incomplete", reason: "session_cancelled" });
    expect(f.bodies).toHaveLength(sent); expect(runs).toHaveLength(0);
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
    let armed = false, stageBegun = false;
    vi.spyOn(f.store, "append").mockImplementation((jobId, event) => { const out = append(jobId, event); if (event.type === "research_input") armed = true; return out; });
    // 6.3: the pause lands after the stage's abort controller exists, so the session's own check before the stage has passed.
    vi.spyOn(f.store, "context").mockImplementation(id => { const out = context(id);
      if (armed) { armed = false; stageBegun = (session as unknown as { stageAbort?: AbortController }).stageAbort !== undefined; session.pause(); } return out; });
    expect(await session.run()).toMatchObject({ status: "paused", reason: "session_stopped" });
    expect(stageBegun).toBe(true);
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
