// Trusted host operator for E5 Amendment 1. Only the scanner's published export enters the proxy's folder.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";

const STOCK_COMMIT = "c02366ab2dcc52a20b212d1784f48e02237d96ad";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDENTITY = { servedModel: "RM-01 VLM", modelRootBasename: "Qwen3.8-Flash-Next-NVFP4",
  engineVersion: "0.33.0rc1.dev617+g821038729", contextTokens: 262144 };
const INTAKE = ["acceptance.txt", "brief.txt", "input.txt"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const status = value => process.stdout.write(JSON.stringify(value) + "\n");
class Refusal extends Error {}
function requireValue(condition, reason) { if (!condition) throw new Refusal(reason); }
function command(executable, args, options = {}) {
  return execFileSync(executable, args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...options });
}
function inside(parent, child) { const rel = relative(parent, child); return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !rel.startsWith(sep)); }
function disjoint(left, right) { return !inside(left, right) && !inside(right, left); }
function privateRoot(argument) {
  const dir = realpathSync(argument);
  const info = lstatSync(argument);
  requireValue(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o077) === 0, "private_directory_required");
  return dir;
}
function exactNames(directory, names) {
  requireValue(lstatSync(directory).isDirectory() && readdirSync(directory).sort().join("\n") === names.slice().sort().join("\n"), "unexpected_handoff_files");
}
function writeRecord(path, record) { writeFileSync(path, JSON.stringify(record) + "\n", { mode: 0o600, flag: "wx" }); }
function stage(source, destination, policy) {
  try { command("python3", ["-I", join(ROOT, "scripts", "e5-proxy-stage.py"), "--source", source, "--out", destination], { input: policy, timeout: 60_000 }); }
  catch (error) {
    // Keep the scanner's closed refusal code, never its input, filename or diagnostic text.
    const code = String(error.stderr ?? "").trim();
    if (/^[a-z][a-z0-9_]{1,80}$/u.test(code)) throw new Refusal("scan_" + code);
    throw new Refusal("scan_refused");
  }
}
export function doctorMatches(report) {
  return report?.ready === true && report.card?.configured === false && report.image?.configuredMatchesQualified === true
    && Object.entries(IDENTITY).every(([field, value]) => report.model?.identity?.[field] === value);
}

