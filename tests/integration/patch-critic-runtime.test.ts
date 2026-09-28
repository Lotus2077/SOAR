import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createSoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import { PatchRunController } from "../../src/main/patch-runs/controller";
import type { PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import type { PatchRunSnapshot } from "../../src/shared/patch-run-contracts";
import { canonicalRequest, loadNativeCodingContract } from "../../src/main/patch-runs/native-contract";
import { validateCompactCriticBundle } from "../../src/main/patch-runs/compact-critic";
import {
  criticFixtureScenarios, criticFixtureObjective, criticFixtureIssue, criticFixtureRepair,
  criticFixtureSecret, criticFixtureHidden, nativeCriticFixtureReply, cloudCriticFixtureReply,
} from "../helpers/patch-critic-fixture";

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");
const enabled = process.env.SOAR_RUN_PATCH_RUNTIME_INTEGRATION === "true";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe.skipIf(!enabled)("same-episode local draft, one critic and optional local repair through production HTTP/Python/Docker", () => {
  it.each(criticFixtureScenarios)("%s", async (scenario) => {
    const directory = await mkdtemp(path.join(tmpdir(), "soar-critic-runtime-"));
    const workspace = path.join(directory, "source");
    await cp(path.join(root, "tests/fixtures/patch-pilot"), workspace, { recursive: true });
    const git = (args: string[]) => execute("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: workspace });
    await git(["init", "-q"]);
    await git(["add", "calculator.py", "tests"]);
    await git(["-c", "user.name=SOAR", "-c", "user.email=fixture@invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
    const original = await readFile(path.join(workspace, "calculator.py"), "utf8");
    const db = createSoarDatabase(path.join(directory, "runs.sqlite"));
    const store = new PatchRunStore(db);
    const observations: PatchRunSnapshot[] = [];
    const calls: { kind: "draft" | "critic" | "repair"; body: Record<string, any>; requestId: string; phase: string }[] = [];
    const counts = { draft: 0, critic: 0, repair: 0 };
    let id = "", admitted = true, unexpected = false;
    const server = createServer((request, response) => {
      let raw = "";
      request.on("data", chunk => { raw += String(chunk); });
      request.on("end", () => {
        try {
          const body = JSON.parse(raw), snapshot = store.get(id);
          const active = db.prepare("SELECT request_id, admission_json FROM patch_run_requests WHERE run_id=? AND state='started'").all(id) as { request_id: string; admission_json: string }[];
          const admittedPhase = active[0] ? JSON.parse(active[0].admission_json).phase : undefined;
          const kind = Array.isArray(body.tools) ? (counts.critic === 0 ? "draft" : "repair") : "critic";
          const call = ++counts[kind];
          admitted &&= snapshot.status === "running" && active.length === 1 && store.hasUnresolvedRequests(id);
          admitted &&= kind === "critic"
            ? snapshot.phase === "cloud_critic" && admittedPhase === "critic" && snapshot.reservedMicrousd > 0 && request.headers.authorization === `Bearer ${criticFixtureSecret}`
            : snapshot.phase === "local_solver" && admittedPhase === "local" && request.headers.authorization === undefined;
          calls.push({ kind, body, requestId: active[0]?.request_id ?? "", phase: admittedPhase ?? "" });
          if (kind === "critic" && (call !== 1 || body.tools !== undefined || body.model !== "critic-fixture")) {
            unexpected = true; response.writeHead(500); response.end(); return;
          }
          if (kind === "critic" && scenario === "unknown") { response.destroy(); return; }
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(kind === "critic"
            ? cloudCriticFixtureReply(scenario === "unknown" ? "invalid" : scenario)
            : nativeCriticFixtureReply(scenario, kind, call)));
        } catch {
          unexpected = true; response.writeHead(500); response.end();
        }
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture did not bind");
    const common = { protocol: "openai" as const, endpoint: `http://127.0.0.1:${address.port}/chat/completions`, allowInsecureHttp: true };
    const config: PatchRuntimeConfig = {
      enabled: true, mode: "live", python: process.env.SOAR_PATCH_PYTHON ?? path.join(root, ".soar/patch-runtime/bin/python"),
      workerPath: path.join(root, "runtime/patch-worker/worker.py"), image: process.env.SOAR_TEST_DOCKER_IMAGE ?? "soar-patch-python:1",
      storageRoot: path.join(directory, "runs"), episodeCapMicrousd: 1_000_000, campaignCapMicrousd: 10_000_000,
      stepLimit: 13, wallTimeSeconds: 600, maxOutputTokens: 8192, maxInputBytes: 256000,
      localCodingCheckSchedule: "final_only",
      cloud: { ...common, id: "synthetic-loopback", model: "critic-fixture", apiKey: criticFixtureSecret, inputUsdPerMillion: 4, outputUsdPerMillion: 20 },
      local: { ...common, id: "local", model: "native-critic-fixture", apiKey: "", inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
    };
    const controller = new PatchRunController(store, config, snapshot => observations.push(snapshot));
    try {
      const created = await controller.create({ workspaceRoot: workspace, objective: criticFixtureObjective,
        policy: "local_critic_repair", publicSourceAcknowledged: true });
      id = created.id; controller.start(id);
      const result = await controller.waitForRun(id);
      const succeeds = scenario === "acceptable" || scenario === "repair", repaired = scenario === "repair", unknown = scenario === "unknown";
      expect(result.status, result.error).toBe(succeeds ? "completed" : "failed");
      if (succeeds) expect(result.error).toBeUndefined();
      expect(result.policy).toBe("local_critic_repair"); expect(result.executionMode).toBe("live");
      expect(admitted).toBe(true); expect(unexpected).toBe(false);
      expect(counts).toEqual({ draft: 3, critic: 1, repair: repaired ? 3 : 0 });
      expect(calls.map(c => c.kind)).toEqual(["draft", "draft", "draft", "critic", ...(repaired ? ["repair", "repair", "repair"] : [])]);
      expect(new Set(calls.map(c => c.requestId)).size).toBe(calls.length);
      expect(result.cloudRecoveryCount ?? 0).toBe(0);
      for (const snapshot of [...observations, result]) {
        expect(snapshot.cloudPlan).toBeUndefined(); expect(snapshot.plannerCheck).toBeUndefined();
        expect(snapshot.phaseUsage?.planner).toBeUndefined(); expect(snapshot.phaseUsage?.cloud).toBeUndefined();
        expect(["cloud_planner", "cloud_solver", "local_scout"]).not.toContain(snapshot.phase);
      }
      const critic = calls.find(c => c.kind === "critic")!;
      expect(critic.body.messages).toHaveLength(2);
      expect(critic.body.tools).toBeUndefined();
      const bundle = validateCompactCriticBundle(JSON.parse(critic.body.messages[1].content));
      expect(bundle.objective).toBe(criticFixtureObjective);
      expect(bundle.baseRevision).toBe(result.baseRevision);
      expect(bundle.visibleTestCommand).toBe(created.checks.command);
      const candidate = bundle.files.find(f => f.revision === "candidate" && f.path === "calculator.py")!;
      const candidateText = candidate.sections.map(s => s.text).join("");
      expect(candidateText).toContain(scenario === "acceptable" ? "return a + b" : "return a + abs(b)");
      expect(hash(candidateText)).toBe(candidate.sha256);
      expect(bundle.files.find(f => f.revision === "baseline" && f.path === "calculator.py")?.sections[0]?.text).toBe(original);
      expect(JSON.stringify(critic.body)).not.toContain(criticFixtureIssue);
      expect(JSON.stringify(critic.body)).not.toContain(criticFixtureRepair);
      expect(result.criticDraft).toMatchObject({ requestId: critic.requestId, draftLocalCalls: 3,
        bodySha256: hash(canonicalRequest(critic.body)), patchSha256: hash(bundle.candidatePatch),
        objectiveSha256: hash(criticFixtureObjective), visibleCommandSha256: hash(created.checks.command),
        baseRevision: result.baseRevision });
      expect(result.criticDraft?.sourceSha256).toBe(result.criticDraft?.checkSourceSha256);
      expect(result.criticDraft?.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(observations.some(s => s.checkpointCheck?.passed && s.checkpointCheck.fresh &&
        s.checkpointCheck.sourceSha256 === result.criticDraft?.sourceSha256)).toBe(true);
      if (succeeds) {
        expect(result.critic).toMatchObject({ requestId: critic.requestId,
          sourceSha256: result.criticDraft?.sourceSha256, patchSha256: result.criticDraft?.patchSha256,
          bodySha256: result.criticDraft?.bodySha256, bundleSha256: result.criticDraft?.bundleSha256,
          result: { verdict: repaired ? "repair_required" : "acceptable" } });
        expect(result.critic?.receiptSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(result.criticCurrent).toBe(!repaired);
      } else {
        expect(result.critic).toBeUndefined(); expect(result.criticCurrent).not.toBe(true);
      }
      if (repaired) {
        const repairInput = JSON.stringify(calls.find(c => c.kind === "repair")!.body.messages);
        expect(repairInput).toContain(criticFixtureIssue);
        expect(repairInput).toContain(criticFixtureRepair);
        expect(repairInput).toContain(criticFixtureObjective);
      }
      const nativeContract = loadNativeCodingContract(config.workerPath);
      for (const call of calls.filter(c => c.kind !== "critic")) {
        expect(call.body.model).toBe("native-critic-fixture"); expect(call.body.max_tokens).toBe(8192);
        expect(call.body.chat_template_kwargs).toEqual({ enable_thinking: false });
        for (const tool of call.body.tools) expect(tool).toEqual(nativeContract.tools.find(t => t.function.name === tool.function.name));
        expect(JSON.stringify(call.body)).not.toContain(criticFixtureHidden);
      }
      const ledger = db.prepare("SELECT * FROM patch_run_requests WHERE run_id=? ORDER BY request_id").all(id) as Record<string, any>[];
      expect(ledger).toHaveLength(calls.length);
      expect(db.prepare("SELECT COUNT(*) AS n FROM patch_runs").get()).toEqual({ n: 1 });
      for (const call of calls) {
        const row = ledger.find(r => r.request_id === call.requestId)!;
        const admission = JSON.parse(row.admission_json);
        expect(admission.inputSha256).toBe(hash(canonicalRequest(call.body)));
        expect(admission.phase).toBe(call.kind === "critic" ? "critic" : "local");
        expect(row.state).toBe(unknown && call.kind === "critic" ? "unknown" : "succeeded");
      }
      expect(result.phaseUsage?.local).toMatchObject({ requestCount: repaired ? 6 : 3, usageReceipts: repaired ? 6 : 3,
        inputTokens: repaired ? 600 : 300, outputTokens: repaired ? 120 : 60, spentMicrousd: 0, reservedMicrousd: 0, unknownRequests: 0 });
      expect(result.phaseUsage?.critic).toMatchObject({ requestCount: 1, usageReceipts: unknown ? 0 : 1,
        unknownRequests: unknown ? 1 : 0, spentMicrousd: unknown ? 0 : 800 });
      expect(result.spentMicrousd).toBe(unknown ? 0 : 800);
      expect(store.hasUnresolvedRequests(id)).toBe(unknown);
      if (unknown) {
        const row = ledger.find(r => JSON.parse(r.admission_json).phase === "critic")!;
        expect(result.reservedMicrousd).toBe(row.reservation_microusd);
        expect(result.reservedMicrousd).toBeGreaterThan(0);
      } else expect(result.reservedMicrousd).toBe(0);
      expect(result.patch?.kind).toBe(succeeds ? "submitted" : "recovered");
      expect(result.patch?.truncated).toBe(false); expect(hash(result.patch!.text)).toBe(result.patch!.sha256);
      expect(result.patch!.text).toContain(succeeds ? "+    return a + b" : "+    return a + abs(b)");
      if (succeeds) {
        expect(result.checks.status).toBe("passed"); expect(result.checks.exitCode).toBe(0);
        expect(result.checks.output).toContain("Ran 3 tests");
        expect(result.checks.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(result.checks.sourceSha256).toBe(result.checks.sourceAfterSha256);
        if (repaired) {
          expect(result.checks.sourceSha256).not.toBe(result.criticDraft?.sourceSha256);
          expect(result.patch?.sha256).not.toBe(result.criticDraft?.patchSha256);
        } else {
          expect(result.checks.sourceSha256).toBe(result.criticDraft?.sourceSha256);
          expect(result.patch?.sha256).toBe(result.criticDraft?.patchSha256);
        }
        const patchIndex = result.events.findIndex(e => e.type === "patch.ready"), finalIndex = result.events.findIndex(e => e.type === "checks.finished");
        expect(patchIndex).toBeGreaterThanOrEqual(0); expect(finalIndex).toBeGreaterThan(patchIndex);
      } else expect(result.checks.status).toBe("not_run");
      expect(result.cleanupConfirmed).toBe(true);
      expect(store.get(id)).toEqual(result); expect(store.replay(id)).toEqual(result);
      expect(await readFile(path.join(workspace, "calculator.py"), "utf8")).toBe(original);
      expect((await git(["status", "--porcelain"])).stdout).toBe("");
      expect((await execute("docker", ["ps", "-aq", "--filter", `label=soar.run-id=${id}`], { timeout: 10000 })).stdout.trim()).toBe("");
      const events = db.prepare("SELECT * FROM patch_run_events WHERE run_id=? ORDER BY sequence").all(id);
      for (const serialized of [JSON.stringify(result), JSON.stringify(events), JSON.stringify(ledger)]) {
        expect(serialized).not.toContain(criticFixtureSecret); expect(serialized).not.toContain(criticFixtureHidden);
        expect(serialized).not.toContain(`127.0.0.1:${address.port}`);
      }
    } finally {
      try { await controller.close(); }
      finally {
        try {
          server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
        } finally {
          try { db.close(); } finally { await rm(directory, { recursive: true, force: true }); }
        }
      }
    }
  }, 180000);
});
