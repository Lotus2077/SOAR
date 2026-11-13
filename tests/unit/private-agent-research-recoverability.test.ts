import Database from "better-sqlite3";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ANTHROPIC_MESSAGES_ENDPOINT } from "../../src/main/private-agent/anthropic";
import { PrivateAgentBroker, type BrokerDestination } from "../../src/main/private-agent/broker";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, type PrivateModelConfig } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { RESEARCH_FILES, RESEARCH_SPLIT_MAX_FEE_USD } from "../../src/main/private-agent/research-pipeline";
import { GeneralAgentSession, sessionPhaseIdentity, type GeneralSessionOptions, type SessionPhase } from "../../src/main/private-agent/session";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { PROBE_MODEL, PROBE_PRICES } from "../../scripts/anthropic-probe";
import { buildCloudArm } from "../../scripts/private-agent-local-screen";
import { F2_SHAPE_KIB, inventedCorpus } from "../helpers/research-corpus";
import { researchV4Reply } from "../helpers/research-v4-fixture";

/**
 * E1 recoverability (E1-T2) of the research stage inside a session, on the real broker. This file keeps its own fixture, apart
 * from tests/unit/private-agent-research-session.test.ts, whose fixture 6.2, 7c, 10.b and E1-T3 each change: one loopback
 * server answers as an OpenAI-shaped local model and as Anthropic's Messages API, each with the invented reply for the stage
 * its system prompt names. No real model, endpoint or fee is involved. The split arm's wiring copies the headless driver's
 * (scripts/private-agent-local-screen.ts: the reader local, the planner and the synthesiser cloud); a PR that rewires it must update this copy.
 */
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const done of cleanups.splice(0).reverse()) await done(); });
const imageId = `sha256:${"a".repeat(64)}`;
const SOURCE = { path: "input/corpus/a.md", bytes: Buffer.from("# Storage\nCapacity nearly doubled in 2024, from 15 GW to 29 GW.\n") };
type Run = { files: string[] };
type Hooks = { local?: (system: string) => "malformed" | undefined; cloud?: (system: string, index: number) => "overloaded" | undefined };

