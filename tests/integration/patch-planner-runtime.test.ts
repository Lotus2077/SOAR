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

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");
const enabled = process.env.SOAR_RUN_PATCH_RUNTIME_INTEGRATION === "true";
const generatedSource = "import unittest\nfrom calculator import add\n\nclass PublicRequirements(unittest.TestCase):\n" +
  "    def test_negative_second_operand(self):\n        self.assertEqual(add(3, -5), -2)\n" +
  "    def test_fractional_operands(self):\n        self.assertEqual(add(0.5, 0.25), 0.75)\n";
const incompleteSource = "import unittest\nimport os\n\nclass Incomplete(unittest.TestCase):\n" +
  "    def test_process_exits(self):\n        os._exit(0)\n";
const edit = (value: string) => `python -c "from pathlib import Path; Path('calculator.py').write_text('def add(a, b):\\n    return ${value}\\n')"`;

describe.skipIf(!enabled)("planner checks through real main, HTTP, Python and Docker", () => {
  it.each(["repair", "fallback", "incomplete", "review_final_failure"] as const)("%s", async (scenario) => {
    const directory = await mkdtemp(path.join(tmpdir(), "soar-planner-runtime-"));
    const workspace = path.join(directory, "source");
    await cp(path.join(root, "tests/fixtures/patch-pilot"), workspace, { recursive: true });
    const git = (args: string[]) => execute("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: workspace });
    await git(["init", "-q"]); await git(["add", "calculator.py", "tests"]);
    await git(["-c", "user.name=SOAR", "-c", "user.email=fixture@invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
    const original = await readFile(path.join(workspace, "calculator.py"), "utf8");
    const db = createSoarDatabase(path.join(directory, "runs.sqlite"));
    const store = new PatchRunStore(db);
    const observations: PatchRunSnapshot[] = [];
    const bodies: { phase: string; body: Record<string, any> }[] = [];
    const counts = { cloud_planner: 0, local_solver: 0, cloud_solver: 0 };
    let id = "", admitted = true;
    const server = createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => { raw += String(chunk); });
      request.on("end", () => {
        const snapshot = store.get(id), phase = snapshot.phase as keyof typeof counts;
        const body = JSON.parse(raw);
        bodies.push({ phase, body });
        admitted &&= snapshot.status === "running" && store.hasUnresolvedRequests(id);
        const call = ++counts[phase];
        let message: object;
        let finishReason = "stop";
        if (phase === "cloud_planner") {
          admitted &&= snapshot.phaseUsage?.planner?.requestCount === 1 && snapshot.reservedMicrousd > 0;
          message = { role: "assistant", content: JSON.stringify({
            plan: "Preserve addition for signed and fractional operands; inspect the implementation, repair it, check and submit.",
            checks: { source: scenario === "incomplete" ? incompleteSource : generatedSource,
              expectedTests: scenario === "incomplete" ? 1 : 2 },
          }) };
        } else if (phase === "local_solver") {
          admitted &&= snapshot.checkpoint?.localCalls === call && snapshot.phaseUsage?.local?.requestCount === call;
          let name = "run_command", args: object;
          if (call === 1) args = { command: edit("a + abs(b)") };
          else if (call <= 4) args = { command: `printf '# local observation ${call}\\n' >> calculator.py` };
          else if (scenario === "fallback") { name = "request_help"; args = { reason: "Generated checks found behavior I cannot safely repair within this phase." }; }
          else if (call === 5) args = { command: edit("a + b") };
          else { name = call === 6 ? "run_visible_checks" : "submit_task"; args = {}; }
          message = { role: "assistant", content: null, tool_calls: [{ id: `local-${call}`, type: "function",
            function: { name, arguments: JSON.stringify(args) } }] };
          finishReason = "tool_calls";
        } else {
          admitted &&= phase === "cloud_solver" && snapshot.cloudRecoveryCount === 1 && snapshot.reservedMicrousd > 0;
          const command = call === 1 ? edit(scenario === "review_final_failure" ? "a + abs(b)" : "a + b") : "SOAR_SUBMIT";
          message = { role: "assistant", content: `\`\`\`mswea_bash_command\n${command}\n\`\`\`` };
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ index: 0, finish_reason: finishReason, message }],
          usage: { prompt_tokens: 100, completion_tokens: 20, ...(phase === "local_solver" ? {} : { cost: 0.0001 }) } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture did not bind");
    const common = { protocol: "openai" as const, endpoint: `http://127.0.0.1:${address.port}/chat/completions`, allowInsecureHttp: true };
    const config: PatchRuntimeConfig = {
      enabled: true, mode: "live", python: process.env.SOAR_PATCH_PYTHON ?? path.join(root, ".soar/patch-runtime/bin/python"),
      workerPath: path.join(root, "runtime/patch-worker/worker.py"), image: process.env.SOAR_TEST_DOCKER_IMAGE ?? "soar-patch-python:1",
      storageRoot: path.join(directory, "runs"), episodeCapMicrousd: 3_000_000, campaignCapMicrousd: 150_000_000,
      stepLimit: 40, wallTimeSeconds: 600, maxOutputTokens: 8192, maxInputBytes: 256000,
      localCodingCheckSchedule: "host_repair_window", plannerMode: "plan_and_checks",
      cloud: { ...common, id: "synthetic-loopback", model: "planner-fixture", apiKey: "synthetic-fixture-key", inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
      local: { ...common, id: "local", model: "local-fixture", apiKey: "", inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
    };
    const controller = new PatchRunController(store, config, (snapshot) => observations.push(snapshot));
    try {
      const created = await controller.create({ workspaceRoot: workspace,
        objective: "Fix addition for signed and fractional operands while preserving the existing interface.",
        policy: scenario === "review_final_failure" ? "cloud_plan_local_review" : "cloud_plan_local", publicSourceAcknowledged: true });
      id = created.id; controller.start(id);
      const result = await controller.waitForRun(id);
      const succeeds = scenario === "repair" || scenario === "fallback";
      expect(result.status, result.error).toBe(succeeds ? "completed" : "failed");
      if (succeeds) expect(result.error).toBeUndefined();
      if (scenario === "review_final_failure") expect(result.error).toContain("routing_planner_final_checks_failed");
      expect(admitted).toBe(true);
      expect(counts.cloud_planner).toBe(1);
      expect(counts.local_solver).toBe(scenario === "incomplete" ? 4 : scenario === "fallback" ? 5 : 7);
      expect(counts.cloud_solver).toBe(scenario === "fallback" || scenario === "review_final_failure" ? 2 : 0);
      expect(result.cloudRecoveryCount ?? 0).toBe(counts.cloud_solver ? 1 : 0);
      expect(result.spentMicrousd).toBe(100 * (1 + counts.cloud_solver));
      expect(result.phaseUsage?.planner).toMatchObject({ requestCount: 1, usageReceipts: 1, spentMicrousd: 100 });
      expect(result.phaseUsage?.local).toMatchObject({ requestCount: counts.local_solver, usageReceipts: counts.local_solver, spentMicrousd: 0, unknownRequests: 0 });
      for (const [phase, count] of [["planner", 1], ["local", counts.local_solver], ["cloud", counts.cloud_solver]] as const) {
        if (!count) { expect(result.phaseUsage?.[phase]).toBeUndefined(); continue; }
        expect(result.phaseUsage?.[phase]).toMatchObject({ requestCount: count, usageReceipts: count,
          unknownRequests: 0, reservedMicrousd: 0, inputTokens: count * 100, outputTokens: count * 20,
          reasoningTokens: 0, spentMicrousd: phase === "local" ? 0 : count * 100 });
      }
      expect(result.reservedMicrousd).toBe(0);
      expect(store.hasUnresolvedRequests(id)).toBe(false);
      expect(result.cleanupConfirmed).toBe(true);
      expect(result.cloudPlan?.checks?.source).toBe(scenario === "incomplete" ? incompleteSource : generatedSource);
      expect(result.patch?.kind).toBe(scenario === "incomplete" ? "recovered" : "submitted");
      expect(result.patch?.text).toContain(succeeds ? "+    return a + b" : "+    return a + abs(b)");
      const host = observations.find(s => s.checkpoint?.reason === "host_check_started");
      expect(host?.checkpoint).toMatchObject({ localCalls: 4, remainingLocalCalls: 20, allowedActions: [] });
      expect(host?.phaseUsage?.local?.requestCount).toBe(4);
      const firstGenerated = observations.find(s => s.plannerCheck);
      expect(firstGenerated?.checkpointCheck).toMatchObject({ passed: true, fresh: true });
      expect(firstGenerated?.plannerCheck).toMatchObject({ passed: false, stage: "checkpoint", fresh: true });
      expect(firstGenerated?.plannerCheck?.sourceSha256).toBe(firstGenerated?.checkpointCheck?.sourceSha256);
      if (scenario === "incomplete") {
        expect(firstGenerated?.plannerCheck).toMatchObject({ exitCode: 0, result: null });
        expect(result.checkpoint?.reason).toBe("planner_check_invalid");
        expect(result.checks.status).toBe("not_run");
      } else {
        expect(firstGenerated?.plannerCheck?.result).toMatchObject({ testsRun: 2, status: "failed", failures: 1 });
        const fifth = bodies.filter(b => b.phase === "local_solver")[4]!.body;
        expect(fifth.messages.at(-1).role).toBe("user");
        expect(fifth.messages.at(-1).content).toContain("Separate model-generated checks: failed");
        expect(fifth.messages.at(-1).content).toContain("test_negative_second_operand");
        expect(result.checks.status).toBe("passed");
        expect(result.plannerCheck).toMatchObject({ stage: "final", passed: succeeds, fresh: true });
        expect(result.plannerCheck?.sourceSha256).toBe(result.checks.sourceSha256);
        expect(result.events.filter(e => e.type === "planner.checks.checked")).toHaveLength(scenario === "fallback" ? 2 : 3);
      }
      expect(store.get(id)).toEqual(result);
      expect(store.replay(id)).toEqual(result);
      expect(await readFile(path.join(workspace, "calculator.py"), "utf8")).toBe(original);
      expect((await git(["status", "--porcelain"])).stdout).toBe("");
      expect((await execute("docker", ["ps", "-aq", "--filter", `label=soar.run-id=${id}`])).stdout.trim()).toBe("");
      const serialized = JSON.stringify(store.list());
      expect(serialized).not.toContain("synthetic-fixture-key");
      expect(serialized).not.toContain(`127.0.0.1:${address.port}`);
    } finally {
      await controller.close();
      server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close(); await rm(directory, { recursive: true, force: true });
    }
  }, 240_000);


  it("persists an initial planner declaration rejection after one settled request", async () => {
    const rawSentinel = "RAW_PLANNER_DECLARATION_RESPONSE_MUST_NOT_PERSIST";
    const rejectedSource = "import unittest\n\nclass Rejected(unittest.TestCase):\n" +
      `    @unittest.skip(${JSON.stringify(rawSentinel)})\n` +
      "    def test_addition(self):\n        self.assertEqual(1 + 1, 2)\n";
    const plannerResponse = JSON.stringify({ plan: `Rejected plan ${rawSentinel}`,
      checks: { source: rejectedSource, expectedTests: 1 } });
    const expectedError = "Worker stopped: routing_plan_rejected:planner_checks_declarations";
    const directory = await mkdtemp(path.join(tmpdir(), "soar-planner-rejection-runtime-"));
    const workspace = path.join(directory, "source");
    await cp(path.join(root, "tests/fixtures/patch-pilot"), workspace, { recursive: true });
    const git = (args: string[]) => execute("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: workspace });
    await git(["init", "-q"]); await git(["add", "calculator.py", "tests"]);
    await git(["-c", "user.name=SOAR", "-c", "user.email=fixture@invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
    const original = await readFile(path.join(workspace, "calculator.py"), "utf8");
    const db = createSoarDatabase(path.join(directory, "runs.sqlite"));
    const store = new PatchRunStore(db);
    const observations: PatchRunSnapshot[] = [];
    const requests: { phase: PatchRunSnapshot["phase"]; model: unknown }[] = [];
    let id = "", admitted = true;
    const server = createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => { raw += String(chunk); });
      request.on("end", () => {
        const snapshot = store.get(id), body = JSON.parse(raw);
        requests.push({ phase: snapshot.phase, model: body.model });
        admitted &&= snapshot.status === "running" && snapshot.phase === "cloud_planner" &&
          snapshot.phaseUsage?.planner?.requestCount === 1 && snapshot.reservedMicrousd > 0 &&
          store.hasUnresolvedRequests(id);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ index: 0, finish_reason: "stop",
          message: { role: "assistant", content: plannerResponse } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0001 } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture did not bind");
    const common = { protocol: "openai" as const, endpoint: `http://127.0.0.1:${address.port}/chat/completions`, allowInsecureHttp: true };
    const config: PatchRuntimeConfig = {
      enabled: true, mode: "live", python: process.env.SOAR_PATCH_PYTHON ?? path.join(root, ".soar/patch-runtime/bin/python"),
      workerPath: path.join(root, "runtime/patch-worker/worker.py"), image: process.env.SOAR_TEST_DOCKER_IMAGE ?? "soar-patch-python:1",
      storageRoot: path.join(directory, "runs"), episodeCapMicrousd: 3_000_000, campaignCapMicrousd: 150_000_000,
      stepLimit: 40, wallTimeSeconds: 600, maxOutputTokens: 8192, maxInputBytes: 256000,
      localCodingCheckSchedule: "host_repair_window", plannerMode: "plan_and_checks",
      cloud: { ...common, id: "synthetic-loopback", model: "planner-fixture", apiKey: "synthetic-fixture-key", inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
      local: { ...common, id: "local", model: "local-fixture", apiKey: "", inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
    };
    const controller = new PatchRunController(store, config, (snapshot) => observations.push(snapshot));
    try {
      const created = await controller.create({ workspaceRoot: workspace,
        objective: "Fix addition for signed and fractional operands while preserving the existing interface.",
        policy: "cloud_plan_local", publicSourceAcknowledged: true });
      id = created.id; controller.start(id);
      const result = await controller.waitForRun(id);
      expect(result.status, result.error).toBe("failed");
      expect(result.error).toBe(expectedError);
      expect(admitted).toBe(true);
      expect(requests).toEqual([{ phase: "cloud_planner", model: "planner-fixture" }]);
      expect(result.phaseUsage?.planner).toMatchObject({ requestCount: 1, usageReceipts: 1, unknownRequests: 0,
        reservedMicrousd: 0, spentMicrousd: 100, inputTokens: 100, outputTokens: 20, reasoningTokens: 0 });
      expect(result.spentMicrousd).toBe(100);
      expect(result.reservedMicrousd).toBe(0);
      expect(store.hasUnresolvedRequests(id)).toBe(false);
      const ledger = db.prepare("SELECT state, actual_microusd, finish_json FROM patch_run_requests WHERE run_id = ?").all(id);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ state: "succeeded", actual_microusd: 100, finish_json: expect.any(String) });
      const settled = result.events.findIndex(event => event.type === "request.finished");
      const failed = result.events.findIndex(event => event.type === "run.failed");
      expect(result.events.filter(event => event.type === "request.finished")).toHaveLength(1);
      expect(settled).toBeGreaterThanOrEqual(0);
      expect(failed).toBeGreaterThan(settled);
      expect(result.events[failed]?.summary).toBe(expectedError);
      expect(observations.find(snapshot => snapshot.status === "failed")?.phaseUsage?.planner)
        .toMatchObject({ requestCount: 1, usageReceipts: 1, unknownRequests: 0, reservedMicrousd: 0, spentMicrousd: 100 });
      for (const snapshot of [...observations, result]) {
        expect(snapshot.phaseUsage?.local).toBeUndefined();
        expect(snapshot.phaseUsage?.cloud).toBeUndefined();
        expect(snapshot.cloudRecoveryCount ?? 0).toBe(0);
        expect(snapshot.cloudPlan).toBeUndefined();
        expect(snapshot.patch).toBeUndefined();
        expect(snapshot.checkpointCheck).toBeUndefined();
        expect(snapshot.plannerCheck).toBeUndefined();
        expect(snapshot.checks).toMatchObject({ status: "not_run", exitCode: null, output: "" });
        expect(snapshot.checkpoint?.localCalls ?? 0).toBe(0);
        expect(["local_solver", "cloud_solver", "checking"]).not.toContain(snapshot.phase);
      }
      for (const type of ["plan.ready", "patch.ready", "patch.recovered", "checkpoint.checked", "planner.checks.checked", "checks.finished"]) {
        expect(result.events.some(event => event.type === type)).toBe(false);
      }
      expect(result.events.some(event => event.type === "sandbox.created")).toBe(true);
      expect(result.cleanupConfirmed).toBe(true);
      expect(store.get(id)).toEqual(result);
      expect(store.replay(id)).toEqual(result);
      expect(store.list()).toHaveLength(1);
      const persistedSnapshot = db.prepare("SELECT snapshot_json FROM patch_runs WHERE id = ?").get(id);
      const persistedEvents = db.prepare("SELECT type, summary, payload_json FROM patch_run_events WHERE run_id = ? ORDER BY sequence").all(id);
      for (const serialized of [JSON.stringify(result), JSON.stringify(observations), JSON.stringify(persistedSnapshot), JSON.stringify(persistedEvents), JSON.stringify(ledger)]) {
        expect(serialized).not.toContain(rawSentinel);
        expect(serialized).not.toContain("synthetic-fixture-key");
        expect(serialized).not.toContain(`127.0.0.1:${address.port}`);
      }
      expect(await readFile(path.join(workspace, "calculator.py"), "utf8")).toBe(original);
      expect((await git(["status", "--porcelain"])).stdout).toBe("");
      expect((await git(["rev-parse", "HEAD"])).stdout.trim()).toBe(created.baseRevision);
      expect((await execute("docker", ["ps", "-aq", "--filter", `label=soar.run-id=${id}`])).stdout.trim()).toBe("");
    } finally {
      await controller.close();
      server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close(); await rm(directory, { recursive: true, force: true });
    }
  }, 240_000);
});
