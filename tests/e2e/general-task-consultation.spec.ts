import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from "@playwright/test";
import Database from "better-sqlite3";
import type { GeneralTaskConsultationPreview, GeneralTaskSnapshot, SoarGeneralTaskApi } from "../../src/shared/general-task-contracts";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import type { DispatchReceipt } from "../../src/main/private-agent/store";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { generalTaskModelFixture } from "../helpers/general-task-model-fixture";
import { consultationDesktopEnvironment, generalTaskConsultantFixture, CONSULTANT_ADVICE, CONSULTANT_FIXTURE_KEY, CONSULTANT_MODEL } from "../helpers/general-task-consultation-fixture";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const imageId = process.env.SOAR_GENERAL_TASK_IMAGE_ID ?? "";
const exec = promisify(execFile);
const input = "Public synthetic source. Café and 你好.\n";
const question = "Suggest one check for this public synthetic input, without tools or a completion claim.";
const goal = "Preserve the selected synthetic input and create report.md. Consultation is optional advice, not acceptance.";
const output = "# Synthetic report\n\nOriginal input preserved. Consultant advice is not independent acceptance.\n";
const python = (source: string) => `python3 -c '${source.replaceAll("'", "'\\''")}'`;
const saveCommand = python(`from pathlib import Path; import base64,hashlib; assert hashlib.sha256(Path("input/01-source.txt").read_bytes()).hexdigest()=="${digest(input)}"; Path("output").mkdir(exist_ok=True); Path("output/report.md").write_bytes(base64.b64decode("${Buffer.from(output).toString("base64")}"))`);
type Event = Record<string, any>;
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function bounded<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(code)), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function fixture(testInfo: TestInfo, malformed = false) {
  const root = await mkdtemp(path.join(tmpdir(), "soar-consultation-e2e-"));
  const local = await generalTaskModelFixture(), consultant = await generalTaskConsultantFixture(malformed);
  const source = path.join(root, "source.txt"); await writeFile(source, input);
  local.actions.push({ name: "request_consultation", arguments: { question, artifactPaths: ["input/01-source.txt"] } });
  const evidence: Record<string, unknown> = { imageId, syntheticProtocolOnly: true, independentAcceptance: "not_evaluated" };
  let app: ElectronApplication | undefined, appCleanupConfirmed = true;
  const closeApp = async () => {
    const current = app; app = undefined;
    if (!current) return;
    try { await bounded(current.close(), 45000, "fixture_app_cleanup_timeout"); appCleanupConfirmed = true; }
    catch {
      const child = current.process();
      evidence.forcedAppKill = child.exitCode === null && child.signalCode === null ? child.kill("SIGKILL") : false;
      // A forced exit is retained as incomplete closure, never as normal cleanup.
      throw new Error("fixture_app_cleanup_unconfirmed");
    }
  };
  return {
    root, source, local, consultant, evidence,
    get app() { if (!app) throw new Error("fixture_app_missing"); return app; },
    async launch() {
      appCleanupConfirmed = false;
      app = await electron.launch({ ...(process.env.SOAR_E2E_EXECUTABLE ? { executablePath: process.env.SOAR_E2E_EXECUTABLE } : {}),
        args: [`--user-data-dir=${path.join(root, "browser-data")}`, ...(process.env.SOAR_E2E_EXECUTABLE ? [] : [projectRoot])],
        cwd: projectRoot, env: consultationDesktopEnvironment(root, local.origin, consultant.origin, imageId), timeout: 45000 });
      return app.firstWindow();
    },
    closeApp,
    async close() {
      let failure = false;
      try { await closeApp(); } catch { failure = true; }
      const servers = await Promise.allSettled([
        bounded(local.close(), 5000, "fixture_local_close_timeout"),
        bounded(consultant.close(), 5000, "fixture_consultant_close_timeout"),
      ]);
      if (servers.some(row => row.status === "rejected")) failure = true;
      let containersAbsent = false;
      try {
        const reader = new Database(path.join(root, "desktop.sqlite"), { readonly: true, fileMustExist: true, timeout: 5000 });
        let ids: string[];
        try { ids = (reader.prepare("SELECT id FROM general_tasks").all() as { id: string }[]).map(row => row.id); }
        finally { reader.close(); }
        const audits = ids.map(id => ledger(root, id)); evidence.finalLedgers = audits;
        for (let i = 0; i < ids.length; i++) await noContainer(ids[i]!, audits[i]!.claims.map(row => String(row.endpoint)));
        containersAbsent = true;
      } catch { failure = true; }
      const cleanupConfirmed = appCleanupConfirmed && containersAbsent && !failure;
      evidence.cleanupConfirmed = cleanupConfirmed;
      evidence.appCleanupConfirmed = appCleanupConfirmed;
      evidence.containersAbsent = containersAbsent;
      if (!cleanupConfirmed) evidence.retainedOriginalDirectory = root;
      // Failure evidence and original temp state survive any unconfirmed closure.
      await writeFile(testInfo.outputPath("evidence.json"), `${JSON.stringify({ ...evidence, localRequests: local.requests,
        consultantRequests: consultant.requests, consultantResponses: consultant.responses,
        fixtureErrors: [...local.errors, ...consultant.errors] }, null, 2)}\n`);
      await cp(root, testInfo.outputPath("retained-state"), { recursive: true });
      if (cleanupConfirmed) await rm(root, { recursive: true, force: true });
      else throw new Error("fixture_cleanup_unconfirmed_original_retained");
    },
  };
}
async function snapshots(page: Page): Promise<GeneralTaskSnapshot[]> {
  return page.evaluate(() => (globalThis as unknown as { soar: SoarGeneralTaskApi }).soar.listGeneralTasks());
}
async function first(page: Page) { const rows = await snapshots(page); expect(rows).toHaveLength(1); return rows[0]!; }
async function noContainer(id: string, endpoints?: string[]) {
  const exact = [...new Set(endpoints?.length ? endpoints : [await DockerSandbox.currentEndpoint()])];
  for (const endpoint of exact) {
  if (!endpoint.startsWith("unix://")) throw new Error("fixture_docker_endpoint_invalid");
  await expect.poll(async () => (await exec("docker", ["--host", endpoint, "container", "ls", "--all", "--quiet",
    "--filter", "label=soar.private-sandbox-id", "--filter", `label=soar.private-job-id=${id}`], { timeout: 10000 })).stdout.trim(), { timeout: 20000 }).toBe("");
  }
}
function ledger(root: string, id: string) {
  const db = new Database(path.join(root, "desktop.sqlite"), { readonly: true, fileMustExist: true, timeout: 5000 });
  try {
    return db.transaction(() => {
      const read = (sql: string) => (db.prepare(sql).all(id) as { value: string }[]).map(row => JSON.parse(row.value));
      return { dispatches: read("SELECT value FROM private_agent_dispatches WHERE job_id=? ORDER BY rowid") as DispatchReceipt[],
        events: read("SELECT value FROM private_agent_events WHERE job_id=? ORDER BY sequence") as Event[],
        grants: read("SELECT value FROM private_agent_grants WHERE job_id=? ORDER BY rowid") as Event[],
        claims: read("SELECT r.value FROM private_agent_run_claims r JOIN private_agent_contexts c ON c.id=r.context_id WHERE c.job_id=?") as Event[],
        record: read("SELECT value FROM general_tasks WHERE id=?")[0] as Event };
    }).deferred();
  } finally { db.close(); }
}
async function startPending(f: Fixture, page: Page) {
  await f.app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, f.source);
  await page.getByTestId("general-task-entry").click();
  await expect(page.getByText("Ready for a general task", { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole("textbox", { name: "Task goal", exact: true }).fill(goal);
  await page.getByRole("combobox", { name: "Consultation mode", exact: true }).selectOption("ask_before_consulting");
  await page.getByRole("button", { name: "Choose files", exact: true }).click();
  await expect(page.getByRole("list", { name: "Selected input files" })).toContainText("source.txt");
  await expect(page.getByRole("textbox", { name: "Public source URLs (optional)" })).toHaveValue("");
  await page.getByRole("checkbox", { name: /^I confirm that my task goal/u }).check();
  await page.getByRole("button", { name: "Create and start task", exact: true }).click();
  await expect.poll(async () => (await first(page)).consultation?.state, { timeout: 45000 }).toBe("pending");
  await expect.poll(async () => (await first(page)).cleanupConfirmed, { timeout: 45000 }).toBe(true);
  const pending = await first(page);
  expect(pending).toMatchObject({ status: "paused", routing: "ask_before_consulting", modelCalls: 1, toolCalls: 1, canResume: false,
    independentAcceptance: "not_evaluated", fees: { reservedMicrousd: 0, settledMicrousd: 0 } });
  expect(f.local.requests).toHaveLength(1); expect(f.consultant.requests).toHaveLength(0);
  expect(f.local.requests[0]!.body.tools).toEqual(expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: "request_consultation" }) })]));
  await noContainer(pending.id); return pending;
}
function reference(task: GeneralTaskSnapshot) { return { id: task.id, proposalId: task.consultation!.proposalId, proposalSha256: task.consultation!.proposalSha256 }; }
async function blindApprovalDenied(page: Page, task: GeneralTaskSnapshot) {
  const denied = await page.evaluate(async ref => {
    try { await (globalThis as unknown as { soar: SoarGeneralTaskApi }).soar.decideGeneralTaskConsultation({ ...ref, decision: "approve" }); return false; }
    catch { return true; }
  }, reference(task)); expect(denied).toBe(true);
}
async function reviewPacket(f: Fixture, page: Page, task: GeneralTaskSnapshot): Promise<GeneralTaskConsultationPreview> {
  await expect(page.getByRole("button", { name: "Approve exact consultation", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Review consultation packet", exact: true }).click();
  const panel = page.getByRole("region", { name: "Exact consultation preview" }); await expect(panel).toBeVisible();
  const preview = await page.evaluate(ref => (globalThis as unknown as { soar: SoarGeneralTaskApi }).soar.previewGeneralTaskConsultation(ref), reference(task));
  expect(preview.proposalId).toBe(task.consultation!.proposalId); expect(preview.proposalSha256).toBe(task.consultation!.proposalSha256);
  expect(digest(preview.packet)).toBe(preview.packetSha256);
  expect(preview.selectedPaths).toEqual(["input/01-source.txt"]); expect(preview.omittedPaths).toEqual([]);
  expect(preview.destination).toEqual({ id: "desktop_consultant", endpoint: `${f.consultant.origin}/v1/chat/completions`, accountId: "synthetic-desktop-fixture", credentialVersion: 1 });
  expect(preview.prices).toEqual({ inputMicrousdPerMillion: 1000000, outputMicrousdPerMillion: 2000000 });
  const packet = JSON.parse(preview.packet), body = JSON.parse(packet.body), selected = JSON.parse(body.messages[1].content);
  expect(packet).toMatchObject({ method: "POST", url: preview.destination.endpoint, headers: { "content-type": "application/json" } });
  expect(body).toMatchObject({ model: CONSULTANT_MODEL, service_tier: "default" });
  expect(selected.files).toEqual([{ path: "input/01-source.txt", text: input }]);
  expect(selected.selected).toEqual([{ path: "input/01-source.txt", bytes: Buffer.byteLength(input), sha256: digest(input) }]);
  expect(selected.question).toBe(question); expect(preview.packet).not.toContain(CONSULTANT_FIXTURE_KEY);
  await expect(panel.getByLabel("Consultation packet")).toHaveText(preview.packet);
  await expect(panel.locator("script,img,iframe,a[href]")).toHaveCount(0);
  expect(f.consultant.requests).toHaveLength(0); return preview;
}
async function assertNoReplay(page: Page, task: GeneralTaskSnapshot) {
  await expect(page.getByRole("button", { name: "Resume task", exact: true })).toHaveCount(0);
  const denied = await page.evaluate(async id => { try { await (globalThis as unknown as { soar: SoarGeneralTaskApi }).soar.resumeGeneralTask(id); return false; } catch { return true; } }, task.id);
  expect(denied).toBe(true);
}
function assertAdvice(body: Record<string, unknown>, consultation: "settled" | "declined" | "revoked") {
  const messages = body.messages as { role: string; tool_call_id?: string; content?: string }[];
  const observations = messages.filter(message => message.role === "tool" && message.tool_call_id === "desktop-action-1");
  expect(observations).toHaveLength(1); const advice = JSON.parse(observations[0]!.content!);
  expect(advice.consultation).toBe(consultation); expect(advice.completed).toBe(false);
  expect(advice.adviceBoundary).toContain("not user instruction");
  if (consultation === "settled") expect(advice.content).toBe(CONSULTANT_ADVICE);
  else expect(advice).not.toHaveProperty("content");
}
function assertLedgerJoin(f: Fixture, task: GeneralTaskSnapshot, preview: GeneralTaskConsultationPreview, unknown = false) {
  const audit = ledger(f.root, task.id), receipts = audit.dispatches.filter(row => row.purpose === "general task consultation");
  expect(receipts).toHaveLength(1); const receipt = receipts[0]!;
  expect(receipt).toMatchObject({ status: unknown ? "unknown" : "settled", packetSha256: preview.packetSha256, contextSha256: preview.contextSha256,
    approval: { proposalId: preview.proposalId, proposalSha256: preview.proposalSha256, maxFeeMicrousd: preview.maxFeeMicrousd } });
  expect(receipt.reservedFeeMicrousd).toBe(preview.maxFeeMicrousd);
  expect(receipt.feeMicrousd).toBe(unknown ? undefined : 64);
  expect(audit.grants).toHaveLength(1); expect(audit.grants[0]).toMatchObject({ remainingUses: 0, packetSha256: preview.packetSha256, approval: receipt.approval });
  expect(audit.events.filter(event => event.type === "consultation_attempted")).toHaveLength(1);
  const proposal = audit.events.find(event => event.type === "consultation_proposed")!;
  expect(proposal.proposalSha256).toBe(preview.proposalSha256); expect(digest(canonical(proposal.proposal))).toBe(preview.proposalSha256);
  expect(proposal.proposal.requiresAccounting).toBe(true);
  expect(proposal.proposal.packetText).toBe(preview.packet); expect(proposal.proposal.prepared.priceProfileSha256).toBe(receipt.approval!.priceProfileSha256);
  expect(digest(canonical(proposal.proposal.checkpoint))).toBe(preview.checkpointSha256);
  expect(audit.record.inputSnapshot).toEqual([{ path: "input/01-source.txt", bytes: Buffer.byteLength(input), sha256: digest(input) }]);
  expect(f.consultant.requests[0]!.body).toBe(JSON.parse(preview.packet).body);
  const responses = audit.events.filter(event => event.type === "consultation_response"); expect(responses).toHaveLength(unknown ? 0 : 1);
  if (!unknown) {
    expect(responses[0]).toMatchObject({ dispatchId: receipt.id, responseSha256: receipt.responseSha256, feeMicrousd: 64, contentSha256: digest(CONSULTANT_ADVICE) });
    expect(responses[0]!.accounting).toEqual({ model: CONSULTANT_MODEL, serviceTier: "default",
      usage: { promptTokens: 32, completionTokens: 16, cachedInputTokens: 0 } });
    const wire = JSON.parse(f.consultant.responses[0]!);
    expect(wire).toMatchObject({ model: CONSULTANT_MODEL, service_tier: "default", usage: { prompt_tokens: 32, completion_tokens: 16, total_tokens: 48 } });
    // Independently recompute the fixture fee from durable usage and approved rates.
    const usage = responses[0]!.accounting.usage;
    expect(Math.ceil((usage.promptTokens * preview.prices.inputMicrousdPerMillion + usage.completionTokens * preview.prices.outputMicrousdPerMillion) / 1000000)).toBe(64);
    expect(responses[0]!.response).toEqual([{ path: `consultation/${preview.proposalId}.txt`, sha256: digest(CONSULTANT_ADVICE), bytes: Buffer.byteLength(CONSULTANT_ADVICE) }]);
    const retained = readFileSync(path.join(f.root, "general-tasks", "checkpoints", task.id, digest(CONSULTANT_ADVICE)));
    expect(retained.toString("utf8")).toBe(CONSULTANT_ADVICE);
    expect(receipt.responseSha256).toBe(digest(f.consultant.responses[0]!));
  }
  return audit;
}
function budget(body: Record<string, unknown>) {
  const messages = body.messages as { role: string; content?: string }[];
  const text = [...messages].reverse().find(row => row.role === "system" && row.content?.includes("Current host budget"))?.content;
  expect(text).toBeDefined(); return JSON.parse(text!.slice(text!.lastIndexOf("\n") + 1));
}
async function submittedAndExported(f: Fixture, page: Page, modelCalls: number, tools: number) {
  await expect.poll(async () => (await first(page)).status, { timeout: 60000 }).toBe("submitted");
  const task = await first(page); expect(task).toMatchObject({ modelCalls, toolCalls: tools, canResume: false, cleanupConfirmed: true, independentAcceptance: "not_evaluated" });
  expect(task.artifacts).toEqual([{ path: "output/report.md", bytes: Buffer.byteLength(output), sha256: digest(output) }]);
  expect(task.checks).toEqual([{ id: "desktop_artifact_structure", passed: true }]);
  await page.getByRole("button", { name: "Preview output/report.md", exact: true }).click();
  await expect(page.getByRole("region", { name: "Artifact preview" })).toContainText("Consultant advice is not independent acceptance");
  const destination = path.join(f.root, "exported.md");
  await f.app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
  await page.getByRole("button", { name: "Export output/report.md", exact: true }).click();
  await expect(page.getByText("Artifact exported.", { exact: true })).toBeVisible();
  expect(await readFile(destination, "utf8")).toBe(output); await noContainer(task.id);
  expect(JSON.stringify(task)).not.toContain(CONSULTANT_FIXTURE_KEY); expect(JSON.stringify(task)).not.toContain(f.root);
  expect(f.local.errors).toEqual([]); expect(f.consultant.errors).toEqual([]); return task;
}

test.describe("desktop exact consultation through IPC, local HTTP and offline Docker", () => {
  test.skip(process.env.SOAR_RUN_GENERAL_TASK_E2E !== "true", "Requires an explicitly frozen app build. All coordinator and consultant responses are localhost fixtures, not inference.");
  test.skip(!/^sha256:[a-f0-9]{64}$/u.test(imageId), "Requires the already installed qualified immutable image. No pull/build/tag selection.");
  test.setTimeout(240000);

  test("restarts pending, approves exact bytes, then resumes a settled-advice checkpoint without another consultation", async ({}, testInfo) => {
    const f = await fixture(testInfo);
    try {
      f.local.actions.push({ name: "execute", hold: true, arguments: { command: saveCommand } }, { name: "finish", arguments: { summary: "Synthetic output ready for structural checks only." } });
      let page = await f.launch(); const pending = await startPending(f, page);
      await blindApprovalDenied(page, pending); const beforePreview = await reviewPacket(f, page, pending), before = ledger(f.root, pending.id);
      await f.closeApp(); await writeFile(f.source, "Changed host file after immutable selection.\n");
      page = await f.launch(); await page.getByTestId("general-task-entry").click();
      await expect(page.getByRole("button", { name: "Review consultation packet", exact: true })).toBeVisible({ timeout: 30000 });
      const restored = await first(page); expect(restored.consultation).toEqual(pending.consultation);
      await blindApprovalDenied(page, restored); const preview = await reviewPacket(f, page, restored);
      expect(preview).toEqual(beforePreview); expect(ledger(f.root, pending.id).record.startedAt).toBe(before.record.startedAt);
      await page.screenshot({ path: testInfo.outputPath("consultation-preview.png"), fullPage: true });
      await page.getByRole("button", { name: "Approve exact consultation", exact: true }).click();
      await expect.poll(async () => (await first(page)).consultation?.state).toBe("approved");
      expect(f.consultant.requests).toHaveLength(0); expect(f.local.requests).toHaveLength(1);
      await page.getByRole("button", { name: "Resume task", exact: true }).click();
      await expect.poll(() => f.local.requests.length, { timeout: 45000 }).toBe(2);
      expect(f.consultant.requests).toHaveLength(1); assertAdvice(f.local.requests[1]!.body, "settled");
      expect(budget(f.local.requests[1]!.body).remainingModelCalls).toBe(18);
      await page.getByRole("button", { name: "Pause task", exact: true }).click(); f.local.release(2);
      await expect.poll(async () => (await first(page)).status, { timeout: 45000 }).toBe("paused");
      await expect.poll(async () => (await first(page)).cleanupConfirmed).toBe(true);
      const paused = await first(page); expect(paused).toMatchObject({ modelCalls: 3, toolCalls: 2, fees: { reservedMicrousd: 0, settledMicrousd: 64 }, consultation: { state: "settled", feeMicrousd: 64 } });
      const pausedAudit = assertLedgerJoin(f, paused, preview); expect(pausedAudit.dispatches).toHaveLength(3); await noContainer(paused.id);
      await f.closeApp(); page = await f.launch(); await page.getByTestId("general-task-entry").click();
      await expect(page.getByRole("button", { name: "Resume task", exact: true })).toBeEnabled({ timeout: 30000 });
      expect(await first(page)).toMatchObject({ modelCalls: 3, fees: { reservedMicrousd: 0, settledMicrousd: 64 } }); expect(f.consultant.requests).toHaveLength(1);
      const reopenedAudit = assertLedgerJoin(f, await first(page), preview);
      expect(reopenedAudit.dispatches).toEqual(pausedAudit.dispatches);
      expect(reopenedAudit.events.filter(event => event.type === "consultation_response")).toEqual(pausedAudit.events.filter(event => event.type === "consultation_response"));
      await page.getByRole("button", { name: "Resume task", exact: true }).click();
      const submitted = await submittedAndExported(f, page, 4, 3), final = assertLedgerJoin(f, submitted, preview);
      expect(f.local.requests).toHaveLength(3); expect(f.consultant.requests).toHaveLength(1); assertAdvice(f.local.requests[2]!.body, "settled");
      expect(budget(f.local.requests[2]!.body).remainingModelCalls).toBe(17);
      expect(final.dispatches).toHaveLength(4); expect(final.dispatches.slice(0, 3)).toEqual(pausedAudit.dispatches);
      expect(final.events.filter(event => event.type === "session_started")).toEqual(before.events.filter(event => event.type === "session_started"));
      expect(final.record.startedAt).toBe(before.record.startedAt); expect(final.record.phaseIdentity).toBe(before.record.phaseIdentity);
      expect(final.claims.every(row => row.state === "released")).toBe(true);
      f.evidence.completed = { pending, beforePreview, restored, paused, pausedAudit, reopenedAudit, submitted, final };
      await page.screenshot({ path: testInfo.outputPath("consultation-submitted.png"), fullPage: true });
    } finally { await f.close(); }
  });

  for (const decision of ["decline", "revoke"] as const) test(`${decision} permits explicit local continuation with no consultant dispatch`, async ({}, testInfo) => {
    const f = await fixture(testInfo);
    try {
      f.local.actions.push({ name: "execute", arguments: { command: saveCommand } }, { name: "finish", arguments: { summary: "Synthetic local-only continuation ready." } });
      const page = await f.launch(), pending = await startPending(f, page);
      if (decision === "revoke") { await reviewPacket(f, page, pending); await page.getByRole("button", { name: "Approve exact consultation", exact: true }).click();
        await expect.poll(async () => (await first(page)).consultation?.state).toBe("approved"); }
      await page.getByRole("button", { name: decision === "decline" ? "Decline consultation" : "Revoke consultation", exact: true }).click();
      const state = decision === "decline" ? "declined" : "revoked";
      await expect.poll(async () => (await first(page)).consultation?.state).toBe(state);
      expect(f.consultant.requests).toHaveLength(0); expect(f.local.requests).toHaveLength(1);
      await page.getByRole("button", { name: "Resume task", exact: true }).click();
      const submitted = await submittedAndExported(f, page, 3, 3), audit = ledger(f.root, submitted.id);
      expect(submitted.fees).toEqual({ reservedMicrousd: 0, settledMicrousd: 0 }); expect(audit.dispatches).toHaveLength(3);
      expect(audit.dispatches.every(row => row.status === "settled" && row.feeMicrousd === 0)).toBe(true);
      expect(audit.events.filter(row => ["consultation_attempted", "consultation_response"].includes(row.type))).toHaveLength(0);
      expect(audit.grants).toHaveLength(decision === "revoke" ? 1 : 0); if (decision === "revoke") expect(audit.grants[0]).toMatchObject({ revoked: true, remainingUses: 1 });
      assertAdvice(f.local.requests[1]!.body, state); expect(budget(f.local.requests[1]!.body).remainingModelCalls).toBe(19);
      expect(f.consultant.requests).toHaveLength(0); f.evidence.completed = { pending, submitted, audit };
    } finally { await f.close(); }
  });

  test("tool-bearing consultant response stays unknown with its reservation and cannot replay after restart", async ({}, testInfo) => {
    const f = await fixture(testInfo, true);
    try {
      let page = await f.launch(); const pending = await startPending(f, page), preview = await reviewPacket(f, page, pending);
      await page.getByRole("button", { name: "Approve exact consultation", exact: true }).click();
      await expect(page.getByRole("button", { name: "Resume task", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Resume task", exact: true }).click();
      await expect.poll(async () => (await first(page)).status, { timeout: 45000 }).toBe("incomplete");
      await expect.poll(async () => (await first(page)).cleanupConfirmed).toBe(true);
      const stopped = await first(page); expect(stopped).toMatchObject({ modelCalls: 2, toolCalls: 1, canResume: false, artifacts: [], checks: [],
        consultation: { state: "uncertain" }, fees: { reservedMicrousd: preview.maxFeeMicrousd, settledMicrousd: 0 } });
      const audit = assertLedgerJoin(f, stopped, preview, true);
      expect(audit.dispatches).toHaveLength(2); expect(f.local.requests).toHaveLength(1); expect(f.consultant.requests).toHaveLength(1);
      expect(audit.events.filter(row => row.type === "tool_started").map(row => row.name)).toEqual(["request_consultation"]);
      await noContainer(stopped.id); await f.closeApp(); page = await f.launch(); await page.getByTestId("general-task-entry").click();
      await expect(page.getByRole("region", { name: "Task consultation" })).toContainText("uncertain", { timeout: 30000 });
      await assertNoReplay(page, stopped);
      expect((await first(page)).fees).toEqual(stopped.fees); expect(ledger(f.root, stopped.id).dispatches).toEqual(audit.dispatches);
      expect(f.local.requests).toHaveLength(1); expect(f.consultant.requests).toHaveLength(1);
      expect(f.local.errors).toEqual([]); expect(f.consultant.errors).toEqual([]);
      f.evidence.completed = { stopped, preview, audit, afterRestart: await first(page) };
    } finally { await f.close(); }
  });
});
