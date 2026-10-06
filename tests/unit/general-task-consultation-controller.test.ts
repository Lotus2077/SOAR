import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GeneralTaskController, type GeneralTaskControllerOptions } from "../../src/main/general-tasks/controller";
import { resolveConsultantProfile } from "../../src/main/general-tasks/consultant-config";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { readConsultation } from "../../src/main/private-agent/consultation";
import type { GeneralJobOptions } from "../../src/main/private-agent/runner";
import type { SoarConfig } from "../../src/main/config";
import type { GeneralTaskSnapshot } from "../../src/shared/general-task-contracts";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "soar-consultation-controller-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const db = new Database(join(root, "desktop.sqlite")); cleanup.push(() => { db.close(); });
  const env: NodeJS.ProcessEnv = { SOAR_GENERAL_CONSULTANT_ENDPOINT: "https://consultant.example/v1/chat/completions",
    SOAR_GENERAL_CONSULTANT_MODEL: "synthetic-advisor", SOAR_GENERAL_CONSULTANT_ACCOUNT_ID: "synthetic-account",
    SOAR_GENERAL_CONSULTANT_CREDENTIAL_VERSION: "1", SOAR_GENERAL_CONSULTANT_API_KEY: "synthetic-host-session-token",
    SOAR_GENERAL_CONSULTANT_MAX_OUTPUT_TOKENS: "256", SOAR_GENERAL_CONSULTANT_INPUT_MICROUSD_PER_MILLION: "1000000",
    SOAR_GENERAL_CONSULTANT_OUTPUT_MICROUSD_PER_MILLION: "2000000", SOAR_GENERAL_CONSULTANT_TIMEOUT_MS: "5000",
    SOAR_GENERAL_CONSULTANT_MAX_FEE_MICROUSD: "100000" };
  const config: SoarConfig = { providerMode: "local", hybridSimulationEnabled: false, fakeCloudScenario: "success", fakeDelayMs: 0, generalTaskProfile: "standard",
    vllm: { baseUrl: "http://127.0.0.1:9999/v1", apiKey: "synthetic-local-token", model: "unit-coordinator", costPolicy: "local_zero_cost", maxOutputTokens: 4096, timeoutMs: 300000 },
    limits: { inferenceRounds: 24, toolCalls: 24 }, context: { maxInputTokens: 32000, safetyMargin: 0.2 } };
  const executions: GeneralJobOptions[] = [];
  let terminal = false, hold = false;
  let release: (() => void) | undefined;
  const options: GeneralTaskControllerOptions = { database: db, dataRoot: join(root, "tasks"), config: () => config,
    imageId: () => `sha256:${"a".repeat(64)}`, runtimeIdentity: () => digest("controlled runtime"),
    consultantProfile: () => resolveConsultantProfile(env), testing: { readiness: async () => {}, runnerFactory: args => ({
      pause() {}, cancel() {}, async run(signal) {
        executions.push(args);
        const { store, jobId, contextId, checkpoints, consultation } = args, owner = randomUUID();
        store.acquireRun(contextId, owner, "unix:///synthetic-controller.sock");
        try {
          if (!consultation?.view()) {
            const operationId = randomUUID();
            store.append(jobId, { type: "model_started", contextId, operationId });
            store.append(jobId, { type: "model_finished", contextId, operationId });
            store.append(jobId, { type: "tool_started", contextId, operationId, name: "request_consultation" });
            const snapshot = checkpoints.save([{ path: "output/draft.txt", bytes: Buffer.from("Synthetic draft text.") },
              { path: "scratch/omitted.txt", bytes: Buffer.from("Omitted synthetic material.") }]);
            store.atomic(() => {
              store.append(jobId, { type: "checkpoint", contextId, snapshot, sha256: checkpoints.fingerprint(snapshot) });
              consultation?.propose({ question: "Find an issue in this draft.", artifactPaths: ["output/draft.txt"] }, snapshot);
              store.append(jobId, { type: "tool_finished", contextId, operationId, output: "Consultation paused." });
            });
            if (hold) await new Promise<void>(done => { release = done; });
            return { status: "paused" as const, reason: "consultation_pending", snapshot, checks: [], modelCalls: 1 };
          }
          const advice = await consultation.resume(signal ?? new AbortController().signal);
          const snapshot = checkpoints.save([{ path: "output/report.md", bytes: Buffer.from(advice) }]);
          const checks = [{ id: "desktop_artifact_structure", passed: true }];
          store.append(jobId, { type: "checkpoint", contextId, snapshot, sha256: checkpoints.fingerprint(snapshot) });
          if (terminal) store.append(jobId, { type: "completed", contextId, snapshot, verifiedSnapshotSha256: checkpoints.fingerprint(snapshot), checks });
          return { status: terminal ? "completed" as const : "paused" as const, reason: "synthetic_continuation", snapshot, checks, modelCalls: 1 };
        } finally {
          store.releaseRun(contextId, owner, true);
          store.append(jobId, { type: "run_ended", contextId, elapsedMs: 5, cleanupConfirmed: true });
        }
      },
    }) } };
  let controller = new GeneralTaskController(options); cleanup.push(() => controller.close());
  const create = () => controller.create({ goal: "Make an arbitrary small report.", outputName: "report.md", publicOrSynthetic: true, routing: "ask_before_consulting" });
  const start = async () => { const task = create(); controller.start(task.id); await controller.wait(task.id); return controller.get(task.id); };
  const ref = (task: GeneralTaskSnapshot) => ({ id: task.id, proposalId: task.consultation!.proposalId, proposalSha256: task.consultation!.proposalSha256 });
  return { db, env, executions, options, create, start, ref, get controller() { return controller; },
    async reopen() { await controller.close(); controller = new GeneralTaskController(options); },
    hold() { hold = true; }, release() { release?.(); hold = false; }, finish() { terminal = true; } };
}