export function competingWork(ps, ownElectronPid) {
  const rows = ps.split("\n").flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }] : [];
  });
  requireValue(rows.length > 0, "process_state_unavailable");
  const ours = new Set(ownElectronPid ? [ownElectronPid] : []);
  // A helper is ours only when its process ancestry ties it to this rehearsal.
  for (let count = -1; count !== ours.size;) {
    count = ours.size;
    for (const row of rows) if (ours.has(row.parent)) ours.add(row.pid);
  }
  return rows.some(row => {
    if (ours.has(row.pid)) return false;
    if (/\/SOAR\.app\/Contents\/MacOS\/SOAR(?:\s|$)/iu.test(row.command)) return true;
    if (/\/Electron\.app\/Contents\/MacOS\/Electron(?:\s|$)/u.test(row.command)
      && /(?:^|[\/\s])soar(?:[-.\s\/]|$)/iu.test(row.command)) return true;
    return /(?:^|\s)(?:[^\s]+\/)?(?:scripts\/)?(?:private-agent-local-screen|experiment-launcher|select-and-repair-loop|phase4-loop|serving-probe|planner-fixture|extractor-fixture|synthesis-fixture|judge-fixture|judge-labeller|assist-capture|setup-general)\.(?:ts|py)(?:\s|$)/u.test(row.command);
  });
}
function hostFree(ownElectronPid, ownJobId) {
  requireValue(!competingWork(command("ps", ["-ww", "-axo", "pid=,ppid=,command="]), ownElectronPid), "owner_app_or_harness_open");
  const rows = command("docker", ["ps", "--filter", "label=soar.private-sandbox-id", "--format", '{{.ID}}|{{.Label "soar.private-job-id"}}']).trim();
  requireValue(!rows || rows.split("\n").every(row => ownJobId && row.split("|")[1] === ownJobId), "active_soar_sandbox");
}
export async function confirmIdle(sample, wait = delay) {
  for (let i = 0; i < 3; i++) {
    if (i) await wait(20_000);
    const counts = await sample();
    requireValue(counts?.running === 0 && counts?.waiting === 0, "endpoint_busy_or_unreadable");
  }
}
async function idle(settings, parseMetrics, ownElectronPid) {
  const origin = new URL(settings.SOAR_VLLM_BASE_URL).origin;
  const headers = settings.SOAR_VLLM_API_KEY ? { authorization: "Bearer " + settings.SOAR_VLLM_API_KEY } : {};
  await confirmIdle(async () => {
    hostFree(ownElectronPid);
    const response = await fetch(origin + "/metrics", { headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
    requireValue(response.ok, "metrics_unavailable");
    return parseMetrics(await response.text());
  });
}
export function decisionFrom(record, digest) {
  requireValue(record && typeof record === "object" && Object.keys(record).sort().join(",") === "artifactSha256,decision,interventions,minutes"
    && record.artifactSha256 === digest && ["accept", "reject"].includes(record.decision)
    && Number.isSafeInteger(record.minutes) && record.minutes >= 0 && record.minutes <= 600
    && Number.isSafeInteger(record.interventions) && record.interventions >= 0 && record.interventions <= 99, "invalid_judgment");
  return record;
}
async function nextTask(page) {
  return page.evaluate(async () => {
    const rows = await window.soar.listGeneralTasks();
    if (rows.length === 0) return null;
    if (rows.length !== 1) return { status: "unexpected_task_count" };
    const task = rows[0];
    return { id: task.id, status: task.status, cleanup: task.cleanupConfirmed, profile: task.profile, routing: task.routing,
      sourceHash: task.inputs.length === 1 ? task.inputs[0].sha256 : null, network: Boolean(task.network),
      artifact: task.artifacts.find(file => file.path === "output/report.html")?.sha256, toolCalls: task.toolCalls };
  });
}
// A click can leave the app's form open or a saved task queued when start fails.
// Confirm the stock app's task, route and input before reporting dispatch or starting its run clock.
export async function confirmTaskStarted(read, inputHash, { wait = delay, timeoutMs = 30_000 } = {}) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Refusal("task_start_unconfirmed")), timeoutMs);
  });
  try {
    for (;;) {
      const task = await Promise.race([read(), deadline]);
      if (task) {
        requireValue(task.id && task.routing === "local_only" && task.profile === "heavy"
          && !task.network && task.sourceHash === inputHash, "unexpected_created_task");
        if (task.status === "running" || task.status === "submitted") return task;
        requireValue(task.status === "queued", "task_stopped");
      }
      await Promise.race([wait(500), deadline]);
    }
  } finally { clearTimeout(timer); }
}
async function saveThroughApp(app, page, label, destination, notice) {
  requireValue(!existsSync(destination), "export_already_exists");
  // Select the trusted destination at the native save dialog; the normal IPC handler still exports the verified bytes.
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, destination);
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByText(notice, { exact: true }).waitFor();
}
function safeEnvironment(settings, local) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "PATH", "TMPDIR", "SHELL", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DISPLAY", "XAUTHORITY"].includes(key)));
  return { ...env, ...settings, SOAR_PROVIDER_MODE: "local", SOAR_GENERAL_TASK_PROFILE: "heavy",
    SOAR_DB_PATH: join(local, "desktop.sqlite"), SOAR_PATCH_MODE: "scripted", SOAR_ENABLE_HYBRID_SIMULATION: "false", SOAR_TEST_WORKSPACE: "" };
}

