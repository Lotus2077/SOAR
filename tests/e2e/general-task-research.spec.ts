import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from "@playwright/test";
import Database from "better-sqlite3";
import type { GeneralTaskSnapshot, SoarGeneralTaskApi } from "../../src/shared/general-task-contracts";
import { canonical } from "../../src/main/private-agent/contracts";
import type { DispatchReceipt } from "../../src/main/private-agent/store";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { digest, generalTaskResearchFixture, researchReport, researchSources, unknownSourceUrl } from "../helpers/general-task-research-fixture";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const imageId = process.env.SOAR_GENERAL_TASK_IMAGE_ID ?? "";
const dnsResolver = process.env.SOAR_RESEARCH_E2E_DNS ?? "system";
const exec = promisify(execFile);
const goal = "Use the three approved synthetic sources to report each label and widget quantity, cite every exact source URL, and calculate the combined quantity. No files are attached.";

function environment(root: string, origin: string): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "PATH", "SHELL", "TMPDIR", "USER", "DISPLAY", "XAUTHORITY", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]) {
    if (process.env[name] !== undefined) inherited[name] = process.env[name]!;
  }
  return { ...inherited, SOAR_PROVIDER_MODE: "local", SOAR_ENABLE_HYBRID_SIMULATION: "false",
    SOAR_DB_PATH: path.join(root, "desktop.sqlite"), SOAR_VLLM_BASE_URL: `${origin}/v1`,
    SOAR_VLLM_MODEL: "synthetic-research-tools", SOAR_VLLM_API_KEY: "", SOAR_VLLM_COST_POLICY: "local_zero_cost",
    SOAR_ALLOW_INSECURE_VLLM_HTTP: "true", SOAR_MAX_OUTPUT_TOKENS: "4096", SOAR_REQUEST_TIMEOUT_MS: "30000",
    SOAR_GENERAL_TASK_IMAGE_ID: imageId, SOAR_PATCH_MODE: "scripted", SOAR_PATCH_API_KEY: "", SOAR_PATCH_LOCAL_API_KEY: "", SOAR_TEST_WORKSPACE: "" };
}
async function launch(root: string, origin: string): Promise<ElectronApplication> {
  return electron.launch({ ...(process.env.SOAR_E2E_EXECUTABLE ? { executablePath: process.env.SOAR_E2E_EXECUTABLE } : {}),
    args: [`--user-data-dir=${path.join(root, "browser-data")}`, ...(process.env.SOAR_E2E_EXECUTABLE ? [] : [projectRoot])],
    cwd: projectRoot, env: environment(root, origin), timeout: 45000 });
}
async function snapshots(page: Page): Promise<GeneralTaskSnapshot[]> {
  return page.evaluate(() => (globalThis as unknown as { soar: SoarGeneralTaskApi }).soar.listGeneralTasks());
}
async function startWithoutFiles(app: ElectronApplication, page: Page, urls: string[], taskGoal: string): Promise<void> {
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => { throw new Error("research_fixture_must_not_pick_files"); }; });
  await page.getByTestId("general-task-entry").click();
  await expect(page.getByText("Ready for a general task", { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole("textbox", { name: "Task goal", exact: true }).fill(taskGoal);
  await page.getByRole("textbox", { name: "Output filename", exact: true }).fill("research.md");
  await page.getByRole("textbox", { name: "Public source URLs (optional)", exact: true }).fill(urls.join("\n"));
  await page.getByRole("combobox", { name: "Hostname lookup", exact: true }).selectOption(dnsResolver);
  const start = page.getByRole("button", { name: "Create and start task", exact: true });
  await expect(start).toBeDisabled();
  await page.getByRole("checkbox", { name: /^I confirm that my task goal/u }).check();
  await expect(start).toBeDisabled();
  await page.getByRole("checkbox", { name: /^Allow SOAR to retrieve only these public URLs/u }).check();
  await expect(start).toBeEnabled();
  await start.click();
}
interface SourceEvent {
  type: "public_source_retained"; contextId: string; dispatchId: string; destinationId: string; url: string;
  sha256: string; bytes: number; retrievedAt: number; snapshot: { path: string; sha256: string; bytes: number }[];
}
interface Ledger {
  record: Record<string, unknown>; dispatches: DispatchReceipt[]; events: Record<string, unknown>[];
  claims: { state: string }[]; contexts: { id: string; jobId: string; sources: { classification: string }[] }[];
}
function ledger(root: string, id: string): Ledger {
  const db = new Database(path.join(root, "desktop.sqlite"), { readonly: true, fileMustExist: true, timeout: 5000 });
  try {
    return db.transaction(() => {
      const read = (sql: string) => (db.prepare(sql).all(id) as { value: string }[]).map(row => JSON.parse(row.value));
      return { record: read("SELECT value FROM general_tasks WHERE id=?")[0],
        dispatches: read("SELECT value FROM private_agent_dispatches WHERE job_id=? ORDER BY rowid"),
        events: read("SELECT value FROM private_agent_events WHERE job_id=? ORDER BY sequence"),
        claims: read("SELECT r.value FROM private_agent_run_claims r JOIN private_agent_contexts c ON c.id=r.context_id WHERE c.job_id=?"),
        contexts: read("SELECT value FROM private_agent_contexts WHERE job_id=?") } as Ledger;
    }).deferred();
  } finally { db.close(); }
}
async function verifySources(root: string, snapshot: GeneralTaskSnapshot, rows: Ledger, count: number): Promise<void> {
  expect(snapshot.sources).toHaveLength(count);
  const events = rows.events.filter(event => event.type === "public_source_retained") as unknown as SourceEvent[];
  expect(events).toHaveLength(count);
  for (let i = 0; i < count; i++) {
    const expected = researchSources[i], source = snapshot.sources![i], event = events[i];
    expect(source).toMatchObject({ url: expected.url, sha256: expected.sha256, bytes: expected.bytes });
    expect(event).toMatchObject({ contextId: expect.any(String),
      destinationId: `desktop_web_${i + 1}`, ...source,
      snapshot: [{ path: `public-sources/${source.dispatchId}.bin`, sha256: expected.sha256, bytes: expected.bytes }] });
    const request = rows.dispatches.find(row => row.id === source.dispatchId)!;
    expect(request).toMatchObject({ jobId: snapshot.id, contextId: event.contextId, destinationId: event.destinationId,
      purpose: "public source retrieval", status: "settled", responseSha256: expected.sha256, feeMicrousd: 0, reservedFeeMicrousd: 0,
      packetSha256: digest(canonical({ method: "GET", url: expected.url, headers: {}, body: "" })) });
    expect(event.retrievedAt).toBeGreaterThanOrEqual(request.committedAt);
    const context = rows.contexts.find(row => row.id === event.contextId)!;
    expect(context.jobId).toBe(snapshot.id); expect(context.sources.length).toBeGreaterThan(0);
    expect(context.sources.every(row => row.classification === "public")).toBe(true);
    // Read the host-owned blob by the known fixture digest; never execute candidate code.
    const bytes = await readFile(path.join(root, "general-tasks", "checkpoints", snapshot.id, expected.sha256));
    expect(bytes.equals(Buffer.from(expected.text))).toBe(true); expect(digest(bytes)).toBe(expected.sha256);
  }
}
async function noContainer(id: string): Promise<void> {
  const endpoint = await DockerSandbox.currentEndpoint();
  await expect.poll(async () => (await exec("docker", ["--host", endpoint, "container", "ls", "--all", "--quiet",
    "--filter", "label=soar.private-sandbox-id", "--filter", `label=soar.private-job-id=${id}`], { timeout: 10000 })).stdout.trim(), { timeout: 20000 }).toBe("");
}
async function retain(testInfo: TestInfo, root: string, evidence: unknown): Promise<void> {
  await writeFile(testInfo.outputPath("evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await cp(root, testInfo.outputPath("retained-state"), { recursive: true });
}
async function closeAndRetain(app: ElectronApplication | undefined, model: Awaited<ReturnType<typeof generalTaskResearchFixture>>,
  testInfo: TestInfo, root: string, evidence: Record<string, unknown>): Promise<void> {
  let appClosed = !app;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (app) await Promise.race([app.close(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("research_fixture_app_close_timeout")), 45000);
    })]);
    appClosed = true;
  } finally {
    clearTimeout(timer);
    try { await model.close(); }
    finally {
      await retain(testInfo, root, { ...evidence, appClosed, modelRequests: model.requests, fixtureErrors: model.errors });
      // Keep original state if the outer owner must still reconcile app cleanup.
      if (appClosed) await rm(root, { recursive: true, force: true });
    }
  }
}

