import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createSoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import { PatchRunController } from "../../src/main/patch-runs/controller";
import type { PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import { canonicalRequest } from "../../src/main/patch-runs/native-contract";
import { criticFixtureObjective, criticFixtureSecret, nativeCriticFixtureReply, cloudCriticFixtureReply } from "../helpers/patch-critic-fixture";

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");
const enabled = process.env.SOAR_RUN_PATCH_RUNTIME_INTEGRATION === "true";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe.skipIf(!enabled)("automatic source admission through real controller, HTTP, Python and Docker", () => {
  it.each([false, true])("oversized source = %s selects once before generation", async (oversized) => {
    const directory = await mkdtemp(path.join(tmpdir(), "soar-automatic-runtime-"));
    const workspace = path.join(directory, "source");
    await cp(path.join(root, "tests/fixtures/patch-pilot"), workspace, { recursive: true });
    if (oversized) await writeFile(path.join(workspace, "PUBLIC_CONTEXT.md"), "x".repeat(98_305));
    const git = (args: string[]) => execute("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd: workspace });
    await git(["init", "-q"]); await git(["add", "."]);
    await git(["-c", "user.name=SOAR", "-c", "user.email=fixture@invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
    const original = await readFile(path.join(workspace, "calculator.py"), "utf8");
    const db = createSoarDatabase(path.join(directory, "runs.sqlite"));
    const store = new PatchRunStore(db);
    const calls: { phase: string; requestId: string; bodySha256: string }[] = [];
    let id = "", admitted = true, unexpected = false;
    const counts = { local: 0, critic: 0, cloud: 0 };
    const commands = [
      "python -c \"from pathlib import Path; p=Path('calculator.py'); p.write_text(p.read_text().replace('return a - b', 'return a + b'))\"",
      "python -m unittest discover -s tests -v", "SOAR_SUBMIT",
    ];
    const server = createServer((request, response) => {
      let raw = "";
      request.on("data", chunk => { raw += String(chunk); });
      request.on("end", () => {
        try {
          const body = JSON.parse(raw), snapshot = store.get(id);
          const rows = db.prepare("SELECT request_id, admission_json FROM patch_run_requests WHERE run_id=? AND state='started'").all(id) as { request_id: string; admission_json: string }[];
          const phase = rows.length === 1 ? JSON.parse(rows[0]!.admission_json).phase : "missing";
          if (!["local", "critic", "cloud"].includes(phase) || (oversized ? phase !== "cloud" : phase === "cloud")) throw new Error("Wrong selected provider phase");
          const stage = phase as keyof typeof counts, count = ++counts[stage];
          admitted &&= snapshot.status === "running" && rows.length === 1 && store.hasUnresolvedRequests(id) && Boolean(snapshot.routingSelection);
          admitted &&= request.headers.authorization === (phase === "local" ? undefined : `Bearer ${criticFixtureSecret}`);
          if (phase !== "local") admitted &&= snapshot.reservedMicrousd > 0;
          calls.push({ phase, requestId: rows[0]!.request_id, bodySha256: hash(canonicalRequest(body)) });
          if ((phase === "local" && (count > 3 || !Array.isArray(body.tools))) || (phase === "critic" && (count > 1 || body.tools !== undefined)) || (phase === "cloud" && count > 3)) throw new Error("Unexpected additional request");
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(phase === "local" ? nativeCriticFixtureReply("acceptable", "draft", count)
            : phase === "critic" ? cloudCriticFixtureReply("acceptable")
              : { choices: [{ message: { content: `\`\`\`mswea_bash_command\n${commands[count - 1]}\n\`\`\`` } }],
                usage: { prompt_tokens: 200, completion_tokens: 80, cost: 0.0001 } }));
        } catch { unexpected = true; response.writeHead(500); response.end(); }
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture did not bind");
    const common = { protocol: "openai" as const, endpoint: `http://127.0.0.1:${address.port}/chat/completions`, allowInsecureHttp: true };
    const config: PatchRuntimeConfig = {
      enabled: true, mode: "live", python: process.env.SOAR_PATCH_PYTHON ?? path.join(root, ".soar/patch-runtime/bin/python"),
      workerPath: path.join(root, "runtime/patch-worker/worker.py"), image: process.env.SOAR_TEST_DOCKER_IMAGE ?? "soar-patch-python:1",
      storageRoot: path.join(directory, "runs"), episodeCapMicrousd: 3_000_000, campaignCapMicrousd: 10_000_000,
      stepLimit: 40, wallTimeSeconds: 600, maxOutputTokens: 8192, maxInputBytes: 256000, localCodingCheckSchedule: "final_only",
      cloud: { ...common, id: "synthetic-loopback", model: "critic-fixture", apiKey: criticFixtureSecret, inputUsdPerMillion: 4, outputUsdPerMillion: 20 },
      local: { ...common, id: "local", model: "native-critic-fixture", apiKey: "", inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
    };
    const controller = new PatchRunController(store, config);
    try {
      const created = await controller.create({ workspaceRoot: workspace, objective: criticFixtureObjective,
        policy: "automatic", publicSourceAcknowledged: true, episodeBudgetUsd: 3 });
      id = created.id;
      expect(calls).toEqual([]);
      expect(created.policy).toBe(oversized ? "prepared_cloud" : "local_critic_repair");
      expect(created.maxCostMicrousd).toBe(oversized ? 3_000_000 : 700_000);
      expect(created.routingSelection).toMatchObject({ requestedPolicy: "automatic", selectedPolicy: created.policy,
        reason: oversized ? "baseline_exceeds_critic_hard_limits" : "baseline_within_critic_hard_limits",
        baseRevision: created.baseRevision, maxCostMicrousd: created.maxCostMicrousd });
      expect(created.routingSelection?.sourceTreeSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(created.routingSelection?.configurationSha256).toMatch(/^[a-f0-9]{64}$/u);
      controller.start(id);
      const result = await controller.waitForRun(id);
      expect(result.status, result.error).toBe("completed");
      expect(result.error).toBeUndefined(); expect(admitted).toBe(true); expect(unexpected).toBe(false);
      expect(result.routingSelection).toEqual(created.routingSelection);
      expect(counts).toEqual(oversized ? { local: 0, critic: 0, cloud: 3 } : { local: 3, critic: 1, cloud: 0 });
      expect(result.cloudRecoveryCount ?? 0).toBe(0);
      expect(result.checks.status).toBe("passed"); expect(result.checks.exitCode).toBe(0);
      expect(result.checks.output).toContain("Ran 3 tests");
      expect(result.patch?.kind).toBe("submitted"); expect(result.patch?.truncated).toBe(false);
      expect(result.patch?.text).toContain("+    return a + b");
      expect(hash(result.patch!.text)).toBe(result.patch?.sha256);
      expect(result.reservedMicrousd).toBe(0); expect(store.hasUnresolvedRequests(id)).toBe(false);
      expect(result.spentMicrousd).toBe(oversized ? 300 : 800);
      expect(result.cleanupConfirmed).toBe(true); expect(store.replay(id)).toEqual(result);
      const ledger = db.prepare("SELECT * FROM patch_run_requests WHERE run_id=?").all(id) as Record<string, any>[];
      expect(ledger).toHaveLength(calls.length);
      for (const call of calls) {
        const row = ledger.find(r => r.request_id === call.requestId)!;
        expect(row.state).toBe("succeeded");
        expect(JSON.parse(row.admission_json)).toMatchObject({ phase: call.phase, inputSha256: call.bodySha256 });
      }
      expect(await readFile(path.join(workspace, "calculator.py"), "utf8")).toBe(original);
      expect((await git(["status", "--porcelain"])).stdout).toBe("");
      expect((await execute("docker", ["ps", "-aq", "--filter", `label=soar.run-id=${id}`], { timeout: 10000 })).stdout.trim()).toBe("");
      const events = db.prepare("SELECT * FROM patch_run_events WHERE run_id=? ORDER BY sequence").all(id);
      for (const text of [JSON.stringify(result), JSON.stringify(ledger), JSON.stringify(events)]) {
        expect(text).not.toContain(criticFixtureSecret); expect(text).not.toContain(`127.0.0.1:${address.port}`);
      }
    } finally {
      try { await controller.close(); }
      finally {
        server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
        db.close(); await rm(directory, { recursive: true, force: true });
      }
    }
  }, 180000);
});
