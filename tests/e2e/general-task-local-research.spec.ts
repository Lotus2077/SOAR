import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { researchModelServer } from "../helpers/desktop-research-server";
import { researchV4Reply, researchV4Sources } from "../helpers/research-v4-fixture";
import { adopt, proposedServingCard, writeCard } from "../helpers/serving-card-fixture";
import { SYNTHETIC_P10_REQUEST_SETTINGS } from "../helpers/serving-probe-fixture";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const imageId = process.env.SOAR_GENERAL_TASK_IMAGE_ID ?? "";
const goal = "Summarize what the two synthetic survey notes record, citing each fact.";
/** The report and claims ledger the scripted writer writes: one claim, quoted verbatim from the first input, and the two required sections. */
const sentence = "The orchard recorded twelve healthy trees during the autumn survey [C1].";
const report = `# Synthetic survey report\n\n${sentence}\n\n## Conflicting evidence\n\nnone found\n\n## Unanswered questions\n\nnone found\n`;
const ledger = { version: 1, claims: [{ id: "C1", sentence, sourceId: "input/01-alpha.md", quote: "The orchard recorded twelve healthy trees during the autumn survey." }] };
function python(source: string): string { return `python3 -c '${source.replaceAll("'", "'\\''")}'`; }

/**
 * Backlog item 13a, part 4b: one local research task through the built app, end to end. The beta folder is the app's (part 4a); the
 * card is the writer's synthetic card adopted with its default roles; one loopback endpoint answers the reading stage with the
 * research-v4 fixture replies and the writer with two scripted actions; the writer runs in the installed offline image. The owner's
 * verdict is recorded and its receipt exported and rowed as registry-row.py rows a research job. No model, network or pull is used.
 */
