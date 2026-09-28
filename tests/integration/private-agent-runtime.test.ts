import Database from "better-sqlite3";
import http from "node:http";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { PrivateAgentModel, type GeneralMessage } from "../../src/main/private-agent/model";
import { GeneralAgentRunner, type GeneralJobContract, type GeneralJobOptions } from "../../src/main/private-agent/runner";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { localScreenSourceFreeze, runLocalArtifactScreen } from "../../scripts/private-agent-local-screen";

const enabled = process.env.SOAR_RUN_PRIVATE_AGENT_RUNTIME === "true";
const imageId = "sha256:95be0fdf09ef20ff31c5f605108f068422a58edb93b35834c5cfaf45312d3071";
const exec = promisify(execFile);
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const callback of cleanup.splice(0).reverse()) await callback(); });

type Action = { name: string; arguments: Record<string, unknown> };
async function prepare(actions: Action[], custom?: { checkPython?: string; maxElapsedMs?: number; afterResponse?: (count: number) => void }) {
  const requests: { messages: GeneralMessage[] }[] = [];
  const server = http.createServer((request, response) => {
    let body = ""; request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      requests.push(JSON.parse(body));
      const index = requests.length - 1, action = actions[index];
      if (!action) { response.writeHead(500); response.end("unexpected fixture request"); return; }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ model: "synthetic-model", choices: [{ message: { content: null,
        tool_calls: [{ id: `tool_${index}`, type: "function", function: { name: action.name, arguments: JSON.stringify(action.arguments) } }] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
      custom?.afterResponse?.(requests.length);
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const directory = mkdtempSync(join(tmpdir(), "soar-general-runtime-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const jobId = randomUUID(), contextId = randomUUID();
  const dbPath = join(directory, "state.sqlite"), db = new Database(dbPath); cleanup.push(() => { db.close(); });
  const store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["model"], maxRequests: 10, maxFeeMicrousd: 0 });
  const contract: GeneralJobContract = { version: 1, goal: "Read the synthetic input and deliver the calculated result as output.txt.",
    requiredArtifacts: [{ path: "output.txt", description: "The computed result" }], requiredChecks: ["correct_result"],
    maxModelCalls: 6, maxToolCalls: 6, maxElapsedMs: custom?.maxElapsedMs ?? 120000 };
  const files = [{ path: "input.txt", bytes: Buffer.from("21") }];
  store.createContext({ id: contextId, jobId, sources: [canonical(contract), canonical(files.map(file => ({ path: file.path, sha256: digest(file.bytes) }))), ...files.map(file => file.bytes)]
    .map((value, i) => ({ id: `source_${i}`, version: digest(value), classification: "private", synthetic: true })) });
  const destination = { id: "model", kind: "local_model" as const, endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions`,
    accountId: "synthetic", credentialVersion: 1, apiKey: "fixture-host-credential", privateDataAdmitted: true, loopbackFixture: true,
    maxResponseBytes: 128 * 1024, timeoutMs: 5000 };
  const scanner = { scan: async () => ({ complete: true, blocked: false, detector: "synthetic-false-negative" }) };
  const broker = new PrivateAgentBroker(store, [destination], scanner);
  const model = new PrivateAgentModel(broker, { destinationId: "model", model: "synthetic-model", maxOutputTokens: 4096,
    inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" }, jobId, contextId);
  const options: GeneralJobOptions = { jobId, contextId, store, broker, model, imageId, contract, files,
    checkpoints: new PrivateCheckpointStore(join(directory, "checkpoints"), jobId),
    checks: [{ id: "correct_result", python: custom?.checkPython ?? "from pathlib import Path\nassert Path('output.txt').read_text() == '42'" }] };
  cleanup.push(async () => { expect((await exec("docker", ["ps", "--all", "--quiet", "--filter", `label=soar.private-job-id=${jobId}`], { timeout: 10000 })).stdout.trim()).toBe(""); });
  return { options, requests, dbPath, directory, destination, scanner };
}

const calculate: Action = { name: "execute", arguments: { command: "python3 -I -c \"from pathlib import Path; Path('output.txt').write_text(str(int(Path('input.txt').read_text()) * 2))\"" } };
const finish: Action = { name: "finish", arguments: { summary: "Computed the result and wrote output.txt." } };

describe.skipIf(!enabled)("general loop through real broker and isolated Docker tools", () => {
  it("runs model → tool → model → independently verified artifact", async () => {
    const f = await prepare([calculate, finish]);
    const result = await new GeneralAgentRunner(f.options).run();
    expect(result).toMatchObject({ status: "completed", reason: "critical_checks_passed", modelCalls: 2, checks: [{ id: "correct_result", passed: true }] });
    expect(f.options.checkpoints.load(result.snapshot).find(file => file.path === "output.txt")?.bytes.toString()).toBe("42");
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1]!.messages.some(message => message.role === "tool" && message.content?.includes('"exitCode":0'))).toBe(true);
    expect(JSON.stringify(f.requests)).not.toContain("fixture-host-credential");
    expect(f.options.store.dispatches(f.options.jobId).every(receipt => receipt.status === "settled" && receipt.feeMicrousd === 0)).toBe(true);
  }, 90000);

  it("restores files, context restrictions and messages after a pause and SQLite reopening", async () => {
    let runner: GeneralAgentRunner;
    const f = await prepare([calculate, finish], { afterResponse: count => { if (count === 1) runner.pause(); } });
    runner = new GeneralAgentRunner(f.options);
    const paused = await runner.run(); expect(paused.status).toBe("paused"); expect(f.requests).toHaveLength(1);
    const reopened = new Database(f.dbPath); cleanup.push(() => { reopened.close(); });
    const store = new PrivateAgentStore(reopened), broker = new PrivateAgentBroker(store, [f.destination], f.scanner);
    const model = new PrivateAgentModel(broker, f.options.model.config, f.options.jobId, f.options.contextId);
    const resumed = await new GeneralAgentRunner({ ...f.options, store, broker, model }).run();
    expect(resumed.status).toBe("completed"); expect(resumed.modelCalls).toBe(2); expect(f.requests).toHaveLength(2);
    expect(store.context(f.options.contextId).sources.every(source => source.classification === "private")).toBe(true);
    expect(f.requests[1]!.messages.filter(message => message.role === "tool")).toHaveLength(1);
  }, 90000);

  it("cannot promote a candidate's shadow module into trusted verification", async () => {
    const spoof: Action = { name: "execute", arguments: { command: "printf wrong > output.txt; printf 'raise SystemExit(0)\\n' > pathlib.py" } };
    const f = await prepare([spoof, finish, calculate, finish]);
    const result = await new GeneralAgentRunner(f.options).run();
    expect(result.status).toBe("completed"); expect(f.requests).toHaveLength(4);
    const outputs = f.options.store.events(f.options.jobId).filter(event => event.type === "tool_finished").map(event => String(event.output));
    expect(outputs.some(output => output.includes('"passed":false'))).toBe(true);
    expect(f.options.checkpoints.load(result.snapshot).find(file => file.path === "output.txt")?.bytes.toString()).toBe("42");
  }, 90000);

  it("completes only the frozen bytes even if the agent leaves a mutating background process", async () => {
    const mutate: Action = { name: "execute", arguments: { command: "printf 42 > output.txt; (sleep 3; printf WRONG > output.txt) >/dev/null 2>&1 < /dev/null &" } };
    const f = await prepare([mutate, finish], { checkPython: "import time\nfrom pathlib import Path\ntime.sleep(4)\nassert Path('output.txt').read_text() == '42'" });
    const result = await new GeneralAgentRunner(f.options).run();
    expect(result.status).toBe("completed");
    const completed = f.options.store.events(f.options.jobId).find(event => event.type === "completed")!;
    expect(completed.verifiedSnapshotSha256).toBe(f.options.checkpoints.fingerprint(result.snapshot));
    expect(f.options.checkpoints.load(result.snapshot).find(file => file.path === "output.txt")?.bytes.toString()).toBe("42");
  }, 90000);

  it("refuses unresolved operations and exhausted persisted time before another model dispatch", async () => {
    const f = await prepare([calculate]);
    f.options.store.append(f.options.jobId, { contextId: f.options.contextId, type: "model_started", operationId: "interrupted-operation" });
    expect((await new GeneralAgentRunner(f.options).run()).reason).toBe("unresolved_operation_no_replay");
    expect(f.requests).toHaveLength(0);
    const g = await prepare([calculate]);
    g.options.store.append(g.options.jobId, { contextId: g.options.contextId, type: "run_ended", elapsedMs: g.options.contract.maxElapsedMs });
    expect((await new GeneralAgentRunner(g.options).run()).reason).toBe("cancelled_or_deadline"); expect(g.requests).toHaveLength(0);
  }, 90000);

  it("durably cancels and kills an observed running command through the runner entry point", async () => {
    const f = await prepare([{ name: "execute", arguments: { command: "sleep 30" } }]);
    const runner = new GeneralAgentRunner(f.options); const pending = runner.run();
    let observed = false;
    for (let i = 0; i < 60 && !observed; i++) {
      const ids = (await exec("docker", ["ps", "--quiet", "--filter", `label=soar.private-job-id=${f.options.jobId}`], { timeout: 3000 })).stdout.trim();
      if (ids) {
        const top = (await exec("docker", ["top", ids, "-eo", "pid,comm"], { timeout: 3000 })).stdout;
        observed = top.split("\n").some(line => /^\s*\d+\s+sleep\s*$/u.test(line));
      }
      if (!observed) await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(observed).toBe(true); runner.cancel();
    const result = await pending;
    expect(result.status).toBe("incomplete"); expect(f.options.store.policy(f.options.jobId).cancelled).toBe(true);
    expect(f.requests).toHaveLength(1); expect(f.options.store.events(f.options.jobId).some(event => event.type === "completed")).toBe(false);
  }, 90000);

  it("excludes another runner and steering through a separately opened SQLite connection", async () => {
    const f = await prepare([{ name: "execute", arguments: { command: "sleep 2; printf 42 > output.txt" } }, finish]);
    const first = new GeneralAgentRunner(f.options);
    const pending = first.run();
    for (let i = 0; i < 100 && !f.requests.length; i++) await new Promise(resolve => setTimeout(resolve, 50));
    expect(f.requests).toHaveLength(1);
    const before = f.options.store.runClaim(f.options.contextId)!;
    expect(before.state).toBe("active");
    const reopened = new Database(f.dbPath); cleanup.push(() => { reopened.close(); });
    const store = new PrivateAgentStore(reopened), broker = new PrivateAgentBroker(store, [f.destination], f.scanner);
    const model = new PrivateAgentModel(broker, f.options.model.config, f.options.jobId, f.options.contextId);
    const second = new GeneralAgentRunner({ ...f.options, store, broker, model });
    expect(() => second.steer("Change the output while another instance is running", true)).toThrow("general_job_pause_before_steering");
    expect((await second.run()).reason).toBe("job_context_busy");
    expect(store.runClaim(f.options.contextId)).toEqual(before);
    expect(store.events(f.options.jobId).filter(event => event.type === "run_ended")).toHaveLength(0);
    const completed = await pending;
    expect(completed.status).toBe("completed");
    expect(store.runClaim(f.options.contextId)?.state).toBe("released");
    expect(f.requests).toHaveLength(2);
  }, 90000);

  it("cannot mark completion when its own deadline expires during final cleanup", async () => {
    const f = await prepare([calculate, finish], { maxElapsedMs: 4000 });
    const cleanupOwnedContext = DockerSandbox.cleanupOwnedContext.bind(DockerSandbox);
    vi.spyOn(DockerSandbox, "cleanupOwnedContext").mockImplementation(async input => {
      await cleanupOwnedContext(input);
      expect(f.options.store.events(f.options.jobId).some(event => event.type === "tool_finished" && String(event.output).includes('"complete":true'))).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 4000));
    });
    const result = await new GeneralAgentRunner(f.options).run();
    expect(result.reason).toBe("deadline_before_completion");
    expect(result.status).toBe("incomplete");
    expect(f.options.store.runClaim(f.options.contextId)?.state).toBe("released");
    expect(f.options.store.events(f.options.jobId).some(event => event.type === "completed")).toBe(false);
  }, 90000);

  it("recovers an actual killed host's orphan before refusing to replay its uncertain tool", async () => {
    const f = await prepare([calculate]);
    const endpoint = await DockerSandbox.currentEndpoint();
    const childPath = join(f.directory, "crash-host.mjs");
    const script = `
      import Database from ${JSON.stringify(join(process.cwd(), "node_modules/better-sqlite3/lib/index.js"))};
      import { PrivateAgentStore } from ${JSON.stringify(join(process.cwd(), "src/main/private-agent/store.ts"))};
      import { DockerSandbox } from ${JSON.stringify(join(process.cwd(), "src/main/private-agent/sandbox.ts"))};
      const store = new PrivateAgentStore(new Database(${JSON.stringify(f.dbPath)}));
      store.acquireRun(${JSON.stringify(f.options.contextId)}, "owned_crash_fixture", ${JSON.stringify(endpoint)});
      const sandbox = await DockerSandbox.create({ imageId: ${JSON.stringify(imageId)}, endpoint: ${JSON.stringify(endpoint)},
        jobId: ${JSON.stringify(f.options.jobId)}, contextId: ${JSON.stringify(f.options.contextId)}, files: [] });
      store.append(${JSON.stringify(f.options.jobId)}, { contextId: ${JSON.stringify(f.options.contextId)},
        type: "tool_started", operationId: "crashed_tool_operation", toolCallId: "crashed_tool" });
      await sandbox.execute("sleep 60 >/dev/null 2>&1 < /dev/null &", { timeoutMs: 5000 });
      process.stdout.write("FIXTURE_READY\\n");
      setInterval(() => {}, 1000);
    `;
    writeFileSync(childPath, script, { mode: 0o600 });
    const child = spawn(process.execPath, ["--import", join(process.cwd(), "node_modules/tsx/dist/loader.mjs"), childPath], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
    cleanup.push(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      await DockerSandbox.cleanupOwnedContext({ endpoint, jobId: f.options.jobId, contextId: f.options.contextId });
    });
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("fixture host startup timeout")), 20000);
      child.stdout.on("data", chunk => { output += chunk; if (output.includes("FIXTURE_READY\n")) { clearTimeout(timer); resolve(); } });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`fixture host exited ${code}: ${stderr}`)); });
    });
    const ids = (await exec("docker", ["--host", endpoint, "ps", "--quiet", "--filter", `label=soar.private-context-id=${f.options.contextId}`], { timeout: 5000 })).stdout.trim();
    expect(ids).not.toBe("");
    const top = (await exec("docker", ["--host", endpoint, "top", ids, "-eo", "pid,comm"], { timeout: 5000 })).stdout;
    expect(top.split("\n").some(line => /^\s*\d+\s+sleep\s*$/u.test(line))).toBe(true);
    child.kill("SIGKILL"); await exited;
    expect(f.options.store.runClaim(f.options.contextId)?.pid).toBe(child.pid);
    const result = await new GeneralAgentRunner(f.options).run();
    expect(result.reason).toBe("unresolved_operation_no_replay");
    expect(f.requests).toHaveLength(0);
    expect(f.options.store.runClaim(f.options.contextId)?.state).toBe("released");
    expect(f.options.store.events(f.options.jobId).some(event => event.type === "orphan_cleanup_confirmed")).toBe(true);
    expect(f.options.store.events(f.options.jobId).some(event => event.type === "completed")).toBe(false);
    expect((await exec("docker", ["--host", endpoint, "ps", "--all", "--quiet", "--filter", `label=soar.private-context-id=${f.options.contextId}`], { timeout: 5000 })).stdout.trim()).toBe("");
  }, 90000);

  it("executes the hash-bound operator entry point and preserves a provisional immutable artifact", async () => {
    const f = await prepare([{ name: "execute", arguments: { command: "mkdir output; python3 -I -c \"from pathlib import Path; Path('output/result.txt').write_text(str(int(Path('input/input.txt').read_text()) * 2))\"" } }, finish]);
    const task = join(f.directory, "operator-task"), output = join(f.directory, "operator-result");
    mkdirSync(join(task, "input"), { recursive: true });
    const data = Buffer.from("21"), brief = "Read input/input.txt, double its integer and write output/result.txt. Keep all input files unchanged.";
    const job = canonical({ schemaVersion: 1, jobId: "synthetic_operator_fixture", goalFile: "brief.md",
      inputs: [{ path: "input.txt", sha256: digest(data), bytes: data.length, confidentiality: "private" }],
      requiredArtifacts: ["output/result.txt"], requiredCapabilities: ["local_calculation"],
      permissions: { externalModelDisclosure: "none", publicWeb: "none", publish: false, send: false, mutateInputs: false },
      verification: { deterministic: "independent arithmetic", humanCriteria: ["computed result"], runtimeAndPrivacyReceiptRequired: true },
      labelIsMetadataOnly: true, synthetic: true });
    writeFileSync(join(task, "job.json"), job); writeFileSync(join(task, "brief.md"), brief); writeFileSync(join(task, "input/input.txt"), data);
    vi.stubEnv("SOAR_PROVIDER_MODE", "local"); vi.stubEnv("SOAR_VLLM_BASE_URL", f.destination.endpoint.slice(0, -"/chat/completions".length));
    vi.stubEnv("SOAR_VLLM_MODEL", "synthetic-model"); vi.stubEnv("SOAR_VLLM_COST_POLICY", "local_zero_cost");
    vi.stubEnv("SOAR_VLLM_API_KEY", "fixture-host-credential");
    const options = { taskDirectory: task, expectedJobSha256: digest(job), expectedBriefSha256: digest(brief),
      syntheticAuthoritySha256: digest("authored synthetic fixture"), expectedRuntimeSha256: localScreenSourceFreeze().sha256,
      imageId, outputDirectory: output };
    await expect(runLocalArtifactScreen({ ...options, expectedRuntimeSha256: "0".repeat(64) })).rejects.toThrow("local_screen_reviewed_source_changed");
    expect(existsSync(output)).toBe(false); expect(f.requests).toHaveLength(0);
    const result = await runLocalArtifactScreen(options);
    expect(result).toMatchObject({ status: "submitted", artifactAccepted: null, independentAcceptanceRequired: true, requests: 2 });
    expect(readFileSync(join(output, "candidate/output/result.txt"), "utf8")).toBe("42");
    const receipt = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
    expect(receipt.closedSourceSha256).toBe(options.expectedRuntimeSha256);
    expect(JSON.stringify(receipt)).not.toContain("fixture-host-credential");
    expect((await exec("docker", ["ps", "--all", "--quiet", "--filter", `label=soar.private-job-id=${result.jobId}`], { timeout: 5000 })).stdout.trim()).toBe("");
  }, 90000);
});
