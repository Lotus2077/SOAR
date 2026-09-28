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
import type { PatchRunPolicy, PatchRunSnapshot } from "../../src/shared/patch-run-contracts";
import { loadNativeCodingContract } from "../../src/main/patch-runs/native-contract";

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");
const enabled = process.env.SOAR_RUN_PATCH_RUNTIME_INTEGRATION === "true";

describe.skipIf(!enabled)("real controller/worker/container with a synthetic HTTP model", () => {
  it("reserves before every observed request, settles usage, exports a real fix and preserves the original", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "soar-runtime-integration-"));
    const workspace = path.join(directory, "source");
    await cp(path.join(root, "tests/fixtures/patch-pilot"), workspace, { recursive: true });
    const git = (args: string[]) => execute("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: workspace });
    await git(["init", "-q"]); await git(["add", "calculator.py", "tests"]);
    await git(["-c", "user.name=SOAR", "-c", "user.email=fixture@invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
    const original = await readFile(path.join(workspace, "calculator.py"), "utf8");
    const db = createSoarDatabase(path.join(directory, "runs.sqlite"));
    const store = new PatchRunStore(db);
    const bodies: unknown[] = [];
    const commands = [
      "python -c \"from pathlib import Path; p=Path('calculator.py'); p.write_text(p.read_text().replace('return a - b', 'return a + b'))\"",
      "python -m unittest discover -s tests -v", "SOAR_SUBMIT",
    ];
    let id = "";
    let authorityObserved = true;
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const snapshot = store.get(id);
        authorityObserved &&= snapshot.reservedMicrousd > 0 && snapshot.status === "running";
        authorityObserved &&= request.headers.authorization === "Bearer synthetic-fixture-key";
        bodies.push(JSON.parse(body));
        const command = commands[bodies.length - 1] ?? "SOAR_SUBMIT";
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: `\`\`\`mswea_bash_command\n${command}\n\`\`\`` } }], usage: { prompt_tokens: 200, completion_tokens: 80, cost: 0.0001 } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture did not bind");
    const config: PatchRuntimeConfig = {
      enabled: true, mode: "live", python: process.env.SOAR_PATCH_PYTHON ?? path.join(root, ".soar/patch-runtime/bin/python"),
      workerPath: path.join(root, "runtime/patch-worker/worker.py"), image: process.env.SOAR_TEST_DOCKER_IMAGE ?? "soar-patch-python:1", storageRoot: path.join(directory, "runs"),
      cloud: { id: "synthetic-loopback", protocol: "openai", endpoint: `http://127.0.0.1:${address.port}/chat/completions`, model: "fixture-model", apiKey: "synthetic-fixture-key", allowInsecureHttp: true, inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
      episodeCapMicrousd: 1_000_000, campaignCapMicrousd: 70_000_000, stepLimit: 8, wallTimeSeconds: 600, maxOutputTokens: 4096, maxInputBytes: 512000,
    };
    const controller = new PatchRunController(store, config);
    try {
      const created = await controller.create({ workspaceRoot: workspace, objective: "Fix addition so it adds numbers.", policy: "cloud", publicSourceAcknowledged: true });
      id = created.id;
      controller.start(id);
      const result = await controller.waitForRun(id);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe("completed");
      expect(result.checks.status).toBe("passed");
      expect(result.patch?.text).toContain("+    return a + b");
      expect(result.spentMicrousd).toBe(300);
      expect(result.reservedMicrousd).toBe(0);
      expect(bodies).toHaveLength(3);
      expect(authorityObserved).toBe(true);
      expect(await readFile(path.join(workspace, "calculator.py"), "utf8")).toBe(original);
      const snapshots = JSON.stringify(store.list());
      expect(snapshots).not.toContain("synthetic-fixture-key");
      expect(snapshots).not.toContain(`127.0.0.1:${address.port}`);
    } finally {
      await controller.close();
      server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close(); await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});

describe.skipIf(!enabled)("real native routing controller and Python event contract without providers", () => {
  const repair = "python -c \"from pathlib import Path; p=Path('calculator.py'); p.write_text(p.read_text().replace('return a - b', 'return a + b'))\"";
  const cases: { name: string; policy: PatchRunPolicy; actions: string[]; recovery?: boolean; stopped?: boolean; plan?: boolean; nativeHttp?: boolean; nativeDenied?: boolean; medium?: boolean; earlyCheck?: boolean; earlyCheckStale?: boolean; hostCheck?: boolean; hostCheckStale?: boolean }[] = [
    { name: "local-only checked submission", policy: "local_only", actions: [repair, "SOAR_SUBMIT"] },
    { name: "one cloud plan followed by local checked submission", policy: "cloud_plan_local", actions: [repair, "SOAR_SUBMIT"], plan: true },
    { name: "one preserved-patch cloud recovery", policy: "local_first", actions: [repair, "SOAR_REQUEST_HELP", "python -m unittest discover -s tests -v", "SOAR_SUBMIT"], recovery: true },
    { name: "local-only help preserves unsubmitted work", policy: "local_only", actions: [repair, "SOAR_REQUEST_HELP"], stopped: true },
    { name: "native HTTP admission, tool history, usage and checked submission", policy: "local_only", actions: [], nativeHttp: true },
    { name: "masked native HTTP denial retains settled usage without execution or retry", policy: "local_only", actions: [], nativeHttp: true, nativeDenied: true, stopped: true },
    { name: "medium native HTTP keeps tool history, total usage and the eight-call finishing reserve", policy: "local_only", actions: [], nativeHttp: true, medium: true },
    { name: "early native check leaves room for repair, fresh recheck and explicit submission", policy: "local_only", actions: [], nativeHttp: true, earlyCheck: true },
    { name: "an early passing native check cannot authorize a later regressed source", policy: "local_only", actions: [], nativeHttp: true, earlyCheck: true, earlyCheckStale: true, stopped: true },
    { name: "host checkpoint delivers failing feedback without a model call before repair and submission", policy: "local_only", actions: [], nativeHttp: true, hostCheck: true },
    { name: "host passing checkpoint cannot authorize later regressed source", policy: "local_only", actions: [], nativeHttp: true, hostCheck: true, hostCheckStale: true, stopped: true },
  ];
  it.each(cases)("$name", async ({ policy, actions, recovery, stopped, plan, nativeHttp, nativeDenied, medium, earlyCheck, earlyCheckStale, hostCheck, hostCheckStale }) => {
    const directory = await mkdtemp(path.join(tmpdir(), "soar-native-integration-"));
    const workspace = path.join(directory, "source");
    await cp(path.join(root, "tests/fixtures/patch-pilot"), workspace, { recursive: true });
    if (earlyCheckStale || hostCheckStale) {
      const file = path.join(workspace, "calculator.py");
      await writeFile(file, (await readFile(file, "utf8")).replace("return a - b", "return a + b"));
    }
    const git = (args: string[]) => execute("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: workspace });
    await git(["init", "-q"]); await git(["add", "calculator.py", "tests"]);
    await git(["-c", "user.name=SOAR", "-c", "user.email=fixture@invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
    const original = await readFile(path.join(workspace, "calculator.py"), "utf8");
    const db = createSoarDatabase(path.join(directory, "runs.sqlite"));
    const store = new PatchRunStore(db);
    const observations: PatchRunSnapshot[] = [];
    const bodies: Record<string, any>[] = [];
    const responses: Record<string, any>[] = [];
    let id = "", authorityObserved = true;
    const server = nativeHttp ? createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        bodies.push(JSON.parse(body));
        const snapshot = store.get(id), call = bodies.length;
        authorityObserved &&= snapshot.status === "running" && snapshot.phase === "local_solver" && store.hasUnresolvedRequests(id);
        authorityObserved &&= snapshot.checkpoint?.localCalls === call && snapshot.phaseUsage?.local?.requestCount === call;
        const command = (earlyCheck || hostCheck) && call <= 4 ? `printf '# precheck step ${call}\\n' >> calculator.py`
          : hostCheckStale && call === 5 ? "python -c \"from pathlib import Path; p=Path('calculator.py'); p.write_text(p.read_text().replace('return a + b', 'return a - b'))\""
          : earlyCheckStale && call === 6 ? "python -c \"from pathlib import Path; p=Path('calculator.py'); p.write_text(p.read_text().replace('return a + b', 'return a - b'))\""
          : call <= 6 ? repair + `\nprintf '# fixture step ${call}\\n' >> calculator.py` : "touch mask-denied.txt";
        const commandAction = hostCheck ? call <= 5 : earlyCheck ? call <= 4 || call === 6 : call <= 6 || (nativeDenied && call === 7);
        const functionName = commandAction ? "run_command" : hostCheck ? (call === 6 ? "run_visible_checks" : hostCheckStale ? "request_help" : "submit_task")
          : call === 7 || (earlyCheck && call === 5) ? "run_visible_checks" : "submit_task";
        const message = { role: "assistant", content: null, ...(medium ? { reasoning_content: "Synthetic hidden reasoning is never replayed." } : {}), tool_calls: [{ id: `fixture-call-${call}`, type: "function",
          function: { name: functionName, arguments: commandAction ? JSON.stringify({ command }) : functionName === "request_help" ? JSON.stringify({ reason: "Fresh check failed; do not submit." }) : "{}" } }] };
        responses.push(message);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ model: "native-fixture", choices: [{ index: 0, finish_reason: "tool_calls", message }],
          usage: { prompt_tokens: 100, completion_tokens: 10, ...(medium ? { completion_tokens_details: { reasoning_tokens: 6 } } : {}) } }));
      });
    }) : undefined;
    if (server) await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server?.address();
    const config: PatchRuntimeConfig = {
      enabled: true, mode: nativeHttp ? "live" : "scripted", python: process.env.SOAR_PATCH_PYTHON ?? path.join(root, ".soar/patch-runtime/bin/python"),
      workerPath: path.join(root, "runtime/patch-worker/worker.py"), image: process.env.SOAR_TEST_DOCKER_IMAGE ?? "soar-patch-python:1", storageRoot: path.join(directory, "runs"),
      episodeCapMicrousd: 3_000_000, campaignCapMicrousd: 150_000_000, stepLimit: 40, wallTimeSeconds: 600,
      maxOutputTokens: 8192, maxInputBytes: 256000, scriptedActions: actions,
      ...(nativeHttp ? { localCodingMaxCalls: 8 } : {}),
      ...(medium ? { localCodingThinking: "medium" as const } : {}),
      ...(earlyCheck ? { localCodingCheckSchedule: "repair_window" as const } : {}),
      ...(hostCheck ? { localCodingCheckSchedule: "host_repair_window" as const } : {}),
      ...(address && typeof address !== "string" ? { local: { id: "local", protocol: "openai", endpoint: `http://127.0.0.1:${address.port}/chat/completions`,
        model: "native-fixture", apiKey: "", allowInsecureHttp: true, inputUsdPerMillion: 0, outputUsdPerMillion: 0, maxOutputTokens: 2048, maxInputBytes: 64000 } as const } : {}),
    };
    const controller = new PatchRunController(store, config, (snapshot) => observations.push(snapshot));
    try {
      const created = await controller.create({ workspaceRoot: workspace, objective: "Fix addition so it adds numbers.", policy, publicSourceAcknowledged: true });
      id = created.id;
      controller.start(created.id);
      const result = await controller.waitForRun(created.id);
      expect(result.status, result.error).toBe(stopped ? "failed" : "completed");
      expect(result.executionMode).toBe(nativeHttp ? "live" : "scripted");
      expect(result.patch?.text).toContain(earlyCheckStale || hostCheckStale ? "+    return a - b" : "+    return a + b");
      expect(result.patch?.kind).toBe(stopped ? "recovered" : "submitted");
      expect(result.checks.status).toBe(stopped ? "not_run" : "passed");
      if (!stopped) {
        expect(result.error).toBeUndefined();
        expect(result.checks.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(result.checks.sourceAfterSha256).toBe(result.checks.sourceSha256);
      } else expect(result.checkpoint).toMatchObject({ decision: "stop", ...(!nativeDenied ? { reason: "local_only_checkpoint" } : {}) });
      if (!recovery && !stopped) expect(result.checkpointCheck).toMatchObject({ passed: true, fresh: true, exitCode: 0 });
      expect(result.cloudRecoveryCount ?? 0).toBe(recovery ? 1 : 0);
      expect(Boolean(result.cloudPlan)).toBe(Boolean(plan));
      if (recovery) {
        const preserved = observations.find((snapshot) => snapshot.handoff && snapshot.patch?.kind === "recovered");
        expect(preserved?.handoff?.patchSha256).toBe(preserved?.patch?.sha256);
        expect(preserved?.handoff?.sourceSha256).toBe(preserved?.checkpoint?.sourceSha256);
        expect(observations.some((snapshot) => snapshot.phase === "cloud_solver")).toBe(true);
      } else expect(observations.some((snapshot) => snapshot.phase === "cloud_solver")).toBe(false);
      expect(result.spentMicrousd).toBe(0); expect(result.reservedMicrousd).toBe(0);
      if (nativeHttp) {
        const count = nativeDenied || earlyCheckStale || hostCheck ? 7 : 8;
        expect(authorityObserved).toBe(true); expect(bodies).toHaveLength(count);
        expect(result.phaseUsage?.local).toMatchObject({ requestCount: count, usageReceipts: count, inputTokens: count * 100, outputTokens: count * 10, unknownRequests: 0 });
        if (medium) expect(result.phaseUsage?.local?.reasoningTokens).toBe(count * 6);
        const contract = loadNativeCodingContract(config.workerPath);
        for (const [index, body] of bodies.entries()) {
          const allowed = hostCheck ? (index === 6 ? (hostCheckStale ? ["run_visible_checks", "request_help"] : ["run_visible_checks", "submit_task", "request_help"])
            : hostCheckStale && index === 4 ? ["run_command", "run_visible_checks", "submit_task", "request_help"] : ["run_command", "run_visible_checks", "request_help"])
            : earlyCheck && index === 4 ? ["run_visible_checks", "request_help"]
            : earlyCheckStale && index === 5 ? ["run_command", "run_visible_checks", "submit_task", "request_help"]
            : index < 6 ? ["run_command", "run_visible_checks", "request_help"]
            : index === 6 ? ["run_visible_checks", "request_help"] : ["submit_task", "request_help"];
          expect(body.tools).toEqual(contract.tools.filter(tool => allowed.includes(tool.function.name))); expect(body.max_tokens).toBe(8192);
          if (medium) {
            expect(body.reasoning_effort).toBe("medium"); expect(body).not.toHaveProperty("chat_template_kwargs");
          } else {
            expect(body.chat_template_kwargs).toEqual({ enable_thinking: false }); expect(body).not.toHaveProperty("reasoning_effort");
          }
          expect(JSON.stringify(body)).not.toContain("Synthetic hidden reasoning");
          expect(body.messages).toHaveLength(2 + 2 * index + (hostCheck && index >= 4 ? 1 : 0));
          if (index > 0) {
            const previous = bodies[index - 1]!;
            expect(body.messages.slice(0, previous.messages.length)).toEqual(previous.messages);
            const { reasoning_content: _hidden, ...action } = responses[index - 1]!;
            const hostOffset = hostCheck && index === 4 ? 1 : 0;
            expect(body.messages.at(-2 - hostOffset)).toEqual(action);
            expect(body.messages.at(-1 - hostOffset)).toMatchObject({ role: "tool", tool_call_id: `fixture-call-${index}` });
          }
        }
        const denials = result.events.filter(event => event.type === "native.action_denied");
        if (hostCheck) {
          expect(bodies[4]!.messages.at(-1)).toMatchObject({ role: "user" });
          expect(bodies[4]!.messages.at(-1).content).toContain("without a model request");
          expect(bodies[4]!.messages.at(-1).content).toContain(hostCheckStale ? "OK" : "FAILED");
          const hostStarts = observations.filter(s => s.checkpoint?.reason === "host_check_started");
          expect(hostStarts.length).toBeGreaterThan(0);
          for (const s of hostStarts) {
            expect(s.checkpoint).toMatchObject({ localCalls: 4, remainingLocalCalls: 4, allowedActions: [], evidence: { hostCheckUsed: true } });
            expect(s.phaseUsage?.local?.requestCount).toBe(4);
          }
          expect(result.events.filter(e => e.type === "checkpoint.checked")).toHaveLength(2);
          expect(result.checkpoint?.evidence.hostCheckUsed).toBe(true);
          expect(result.checkpoint?.failedChecks).toBe(1);
          if (hostCheckStale) expect(result.checkpoint?.checkSourceSha256).toBeNull();
        }
        if (earlyCheck) {
          expect(String(bodies[5]!.messages.at(-1).content)).toContain(earlyCheckStale ? "OK" : "FAILED");
          expect(observations.some(snapshot => snapshot.checkpointCheck?.passed === false && snapshot.checkpointCheck.fresh === true)).toBe(true);
          expect(result.checkpoint?.failedChecks).toBe(1);
          expect(result.events.filter(event => event.type === "checkpoint.checked")).toHaveLength(2);
          if (earlyCheckStale) {
            expect(result.checkpoint?.checkSourceSha256).toBeNull();
            expect(result.checkpointCheck).toMatchObject({ passed: false, fresh: true, exitCode: 1 });
          }
        }
        expect(denials).toHaveLength(nativeDenied ? 1 : 0);
        if (nativeDenied) {
          expect(denials[0]!.summary).toContain("Denied run_command;");
          expect(denials[0]!.summary).toContain("local call 7.");
          expect(JSON.stringify(result)).not.toContain("mask-denied.txt");
          expect(result.events.filter(event => event.type === "tool.started")).toHaveLength(6);
          expect(result.checkpointCheck).toBeUndefined();
        }
        expect(store.hasUnresolvedRequests(id)).toBe(false);
        expect(JSON.stringify(result)).not.toContain("Synthetic hidden reasoning");
      } else {
        expect(result.phaseUsage).toBeUndefined();
        expect(result.events.some((event) => event.type.startsWith("request."))).toBe(false);
      }
      expect(await readFile(path.join(workspace, "calculator.py"), "utf8")).toBe(original);
      expect(store.replay(created.id)).toEqual(result);
      expect(result.cleanupConfirmed).toBe(true);
      const cleanup = await execute("docker", ["ps", "-aq", "--filter", `label=soar.run-id=${created.id}`], { timeout: 10_000 });
      expect(cleanup.stdout.trim()).toBe("");
    } finally {
      await controller.close();
      if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
      db.close(); await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
