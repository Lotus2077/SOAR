#!/usr/bin/env -S tsx
/** Trusted CLI experiment entry. Every model episode uses the app controller. */
import { spawn } from "node:child_process";
import { open, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createSoarDatabase } from "../src/main/database";
import { loadPatchRuntimeConfig } from "../src/main/patch-runs/config";
import { PatchRunController } from "../src/main/patch-runs/controller";
import { PatchRunStore } from "../src/main/patch-runs/store";
import { ComparisonManifestSchema, ComparisonStore, comparisonConfiguration, digest, runComparisonScreen, validateComparisonSources } from "../src/main/patch-runs/comparison";
import { comparisonMarkdown, comparisonReport } from "../src/main/patch-runs/comparison-report";

function argumentsFor(argv: string[]) {
  const [command, ...rest] = argv;
  if (!command || !["freeze", "run", "report"].includes(command)) throw new Error("Use freeze, run or report.");
  const values: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    if (!key || !["--manifest", "--database", "--output", "--screen"].includes(key) || !value || value.startsWith("--") || values[key]) throw new Error("Invalid comparison arguments.");
    values[key] = value;
  }
  if (!values["--database"] || !values["--output"] || (command === "report" ? !values["--screen"] : !values["--manifest"])) throw new Error("Comparison paths and identity are required.");
  return { command, database: path.resolve(values["--database"]), output: path.resolve(values["--output"]),
    manifest: values["--manifest"] ? path.resolve(values["--manifest"]) : undefined, screenId: values["--screen"] };
}

async function exclusiveRunnerLock(databasePath: string): Promise<() => Promise<void>> {
  const lockPath = `${databasePath}.patch-comparison.lock`;
  await mkdir(path.dirname(databasePath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const lock = await open(lockPath, "wx", 0o600);
      await lock.writeFile(String(process.pid));
      await lock.close();
      return () => rm(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = Number(await readFile(lockPath, "utf8"));
      if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error("Comparison lock requires inspection.");
      try { process.kill(owner, 0); throw new Error("Another comparison runner is active."); }
      catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code !== "ESRCH") throw probeError;
      }
      await rm(lockPath);
    }
  }
  throw new Error("Could not acquire comparison lock.");
}

async function evaluate(python: string, helper: string, helperSha256: string, args: string[]): Promise<unknown> {
  if (digest(await readFile(helper)) !== helperSha256) throw new Error("Frozen evaluator code changed.");
  return new Promise((resolve, reject) => {
    const child = spawn(python, [helper, ...args], { stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONFIG: process.env.DOCKER_CONFIG,
        PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1" } });
    let output = "", size = 0, excessive = false;
    const receive = (chunk: Buffer, stdout: boolean) => { size += chunk.length; if (size > 2 * 1024 * 1024) { excessive = true; child.kill("SIGTERM"); } else if (stdout) output += chunk.toString(); };
    child.stdout.on("data", (chunk: Buffer) => receive(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => receive(chunk, false));
    // Helper owns per-command deadlines and Docker cleanup; outer bound is an emergency stop.
    const timeout = setTimeout(() => { excessive = true; child.kill("SIGTERM"); }, 180000);
    child.once("error", () => { clearTimeout(timeout); reject(new Error("Evaluator could not start.")); });
    child.once("close", () => {
      clearTimeout(timeout);
      if (excessive) return reject(new Error("Evaluator exceeded its execution envelope."));
      try { resolve(JSON.parse(output.trim().split("\n").at(-1)!)); }
      catch { reject(new Error("Evaluator returned no valid receipt.")); }
    });
  });
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = argumentsFor(argv);
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const release = options.command === "report" ? async () => {} : await exclusiveRunnerLock(options.database);
  let database;
  try { database = createSoarDatabase(options.database, { readonly: options.command === "report" }); }
  catch (error) { await release(); throw error; }
  let controller: PatchRunController | undefined;
  let screenId = options.screenId;
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try {
    await mkdir(options.output, { recursive: true, mode: 0o700 });
    if (options.command !== "report") {
      const manifest = ComparisonManifestSchema.parse(JSON.parse(await readFile(options.manifest!, "utf8")));
      screenId = manifest.screenId;
      await validateComparisonSources(manifest);
      const config = { ...loadPatchRuntimeConfig({ cwd: projectRoot, appPath: projectRoot }), image: manifest.image };
      const configuration = await comparisonConfiguration(config, projectRoot, manifest);
      const screen = new ComparisonStore(database);
      screen.freeze(manifest, configuration);
      await writeFile(path.join(options.output, "frozen.json"), JSON.stringify({ manifest, configuration }, null, 2), { mode: 0o600 });
      if (options.command === "run") {
        const scope = screen.runIds(screenId);
        const unrelated = (database.prepare("SELECT id FROM patch_runs WHERE status = 'running'").all() as { id: string }[]).filter((row) => !scope.includes(row.id));
        if (unrelated.length) throw new Error("Another app task is running; finish it before starting the screen.");
        const store = new PatchRunStore(database);
        controller = new PatchRunController(store, config, () => {}, { recoveryRunIds: scope });
        const availability = await controller.availability();
        if (!availability.ready || !availability.localReady) throw new Error("Shared coding runtime or local provider is not ready.");
        const helper = path.join(projectRoot, "scripts/evaluate-patch-screen.py");
        await runComparisonScreen({ manifest, configuration, controller, runs: store, screen, campaignCeilingMicrousd: config.campaignCapMicrousd,
          outputDirectory: options.output, signal: abort.signal,
          async beforeEpisode() {
            const current = await comparisonConfiguration(config, projectRoot, manifest);
            if (JSON.stringify(current) !== JSON.stringify(configuration)) throw new Error("Frozen runtime changed between episodes.");
          },
          progress(value) { process.stdout.write(`${JSON.stringify(value)}\n`); },
          evaluate: (task, patchPath) => evaluate(config.python, helper, configuration.codeHashes["scripts/evaluate-patch-screen.py"]!, [
            "--source", task.source.root, "--revision", task.source.revision, "--patch", patchPath,
            "--oracle", task.oracle.path, "--oracle-sha256", task.oracle.sha256, "--image", manifest.image,
            "--expected-tests", String(task.referenceReceipt.testCount),
          ]) });
      }
    }
  } finally {
    try {
      await controller?.close();
      if (screenId && database.prepare("SELECT 1 FROM patch_comparison_screens WHERE id = ?").get(screenId)) {
        const report = comparisonReport(database, screenId);
        await writeFile(path.join(options.output, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
        await writeFile(path.join(options.output, "report.md"), comparisonMarkdown(report), { mode: 0o600 });
        process.stdout.write(`${JSON.stringify({ screenId, complete: report.complete, arms: report.arms })}\n`);
      }
    } finally {
      try { database.close(); }
      finally {
        try { await release(); }
        finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write("Comparison stopped. Inspect the durable report and runtime readiness before resuming; no paid episode is retried.\n"); process.exitCode = 1; });
}