test.describe("desktop public research through real HTTPS and scripted local tools", () => {
  test.skip(process.env.SOAR_RUN_GENERAL_TASK_RESEARCH_E2E !== "true", "Requires separately frozen app and exact public HTTPS preflight; no real model is used.");
  test.skip(!/^sha256:[a-f0-9]{64}$/u.test(imageId), "Supply the already qualified immutable image; no image is pulled.");
  test.skip(!["system", "cloudflare_v1"].includes(dnsResolver), "Choose an explicit, preflighted system or Cloudflare resolver.");
  test.setTimeout(240000);

  test("retains source bytes across pause/restart and exports a cited goal-only report", async ({}, testInfo) => {
    const root = await mkdtemp(path.join(tmpdir(), "soar-research-e2e-"));
    const model = await generalTaskResearchFixture("success");
    let app: ElectronApplication | undefined;
    let evidence: Record<string, unknown> = { imageId, dnsResolver, scriptedModel: true, transport: "real_public_https" };
    try {
      app = await launch(root, model.origin); let page = await app.firstWindow();
      await startWithoutFiles(app, page, researchSources.map(source => source.url), goal);
      await expect.poll(() => model.requests.length, { timeout: 45000 }).toBe(1);
      // Pause lets the already admitted response/action settle, then stops before another model turn.
      await page.getByRole("button", { name: "Pause task", exact: true }).click(); model.release(1);
      await expect.poll(async () => (await snapshots(page))[0]?.status, { timeout: 45000 }).toBe("paused");
      await expect.poll(async () => (await snapshots(page))[0]?.cleanupConfirmed).toBe(true);
      const paused = (await snapshots(page))[0], pausedLedger = ledger(root, paused.id);
      expect(paused).toMatchObject({ inputs: [], modelCalls: 1, toolCalls: 1, publicFetches: 1, canResume: true,
        network: { urls: researchSources.map(source => source.url), dnsResolver, maxFetches: 5, maxResponseBytes: 65536 }, independentAcceptance: "not_evaluated" });
      expect(pausedLedger.record).toMatchObject({ version: 2, inputs: [], inputSnapshot: [], goal, outputName: "research.md" });
      expect(pausedLedger.dispatches).toHaveLength(2);
      await verifySources(root, paused, pausedLedger, 1); await noContainer(paused.id);
      evidence = { ...evidence, paused, pausedLedger };
      await page.screenshot({ path: testInfo.outputPath("research-paused.png"), fullPage: true });
      await app.close(); app = undefined;
      app = await launch(root, model.origin); page = await app.firstWindow();
      await page.getByTestId("general-task-entry").click();
      await expect(page.getByRole("button", { name: "Resume task", exact: true })).toBeEnabled({ timeout: 30000 });
      const restored = (await snapshots(page))[0];
      expect(restored).toMatchObject({ id: paused.id, modelCalls: 1, toolCalls: 1, publicFetches: 1, network: paused.network, sources: paused.sources });
      expect(model.requests).toHaveLength(1); expect(ledger(root, paused.id).dispatches).toEqual(pausedLedger.dispatches);
      await page.getByRole("button", { name: "Resume task", exact: true }).click();
      await expect.poll(async () => (await snapshots(page))[0]?.status, { timeout: 90000 }).toBe("submitted");
      const final = (await snapshots(page))[0], finalLedger = ledger(root, final.id);
      expect(final).toMatchObject({ inputs: [], modelCalls: 5, toolCalls: 5, publicFetches: 3, cleanupConfirmed: true, canResume: false, independentAcceptance: "not_evaluated" });
      expect(final.artifacts).toEqual([{ path: "output/research.md", bytes: Buffer.byteLength(researchReport), sha256: digest(researchReport) }]);
      expect(final.checks).toEqual([{ id: "desktop_artifact_structure", passed: true }]);
      expect(model.errors).toEqual([]); expect(model.requests).toHaveLength(5);
      expect(finalLedger.dispatches).toHaveLength(8);
      expect(finalLedger.dispatches.every(row => row.status === "settled" && row.feeMicrousd === 0 && row.reservedFeeMicrousd === 0)).toBe(true);
      expect(finalLedger.dispatches.slice(0, 2)).toEqual(pausedLedger.dispatches);
      expect(finalLedger.record.startedAt).toBe(pausedLedger.record.startedAt);
      expect(finalLedger.record.phaseIdentity).toBe(pausedLedger.record.phaseIdentity);
      expect(finalLedger.record.configurationIdentity).toBe(pausedLedger.record.configurationIdentity);
      expect(finalLedger.events.filter(event => event.type === "session_started")).toEqual(pausedLedger.events.filter(event => event.type === "session_started"));
      expect(finalLedger.claims.length).toBeGreaterThan(0); expect(finalLedger.claims.every(row => row.state === "released")).toBe(true);
      await verifySources(root, final, finalLedger, 3); await noContainer(final.id);
      const receiptRegion = page.getByRole("region", { name: "Host source receipts", exact: true });
      for (const source of researchSources) await expect(receiptRegion).toContainText(source.sha256);
      await expect(receiptRegion.locator("a[href],script,img,iframe")).toHaveCount(0);
      await page.getByRole("button", { name: "Preview output/research.md", exact: true }).click();
      const preview = page.getByRole("region", { name: "Artifact preview", exact: true });
      await expect(preview).toContainText("Total: 23 widgets.");
      for (const source of researchSources) await expect(preview).toContainText(JSON.parse(source.text).label);
      await expect(preview.locator("a[href],script,img,iframe")).toHaveCount(0);
      const destination = path.join(root, "exported-research.md");
      await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
      await page.getByRole("button", { name: "Export output/research.md", exact: true }).click();
      await expect(page.getByText("Artifact exported.", { exact: true })).toBeVisible();
      const exported = await readFile(destination);
      expect(exported.equals(Buffer.from(researchReport))).toBe(true); expect(digest(exported)).toBe(final.artifacts[0].sha256);
      await page.screenshot({ path: testInfo.outputPath("research-submitted.png"), fullPage: true });
      evidence = { ...evidence, restored, final, finalLedger, exportedSha256: digest(exported) };
    } finally {
      await closeAndRetain(app, model, testInfo, root, evidence);
    }
  });

  test("an uncertain public fetch stops the next model turn and cannot replay after restart", async ({}, testInfo) => {
    const root = await mkdtemp(path.join(tmpdir(), "soar-research-unknown-e2e-"));
    const model = await generalTaskResearchFixture("unknown");
    let app: ElectronApplication | undefined;
    let evidence: Record<string, unknown> = { imageId, dnsResolver, scriptedModel: true, transport: "real_public_https" };
    try {
      app = await launch(root, model.origin); let page = await app.firstWindow();
      await startWithoutFiles(app, page, [unknownSourceUrl], "Retrieve the explicitly approved public test source and create a report only if evidence arrives.");
      await expect.poll(async () => (await snapshots(page))[0]?.status, { timeout: 60000 }).toBe("incomplete");
      await expect.poll(async () => (await snapshots(page))[0]?.cleanupConfirmed).toBe(true);
      const stopped = (await snapshots(page))[0], stoppedLedger = ledger(root, stopped.id);
      expect(stopped).toMatchObject({ inputs: [], modelCalls: 1, toolCalls: 1, publicFetches: 1, sources: [], artifacts: [], checks: [], canResume: false, independentAcceptance: "not_evaluated" });
      expect(model.requests).toHaveLength(1); expect(model.errors).toEqual([]);
      expect(stoppedLedger.dispatches).toHaveLength(2);
      expect(stoppedLedger.dispatches[0]).toMatchObject({ purpose: "agent reasoning and tool selection", status: "settled", feeMicrousd: 0, reservedFeeMicrousd: 0 });
      expect(stoppedLedger.dispatches[1]).toMatchObject({ purpose: "public source retrieval", status: "unknown", reservedFeeMicrousd: 0,
        packetSha256: digest(canonical({ method: "GET", url: unknownSourceUrl, headers: {}, body: "" })) });
      expect(stoppedLedger.events.filter(event => event.type === "public_source_retained")).toEqual([]);
      expect(stoppedLedger.claims.length).toBeGreaterThan(0); expect(stoppedLedger.claims.every(row => row.state === "released")).toBe(true);
      await noContainer(stopped.id); evidence = { ...evidence, stopped, stoppedLedger };
      await page.screenshot({ path: testInfo.outputPath("research-unknown.png"), fullPage: true });
      await app.close(); app = undefined; app = await launch(root, model.origin); page = await app.firstWindow();
      await page.getByTestId("general-task-entry").click();
      await expect(page.getByRole("article", { name: "Selected general task" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Resume task", exact: true })).toHaveCount(0);
      const denied = await page.evaluate(async id => {
        try { await (globalThis as unknown as { soar: SoarGeneralTaskApi }).soar.resumeGeneralTask(id); return false; } catch { return true; }
      }, stopped.id);
      expect(denied).toBe(true); expect(model.requests).toHaveLength(1);
      expect(ledger(root, stopped.id).dispatches).toEqual(stoppedLedger.dispatches);
      evidence = { ...evidence, afterRestart: (await snapshots(page))[0], resumeDenied: denied };
    } finally {
      await closeAndRetain(app, model, testInfo, root, evidence);
    }
  });
});