describe("desktop consultation authority and continuity", () => {
  it("is absent without an explicit session profile and keeps local-only available", async () => {
    const f = fixture(); delete f.env.SOAR_GENERAL_CONSULTANT_API_KEY;
    expect((await f.controller.availability()).consultation).toMatchObject({ available: false });
    expect(() => f.create()).toThrow("general_task_configuration_changed");
    const local = f.controller.create({ goal: "Write locally.", outputName: "report.md", publicOrSynthetic: true });
    expect(local.routing).toBe("local_only"); expect(local.consultation).toBeUndefined(); expect(local.fees).toBeUndefined();
    expect(f.executions).toHaveLength(0);
  });
  it.each(["API_KEY", "MAX_FEE_MICROUSD", "INPUT_MICROUSD_PER_MILLION", "MODEL"])("binds queued tasks to their original %s", field => {
    const f = fixture(), task = f.create();
    f.env[`SOAR_GENERAL_CONSULTANT_${field}`] = field === "API_KEY" ? "changed-session-token" : field === "MODEL" ? "another-model" : "300000";
    expect(() => f.controller.start(task.id)).toThrow("general_task_configuration_changed"); expect(f.executions).toHaveLength(0);
  });
  it("retains pending preview and exact priced grant across restart without sending", async () => {
    const f = fixture(), task = await f.start(), args = f.executions[0]!, ref = f.ref(task);
    expect(task).toMatchObject({ status: "paused", canResume: false, modelCalls: 1, toolCalls: 1, cleanupConfirmed: true, consultation: { state: "pending" } });
    expect(args.store.policy(task.id)).toMatchObject({ mode: "cloud_help", revision: 0, maxRequests: 40, maxFeeMicrousd: 100000 });
    const preview = f.controller.previewConsultation(ref);
    expect(preview).toMatchObject({ state: "pending", selectedPaths: ["output/draft.txt"], omittedPaths: ["scratch/omitted.txt"], maxOutputTokens: 256 });
    expect(digest(preview.packet)).toBe(preview.packetSha256);
    expect(preview.packet).toContain("Synthetic draft text."); expect(preview.packet).not.toContain("Omitted synthetic material.");
    expect(JSON.stringify(preview)).not.toContain(f.env.SOAR_GENERAL_CONSULTANT_API_KEY);
    expect(args.store.dispatches(task.id)).toEqual([]);
    await f.reopen();
    expect(f.controller.previewConsultation(ref)).toEqual(preview);
    expect(() => f.controller.resume(task.id)).toThrow("general_task_resume_denied");
    expect(() => f.controller.decideConsultation({ ...ref, proposalSha256: digest("other packet"), decision: "approve" })).toThrow();
    const approved = f.controller.decideConsultation({ ...ref, decision: "approve" });
    expect(approved).toMatchObject({ status: "paused", canResume: true, modelCalls: 1, consultation: { state: "approved" } });
    const grants = f.db.prepare("SELECT value FROM private_agent_grants WHERE job_id=?").all(task.id) as { value: string }[];
    expect(grants).toHaveLength(1);
    expect(JSON.parse(grants[0]!.value)).toMatchObject({ remainingUses: 1, revoked: false, packetSha256: preview.packetSha256,
      approval: { proposalId: ref.proposalId, proposalSha256: ref.proposalSha256, maxFeeMicrousd: preview.maxFeeMicrousd } });
    expect(() => f.controller.decideConsultation({ ...ref, decision: "approve" })).toThrow();
    expect(args.store.dispatches(task.id)).toEqual([]);
    expect(f.controller.get(task.id).fees).toEqual({ reservedMicrousd: 0, settledMicrousd: 0 });
  });
  it("keeps an approved consultation resumable under the heavy budget after more than eighteen calls", async () => {
    const f = fixture(); f.options.config().generalTaskProfile = "heavy";
    const task = await f.start(), args = f.executions[0]!;
    for (let i = 0; i < 30; i++) {
      args.store.append(task.id, { type: "model_started", operationId: `heavy_${i}`, contextId: args.contextId });
      args.store.append(task.id, { type: "model_finished", operationId: `heavy_${i}`, contextId: args.contextId });
    }
    f.controller.previewConsultation(f.ref(task));
    const approved = f.controller.decideConsultation({ ...f.ref(task), decision: "approve" });
    expect(approved).toMatchObject({ status: "paused", canResume: true, modelCalls: 31, consultation: { state: "approved" } });
    f.finish(); f.controller.resume(task.id); await f.controller.wait(task.id);
    // Resume was admitted and the worker ran a second time with the approved allowance; the
    // fixture's consultant endpoint is unreachable by design, so the outcome of that attempt is not asserted.
    expect(f.executions).toHaveLength(2);
  });
  it.each(["context", "profile", "deadline", "allowance"])("blocks %s drift at approval", async changed => {
    const f = fixture(), task = await f.start(), args = f.executions[0]!;
    f.controller.previewConsultation(f.ref(task));
    if (changed === "context") args.store.addSources(args.contextId, [{ id: "new_source", version: digest("new"), classification: "private", synthetic: true }]);
    if (changed === "profile") f.env.SOAR_GENERAL_CONSULTANT_MAX_FEE_MICROUSD = "200000";
    if (changed === "deadline") {
      const row = JSON.parse((f.db.prepare("SELECT value FROM general_tasks WHERE id=?").get(task.id) as { value: string }).value);
      row.startedAt = Date.now() - 900001; f.db.prepare("UPDATE general_tasks SET value=? WHERE id=?").run(canonical(row), task.id);
    }
    if (changed === "allowance") for (let i = 0; i < 18; i++) {
      args.store.append(task.id, { type: "model_started", operationId: `extra_${i}`, contextId: args.contextId });
      args.store.append(task.id, { type: "model_finished", operationId: `extra_${i}`, contextId: args.contextId });
    }
    expect(() => f.controller.decideConsultation({ ...f.ref(task), decision: "approve" })).toThrow();
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM private_agent_grants").get()).toEqual({ n: 0 });
    expect(args.store.dispatches(task.id)).toEqual([]);
  });
  it.each(["decline", "revoke"] as const)("records %s without a configured profile or new authority", async decision => {
    const f = fixture(), task = await f.start(), ref = f.ref(task);
    if (decision === "revoke") { f.controller.previewConsultation(ref); f.controller.decideConsultation({ ...ref, decision: "approve" }); }
    delete f.env.SOAR_GENERAL_CONSULTANT_API_KEY;
    f.controller.decideConsultation({ ...ref, decision });
    expect(f.controller.previewConsultation(ref).state).toBe(decision === "decline" ? "declined" : "revoked");
    expect(f.executions[0]!.store.dispatches(task.id)).toEqual([]);
    if (decision === "revoke") {
      const row = f.db.prepare("SELECT value FROM private_agent_grants WHERE job_id=?").get(task.id) as { value: string };
      expect(JSON.parse(row.value)).toMatchObject({ revoked: true, remainingUses: 1 });
    }
  });
  it("continues a declined request locally in the same session and retains source context", async () => {
    const f = fixture(), task = await f.start(), args = f.executions[0]!;
    const start = args.store.events(task.id).find(event => event.type === "session_started");
    f.controller.decideConsultation({ ...f.ref(task), decision: "decline" }); f.finish();
    f.controller.resume(task.id); await f.controller.wait(task.id);
    const done = f.controller.get(task.id);
    expect(done).toMatchObject({ status: "submitted", modelCalls: 1, toolCalls: 1, consultation: { state: "declined" }, independentAcceptance: "not_evaluated" });
    expect(args.store.events(task.id).filter(event => event.type === "session_started")).toEqual([start]);
    expect(args.store.dispatches(task.id)).toEqual([]);
    expect(args.store.context(args.contextId).sources.some(source => source.id.startsWith("consult_"))).toBe(true);
  });
  it("blocks approval until the active worker and its claim are released", async () => {
    const f = fixture(); f.hold(); const task = f.create(); f.controller.start(task.id);
    for (let i = 0; i < 30 && !f.controller.get(task.id).consultation; i++) await Promise.resolve();
    const active = f.controller.get(task.id);
    f.controller.previewConsultation(f.ref(active));
    expect(active.consultation?.state).toBe("pending"); expect(active.cleanupConfirmed).toBe(false);
    expect(() => f.controller.decideConsultation({ ...f.ref(active), decision: "approve" })).toThrow("general_task_consultation_busy");
    f.release(); await f.controller.wait(task.id);
    expect(f.controller.decideConsultation({ ...f.ref(active), decision: "approve" }).consultation?.state).toBe("approved");
  });
  it("does not replay a consultation attempt missing its durable response after reopen", async () => {
    const f = fixture(), task = await f.start(), args = f.executions[0]!, ref = f.ref(task);
    f.controller.previewConsultation(ref);
    f.controller.decideConsultation({ ...ref, decision: "approve" });
    args.store.append(task.id, { type: "consultation_attempted", contextId: args.contextId, proposalId: ref.proposalId, proposalSha256: ref.proposalSha256 });
    await f.reopen();
    expect(f.controller.get(task.id)).toMatchObject({ canResume: false, modelCalls: 2, consultation: { state: "uncertain" } });
    expect(readConsultation(args.store, task.id)?.uncertain).toBe(true);
    expect(() => f.controller.resume(task.id)).toThrow("general_task_resume_denied");
    expect(args.store.dispatches(task.id)).toEqual([]);
  });
  it("advances desktop revision when fees are reserved or a dispatch becomes unknown", async () => {
    const f = fixture(), task = await f.start(), args = f.executions[0]!, ref = f.ref(task);
    const preview = f.controller.previewConsultation(ref);
    const approved = f.controller.decideConsultation({ ...ref, decision: "approve" });
    const raw = f.db.prepare("SELECT value FROM private_agent_grants WHERE job_id=?").get(task.id) as { value: string };
    const grant = JSON.parse(raw.value);
    const receipt = args.store.commit({ jobId: task.id, contextId: args.contextId, contextSha256: grant.contextSha256,
      packetSha256: grant.packetSha256, destinationId: grant.destinationId, destinationSha256: grant.destinationSha256,
      purpose: grant.purpose, policyRevision: grant.policyRevision, approval: grant.approval,
      reservedFeeMicrousd: grant.approval.maxFeeMicrousd, scan: { status: "complete", detector: "synthetic_store_test" } }, () => {}, grant.id);
    const committed = f.controller.get(task.id);
    expect(committed.revision).toBeGreaterThan(approved.revision);
    expect(committed.fees).toEqual({ reservedMicrousd: preview.maxFeeMicrousd, settledMicrousd: 0 });
    args.store.unknown(receipt.id);
    const unknown = f.controller.get(task.id);
    expect(unknown.revision).toBeGreaterThan(committed.revision);
    expect(unknown).toMatchObject({ canResume: false, modelCalls: 2, consultation: { state: "uncertain" } });
    expect(unknown.fees).toEqual(committed.fees);
  });
});
