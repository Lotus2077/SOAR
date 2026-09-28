import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from "@playwright/test";
import Database from "better-sqlite3";
import type { GeneralTaskSnapshot, SoarGeneralTaskApi } from "../../src/shared/general-task-contracts";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { generalTaskModelFixture } from "../helpers/general-task-model-fixture";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const imageId = process.env.SOAR_GENERAL_TASK_IMAGE_ID ?? "";
const exec = promisify(execFile);
const original = "Synthetic desktop input\nCafé, invoices and 你好.\n";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const python = (source: string) => `python3 -c '${source.replaceAll("'", "'\\''")}'`;

function environment(root: string, origin: string): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "PATH", "SHELL", "TMPDIR", "USER", "DISPLAY", "XAUTHORITY", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]) {
    if (process.env[name] !== undefined) inherited[name] = process.env[name]!;
  }
  return { ...inherited, SOAR_PROVIDER_MODE: "local", SOAR_ENABLE_HYBRID_SIMULATION: "false",
    SOAR_DB_PATH: path.join(root, "desktop.sqlite"), SOAR_VLLM_BASE_URL: `${origin}/v1`,
    SOAR_VLLM_MODEL: "synthetic-general-tools", SOAR_VLLM_API_KEY: "", SOAR_VLLM_COST_POLICY: "local_zero_cost",
    SOAR_ALLOW_INSECURE_VLLM_HTTP: "true", SOAR_MAX_OUTPUT_TOKENS: "4096", SOAR_REQUEST_TIMEOUT_MS: "30000",
    SOAR_GENERAL_TASK_IMAGE_ID: imageId,
    SOAR_PATCH_MODE: "scripted", SOAR_PATCH_API_KEY: "", SOAR_PATCH_LOCAL_API_KEY: "",
    SOAR_TEST_WORKSPACE: "",
  };
}
async function launch(root: string, origin: string): Promise<ElectronApplication> {
  return electron.launch({
    ...(process.env.SOAR_E2E_EXECUTABLE ? { executablePath: process.env.SOAR_E2E_EXECUTABLE } : {}),
    args: [`--user-data-dir=${path.join(root, "browser-data")}`, ...(process.env.SOAR_E2E_EXECUTABLE ? [] : [projectRoot])],
    cwd: projectRoot, env: environment(root, origin), timeout: 45000,
  });
}
async function snapshots(page: Page): Promise<GeneralTaskSnapshot[]> {
  return page.evaluate(() => (globalThis as unknown as { soar: SoarGeneralTaskApi }).soar.listGeneralTasks());
}
async function selectAndStart(app: ElectronApplication, page: Page, inputPath: string, goal: string) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, inputPath);
  await page.getByTestId("general-task-entry").click();
  await expect(page.getByText("Ready for a general task", { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole("textbox", { name: "Task goal", exact: true }).fill(goal);
  await page.getByRole("textbox", { name: "Output filename", exact: true }).fill("report.html");
  await page.getByRole("button", { name: "Choose files", exact: true }).click();
  await expect(page.getByRole("list", { name: "Selected input files" })).toContainText("source.txt");
  const start = page.getByRole("button", { name: "Create and start task", exact: true });
  await expect(start).toBeDisabled();
  await page.getByRole("checkbox", { name: /^I confirm that my task goal/u }).check();
  await expect(start).toBeEnabled();
  await start.click();
}
async function noContainer(id: string) {
  const endpoint = await DockerSandbox.currentEndpoint();
  await expect.poll(async () => (await exec("docker", ["--host", endpoint, "container", "ls", "--all", "--quiet",
    "--filter", "label=soar.private-sandbox-id", "--filter", `label=soar.private-job-id=${id}`], { timeout: 10000 })).stdout.trim(), { timeout: 20000 }).toBe("");
}
async function ledger(root: string, id: string) {
  const db = new Database(path.join(root, "desktop.sqlite"), { readonly: true, fileMustExist: true, timeout: 5000 });
  try {
    // One deferred read transaction gives all joins the same committed snapshot.
    return db.transaction(() => {
      const read = (sql: string) => (db.prepare(sql).all(id) as { value: string }[]).map(row => JSON.parse(row.value));
      return {
        dispatches: read("SELECT value FROM private_agent_dispatches WHERE job_id=? ORDER BY rowid"),
        events: read("SELECT value FROM private_agent_events WHERE job_id=? ORDER BY sequence"),
        claims: read("SELECT r.value FROM private_agent_run_claims r JOIN private_agent_contexts c ON c.id=r.context_id WHERE c.job_id=?"),
        record: read("SELECT value FROM general_tasks WHERE id=?")[0],
      };
    }).deferred() as {
      dispatches: { id: string; status: string; feeMicrousd: number; reservedFeeMicrousd: number; packetSha256: string }[];
      events: Record<string, unknown>[]; claims: { state: string }[]; record: Record<string, unknown>;
    };
  } finally { db.close(); }
}
async function retain(testInfo: TestInfo, root: string, evidence: unknown) {
  await writeFile(testInfo.outputPath("evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  // These temporary databases and traces contain this self-authored synthetic fixture only.
  await cp(root, testInfo.outputPath("retained-state"), { recursive: true });
}

test.describe("desktop general tasks through real IPC, HTTP tools and Docker", () => {
  test.skip(process.env.SOAR_RUN_GENERAL_TASK_E2E !== "true", "Requires an explicitly frozen app build and the installed immutable offline image; no live model is used.");
  test.skip(!/^sha256:[a-f0-9]{64}$/u.test(imageId), "Supply the already qualified immutable SOAR_GENERAL_TASK_IMAGE_ID; the fixture never pulls or selects an image tag.");
  test.setTimeout(240000);

  test("pauses, restarts, resumes and exports a snapshot-bound inert artifact", async ({}, testInfo) => {
    const root = await mkdtemp(path.join(tmpdir(), "soar-general-e2e-"));
    const model = await generalTaskModelFixture();
    const source = path.join(root, "source.txt");
    const result = `<!doctype html><html><body><h1>Synthetic result — 你好</h1><script>globalThis.SOAR_GENERATED_SCRIPT_EXECUTED = true; fetch('${model.origin}/canary')</script><img src="${model.origin}/canary"></body></html>\n`;
    let app: ElectronApplication | undefined;
    let evidence: Record<string, unknown> = { imageId, syntheticProtocolOnly: true };
    try {
      await writeFile(source, original);
      model.actions.push(
        { name: "execute", hold: true, arguments: { command: python(`from pathlib import Path; import hashlib; p=Path("input/01-source.txt"); assert hashlib.sha256(p.read_bytes()).hexdigest()=="${sha(original)}"; Path("output").mkdir(exist_ok=True); Path("output/checkpoint.txt").write_text("checkpoint retained\\n"); print("synthetic action complete")`) } },
        { name: "execute", arguments: { command: python(`from pathlib import Path; import base64, hashlib; assert Path("output/checkpoint.txt").read_text()=="checkpoint retained\\n"; assert hashlib.sha256(Path("input/01-source.txt").read_bytes()).hexdigest()=="${sha(original)}"; Path("output/report.html").write_bytes(base64.b64decode("${Buffer.from(result).toString("base64")}")); print("synthetic artifact saved")`) } },
        { name: "finish", arguments: { summary: "Synthetic artifact ready for host structural checks." } },
      );
      app = await launch(root, model.origin);
      let page = await app.firstWindow();
      await selectAndStart(app, page, source, "Create the synthetic HTML deliverable from the selected input.");
      await expect.poll(() => model.requests.length, { timeout: 45000 }).toBe(1);
      await page.getByRole("button", { name: "Pause task", exact: true }).click();
      model.release(1);
      await expect.poll(async () => (await snapshots(page))[0]?.status, { timeout: 45000 }).toBe("paused");
      await expect.poll(async () => (await snapshots(page))[0]?.cleanupConfirmed).toBe(true);
      const paused = (await snapshots(page))[0];
      expect(paused).toMatchObject({ modelCalls: 1, toolCalls: 1, canResume: true, independentAcceptance: "not_evaluated" });
      expect(paused.events.some(event => event.type === "checkpoint")).toBe(true);
      await noContainer(paused.id);
      const pausedLedger = await ledger(root, paused.id);
      expect(pausedLedger.dispatches).toHaveLength(1); expect(pausedLedger.dispatches[0].status).toBe("settled");
      evidence = { ...evidence, paused, pausedLedger };
      await page.screenshot({ path: testInfo.outputPath("general-task-paused.png"), fullPage: true });
      await app.close(); app = undefined;
      // A resumed task must use its native-picked immutable copy, never reopen this path.
      await writeFile(source, "Synthetic host file changed after input capture.\n");
      app = await launch(root, model.origin); page = await app.firstWindow();
      await page.getByTestId("general-task-entry").click();
      await expect(page.getByRole("button", { name: "Resume task", exact: true })).toBeEnabled({ timeout: 30000 });
      expect(model.requests).toHaveLength(1);
      const restored = (await snapshots(page))[0];
      expect(restored.id).toBe(paused.id); expect(restored.modelCalls).toBe(1);
      expect(restored.revision).toBeGreaterThanOrEqual(paused.revision);
      await page.getByRole("button", { name: "Resume task", exact: true }).click();
      await expect.poll(async () => (await snapshots(page))[0]?.status, { timeout: 60000 }).toBe("submitted");
      const submitted = (await snapshots(page))[0];
      expect(submitted).toMatchObject({ modelCalls: 3, toolCalls: 3, canResume: false, cleanupConfirmed: true, independentAcceptance: "not_evaluated" });
      expect(submitted.artifacts).toEqual([{ path: "output/report.html", bytes: Buffer.byteLength(result), sha256: sha(result) }]);
      expect(submitted.checks).toEqual([{ id: "desktop_artifact_structure", passed: true }]);
      expect(model.errors).toEqual([]); expect(model.requests).toHaveLength(3);
      const messages = model.requests[1].body.messages as { role: string; tool_call_id?: string; content?: string }[];
      expect(messages.some(message => message.role === "tool" && message.tool_call_id === "desktop-action-1")).toBe(true);
      expect(JSON.stringify(submitted.events)).not.toContain("synthetic action complete");
      expect(JSON.stringify(submitted)).not.toContain(root);
      const finalLedger = await ledger(root, submitted.id);
      expect(finalLedger.dispatches).toHaveLength(3);
      expect(finalLedger.dispatches.every(row => row.status === "settled" && row.feeMicrousd === 0 && row.reservedFeeMicrousd === 0)).toBe(true);
      expect(finalLedger.dispatches[0]).toEqual(pausedLedger.dispatches[0]);
      expect(finalLedger.claims.length).toBeGreaterThan(0); expect(finalLedger.claims.every(row => row.state === "released")).toBe(true);
      expect(finalLedger.events.filter(event => event.type === "session_started")).toEqual(pausedLedger.events.filter(event => event.type === "session_started"));
      await noContainer(submitted.id);
      const artifactRef = { id: submitted.id, path: "output/report.html", sha256: sha(result) };
      const staleDenied = await page.evaluate(async ref => {
        try { await (globalThis as unknown as { soar: SoarGeneralTaskApi }).soar.readGeneralTaskArtifact({ ...ref, sha256: "0".repeat(64) }); return false; }
        catch { return true; }
      }, artifactRef);
      expect(staleDenied).toBe(true);
      await page.getByRole("button", { name: "Preview output/report.html", exact: true }).click();
      const preview = page.getByRole("region", { name: "Artifact preview", exact: true });
      await expect(preview.locator("pre")).toHaveText(result.trimEnd());
      await expect(preview.locator("script,img,iframe,webview,a[href]")).toHaveCount(0);
      expect(await page.evaluate(() => (globalThis as unknown as { SOAR_GENERATED_SCRIPT_EXECUTED?: boolean }).SOAR_GENERATED_SCRIPT_EXECUTED)).toBeUndefined();
      expect(model.canaryRequests).toBe(0);
      await expect(page.getByText(/this task has not been independently evaluated for correctness/u)).toBeVisible();
      const destination = path.join(root, "exported.html");
      await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
      await page.getByRole("button", { name: "Export output/report.html", exact: true }).click();
      await expect(page.getByText("Artifact exported.", { exact: true })).toBeVisible();
      expect(await readFile(destination, "utf8")).toBe(result);
      expect(sha(await readFile(destination))).toBe(submitted.artifacts[0].sha256);
      expect(await readFile(source, "utf8")).toBe("Synthetic host file changed after input capture.\n");
      await page.screenshot({ path: testInfo.outputPath("general-task-submitted.png"), fullPage: true });
      evidence = { ...evidence, restored, submitted, finalLedger, exportedSha256: sha(await readFile(destination)), canaryRequests: model.canaryRequests };
    } finally {
      await app?.close();
      await model.close();
      await retain(testInfo, root, { ...evidence, requests: model.requests, fixtureErrors: model.errors });
      await rm(root, { recursive: true, force: true });
    }
  });

  test("durably cancels a settled tool action and never resumes it after restart", async ({}, testInfo) => {
    const root = await mkdtemp(path.join(tmpdir(), "soar-general-cancel-e2e-"));
    const model = await generalTaskModelFixture();
    let app: ElectronApplication | undefined;
    let evidence: Record<string, unknown> = { imageId, syntheticProtocolOnly: true };
    try {
      const source = path.join(root, "source.txt"); await writeFile(source, original);
      model.actions.push({ name: "execute", arguments: { command: python("import time; print('synthetic slow tool', flush=True); time.sleep(40)") } });
      app = await launch(root, model.origin); let page = await app.firstWindow();
      await selectAndStart(app, page, source, "Create a synthetic report; cancellation is exercised by this app fixture.");
      await expect.poll(async () => (await snapshots(page))[0]?.toolCalls, { timeout: 45000 }).toBe(1);
      await page.getByRole("button", { name: "Cancel task", exact: true }).click();
      await expect.poll(async () => (await snapshots(page))[0]?.cleanupConfirmed, { timeout: 45000 }).toBe(true);
      const cancelled = (await snapshots(page))[0];
      expect(cancelled).toMatchObject({ status: "cancelled", modelCalls: 1, toolCalls: 1, canResume: false, independentAcceptance: "not_evaluated", checks: [] });
      const settled = await ledger(root, cancelled.id);
      expect(settled.dispatches).toHaveLength(1); expect(settled.dispatches[0]).toMatchObject({ status: "settled", feeMicrousd: 0, reservedFeeMicrousd: 0 });
      expect(settled.claims.every(row => row.state === "released")).toBe(true);
      await noContainer(cancelled.id);
      await app.close(); app = await launch(root, model.origin); page = await app.firstWindow();
      await page.getByTestId("general-task-entry").click();
      await expect(page.getByRole("article", { name: "Selected general task" }).getByText("Cancelled", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Resume task", exact: true })).toHaveCount(0);
      const denied = await page.evaluate(async id => {
        try { await (globalThis as unknown as { soar: SoarGeneralTaskApi }).soar.resumeGeneralTask(id); return false; } catch { return true; }
      }, cancelled.id);
      expect(denied).toBe(true); expect(model.requests).toHaveLength(1); expect(model.errors).toEqual([]);
      expect((await ledger(root, cancelled.id)).dispatches).toEqual(settled.dispatches);
      expect(await readFile(source, "utf8")).toBe(original);
      evidence = { ...evidence, cancelled, ledger: settled, afterRestart: (await snapshots(page))[0], resumeDenied: denied };
    } finally {
      await app?.close(); await model.close();
      await retain(testInfo, root, { ...evidence, requests: model.requests, fixtureErrors: model.errors });
      await rm(root, { recursive: true, force: true });
    }
  });
});