export async function rehearse([stockArg, operatorArg, roleArg]) {
  requireValue(process.versions.node === "22.22.2" && !process.env.NODE_USE_ENV_PROXY && !process.env.PWDEBUG && !process.env.DEBUG, "unexpected_runtime");
  const stock = realpathSync(stockArg), operator = privateRoot(operatorArg), role = privateRoot(roleArg);
  requireValue(disjoint(operator, role) && disjoint(stock, operator) && disjoint(stock, role), "directory_overlap");
  const policyPath = realpathSync(process.env.SOAR_E5_SCAN_POLICY_FILE);
  const policyInfo = lstatSync(policyPath);
  requireValue(!inside(role, policyPath) && policyInfo.nlink === 1 && policyInfo.isFile() && policyInfo.uid === process.getuid() && (policyInfo.mode & 0o077) === 0, "private_scan_policy_required");
  requireValue(command("git", ["rev-parse", "HEAD"], { cwd: stock }).trim() === STOCK_COMMIT
    && command("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: stock }).trim() === "", "wrong_stock_checkout");
  requireValue(existsSync(join(stock, "out", "main", "index.js")), "stock_build_missing");
  const local = join(operator, "rehearsal"), intake = join(role, "intake"), dispatch = join(local, "dispatch");
  requireValue(!existsSync(local) && !existsSync(join(role, "exported")) && !existsSync(join(role, "judgment")), "fresh_rehearsal_required");
  exactNames(intake, INTAKE);
  const lock = join(tmpdir(), "soar-e5-rehearsal-" + process.getuid() + ".lock");
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new Refusal("operator_lock_unavailable"); }
  let app;
  try {
    mkdirSync(local, { mode: 0o700 });
    const policy = readFileSync(policyPath);
    stage(intake, dispatch, policy);
    exactNames(dispatch, INTAKE);
    const goal = readFileSync(join(dispatch, "brief.txt"), "utf8").trim(), input = join(dispatch, "input.txt");
    requireValue(goal.length > 0 && goal.length <= 16000, "invalid_brief");
    const inputHash = sha(readFileSync(input));
    writeRecord(join(local, "intake.json"), { goal: sha(Buffer.from(goal)), input: inputHash, acceptance: sha(readFileSync(join(dispatch, "acceptance.txt"))) });
    const load = path => import(pathToFileURL(join(stock, path)).href);
    const doctor = await load("scripts/setup-general.ts");
    const { vllmEndpointPolicyIssue } = await load("src/main/config.ts");
    const { parseMetrics } = await load("scripts/experiment-launcher.ts");
    const settingsFile = doctor.userDataEnvFile();
    const settings = doctor.resolveSettings(process.env, settingsFile, join(stock, ".env.local"));
    requireValue(settings.SOAR_VLLM_COST_POLICY === "local_zero_cost" && settings.SOAR_VLLM_BASE_URL && !vllmEndpointPolicyIssue(settings), "endpoint_policy_refused");
    await idle(settings, parseMetrics);
    const doctorDay = new Date().toISOString().slice(0, 10);
    const report = await doctor.runGeneralSetup({ cwd: stock, userDataFile: settingsFile, env: { ...process.env, ...settings, SOAR_GENERAL_TASK_PROFILE: "heavy" },
      write: false, nodeVersion: process.version, probes: doctor.liveProbes });
    requireValue(doctorMatches(report), "doctor_or_identity_refused");
    status({ status: "doctor_ready" });
    const { _electron: electron } = createRequire(join(stock, "package.json"))("@playwright/test");
    const executablePath = createRequire(join(stock, "package.json"))("electron");
    const userData = join(local, "browser-data");
    mkdirSync(userData, { mode: 0o700 });
    hostFree();
    app = await electron.launch({ executablePath, args: ["--user-data-dir=" + userData, stock], cwd: stock, env: safeEnvironment(settings, local), timeout: 45_000 });
    requireValue(await app.evaluate(({ app }) => app.getPath("userData")) === userData, "wrong_app_user_data");
    const page = await app.firstWindow();
    await page.getByTestId("general-task-entry").click();
    await page.getByText("Ready for a general task", { exact: true }).waitFor();
    requireValue(await page.evaluate(async () => (await window.soar.listGeneralTasks()).length === 0
      && (await window.soar.getGeneralTaskAvailability()).executionMode === "local"), "wrong_task_runtime");
    await page.getByRole("textbox", { name: "Task goal", exact: true }).fill(goal);
    await page.getByRole("textbox", { name: "Output filename", exact: true }).fill("report.html");
    await page.getByLabel("Consultation mode", { exact: true }).selectOption("local_only");
    await page.getByLabel("Model profile", { exact: true }).selectOption("heavy");
    requireValue(await page.getByLabel("Public source URLs (optional)", { exact: true }).inputValue() === "", "public_urls_present");
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, input);
    await page.getByRole("button", { name: "Choose files", exact: true }).click();
    await page.getByRole("list", { name: "Selected input files" }).getByText("input.txt", { exact: true }).waitFor();
    await page.getByRole("checkbox", { name: /^I confirm that my task goal/u }).check();
    await idle(settings, parseMetrics, app.process().pid);
    requireValue(new Date().toISOString().startsWith(doctorDay), "doctor_day_changed");
    const submittedAt = Date.now();
    await page.getByRole("button", { name: "Create and start task", exact: true }).click();
    let task = await confirmTaskStarted(() => nextTask(page), inputHash);
    const taskId = task.id;
    status({ status: "dispatched" });
    let lastCheck = 0;
    while (task.status !== "submitted" || !task.cleanup) {
      if (Date.now() - lastCheck >= 10_000) {
        hostFree(app.process().pid, taskId);
        lastCheck = Date.now();
      }
      requireValue(Date.now() - submittedAt < 95 * 60_000, "task_deadline");
      await delay(2_000);
      task = await nextTask(page);
      requireValue(task?.id === taskId, "task_record_changed");
      requireValue(task.status === "running" || task.status === "submitted", "task_stopped");
    }
    requireValue(task.profile === "heavy" && !task.network && task.sourceHash === inputHash && /^[a-f0-9]{64}$/u.test(task.artifact ?? ""), "unexpected_task_result");
    const produced = join(local, "export");
    mkdirSync(produced, { mode: 0o700 });
    await saveThroughApp(app, page, "Export output/report.html", join(produced, "report.html"), "Artifact exported.");
    requireValue(sha(readFileSync(join(produced, "report.html"))) === task.artifact, "export_digest_mismatch");
    stage(produced, join(role, "exported"), policy);
    requireValue(sha(readFileSync(join(role, "exported", "report.html"))) === task.artifact, "published_digest_mismatch");
    status({ status: "export_ready", artifactSha256: task.artifact, toolCalls: task.toolCalls });
    const decisionDir = join(role, "judgment"), until = Date.now() + 24 * 60 * 60_000;
    while (!existsSync(join(decisionDir, "decision.json"))) {
      requireValue(Date.now() < until, "judgment_deadline");
      await delay(2_000);
    }
    exactNames(decisionDir, ["decision.json"]);
    const judged = join(local, "judgment");
    stage(decisionDir, judged, policy);
    const decision = decisionFrom(JSON.parse(readFileSync(join(judged, "decision.json"), "utf8")), task.artifact);
    await page.getByRole("radio", { name: decision.decision === "accept" ? "Accept" : "Reject", exact: true }).check();
    await page.getByLabel("Your minutes on this job", { exact: true }).fill(String(decision.minutes));
    await page.getByLabel("Manual interventions", { exact: true }).fill(String(decision.interventions));
    await page.getByRole("checkbox", { name: "I exported the deliverable through the app.", exact: true }).check();
    await page.getByRole("button", { name: "Record verdict", exact: true }).click();
    const receiptPath = join(local, "receipt.json");
    await saveThroughApp(app, page, "Export verdict receipt", receiptPath, "Verdict receipt exported.");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    requireValue(receipt.version === 1 && receipt.taskId === task.id && receipt.arm === "local-heavy" && receipt.profile === "heavy" && receipt.usd === 0
      && receipt.runStatus === "submitted" && receipt.entailment === null && receipt.verdict?.decision === decision.decision
      && receipt.verdict.ownerMinutes === decision.minutes && receipt.verdict.interventions === decision.interventions && receipt.verdict.exportedThroughApp === true,
    "receipt_mismatch");
    status({ status: "receipt_ready" });
  } finally {
    try { await app?.close(); } finally { rmdirSync(lock); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes("--help") || process.argv.length !== 5) {
    process.stdout.write("node --import tsx scripts/e5-proxy-rehearsal.mjs STOCK_CHECKOUT OPERATOR_ROOT ROLE_ROOT\nSet SOAR_E5_SCAN_POLICY_FILE. Requires a scheduled exclusive endpoint window.\n");
    process.exitCode = process.argv.includes("--help") ? 0 : 2;
  } else {
    process.umask(0o077);
    try { await rehearse(process.argv.slice(2)); }
    catch (error) { status({ status: "stopped", reason: error instanceof Refusal ? error.message : "operator_error" }); process.exitCode = 1; }
  }
}
