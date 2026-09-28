#!/usr/bin/env -S tsx
/** Private experiment inputs; all solver episodes use the application controller. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, readFile, mkdir, rm, writeFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createSoarDatabase } from "../src/main/database";
import { loadPatchRuntimeConfig } from "../src/main/patch-runs/config";
import { PatchRunController } from "../src/main/patch-runs/controller";
import { PatchRunStore } from "../src/main/patch-runs/store";
import { canonicalRequest } from "../src/main/patch-runs/native-contract";
import { digest, EvaluationReceiptSchema } from "../src/main/patch-runs/comparison";
import { RoutingComparisonStore, routingComparisonConfiguration, RoutingTaskContractSchema, runRoutingComparisonScreen,
  RoutingManifestSchema, routingArms, routingRuntimeConfigForArm, type RoutingManifest, type RoutingArm } from "../src/main/patch-runs/routing-comparison";
import { routingComparisonMarkdown, routingComparisonReport, joinRoutingIndependentReview } from "../src/main/patch-runs/routing-comparison-report";
import { verifyRoutingHistoricalAdmission, assertNoOwnedRoutingContainers, routingAdmissionLedgerSha256 } from "../src/main/patch-runs/routing-historical-admission";

const additionalCodePaths = ["scripts/routing-comparison.ts", "src/main/patch-runs/routing-comparison-report.ts"];
const routingCodePaths = (manifest: RoutingManifest) => manifest.schemaVersion === 2
  ? [...additionalCodePaths, "src/main/patch-runs/routing-comparison-review.ts", "src/main/patch-runs/routing-historical-admission.ts"] : additionalCodePaths;
const closureSha = z.string().regex(/^[a-f0-9]{64}$/u);
const AdmissionClosureSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal("routing-admission-closure-v1"),
  screenId: z.string(), configurationSha256: closureSha, manifestSha256: closureSha, ledgerSha256: closureSha,
  historicalReceiptSha256: closureSha.nullable(), passed: z.boolean(), reason: z.enum(["final_admission_revalidation_failed"]).nullable(),
}).strict().refine(value => value.passed === (value.reason === null));
export function routingArguments(argv: string[]) {
  const [command, ...rest] = argv;
  if (!command || !["freeze", "run", "report"].includes(command)) throw new Error("Use freeze, run or report.");
  const values: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    if (!key || !["--manifest", "--details", "--database", "--output", "--screen", "--review", "--historical-admission"].includes(key) || !value || value.startsWith("--") || values[key]) throw new Error("Invalid routing comparison arguments.");
    values[key] = value;
  }
  if (!values["--database"] || !values["--output"] || (command === "report" ? !values["--screen"] : !values["--manifest"] || !values["--details"])) throw new Error("Dedicated database, output and fixture identity are required.");
  if (command === "report" && (values["--manifest"] || values["--details"] || values["--historical-admission"]) || command !== "report" && (values["--screen"] || values["--review"])) throw new Error("Arguments do not belong to this command.");
  return { command, database: path.resolve(values["--database"]), output: path.resolve(values["--output"]),
    manifest: values["--manifest"] ? path.resolve(values["--manifest"]) : undefined,
    details: values["--details"] ? path.resolve(values["--details"]) : undefined, screenId: values["--screen"],
    ...(values["--review"] ? { review: path.resolve(values["--review"]) } : {}),
    ...(values["--historical-admission"] ? { historicalAdmission: path.resolve(values["--historical-admission"]) } : {}) };
}

/** Never take over an ambiguous lock. The operator must first establish that a
 * prior process and its accounting/cleanup obligations are resolved. */