test("a local research task reads its files on the card, writes from the packet, and exports a research verdict receipt", async ({}, testInfo) => {
  test.skip(process.env.SOAR_RUN_LOCAL_RESEARCH_E2E !== "true", "Launches the built app with a window and runs the writer in Docker: run `pnpm build` first.");
  test.skip(!/^sha256:[a-f0-9]{64}$/u.test(imageId), "Supply the installed immutable image (SOAR_GENERAL_TASK_IMAGE_ID); nothing is pulled or downloaded.");
  test.skip(existsSync(path.join(projectRoot, ".env.local")) || existsSync(path.join(projectRoot, ".env")), "The checkout's own .env.local or .env would change the run.");
  test.setTimeout(300_000);
  const root = realpathSync(await mkdtemp(path.join(tmpdir(), "soar-local-research-e2e-"))), home = path.join(root, "browser-data"), beta = `${home} Research Beta`;
  const written = writeCard(root, adopt(proposedServingCard(), undefined, { defaults: true }));
  mkdirSync(path.join(root, "inputs"));
  const inputs = researchV4Sources().map(source => { const file = path.join(root, "inputs", path.basename(source.path)); writeFileSync(file, source.bytes); return file; });
  // The stage's requests carry no tools; the writer's do, and get its two actions in order; the judge's (no tools, no stage prompt) answer 500.
  const writer: string[] = [];
  const server = await researchModelServer((system, user, body) => {
    if (!Array.isArray(body.tools) || !body.tools.length) return researchV4Reply(system, user);
    writer.push(system);
    if (writer.length === 1) return { toolCall: { name: "execute", arguments: { command: python([
      "import json",
      "from pathlib import Path",
      "Path('output').mkdir(exist_ok=True)",
      `Path('output/report.md').write_text(${JSON.stringify(report)}, encoding='utf-8')`,
      `Path('output/claims.json').write_text(${JSON.stringify(JSON.stringify(ledger))}, encoding='utf-8')`,
      "print('report and claims ledger written')",
    ].join("\n")) } } };
    if (writer.length === 2) return { toolCall: { name: "finish", arguments: { summary: "Wrote the cited report from the research packet." } } };
    throw new Error("unplanned_writer_request");
  });
  const env: Record<string, string> = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "PATH", "SHELL", "TMPDIR", "USER", "DISPLAY", "XAUTHORITY", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name]!;
  }
  const app = await electron.launch({ ...(process.env.SOAR_E2E_EXECUTABLE ? { executablePath: process.env.SOAR_E2E_EXECUTABLE } : {}),
    args: [`--user-data-dir=${home}`, ...(process.env.SOAR_E2E_EXECUTABLE ? [] : [projectRoot])], cwd: projectRoot, timeout: 30000,
    env: { ...env, SOAR_PROVIDER_MODE: "local", SOAR_ENABLE_HYBRID_SIMULATION: "false", SOAR_VLLM_BASE_URL: server.baseUrl, SOAR_VLLM_MODEL: SYNTHETIC_P10_REQUEST_SETTINGS.model,
      SOAR_VLLM_API_KEY: "", SOAR_VLLM_COST_POLICY: "local_zero_cost", SOAR_ALLOW_INSECURE_VLLM_HTTP: "true", SOAR_STREAMING: "false", SOAR_REQUEST_TIMEOUT_MS: "30000",
      SOAR_GENERAL_TASK_IMAGE_ID: imageId, SOAR_PATCH_MODE: "scripted", SOAR_PATCH_API_KEY: "", SOAR_PATCH_LOCAL_API_KEY: "", SOAR_TEST_WORKSPACE: "",
      SOAR_ENABLE_LOCAL_RESEARCH_BETA: "true", SOAR_SERVING_CARD_FILE: written.path, SOAR_SERVING_CARD_SHA256: written.sha256 } });
  try {
    const page = await app.firstWindow({ timeout: 30000 });
    expect(app.windows()).toHaveLength(1);
    const receiptPath = path.join(root, "verdict-receipt.json");
    await app.evaluate(({ dialog }, { files, receipt }) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: receipt });
    }, { files: inputs, receipt: receiptPath });
    await page.getByTestId("general-task-entry").click();
    await expect(page.getByText("Ready for a general task", { exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole("textbox", { name: "Task goal", exact: true }).fill(goal);
    await page.getByRole("button", { name: "Choose files", exact: true }).click();
    await page.getByRole("checkbox", { name: /^Local research first \(beta\)/u }).check();
    await page.getByRole("checkbox", { name: /^I confirm that my task goal/u }).check();
    await page.getByRole("button", { name: "Create and start task", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Submitted for review" })).toBeVisible({ timeout: 240000 });
    // The badge, the stage's counts, and the stage before the writer.
    await expect(page.getByLabel("Research route")).toHaveText("Local research (beta) · serving card of " + JSON.parse(readFileSync(written.path, "utf8")).date + " · packet ready");
    const section = page.getByRole("region", { name: "Research stage" });
    await expect(section).toContainText("Extraction: 2 of 2 source passages read.");
    const first = (prefix: string) => server.requests.findIndex(request => request.system.startsWith(prefix));
    expect(["You index", "You plan", "You extract", "You write"].every(prefix => first(prefix) >= 0)).toBe(true);
    expect(writer).toHaveLength(2);
    // The owner's verdict, exported as a receipt and rowed with the research arm.
    await page.getByRole("radio", { name: "Accept", exact: true }).check();
    await page.getByRole("spinbutton", { name: "Your minutes on this job", exact: true }).fill("5");
    await page.getByRole("spinbutton", { name: "Manual interventions", exact: true }).fill("0");
    await page.getByRole("checkbox", { name: "I exported the deliverable through the app." }).check();
    await page.getByRole("button", { name: "Record verdict", exact: true }).click();
    await page.getByRole("button", { name: "Export verdict receipt", exact: true }).click();
    await expect.poll(() => existsSync(receiptPath), { timeout: 15000 }).toBe(true);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    await testInfo.attach("verdict-receipt.json", { body: JSON.stringify(receipt), contentType: "application/json" });
    expect(receipt).toMatchObject({ arm: "local-heavy-research", profile: "heavy", runStatus: "submitted", verdict: { decision: "accept", ownerMinutes: 5, interventions: 0 } });
    expect(receipt.modelCalls).toBeGreaterThan(writer.length);
    const row = JSON.parse(execFileSync("python3", ["-I", path.join(projectRoot, "scripts", "registry-row.py"), "--verdict-file", receiptPath, "--id", "e2e-local-research-1",
      "--batch", "local-research-beta", "--task", "e2e-00000000", "--family", "research", "--exposure", "fresh", "--verdict-by", "owner", "--lesson", "e2e"], { cwd: projectRoot, encoding: "utf8" }));
    expect(row).toMatchObject({ arm: "local-heavy-research", outcome: "accepted", family: "research" });
    // The beta folder holds the database; the folder the app would otherwise use stays absent or empty (part 4a).
    expect(existsSync(path.join(beta, "soar.sqlite"))).toBe(true);
    expect(existsSync(home) ? readdirSync(home) : []).toEqual([]);
  } finally {
    await app.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
