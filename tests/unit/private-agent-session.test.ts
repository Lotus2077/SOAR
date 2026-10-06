import Database from "better-sqlite3";
import http from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { canonical, digest, restrictedContext } from "../../src/main/private-agent/contracts";
import { GeneralAgentSession, sessionPhaseIdentity, type GeneralSessionOptions, type SessionPhase, SESSION_TRANSFER_CHECK_ID } from "../../src/main/private-agent/session";
import { buildPublicRetrievalPhase, commonStructuralCheck, inspectPreparedTask, loadPreparedOperatorTask, runPreparedOperatorSession, selectPreparedPublicInputs, startControlledSnapshotReceiver } from "../../scripts/private-agent-run";
import { EVIDENCE_HELPER_PATH } from "../../src/main/private-agent/evidence";
import { retainPublicSource } from "../../src/main/private-agent/public-sources";
import { publicSourceWorkspacePath } from "../../src/main/private-agent/claims";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const done of cleanups.splice(0).reverse()) await done(); });
const imageId = `sha256:${"a".repeat(64)}`;
function privatePhase(text: string): SessionPhase {
  const files = [{ path: "input/private.txt", bytes: Buffer.from(text) }];
  const checks = [commonStructuralCheck(files, ["output/result.txt"])];
  return { files, checks, contract: { version: 1, goal: `Use the private file to produce a local result. ${text}`,
    requiredArtifacts: [{ path: "output/result.txt", description: "local result" }], requiredChecks: checks.map(row => row.id), maxModelCalls: 40, maxToolCalls: 80, maxElapsedMs: 1_800_000 } };
}
async function fixture() {
  const requests: { path: string; method: string; body: string }[] = [];
  const server = http.createServer((request, response) => {
    let body = ""; request.on("data", chunk => { body += chunk; }); request.on("end", () => {
      requests.push({ path: request.url!, method: request.method!, body }); response.end("public synthetic page");
    });
  });
  await new Promise<void>((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
  cleanups.push(() => new Promise<void>(yes => { server.closeAllConnections(); server.close(() => yes()); }));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const root = mkdtempSync(join(tmpdir(), "soar-session-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const db = new Database(":memory:"); cleanups.push(() => { db.close(); });
  const store = new PrivateAgentStore(db);
  const broker = new PrivateAgentBroker(store, [{ id: "public", kind: "public_web", endpoint, accountId: "fixture", credentialVersion: 0, privateDataAdmitted: false, loopbackFixture: true, timeoutMs: 2000, maxResponseBytes: 2048 },
    { id: "model", kind: "local_model", endpoint: `${endpoint}/model`, accountId: "fixture", credentialVersion: 0, privateDataAdmitted: false, syntheticOnly: true, loopbackFixture: true, timeoutMs: 2000, maxResponseBytes: 2048 }],
  { scan: async () => ({ complete: true, blocked: false, detector: "deliberate-false-negative-fixture" }) });
  const publicBrief = Buffer.from("Retrieve the approved public product snapshot; cite its claims.");
  const publicPhase = buildPublicRetrievalPhase({ brief: { path: "public-brief.md", bytes: publicBrief }, expectedBriefSha256: digest(publicBrief), destinationId: "public", indexUrl: `${endpoint}/index.html` });
  return { store, broker, root, endpoint, requests, publicPhase };
}
function options(f: Awaited<ReturnType<typeof fixture>>, jobId: string, secret: string): GeneralSessionOptions {
  const phase = privatePhase(secret), checkpoints = new PrivateCheckpointStore(f.root, jobId);
  return { jobId, imageId, store: f.store, broker: f.broker, checkpoints, privatePhase: phase, publicPhase: f.publicPhase,
    syntheticInputApproval: { privatePhaseSha256: sessionPhaseIdentity(phase), authoritySha256: digest("host-authored-fixture") },
    trustedHostModelFactory: contextId => new PrivateAgentModel(f.broker, { destinationId: "model", model: "fixture", maxOutputTokens: 128, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" }, jobId, contextId),
    trustedHostRunnerFactory: input => ({ pause() {}, cancel() {}, async run(signal) {
      if (input.webDestinations?.length) {
        expect(input.contract.goal).not.toContain(secret); expect(input.files.every(file => !file.bytes.includes(secret))).toBe(true);
        expect(restrictedContext(f.store.context(input.contextId))).toBe(false);
        const response = await f.broker.request({ jobId, contextId: input.contextId, destinationId: "public", purpose: "public source retrieval", method: "GET", url: `${f.endpoint}/index.html`, maxFeeMicrousd: 0, signal });
        retainPublicSource(f.store, checkpoints, { jobId, contextId: input.contextId, url: `${f.endpoint}/index.html`, bytes: response.bytes, receipt: response.receipt });
      } else {
        expect(restrictedContext(f.store.context(input.contextId))).toBe(true);
        expect(input.files.map(file => file.path)).toContain("context/public-research.md");
        // The host's retained public source travels with the findings, and every transferred file is pinned by a critical check.
        const copy = input.files.find(file => file.path === publicSourceWorkspacePath(`${f.endpoint}/index.html`));
        expect(copy?.bytes.toString("utf8")).toBe("public synthetic page");
        expect(input.checks.map(check => check.id)).toContain(SESSION_TRANSFER_CHECK_ID);
        expect(input.contract.requiredChecks).toContain(SESSION_TRANSFER_CHECK_ID);
        const pinned = JSON.parse(Buffer.from(input.checks.find(check => check.id === SESSION_TRANSFER_CHECK_ID)!.python.match(/b64decode\('([^']+)'\)/u)![1]!, "base64").toString("utf8"));
        expect(pinned).toContainEqual({ path: copy!.path, sha256: digest(Buffer.from("public synthetic page")) });
        await f.broker.request({ jobId, contextId: input.contextId, destinationId: "model", purpose: "synthetic local fixture", method: "POST", body: canonical({ value: secret }), maxFeeMicrousd: 0, signal });
      }
      const files = [...input.files, ...input.contract.requiredArtifacts.map(a => ({ path: a.path, bytes: Buffer.from(a.path.endsWith(".json") ? "[]" : "synthetic result") }))];
      const snapshot = checkpoints.save(files), checks = input.checks.map(c => ({ id: c.id, passed: true }));
      // The private phase records what the finish-time claims check verified, as the real runner does.
      if (!input.webDestinations?.length && jobId.startsWith("judged")) f.store.append(jobId, { type: "claims_verified", contextId: input.contextId, version: 1,
        claims: [{ id: "C1", sentence: "s1", quote: "q1 long enough", context: "c1" }, { id: "C2", sentence: "s2", quote: "q2 long enough", context: "c2" }],
        ...(jobId === "judged-invalid" ? { invalidClaimIds: ["C9"] } : {}) });
      f.store.append(jobId, { type: "completed", contextId: input.contextId, snapshot, checks, verifiedSnapshotSha256: checkpoints.fingerprint(snapshot) });
      return { status: "completed", reason: "fixture", snapshot, checks, modelCalls: 0 };
    } }) };
}

describe("general isolated phase session", () => {
  it("varying only private material leaves the real public-web transcript identical", async () => {
    const f = await fixture();
    for (const [id, value] of [["first", "PRIVATE-ALPHA"], ["second", "PRIVATE-BETA"]]) {
      const result = await new GeneralAgentSession(options(f, id!, value!)).run();
      expect(result).toMatchObject({ status: "submitted", requests: 2, artifactAccepted: null, independentAcceptanceRequired: true });
      expect(f.store.policy(id!)).toMatchObject({ maxRequests: 40, maxFeeMicrousd: 0, mode: "private" });
      const transfer = f.store.events(id!).find(row => row.type === "session_public_transfer")!;
      expect(transfer.binding).toMatchObject({ dispatchesSha256: expect.stringMatching(/^[a-f0-9]{64}$/), contextSha256: expect.stringMatching(/^[a-f0-9]{64}$/), files: expect.any(Array) });
      expect((transfer.binding as { files: { path: string }[] }).files.map(file => file.path)).toEqual(["context/public-research.md", "context/public-sources.json", publicSourceWorkspacePath(`${f.endpoint}/index.html`)]);
    }
    expect(f.requests.filter(row => row.method === "GET")).toEqual([{ path: "/index.html", method: "GET", body: "" }, { path: "/index.html", method: "GET", body: "" }]);
  });

  it("judges the verified claims once, after the private completion is durable, and records verdicts as evidence", async () => {
    const f = await fixture(), judge: unknown[][] = [];
    const spy = vi.spyOn(PrivateAgentModel.prototype, "complete").mockImplementation(async function (this: PrivateAgentModel, messages, tools, _signal, overrides) {
      expect(tools).toEqual([]); expect(overrides).toMatchObject({ thinking: "disabled", maxOutputTokens: 256, purpose: "claims entailment judgement" });
      judge.push(messages); return { content: judge.length === 1 ? '{"verdict":"supported","reason":"fixture"}' : "garbage", toolCalls: [], finishReason: "stop", costUsd: 0, durationMs: 1 };
    });
    try {
      expect((await new GeneralAgentSession(options(f, "judged", "PRIVATE-JUDGE")).run()).status).toBe("submitted");
      const events = f.store.events("judged"), completedAt = events.findIndex(e => e.type === "completed" && e.contextId === String(events.find(x => x.type === "session_started")!.privateContextId));
      const judgedAt = events.findIndex(e => e.type === "claims_entailment");
      expect(completedAt).toBeGreaterThan(-1); expect(judgedAt).toBeGreaterThan(completedAt);
      expect(events[judgedAt]).toMatchObject({ version: 1, entailmentCalls: 2, truncated: false, counts: { supported: 1, partial: 0, unsupported: 0, contradicted: 0, not_judged: 1 },
        verdicts: [{ id: "C1", verdict: "supported", reason: "fixture" }, { id: "C2", verdict: "not_judged", reason: "judge_reply_invalid" }], protocol: { version: 1 } });
      expect(judge).toHaveLength(2); expect(String((judge[0] as { content: string }[])[1]!.content)).not.toContain("PRIVATE-JUDGE");
      // Resuming a submitted session never judges again.
      expect((await new GeneralAgentSession(options(f, "judged", "PRIVATE-JUDGE")).run()).status).toBe("submitted");
      expect(judge).toHaveLength(2); expect(f.store.events("judged").filter(e => e.type === "claims_entailment")).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });
  it("submits before the pass, so a judge that outlives the session deadline cannot revoke the submission", async () => {
    const f = await fixture();
    const spy = vi.spyOn(PrivateAgentModel.prototype, "complete").mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 700)); return { content: '{"verdict":"supported"}', toolCalls: [], finishReason: "stop", costUsd: 0, durationMs: 1 }; });
    try {
      const config = { ...options(f, "judged-slow", "PRIVATE-SLOW"), limits: { maxRequests: 40, maxElapsedMs: 600 } };
      expect((await new GeneralAgentSession(config).run()).status).toBe("submitted");
      const types = f.store.events("judged-slow").map(e => e.type);
      expect(types.indexOf("session_submitted")).toBeGreaterThan(types.indexOf("completed")); expect(types.indexOf("claims_entailment")).toBeGreaterThan(types.indexOf("session_submitted"));
      expect(f.store.events("judged-slow").find(e => e.type === "claims_entailment")).toMatchObject({ counts: { supported: 2 }, truncated: false });
    } finally { spy.mockRestore(); }
  });
  it("a pause during the pass stops it at a claim boundary without recording, and the next run judges from the start", async () => {
    const f = await fixture(), config = options(f, "judged-pause", "PRIVATE-PAUSE");
    const session = new GeneralAgentSession(config); let calls = 0;
    const spy = vi.spyOn(PrivateAgentModel.prototype, "complete").mockImplementation(async () => { calls++; if (calls === 1) session.pause(); return { content: '{"verdict":"partial"}', toolCalls: [], finishReason: "stop", costUsd: 0, durationMs: 1 }; });
    try {
      expect(await session.run()).toMatchObject({ status: "paused", reason: "session_stopped" });
      expect(f.store.events("judged-pause").some(e => e.type === "session_submitted")).toBe(true);
      expect(f.store.events("judged-pause").some(e => e.type === "claims_entailment")).toBe(false); expect(calls).toBe(1);
      expect((await new GeneralAgentSession(config).run()).status).toBe("submitted");
      expect(f.store.events("judged-pause").find(e => e.type === "claims_entailment")).toMatchObject({ entailmentCalls: 2, truncated: false, counts: { partial: 2 } });
    } finally { spy.mockRestore(); }
  });
  it("lists claims the runner could not validate as not judged", async () => {
    const f = await fixture();
    const spy = vi.spyOn(PrivateAgentModel.prototype, "complete").mockResolvedValue({ content: '{"verdict":"supported"}', toolCalls: [], finishReason: "stop", costUsd: 0, durationMs: 1 });
    try {
      expect((await new GeneralAgentSession(options(f, "judged-invalid", "PRIVATE-INVALID")).run()).status).toBe("submitted");
      expect(f.store.events("judged-invalid").find(e => e.type === "claims_entailment")).toMatchObject({ entailmentCalls: 2, counts: { supported: 2, not_judged: 1 },
        verdicts: [{ id: "C1", verdict: "supported" }, { id: "C2", verdict: "supported" }, { id: "C9", verdict: "not_judged", reason: "claim_text_invalid" }] });
    } finally { spy.mockRestore(); }
  });
  it("a private-derived public fetch is denied before transport despite clean scan", async () => {
    const f = await fixture(); await new GeneralAgentSession(options(f, "blocked", "PRIVATE-CANARY")).run();
    const contextId = String(f.store.events("blocked").find(e => e.type === "session_started")!.privateContextId);
    const before = f.requests.length;
    await expect(f.broker.request({ jobId: "blocked", contextId, destinationId: "public", purpose: "public source retrieval", method: "GET", url: `${f.endpoint}/search?q=PRIVATE-CANARY`, maxFeeMicrousd: 0 })).rejects.toThrow("private_disclosure_requires_exact_grant");
    expect(f.requests).toHaveLength(before);
  });

  it("completed phases resume without replay and altered contracts stop", async () => {
    const f = await fixture(), config = options(f, "resume", "PRIVATE-RESUME");
    await new GeneralAgentSession(config).run(); const count = f.requests.length;
    expect((await new GeneralAgentSession(config).run()).status).toBe("submitted"); expect(f.requests).toHaveLength(count);
    const changed = options(f, "resume", "PRIVATE-CHANGED");
    expect((await new GeneralAgentSession(changed).run()).reason).toBe("session_contract_drift"); expect(f.requests).toHaveLength(count);
  });

  it("public approval and synthetic attestation must bind exact bytes", async () => {
    const f = await fixture(), config = options(f, "binding", "PRIVATE-BINDING");
    expect(() => new GeneralAgentSession({ ...config, publicPhase: { ...f.publicPhase, approval: { ...f.publicPhase.approval, goalSha256: "0".repeat(64) } } })).toThrow("session_public_approval_invalid");
    expect(() => new GeneralAgentSession({ ...config, syntheticInputApproval: { privatePhaseSha256: "0".repeat(64), authoritySha256: digest("authority") } })).toThrow("session_synthetic_approval_invalid");
    const changed = { ...f.publicPhase, contract: { ...f.publicPhase.contract, requiredArtifacts: f.publicPhase.contract.requiredArtifacts.map((row, i) => i ? row : { ...row, description: "PRIVATE-METADATA-CANARY" }) } };
    expect(() => new GeneralAgentSession({ ...config, publicPhase: changed })).toThrow("session_public_approval_invalid");
    const changedChecks = { ...f.publicPhase, checks: [{ ...f.publicPhase.checks[0]!, python: "# PRIVATE-CHECK-METADATA" }] };
    expect(() => new GeneralAgentSession({ ...config, publicPhase: changedChecks })).toThrow("session_public_approval_invalid");
    expect(() => new GeneralAgentSession({ ...config, publicPhase: { ...f.publicPhase, webDestinations: ["PRIVATE-DESTINATION-METADATA"] } })).toThrow("session_public_approval_invalid");
  });

  it("private sources are not synthetic without an independent host attestation", async () => {
    const f = await fixture(), config = options(f, "unattested", "PRIVATE-UNATTESTED");
    config.publicPhase = undefined; config.syntheticInputApproval = undefined;
    config.trustedHostRunnerFactory = input => ({ pause() {}, cancel() {}, async run(signal) {
      expect(f.store.context(input.contextId).sources.every(source => source.classification === "private" && source.synthetic === false)).toBe(true);
      await expect(f.broker.request({ jobId: "unattested", contextId: input.contextId, destinationId: "model", purpose: "synthetic local fixture", method: "POST", body: "private packet", maxFeeMicrousd: 0, signal })).rejects.toThrow("synthetic_destination_private_data_denied");
      return { status: "incomplete", reason: "unattested_blocked", snapshot: [], checks: [], modelCalls: 0 };
    } });
    expect((await new GeneralAgentSession(config).run()).reason).toBe("unattested_blocked"); expect(f.requests).toHaveLength(0);
  });

  it("rejects transfer path collisions with private inputs", async () => {
    const f = await fixture(), config = options(f, "collision", "PRIVATE-COLLISION");
    expect(() => new GeneralAgentSession({ ...config, publicPhase: { ...f.publicPhase, transfer: [{ from: "output/public-research.md", to: "input/private.txt" }] } })).toThrow("session_public_approval_invalid");
  });

  it("rejects source paths that UTF8 encoding would silently change", async () => {
    const f = await fixture(), config = options(f, "unicode", "PRIVATE-UNICODE");
    config.privatePhase.files[0]!.path = "input/\ud800.txt";
    expect(() => new GeneralAgentSession(config)).toThrow("session_phase_invalid");
  });

  it("public completion without an actual retrieval receipt cannot reach private phase", async () => {
    const f = await fixture(), config = options(f, "no-fetch", "PRIVATE-NO-FETCH");
    config.trustedHostRunnerFactory = input => ({ pause() {}, cancel() {}, async run() {
      return { status: "completed", reason: "fixture", snapshot: input.checkpoints.save(input.contract.requiredArtifacts.map(a => ({ path: a.path, bytes: Buffer.from("artifact") }))), checks: [{ id: "fixture", passed: true }], modelCalls: 0 };
    } });
    expect((await new GeneralAgentSession(config).run()).reason).toBe("public_retrieval_receipt_missing"); expect(f.requests).toHaveLength(0);
  });

  it("the public and private phases exhaust one shared40-request allowance", async () => {
    const f = await fixture(), config = options(f, "budget", "PRIVATE-BUDGET"), original = config.trustedHostRunnerFactory!;
    config.trustedHostRunnerFactory = input => {
      const runner = original(input);
      return { pause: () => runner.pause(), cancel: () => runner.cancel(), async run(signal) {
        if (input.webDestinations?.length) {
          const { text: _text, ...preview } = f.broker.preview({ jobId: "budget", contextId: input.contextId, destinationId: "public", purpose: "public source retrieval", method: "GET", url: `${f.endpoint}/index.html`, maxFeeMicrousd: 0 });
          for (let i = 0; i < 39; i++) {
            const row = f.store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "complete", detector: "synthetic-prior-receipt" } }, () => {});
            f.store.settle(row.id, 0, digest("prior synthetic receipt"));
          }
        }
        try { return await runner.run(signal); }
        catch { return { status: "incomplete" as const, reason: "shared_request_cap", snapshot: [], checks: [], modelCalls: 0 }; }
      } };
    };
    expect(await new GeneralAgentSession(config).run()).toMatchObject({ status: "incomplete", reason: "shared_request_cap", requests: 40 });
    expect(f.requests).toEqual([{ path: "/index.html", method: "GET", body: "" }]);
  });

  it("one wall deadline includes time between a public pause and private continuation", async () => {
    const f = await fixture(), config = options(f, "deadline", "PRIVATE-DEADLINE"), now = Date.now;
    const initial = now(); let clock = initial;
    Date.now = () => clock;
    try {
      const paused = { ...config, trustedHostRunnerFactory: () => ({ pause() {}, cancel() {}, async run() { return { status: "paused" as const, reason: "fixture_pause", snapshot: [], checks: [], modelCalls: 0 }; } }) };
      expect((await new GeneralAgentSession(paused).run()).status).toBe("paused");
      clock = initial + 1_800_001;
      expect((await new GeneralAgentSession(config).run()).reason).toBe("session_deadline");
      expect(f.requests).toHaveLength(0);
    } finally { Date.now = now; }
  });

  it.each(["cancel", "revision", "mode"] as const)("%s after the public phase prevents private continuation", async change => {
    const f = await fixture(), config = options(f, `post-${change}`, `PRIVATE-${change}`), original = config.trustedHostRunnerFactory!;
    config.trustedHostRunnerFactory = input => {
      const runner = original(input);
      return { pause: () => runner.pause(), cancel: () => runner.cancel(), async run(signal) {
        const result = await runner.run(signal);
        if (input.webDestinations?.length) {
          if (change === "cancel") f.store.cancel(config.jobId);
          else f.store.revisePolicy(config.jobId, { mode: change === "mode" ? "cloud_help" : "private", destinations: f.store.policy(config.jobId).destinations });
        }
        return result;
      } };
    };
    expect(await new GeneralAgentSession(config).run()).toMatchObject({ status: "incomplete", reason: change === "cancel" ? "session_cancelled" : "session_policy_drift" });
    expect(f.requests).toEqual([{ path: "/index.html", method: "GET", body: "" }]);
    expect(f.store.events(config.jobId).some(e => e.type === "session_submitted")).toBe(false);
  });

  it("cancellation after private return cannot become submitted", async () => {
    const f = await fixture(), config = options(f, "final-cancel", "PRIVATE-FINAL-CANCEL"), original = config.trustedHostRunnerFactory!;
    config.trustedHostRunnerFactory = input => {
      const runner = original(input);
      return { pause: () => runner.pause(), cancel: () => runner.cancel(), async run(signal) {
        const result = await runner.run(signal); if (!input.webDestinations?.length) f.store.cancel(config.jobId); return result;
      } };
    };
    expect(await new GeneralAgentSession(config).run()).toMatchObject({ status: "incomplete", reason: "session_cancelled" });
    expect(f.store.events(config.jobId).some(e => e.type === "session_submitted")).toBe(false);
  });

  it("two database connections adopt one winning session context pair", () => {
    const directory = mkdtempSync(join(tmpdir(), "soar-session-start-")); cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const a = new Database(join(directory, "state.sqlite")), b = new Database(join(directory, "state.sqlite")); cleanups.push(() => { b.close(); a.close(); });
    const first = new PrivateAgentStore(a), second = new PrivateAgentStore(b);
    first.createJob({ version: 1, id: "shared", mode: "private", revision: 0, cancelled: false, destinations: ["model"], maxRequests: 40, maxFeeMicrousd: 0 });
    const start = { type: "session_started" as const, identity: digest("same frozen session"), startedAt: 100, privateContextId: "private-first", publicContextId: "public-first" };
    expect(first.ensureSessionStart("shared", start)).toEqual(start);
    expect(second.ensureSessionStart("shared", { ...start, startedAt: 200, privateContextId: "private-second", publicContextId: "public-second" })).toEqual(start);
    expect(second.events("shared")).toEqual([start]);
    expect(() => second.ensureSessionStart("shared", { ...start, identity: digest("drift") })).toThrow("private_agent_session_identity_changed");
  });
});

describe("operator loader", () => {
  it("binds optional source evidence and its immutable helper without expanding public selection", async () => {
    const root = mkdtempSync(join(tmpdir(), "soar-evidence-load-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "input")); writeFileSync(join(root, "input/data.txt"), "public"); writeFileSync(join(root, "brief.md"), "Calculate a result.");
    const evidence = { version: 1, claimsPath: "output/claims.json", scriptPath: "output/calculate.py", resultsPath: "output/checks.json", requirements: [{ id: "total", statement: "Verify the required total.", kind: "numeric" }] };
    const job = { schemaVersion: 1, jobId: "source-evidence", goalFile: "brief.md", inputs: [{ path: "data.txt", sha256: digest("public"), bytes: 6, confidentiality: "public" }], requiredArtifacts: ["output/result.json", evidence.claimsPath, evidence.scriptPath, evidence.resultsPath], requiredCapabilities: [], permissions: { externalModelDisclosure: "none", publicWeb: "controlled", publish: false, send: false, mutateInputs: false }, verification: { deterministic: "independent", humanCriteria: ["correct"], runtimeAndPrivacyReceiptRequired: true, evidence }, labelIsMetadataOnly: true, synthetic: true };
    const raw = JSON.stringify(job); writeFileSync(join(root, "job.json"), raw);
    const binding = { jobSha256: digest(raw), briefSha256: digest("Calculate a result.") };
    const task = loadPreparedOperatorTask(root, binding);
    expect(task.phase.checks.map(check => check.id)).toEqual(["source_preserved_and_artifacts_readable", "source_evidence_replayed_and_consistent"]);
    expect(task.phase.contract.goal).toContain("independent correctness/completeness acceptance");
    const helper = task.phase.files.find(file => file.path === EVIDENCE_HELPER_PATH)!;
    expect(helper.bytes.toString()).toBe(task.phase.checks[1]!.python);
    expect(task.publicInputs.map(file => file.path)).toEqual(["input/data.txt"]);
    expect(() => selectPreparedPublicInputs(task, [EVIDENCE_HELPER_PATH], task.sourceBindingSha256)).toThrow("operator_private_selection_denied");
    helper.bytes[0] = 0;
    await expect(runPreparedOperatorSession({ task, syntheticAuthority: { sourceBindingSha256: task.sourceBindingSha256, authoritySha256: digest("authority") }, dependencies: {} as never })).rejects.toThrow("operator_prepared_task_changed");
    job.requiredArtifacts.pop(); const missing = JSON.stringify(job); writeFileSync(join(root, "job.json"), missing);
    expect(() => loadPreparedOperatorTask(root, { ...binding, jobSha256: digest(missing) })).toThrow("operator_evidence_artifacts_missing");
  });
  it("public selection uses frozen originals and rejects private or mutated selections", async () => {
    const root = mkdtempSync(join(tmpdir(), "soar-public-select-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "input")); writeFileSync(join(root, "input/public.txt"), "public"); writeFileSync(join(root, "input/private.txt"), "private"); writeFileSync(join(root, "brief.md"), "Local goal");
    const job = { schemaVersion: 1, jobId: "public-selection", goalFile: "brief.md", inputs: [{ path: "public.txt", sha256: digest("public"), bytes: 6, confidentiality: "public" }, { path: "private.txt", sha256: digest("private"), bytes: 7, confidentiality: "private" }], requiredArtifacts: ["output/result.txt"], requiredCapabilities: [], permissions: { externalModelDisclosure: "none", publicWeb: "controlled", publish: false, send: false, mutateInputs: false }, verification: { deterministic: "outside", humanCriteria: [], runtimeAndPrivacyReceiptRequired: true }, labelIsMetadataOnly: true, synthetic: true };
    const raw = JSON.stringify(job); writeFileSync(join(root, "job.json"), raw);
    const task = loadPreparedOperatorTask(root, { jobSha256: digest(raw), briefSha256: digest("Local goal") });
    task.publicInputs[0]!.bytes.fill(88);
    const selected = selectPreparedPublicInputs(task, ["input/public.txt"], task.sourceBindingSha256);
    expect(selected.files[0]!.bytes.toString()).toBe("public");
    expect(() => selectPreparedPublicInputs(task, ["input/private.txt"], task.sourceBindingSha256)).toThrow("operator_private_selection_denied");
    selected.files[0]!.bytes.fill(89);
    await expect(startControlledSnapshotReceiver(selected.files, selected.manifestSha256)).rejects.toThrow("operator_public_snapshot_binding");
  });
  it("loads only explicit bound task inputs and rejects missing authority hashes", async () => {
    const root = mkdtempSync(join(tmpdir(), "soar-loader-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "input")); writeFileSync(join(root, "input", "data.txt"), "fixture"); writeFileSync(join(root, "brief.md"), "Make the requested artifact.");
    const job = { schemaVersion: 1, jobId: "novel-task", goalFile: "brief.md", inputs: [{ path: "data.txt", sha256: digest("fixture"), bytes: 7, confidentiality: "private" }], requiredArtifacts: ["output/result.txt"], requiredCapabilities: ["novel_capability"], permissions: { externalModelDisclosure: "none", publicWeb: "none", publish: false, send: false, mutateInputs: false }, verification: { deterministic: "outside solver", humanCriteria: ["correct"], runtimeAndPrivacyReceiptRequired: true }, labelIsMetadataOnly: true, synthetic: true };
    const raw = JSON.stringify(job); writeFileSync(join(root, "job.json"), raw); writeFileSync(join(root, "gold.json"), "NEVER-READ-THIS");
    const binding = { jobSha256: digest(raw), briefSha256: digest("Make the requested artifact.") };
    const task = loadPreparedOperatorTask(root, binding);
    expect(task.phase.files.map(f => f.path)).toEqual(["job.json", "brief.md", "input/data.txt"]);
    expect(task.syntheticClaimInManifestIsNotAuthority).toBe(true);
    expect(inspectPreparedTask(["--task-directory", root, "--expected-job-sha256", binding.jobSha256, "--expected-brief-sha256", binding.briefSha256])).toMatchObject({ executionStarted: false, artifactAccepted: null });
    expect(() => loadPreparedOperatorTask(root, { ...binding, briefSha256: "0".repeat(64) })).toThrow("operator_task_binding");
    const mutated = loadPreparedOperatorTask(root, binding); mutated.phase.files[2]!.bytes[0] = 0;
    await expect(runPreparedOperatorSession({ task: mutated, syntheticAuthority: { sourceBindingSha256: mutated.sourceBindingSha256, authoritySha256: digest("authority") }, dependencies: {} as never })).rejects.toThrow("operator_prepared_task_changed");
    writeFileSync(join(root, "input", "unexpected.txt"), "new");
    expect(() => loadPreparedOperatorTask(root, binding)).toThrow("operator_input_inventory_changed");
  });

  it("binds a larger session allowance into the policy and identity, so another allowance cannot resume the job", async () => {
    const f = await fixture();
    const first = new GeneralAgentSession({ ...options(f, "allowance", "PRIVATE-GAMMA"), limits: { maxRequests: 200, maxElapsedMs: 5_400_000 } });
    expect((await first.run()).status).toBe("submitted");
    expect(f.store.policy("allowance")).toMatchObject({ maxRequests: 200, maxFeeMicrousd: 0, mode: "private" });
    const second = new GeneralAgentSession({ ...options(f, "allowance", "PRIVATE-GAMMA"), limits: { maxRequests: 40, maxElapsedMs: 1_800_000 } });
    // The durable policy already carries the first allowance, so the mismatch is refused before any work.
    expect(await second.run()).toMatchObject({ status: "incomplete", reason: "session_policy_drift" });
    // The same request allowance with a different time allowance passes the policy check and fails the identity check.
    const third = new GeneralAgentSession({ ...options(f, "allowance", "PRIVATE-GAMMA"), limits: { maxRequests: 200, maxElapsedMs: 1_800_000 } });
    expect(await third.run()).toMatchObject({ status: "incomplete", reason: "session_contract_drift" });
    const invalid = new GeneralAgentSession({ ...options(f, "invalid-allowance", "PRIVATE-DELTA"), limits: { maxRequests: 0, maxElapsedMs: 1 } });
    expect(await invalid.run()).toMatchObject({ status: "incomplete", reason: "session_limits_invalid" });
  });
});