export async function routingRunnerLock(database: string): Promise<() => Promise<void>> {
  await mkdir(path.dirname(database), { recursive: true, mode: 0o700 });
  try { if (!(await lstat(database)).isFile()) throw new Error("Stage database must be a regular file, not an alias."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const canonical = path.join(await realpath(path.dirname(database)), path.basename(database));
  const file = `${canonical}.routing-comparison.lock`, token = `${process.pid}:${randomUUID()}`;
  let handle;
  try { handle = await open(file, "wx", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Routing runner lock exists; inspect the prior owner before removing it."); throw error; }
  try { await handle.writeFile(token); } finally { await handle.close(); }
  return async () => {
    if (await readFile(file, "utf8") !== token) throw new Error("Runner lock identity changed; refusing to remove it.");
    await rm(file);
  };
}

async function readJson(file: string): Promise<unknown> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error("Experiment input must be a bounded regular file.");
  return JSON.parse(await readFile(file, "utf8"));
}

async function historicalAdmission(file: string | undefined, database: ReturnType<typeof createSoarDatabase>, manifest: RoutingManifest,
  expectedSha256?: string) {
  if (!file) return undefined;
  if (manifest.schemaVersion !== 2) throw new Error("Historical admission requires the V2 development profile.");
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error("Historical receipt must be a bounded regular file.");
  const bytes = await readFile(file), receiptSha256 = digest(bytes);
  if (expectedSha256 !== undefined && receiptSha256 !== expectedSha256) throw new Error("Frozen historical receipt bytes changed.");
  return verifyRoutingHistoricalAdmission(database, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    { screenId: manifest.screenId, receiptSha256 });
}

export function routingTaskContracts(raw: unknown, manifest: RoutingManifest) {
  const details = z.object({ schemaVersion: z.literal(1), screenId: z.string(), tasks: z.array(z.record(z.string(), z.unknown())).length(manifest.tasks.length) }).passthrough().parse(raw);
  if (details.screenId !== manifest.screenId) throw new Error("Task details belong to a different screen.");
  const contracts = details.tasks.map((row) => {
    const task = manifest.tasks.find((item) => item.taskId === row.taskId);
    if (!task || row.oracleSha256 !== task.oracle.sha256 || row.referencePatchSha256 !== task.referencePatch.sha256 ||
        row.visibleCommandSha256 !== digest(task.visibleCommand) || canonicalRequest(row.source) !== canonicalRequest(task.source)) throw new Error("Task details differ from their frozen public/acceptance identity.");
    return RoutingTaskContractSchema.parse({ taskId: row.taskId, allowedFiles: row.allowedFiles, sourceTreeSha256: row.sourceTreeSha256, expectedTests: row.expectedTests });
  });
  if (new Set(contracts.map((row) => row.taskId)).size !== manifest.tasks.length) throw new Error("Task details contain duplicate or missing task IDs.");
  return contracts.sort((a, b) => a.taskId.localeCompare(b.taskId));
}

/** Executes only the hash-bound trusted helper. Candidate/oracle code stays in
 * its network-disabled pinned container. Timeout gives cleanup its own grace. */
export async function evaluateRoutingPatch(options: { python: string; helper: string; helperSha256: string; args: string[]; logPath: string; signal?: AbortSignal;
  timeoutMs?: number; cleanupGraceMs?: number }): Promise<unknown> {
  if (digest(await readFile(options.helper)) !== options.helperSha256) throw new Error("Frozen evaluator code changed.");
  if (options.signal?.aborted) throw new Error("Evaluation cancelled before launch.");
  return new Promise((resolve, reject) => {
    const child = spawn(options.python, ["-I", options.helper, ...options.args], { stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONFIG: process.env.DOCKER_CONFIG,
        PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1" } });
    let stdout = "", log = "", bytes = 0, stopped = false, grace: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true; child.kill("SIGTERM");
      grace = setTimeout(() => child.kill("SIGKILL"), options.cleanupGraceMs ?? 45_000);
    };
    const receive = (chunk: Buffer, out: boolean) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) { stop(); return; }
      log += chunk.toString(); if (out) stdout += chunk.toString();
    };
    child.stdout.on("data", (chunk: Buffer) => receive(chunk, true)); child.stderr.on("data", (chunk: Buffer) => receive(chunk, false));
    const deadline = setTimeout(stop, options.timeoutMs ?? 180_000);
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
    const clear = () => { clearTimeout(deadline); if (grace) clearTimeout(grace); options.signal?.removeEventListener("abort", stop); };
    child.once("error", () => { clear(); reject(new Error("Evaluator could not start.")); });
    child.once("close", async (code, signal) => {
      clear();
      try {
        await writeFile(options.logPath, log, { flag: "wx", mode: 0o600 });
        if (stopped || signal) throw new Error("Evaluator interrupted; inspect retained receipt and cleanup, without replay.");
        const receipt = EvaluationReceiptSchema.parse(JSON.parse(stdout.trim().split("\n").at(-1)!));
        if (code !== receipt.exitCode) throw new Error("Evaluator exit code differs from its receipt.");
        resolve(receipt);
      } catch { reject(new Error("Evaluator returned an incomplete or inconsistent receipt; no retry is allowed.")); }
    });
  });
}

async function writeImmutable(file: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 2) + "\n";
  try { await writeFile(file, text, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(file, "utf8") !== text) throw new Error("Frozen public artifact already exists with another identity."); }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = routingArguments(argv), projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const release = options.command === "report" ? async () => {} : await routingRunnerLock(options.database);
  let database;
  try { database = createSoarDatabase(options.database, { readonly: options.command === "report" }); }
  catch (error) { await release(); throw error; }
  const controllers: PatchRunController[] = [];
  let screenId = options.screenId;
  let finalRevalidation: (() => Promise<void>) | undefined, historicalReceiptSha256: string | null = null;
  const abort = new AbortController(), cancel = () => abort.abort();
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try {
    await mkdir(options.output, { recursive: true, mode: 0o700 });
    if (options.command !== "report") {
      const manifest = RoutingManifestSchema.parse(await readJson(options.manifest!)); screenId = manifest.screenId;
      const history = await historicalAdmission(options.historicalAdmission, database, manifest);
      historicalReceiptSha256 = history?.receiptSha256 ?? null;
      if (!history && database.prepare("SELECT 1 FROM patch_comparison_screens LIMIT 1").get()) throw new Error("Use a dedicated routing-stage database; prior C/D/H studies must remain separate.");
      const contracts = routingTaskContracts(await readJson(options.details!), manifest);
      const config = { ...loadPatchRuntimeConfig({ cwd: projectRoot, appPath: projectRoot }), image: manifest.image };
      const configuration = await routingComparisonConfiguration(config, projectRoot, manifest, contracts, routingCodePaths(manifest), history);
      const screen = new RoutingComparisonStore(database); screen.freeze(manifest, configuration);
      const publicFreeze = database.prepare("SELECT frozen_json FROM patch_routing_screens WHERE id = ?").get(screenId) as { frozen_json: string };
      await writeImmutable(path.join(options.output, "frozen.json"), JSON.parse(publicFreeze.frozen_json));
      if (options.command === "run") {
        const scope = screen.runIds(screenId), store = new PatchRunStore(database);
        const unrelated = (database.prepare("SELECT id FROM patch_runs").all() as { id: string }[]).filter((row) => !scope.includes(row.id));
        if (history) {
          await historicalAdmission(options.historicalAdmission, database, manifest, history.receiptSha256);
          await assertNoOwnedRoutingContainers(abort.signal);
        } else if (unrelated.some((row) => ["running", "created"].includes(store.get(row.id).status) || store.hasUnresolvedRequests(row.id) || store.get(row.id).cleanupConfirmed !== true)) throw new Error("Unrelated active, unresolved or cleanup-unconfirmed stage runs block comparison.");
        const byArm = new Map<RoutingArm, PatchRunController>();
        if (manifest.schemaVersion === 2) {
          const assignments = screen.assignments(screenId);
          for (const arm of routingArms(configuration)) {
            const owned = assignments.filter(row => row.arm === arm && row.run_id !== null).map(row => row.run_id!);
            const controller = new PatchRunController(store, routingRuntimeConfigForArm(config, arm, manifest), () => {}, { recoveryRunIds: owned });
            controllers.push(controller); byArm.set(arm, controller);
          }
        } else {
          const controller = new PatchRunController(store, config, () => {}, { recoveryRunIds: scope });
          controllers.push(controller);
          for (const arm of routingArms(configuration)) byArm.set(arm, controller);
        }
        for (const controller of controllers) {
          const availability = await controller.availability();
          if (!availability.ready || !availability.localReady || !availability.cloudReady) throw new Error("Both providers and the shared isolated runtime must be ready.");
        }
        const controllerForArm = (arm: RoutingArm): PatchRunController => {
          const controller = byArm.get(arm);
          if (!controller) throw new Error("Controller arm is outside the frozen assignment.");
          return controller;
        };
        const helper = path.join(projectRoot, "scripts/evaluate-patch-screen.py");
        const revalidate = async (arm?: RoutingArm, signal?: AbortSignal) => {
          const currentManifest = RoutingManifestSchema.parse(await readJson(options.manifest!));
          const currentContracts = routingTaskContracts(await readJson(options.details!), currentManifest);
          const currentConfig = { ...loadPatchRuntimeConfig({ cwd: projectRoot, appPath: projectRoot }), image: currentManifest.image };
          const currentHistory = await historicalAdmission(options.historicalAdmission, database, currentManifest, history?.receiptSha256);
          const current = await routingComparisonConfiguration(currentConfig, projectRoot, currentManifest, currentContracts, routingCodePaths(currentManifest), currentHistory);
          if (canonicalRequest(current) !== canonicalRequest(configuration)) throw new Error("Frozen runtime or task contract changed before dispatch or closure.");
          if (manifest.schemaVersion === 2) for (const selected of arm ? [arm] : routingArms(configuration)) {
            if (canonicalRequest(routingRuntimeConfigForArm(currentConfig, selected, currentManifest)) !== canonicalRequest(controllerForArm(selected).config)) {
              throw new Error("Frozen arm runtime profile changed before dispatch or closure.");
            }
          }
          if (currentHistory) await assertNoOwnedRoutingContainers(signal);
        };
        if (manifest.schemaVersion === 2) finalRevalidation = () => revalidate();
        await runRoutingComparisonScreen({ manifest, configuration,
          ...(manifest.schemaVersion === 2 ? { controllerForArm } : { controller: controllers[0]! }),
          runs: store, screen, outputDirectory: options.output, signal: abort.signal,
          beforeEpisode: ({ arm }) => revalidate(arm, abort.signal),
          progress(value) { process.stdout.write(`${JSON.stringify(value)}\n`); },
          evaluate: (task, patchPath) => evaluateRoutingPatch({ python: config.python, helper, helperSha256: configuration.codeHashes["scripts/evaluate-patch-screen.py"]!, signal: abort.signal,
            logPath: `${patchPath}.evaluation.log`, args: ["--source", task.source.root, "--revision", task.source.revision, "--patch", patchPath,
              "--oracle", task.oracle.path, "--oracle-sha256", task.oracle.sha256, "--image", manifest.image, "--expected-tests", String(task.referenceReceipt.testCount)] }) });
      }
    } else {
      const target = database.prepare("SELECT frozen_json FROM patch_routing_screens WHERE id = ?").get(screenId) as { frozen_json: string } | undefined;
      if (!target) throw new Error("Unknown frozen routing screen.");
      const configuration = JSON.parse(target.frozen_json).configuration;
      if (database.prepare("SELECT 1 FROM patch_comparison_screens LIMIT 1").get() &&
          !(configuration.schemaVersion === 2 && configuration.historicalAdmission)) throw new Error("Use a dedicated routing-stage database; prior C/D/H studies must remain separate.");
    }
  } finally {
    try {
      const closed = await Promise.allSettled(controllers.map(controller => controller.close()));
      const failedClose = closed.find((result): result is PromiseRejectedResult => result.status === "rejected");
      let closureFailure: unknown = failedClose?.reason;
      let admissionClosure: z.infer<typeof AdmissionClosureSchema> | undefined;
      if (finalRevalidation) {
        try { await finalRevalidation(); } catch (error) { closureFailure ??= error; }
        const identity = database.prepare("SELECT configuration_sha256,manifest_sha256 FROM patch_routing_screens WHERE id=?").get(screenId) as
          { configuration_sha256: string; manifest_sha256: string };
        admissionClosure = AdmissionClosureSchema.parse({ schemaVersion: 1, kind: "routing-admission-closure-v1", screenId,
          configurationSha256: identity.configuration_sha256, manifestSha256: identity.manifest_sha256,
          ledgerSha256: routingAdmissionLedgerSha256(database), passed: closureFailure === undefined, historicalReceiptSha256,
          reason: closureFailure === undefined ? null : "final_admission_revalidation_failed" });
        await writeImmutable(path.join(options.output, "admission-closure.json"), admissionClosure);
      }
      if (screenId && database.prepare("SELECT 1 FROM patch_routing_screens WHERE id = ?").get(screenId)) {
        const automatic = routingComparisonReport(database, screenId);
        const frozen = JSON.parse((database.prepare("SELECT frozen_json FROM patch_routing_screens WHERE id=?").get(screenId) as { frozen_json: string }).frozen_json);
        let closureProblem: string | undefined;
        if (frozen.configuration.schemaVersion === 2) {
          try {
            admissionClosure ??= AdmissionClosureSchema.parse(await readJson(path.join(options.output, "admission-closure.json")));
            if (admissionClosure.screenId !== screenId || admissionClosure.configurationSha256 !== frozen.configurationSha256 ||
                admissionClosure.manifestSha256 !== frozen.manifestSha256 || admissionClosure.ledgerSha256 !== routingAdmissionLedgerSha256(database) ||
                admissionClosure.historicalReceiptSha256 !== (frozen.configuration.historicalAdmission?.receiptSha256 ?? null)) throw new Error("Closure identity changed.");
            if (!admissionClosure.passed) closureProblem = "final_admission_revalidation_failed";
          } catch { closureProblem = "admission_closure_missing_or_mismatched"; }
        }
        const eligibleAutomatic = closureProblem ? { ...automatic, complete: false } : automatic;
        const joined = options.review ? joinRoutingIndependentReview(eligibleAutomatic, await readJson(options.review)) : eligibleAutomatic;
        const guarded = closureProblem && joined.schemaVersion === "routing-comparison-report-v2" ? { ...joined,
          advancement: { additionalMaterialRegression: null, apiCostPerAcceptableSavingFraction: null, medianLatencyRatio: null,
            ...joined.advancement, status: "blocked" as const, eligible: false, reasons: [...(joined.advancement?.reasons ?? []), closureProblem] } } : joined;
        const report = frozen.configuration.schemaVersion === 2 ? { ...guarded, admissionClosure: admissionClosure ?? null, admissionClosureProblem: closureProblem ?? null } : guarded;
        await writeFile(path.join(options.output, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
        await writeFile(path.join(options.output, "report.md"), routingComparisonMarkdown(report), { mode: 0o600 });
        process.stdout.write(`${JSON.stringify({ screenId, complete: report.complete, assigned: report.assigned, completedBlocks: report.completedBlocks })}\n`);
      }
      if (closureFailure !== undefined) throw closureFailure;
    } finally {
      database.close();
      try { await release(); } finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write("Routing comparison stopped. Inspect the durable stage report and cleanup/accounting evidence before resuming. No episode or evaluation is retried automatically.\n"); process.exitCode = 1; });
}