/** `hooks.local` may cut a local reply's body inside its JSON; `hooks.cloud` may answer a cloud request with Anthropic's 529 overloaded_error. */
async function fixture() {
  const sent: { arm: "local" | "cloud"; system: string }[] = [], hooks: Hooks = {};
  const server = http.createServer((request, response) => {
    let raw = ""; request.on("data", chunk => { raw += chunk; }); request.on("end", () => {
      const body = JSON.parse(raw);
      if (request.url === "/anthropic/v1/messages") {
        const system = body.system[0].text as string, user = body.messages[0].content[0].text as string, index = sent.filter(item => item.arm === "cloud").length;
        sent.push({ arm: "cloud", system });
        if (hooks.cloud?.(system, index) === "overloaded") {
          response.writeHead(529, { "content-type": "application/json", "request-id": `req_011overloaded${index}` });
          response.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })); return;
        }
        response.writeHead(200, { "content-type": "application/json", "request-id": `req_011fixture${index}` });
        response.end(JSON.stringify({ type: "message", role: "assistant", model: PROBE_MODEL, content: [{ type: "text", text: researchV4Reply(system, user) }], stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, service_tier: "standard", inference_geo: "global" } }));
        return;
      }
      const system = body.messages[0].content as string, user = body.messages[1].content as string;
      sent.push({ arm: "local", system });
      response.setHeader("content-type", "application/json");
      // A malformed body: complete HTTP, but the JSON is cut off, so the model's decoder refuses it at settlement.
      if (hooks.local?.(system) === "malformed") { response.end("{\"choices\":[{\"message\":{\"content\":"); return; }
      response.end(JSON.stringify({ choices: [{ message: { content: researchV4Reply(system, user) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  await new Promise<void>((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
  cleanups.push(() => new Promise<void>(yes => { server.closeAllConnections(); server.close(() => yes()); }));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const root = mkdtempSync(join(tmpdir(), "soar-research-e1-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const db = new Database(":memory:"); cleanups.push(() => { db.close(); });
  const store = new PrivateAgentStore(db);
  // The headless driver's split arm under its fee cap (buildCloudArm, RESEARCH_SPLIT_MAX_FEE_USD), with the Anthropic destination pointed at
  // the loopback. The key is a placeholder no server checks. Both timeouts are 10 s: no case depends on one, and a loaded run must not hit it.
  const arm = buildCloudArm({ model: PROBE_MODEL, endpoint: ANTHROPIC_MESSAGES_ENDPOINT, prices: PROBE_PRICES, maxFeeUsd: RESEARCH_SPLIT_MAX_FEE_USD },
    { SOAR_CLAUDE_CLOUD_API_KEY: "sk-ant-fixture-0001" }, COORDINATOR_PROFILES.heavy);
  const destinations: BrokerDestination[] = [{ id: "model", kind: "local_model", endpoint: `${endpoint}/v1/chat/completions`, accountId: "fixture", credentialVersion: 0, loopbackFixture: true,
    timeoutMs: 10_000, maxResponseBytes: 65536, privateDataAdmitted: false, syntheticOnly: true }, { ...arm.destination, endpoint: `${endpoint}/anthropic/v1/messages`, loopbackFixture: true, timeoutMs: 10_000 }];
  // The Anthropic waits are 20 and 40 ms instead of 30 and 60 s, as in tests/integration/private-agent-broker-anthropic.test.ts.
  const broker = new PrivateAgentBroker(store, destinations, { scan: async () => ({ complete: true, blocked: false, detector: "deliberate-false-negative-fixture" }) },
    { anthropicRetryDelaysMs: [20, 40] });
  return { store, broker, root, sent, hooks, arm };
}

/** A synthetic-attested session whose reader is the local model; `split` puts the planner and the synthesiser on the cloud arm, as the driver does. */
function options(f: Awaited<ReturnType<typeof fixture>>, jobId: string, runs: Run[], extra: { sources?: { path: string; bytes: Buffer }[]; split?: boolean } = {}): GeneralSessionOptions {
  const privatePhase: SessionPhase = { files: [...(extra.sources ?? [SOURCE]), { path: "brief.md", bytes: Buffer.from("Write a cited briefing.") }], checks: [{ id: "structure", python: "# fixed fixture" }],
    contract: { version: 1, goal: "Write a cited briefing from input/corpus.", requiredArtifacts: [{ path: "output/report.md", description: "report" }], requiredChecks: ["structure"],
      maxModelCalls: 40, maxToolCalls: 80, maxElapsedMs: 1_800_000 } };
  const checkpoints = new PrivateCheckpointStore(f.root, jobId);
  const local: PrivateModelConfig = { destinationId: "model", model: "fixture", maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" };
  const cloud = extra.split ? f.arm.modelConfig as PrivateModelConfig : local, model = (contextId: string, config = local) => new PrivateAgentModel(f.broker, config, jobId, contextId);
  return { jobId, imageId, store: f.store, broker: f.broker, checkpoints, privatePhase, limits: { maxRequests: 200, maxElapsedMs: 1_800_000 },
    syntheticInputApproval: { privatePhaseSha256: sessionPhaseIdentity(privatePhase), authoritySha256: digest("host-authored-fixture") },
    ...(extra.split ? { cloudArm: { destinationId: f.arm.destination.id, maxFeeMicrousd: f.arm.maxFeeMicrousd } } : {}),
    trustedHostModelFactory: contextId => model(contextId),
    research: { models: contextId => ({ reader: model(contextId), planner: model(contextId, cloud), synthesiser: model(contextId, cloud) }) },
    trustedHostRunnerFactory: input => ({ pause() {}, cancel() {}, async run() {
      runs.push({ files: input.files.map(file => file.path) });
      const snapshot = checkpoints.save([...input.files, { path: "output/report.md", bytes: Buffer.from("Capacity doubled [C1].") }]), checks = input.checks.map(check => ({ id: check.id, passed: true }));
      f.store.append(jobId, { type: "completed", contextId: input.contextId, snapshot, checks, verifiedSnapshotSha256: checkpoints.fingerprint(snapshot) });
      return { status: "completed" as const, reason: "critical_checks_passed", snapshot, checks, modelCalls: 1 };
    } }) };
}
type Receipts = { producer: { receipts: { id: string; stage: string; status?: string }[] } };
const receiptsOf = (f: Awaited<ReturnType<typeof fixture>>, jobId: string) => (f.store.events(jobId).find(event => event.type === "research_transfer")!.binding as Receipts).producer.receipts;
const stageRows = (f: Awaited<ReturnType<typeof fixture>>, jobId: string) => f.store.events(jobId).filter(event => event.type === "research_stage");

describe("E1 recoverability: a malformed body inside a research stage, on the real broker (S3)", () => {
  const stages = [["index", "You index", "research source index"], ["plan", "You plan", "research plan"], ["extract", "You extract", "research evidence extraction"],
    ["synthesise", "You write", "research synthesis"]] as const;
  it.each(stages)("pins the item-7 gap at %s: the zero-fee row resolves failed (response_or_usage_invalid, other), the stage is denied request_failed with nothing unresolved, and a resume sends nothing", async (name, prompt, purpose) => {
    // BL-20261107-0809 decision 6: a denied call ends its stage; continuing past one needs item 7 to reconcile the failed row with the ready packet.
    const f = await fixture(), runs: Run[] = [], jobId = `job-malformed-${name}`;
    f.hooks.local = system => system.startsWith(prompt) ? "malformed" : undefined;
    expect(await new GeneralAgentSession(options(f, jobId, runs)).run()).toMatchObject({ status: "incomplete", reason: "research_request_denied" });
    const rows = f.store.dispatches(jobId);
    expect(rows.at(-1)).toMatchObject({ purpose, status: "failed", failure: { phase: "settlement", code: "response_or_usage_invalid", subcode: "other" } });
    expect(rows.at(-1)).not.toHaveProperty("responseSha256");
    expect(rows.slice(0, -1).every(row => row.status === "settled")).toBe(true); expect(rows.some(row => row.status === "unknown" || row.status === "committed")).toBe(false);
    expect(stageRows(f, jobId).at(-1)).toMatchObject({ stage: name, calls: 0, denied: "request_failed" });
    expect(runs).toHaveLength(0);
    const sent = f.sent.length; f.hooks.local = undefined;
    expect(await new GeneralAgentSession(options(f, jobId, runs)).run()).toMatchObject({ status: "incomplete", reason: "research_stage_not_replayed" });
    expect(f.sent).toHaveLength(sent); expect(f.store.dispatches(jobId)).toHaveLength(rows.length); expect(runs).toHaveLength(0);
  }, 20_000);
});

describe("E1 recoverability: the split arm's Anthropic planner retried after a 529 still reaches the writer (S2, the cloud half of D14, gate clause 2)", () => {
  it("supersedes the priced attempt the 529 rejected, binds it uncounted, settles the retry and the cloud synthesis, reaches the writer, and reuses the packet on resume", async () => {
    const f = await fixture(), runs: Run[] = [], jobId = "job-split-overloaded", cloud = f.arm.destination.id;
    f.hooks.cloud = (system, index) => system.startsWith("You plan") && index === 0 ? "overloaded" : undefined;
    expect(await new GeneralAgentSession(options(f, jobId, runs, { split: true })).run()).toMatchObject({ status: "submitted" });
    expect(runs).toHaveLength(1);
    const rows = f.store.dispatches(jobId);
    expect(rows.map(row => [row.purpose, row.destinationId, row.status])).toEqual([["research source index", "model", "settled"], ["research plan", cloud, "superseded"],
      ["research plan", cloud, "settled"], ["research evidence extraction", "model", "settled"], ["research synthesis", cloud, "settled"]]);
    expect(rows[1]!.failure).toMatchObject({ phase: "transport", code: "http_rejected", status: 529, errorType: "overloaded_error", requestId: "req_011overloaded0", attempt: 1 });
    // The broker re-sent the same packet (a retry, not a pipeline repair). Priced: the rejected attempt reserved a fee and settled none;
    // the retry and the synthesis settled theirs.
    expect(rows[2]!.packetSha256).toBe(rows[1]!.packetSha256);
    expect(rows[1]!.reservedFeeMicrousd).toBeGreaterThan(0); expect(rows[1]).not.toHaveProperty("feeMicrousd");
    expect(rows[2]!.feeMicrousd).toBeGreaterThan(0); expect(rows[4]!.feeMicrousd).toBeGreaterThan(0);
    expect(f.sent.map(item => [item.arm, item.system.split(" ").slice(0, 2).join(" ")])).toEqual([["local", "You index"], ["cloud", "You plan"], ["cloud", "You plan"],
      ["local", "You extract"], ["cloud", "You write"]]);
    expect(stageRows(f, jobId).map(event => [event.stage, event.calls, event.denied])).toEqual(["index", "plan", "extract", "synthesise"].map(stage => [stage, 1, undefined]));
    const receipts = receiptsOf(f, jobId);
    expect(receipts.map(receipt => receipt.id)).toEqual(rows.map(row => row.id));
    expect(receipts.filter(receipt => receipt.status !== undefined)).toEqual([expect.objectContaining({ id: rows[1]!.id, stage: "plan", status: "superseded" })]);
    const sent = f.sent.length;
    expect(await new GeneralAgentSession(options(f, jobId, runs, { split: true })).run()).toMatchObject({ status: "submitted" });
    expect(f.sent).toHaveLength(sent); expect(f.store.dispatches(jobId)).toHaveLength(rows.length);
  }, 20_000);
});

describe("E1 recoverability: an f2-shaped corpus through the real broker (S7)", () => {
  it("indexes 21 invented sources in 7 batches, extracts their 21 chunks, settles every row once, and reaches the writer with every source and the packet", async () => {
    const f = await fixture(), runs: Run[] = [], jobId = "job-f2-shaped", sources = inventedCorpus("f2", F2_SHAPE_KIB, "input/corpus").map(({ path, bytes }) => ({ path, bytes }));
    expect(await new GeneralAgentSession(options(f, jobId, runs, { sources })).run()).toMatchObject({ status: "submitted" });
    expect(runs).toHaveLength(1);
    const rows = f.store.dispatches(jobId);
    expect(rows).toHaveLength(30); expect(rows.every(row => row.status === "settled")).toBe(true);
    expect(stageRows(f, jobId).map(event => [event.stage, event.calls, event.invalidReplies, event.denied])).toEqual([["index", 7, 0, undefined], ["plan", 1, 0, undefined],
      ["extract", 21, 0, undefined], ["synthesise", 1, 0, undefined]]);
    const receipts = receiptsOf(f, jobId);
    expect(receipts.map(receipt => receipt.id)).toEqual(rows.map(row => row.id)); expect(receipts.every(receipt => receipt.status === undefined)).toBe(true);
    expect(runs[0]!.files).toEqual(expect.arrayContaining([...sources.map(source => source.path), ...Object.values(RESEARCH_FILES)]));
  }, 20_000);
});
