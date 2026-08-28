import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveWorkload } from "./catalog.ts";
import { runBoundedProcess } from "./process.ts";
import type { BenchmarkPreflight } from "./types.ts";

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function executableOnPath(name: string, environment: NodeJS.ProcessEnv): Promise<string | null> {
  const directories = (environment.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH.
    }
  }
  return null;
}

function preparedOraclePath(projectRoot: string, workloadId: string): string {
  return path.join(
    projectRoot,
    "benchmarks",
    "cache",
    "prepared",
    workloadId,
    "evaluator",
    "oracle.json",
  );
}

export async function preflightWorkload(options: {
  projectRoot: string;
  workloadId: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  architecture?: string;
  pythonExecutable?: string;
  dockerExecutable?: string;
}): Promise<BenchmarkPreflight> {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? os.arch();
  const python =
    options.pythonExecutable ??
    environment.SOAR_BENCHMARK_PYTHON ??
    (await executableOnPath("python3", environment));
  const { workload, suite } = await resolveWorkload(options.projectRoot, options.workloadId);
  const oraclePath = preparedOraclePath(options.projectRoot, workload.id);
  const fixturePrepared = await exists(oraclePath);
  const checks: BenchmarkPreflight["checks"] = [
    {
      id: "prepared-fixture",
      ok: fixturePrepared,
      detail: fixturePrepared
        ? "Pinned source row is prepared and evaluator-only data is isolated."
        : `Prepare the fixture first: pnpm benchmark prepare --id ${workload.id}`,
    },
  ];

  if (workload.source.dataset === "microsoft/LiveDRBench") {
    const evaluatorRoot = path.join(
      options.projectRoot,
      "benchmarks",
      "cache",
      "evaluators",
      "livedrbench",
    );
    const expectedRevision = suite.evaluator?.revision;
    let revisionOk = false;
    let revisionDetail = `Install the pinned evaluator: pnpm benchmark setup-evaluator --id ${workload.id}`;
    if (expectedRevision && (await exists(path.join(evaluatorRoot, ".git")))) {
      const result = await runBoundedProcess({
        executable: "git",
        args: ["rev-parse", "HEAD"],
        cwd: evaluatorRoot,
        timeoutMs: 10_000,
      });
      const actualRevision = result.stdout.trim();
      revisionOk = result.exitCode === 0 && actualRevision === expectedRevision;
      revisionDetail = revisionOk
        ? `Pinned LiveDRBench evaluator ${actualRevision}.`
        : `Evaluator checkout is ${actualRevision || "unreadable"}; expected ${expectedRevision}.`;
    }
    checks.push({ id: "pinned-evaluator", ok: revisionOk, detail: revisionDetail });
    checks.push({
      id: "judge-credential",
      ok: Boolean(environment.OPENAI_API_KEY),
      detail: environment.OPENAI_API_KEY
        ? "OPENAI_API_KEY is available to the evaluator process."
        : "Official LiveDRBench scoring uses an LLM judge and requires OPENAI_API_KEY; no pilot score will be presented as official.",
    });
    checks.push({
      id: "python",
      ok: Boolean(python),
      detail: python ? `Python executable: ${python}` : "python3 is required by the pinned evaluator.",
    });
    let dependenciesOk = false;
    let dependenciesDetail = "Python is required before evaluator dependencies can be checked.";
    const evaluatorSourceRoot = path.join(evaluatorRoot, "src");
    if (python && (await exists(evaluatorSourceRoot))) {
      const result = await runBoundedProcess({
        executable: python,
        args: [
          "-c",
          "from evals import datasets_flights, entities, priorart, scifacts; import datasets, openai, tqdm",
        ],
        cwd: evaluatorSourceRoot,
        env: {
          ...environment,
          PYTHONPATH: [evaluatorSourceRoot, environment.PYTHONPATH]
            .filter((value): value is string => Boolean(value))
            .join(path.delimiter),
        },
        timeoutMs: 15_000,
      });
      dependenciesOk = result.exitCode === 0;
      dependenciesDetail = dependenciesOk
        ? "Pinned LiveDRBench evaluator dependencies import successfully."
        : `Pinned evaluator dependencies are missing: ${result.stderr.trim().split(/\r?\n/u).at(-1) ?? "Python import failed"}`;
    } else if (python) {
      dependenciesDetail = `Pinned evaluator source is missing: ${evaluatorSourceRoot}`;
    }
    checks.push({
      id: "evaluator-dependencies",
      ok: dependenciesOk,
      detail: dependenciesDetail,
    });
    return {
      workloadId: workload.id,
      adapter: "livedrbench",
      status: checks.every((check) => check.ok) ? "ready" : "blocked",
      checks,
    };
  }

  if (workload.source.dataset === "SWE-bench/SWE-bench_Verified") {
    const evaluatorRoot = path.join(
      options.projectRoot,
      "benchmarks",
      "cache",
      "evaluators",
      suite.id,
    );
    const expectedRevision = suite.evaluator?.revision;
    let revisionOk = false;
    let revisionDetail = `Install the pinned evaluator: pnpm benchmark setup-evaluator --id ${workload.id}`;
    if (expectedRevision && (await exists(path.join(evaluatorRoot, ".git")))) {
      const result = await runBoundedProcess({
        executable: "git",
        args: ["rev-parse", "HEAD"],
        cwd: evaluatorRoot,
        timeoutMs: 10_000,
      });
      const actualRevision = result.stdout.trim();
      revisionOk = result.exitCode === 0 && actualRevision === expectedRevision;
      revisionDetail = revisionOk
        ? `Pinned SWE-bench evaluator ${actualRevision}.`
        : `Evaluator checkout is ${actualRevision || "unreadable"}; expected ${expectedRevision}.`;
    }
    checks.push({ id: "pinned-evaluator", ok: revisionOk, detail: revisionDetail });
    const nativeHost = platform === "linux" && architecture === "x64";
    checks.push({
      id: "x86-64-linux",
      ok: nativeHost,
      detail: nativeHost
        ? "Native x86-64 Linux evaluator host detected."
        : `Official coding evaluation requires an x86-64 Linux worker; detected ${platform}/${architecture}. Apple-Silicon emulation is smoke-only and is not accepted as an official pass.`,
    });
    const docker =
      options.dockerExecutable ??
      environment.SOAR_BENCHMARK_DOCKER ??
      (await executableOnPath("docker", environment));
    checks.push({
      id: "docker-client",
      ok: Boolean(docker),
      detail: docker ? `Docker client: ${docker}` : "Docker CLI is not installed.",
    });
    let daemonOk = false;
    let daemonDetail = "Docker daemon was not checked because the client is absent.";
    if (docker) {
      const result = await runBoundedProcess({
        executable: docker,
        args: ["info", "--format", "{{json .ServerVersion}}"],
        cwd: options.projectRoot,
        timeoutMs: 15_000,
      });
      daemonOk = result.exitCode === 0 && result.stdout.trim().length > 0;
      daemonDetail = daemonOk
        ? `Docker daemon reachable (server ${result.stdout.trim()}).`
        : `Docker daemon unavailable: ${result.stderr.trim() || "docker info failed"}`;
    }
    checks.push({ id: "docker-daemon", ok: daemonOk, detail: daemonDetail });

    let swebenchOk = false;
    let swebenchDetail = "python3 is required to invoke the official SWE-bench harness.";
    if (python) {
      const pythonPath = [evaluatorRoot, environment.PYTHONPATH]
        .filter((value): value is string => Boolean(value))
        .join(path.delimiter);
      const result = await runBoundedProcess({
        executable: python,
        args: [
          "-c",
          "import importlib.metadata; print(importlib.metadata.version('swebench'))",
        ],
        cwd: (await exists(evaluatorRoot)) ? evaluatorRoot : options.projectRoot,
        env: { ...environment, PYTHONPATH: pythonPath },
        timeoutMs: 15_000,
      });
      swebenchOk = result.exitCode === 0;
      swebenchDetail = swebenchOk
        ? `Official swebench Python package ${result.stdout.trim()} is installed.`
        : "Official swebench Python package is missing; install it in a pinned evaluator environment.";
    }
    checks.push({ id: "swebench-package", ok: swebenchOk, detail: swebenchDetail });
    return {
      workloadId: workload.id,
      adapter: "swebench",
      status: checks.every((check) => check.ok) ? "ready" : "blocked",
      checks,
    };
  }

  // This branch is reserved for small offline harness tests, never official workloads.
  await readFile(oraclePath, "utf8");
  return {
    workloadId: workload.id,
    adapter: "synthetic",
    status: checks.every((check) => check.ok) ? "ready" : "blocked",
    checks,
  };
}
