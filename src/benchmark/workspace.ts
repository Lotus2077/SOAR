import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { resolveWorkload } from "./catalog.ts";
import { materializeAgentFixture } from "./fixture-cache.ts";
import { runBoundedProcess } from "./process.ts";
import type { PreparedAgentFixture } from "./types.ts";

function safeSegment(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/gu, "--");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function requireEmptyDestination(destination: string): Promise<void> {
  if (!(await pathExists(destination))) return;
  if ((await readdir(destination)).length !== 0) {
    throw new Error(`Workspace destination must be absent or empty: ${destination}`);
  }
}

async function git(options: {
  args: string[];
  cwd: string;
  timeoutMs?: number;
}): Promise<string> {
  const result = await runBoundedProcess({
    executable: "git",
    args: options.args,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 10 * 60 * 1_000,
    maxOutputBytes: 2 * 1024 * 1024,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${options.args[0] ?? "command"} failed (${result.exitCode}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

export async function checkoutRepository(options: {
  projectRoot: string;
  repositoryName: string;
  repositoryUrl: string;
  baseCommit: string;
  workspaceRoot: string;
}): Promise<void> {
  if (!/^[a-f0-9]{40}$/u.test(options.baseCommit)) {
    throw new Error(`Invalid pinned base commit: ${options.baseCommit}`);
  }
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const benchmarkCache = path.join(options.projectRoot, "benchmarks", "cache");
  const relative = path.relative(path.resolve(benchmarkCache), workspaceRoot);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("Agent checkout must be outside benchmarks/cache");
  }
  await requireEmptyDestination(workspaceRoot);
  const mirrorRoot = path.join(benchmarkCache, "repositories");
  const mirrorPath = path.join(
    mirrorRoot,
    safeSegment(options.repositoryName),
    `${options.baseCommit}.git`,
  );
  await mkdir(mirrorRoot, { recursive: true, mode: 0o700 });
  if (!(await pathExists(mirrorPath))) {
    try {
      await mkdir(path.dirname(mirrorPath), { recursive: true, mode: 0o700 });
      await git({
        args: ["init", "--bare", mirrorPath],
        cwd: options.projectRoot,
      });
      await git({
        args: ["remote", "add", "origin", options.repositoryUrl],
        cwd: mirrorPath,
      });
      await git({
        args: ["fetch", "--depth=1", "--no-tags", "origin", options.baseCommit],
        cwd: mirrorPath,
        timeoutMs: 30 * 60 * 1_000,
      });
      await git({
        args: ["update-ref", "refs/heads/fixture", options.baseCommit],
        cwd: mirrorPath,
      });
    } catch (error) {
      await rm(mirrorPath, { recursive: true, force: true });
      throw error;
    }
  }
  const commitExists = await runBoundedProcess({
    executable: "git",
    args: ["cat-file", "-e", `${options.baseCommit}^{commit}`],
    cwd: mirrorPath,
    timeoutMs: 30_000,
  });
  if (commitExists.exitCode !== 0) {
    throw new Error(`Base-only cache is incomplete for ${options.baseCommit}`);
  }
  try {
    await mkdir(path.dirname(workspaceRoot), { recursive: true });
    await git({
      args: [
        "clone",
        "--no-local",
        "--single-branch",
        "--branch",
        "fixture",
        mirrorPath,
        workspaceRoot,
      ],
      cwd: path.dirname(workspaceRoot),
      timeoutMs: 30 * 60 * 1_000,
    });
    await git({ args: ["checkout", "--detach", options.baseCommit], cwd: workspaceRoot });
    await git({ args: ["remote", "remove", "origin"], cwd: workspaceRoot });
    const actual = await git({ args: ["rev-parse", "HEAD"], cwd: workspaceRoot });
    if (actual !== options.baseCommit) {
      throw new Error(`Checkout resolved to ${actual}; expected ${options.baseCommit}`);
    }
    const historyCount = Number(
      await git({ args: ["rev-list", "--all", "--count"], cwd: workspaceRoot }),
    );
    if (historyCount !== 1) {
      throw new Error(
        `Agent checkout contains ${historyCount} commits; expected only the pinned base commit`,
      );
    }
  } catch (error) {
    await rm(workspaceRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function prepareAgentWorkspace(options: {
  projectRoot: string;
  workloadId: string;
  workspaceRoot: string;
}): Promise<{ fixturePath: string; promptPath: string; baseCommit?: string }> {
  const { workload } = await resolveWorkload(options.projectRoot, options.workloadId);
  const agentFixturePath = path.join(
    options.projectRoot,
    "benchmarks",
    "cache",
    "prepared",
    workload.id,
    "agent",
    "fixture.json",
  );
  const fixture = JSON.parse(
    await readFile(agentFixturePath, "utf8"),
  ) as PreparedAgentFixture;
  if (workload.track === "coding") {
    const repositoryName = fixture.fields.repo;
    const baseCommit = fixture.fields.base_commit;
    if (typeof repositoryName !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repositoryName)) {
      throw new Error(`${workload.id}: invalid repository name in agent fixture`);
    }
    if (typeof baseCommit !== "string") {
      throw new Error(`${workload.id}: base_commit is missing from agent fixture`);
    }
    await checkoutRepository({
      projectRoot: options.projectRoot,
      repositoryName,
      repositoryUrl: `https://github.com/${repositoryName}.git`,
      baseCommit,
      workspaceRoot: options.workspaceRoot,
    });
    const materialized = await materializeAgentFixture(options);
    return { ...materialized, baseCommit };
  }
  await mkdir(options.workspaceRoot, { recursive: true, mode: 0o700 });
  await requireEmptyDestination(options.workspaceRoot);
  return materializeAgentFixture(options);
}

export async function setupPinnedEvaluator(options: {
  projectRoot: string;
  workloadId: string;
}): Promise<{ path: string; revision: string }> {
  const { suite } = await resolveWorkload(options.projectRoot, options.workloadId);
  if (!suite.evaluator) {
    throw new Error(
      `${suite.id} does not declare a pinned evaluator checkout; use the pinned official package environment documented for this suite`,
    );
  }
  const evaluatorRoot = path.join(
    options.projectRoot,
    "benchmarks",
    "cache",
    "evaluators",
    suite.dataset === "microsoft/LiveDRBench" ? "livedrbench" : suite.id,
  );
  await mkdir(path.dirname(evaluatorRoot), { recursive: true, mode: 0o700 });
  if (!(await pathExists(path.join(evaluatorRoot, ".git")))) {
    await git({
      args: ["clone", "--no-checkout", suite.evaluator.url, evaluatorRoot],
      cwd: options.projectRoot,
      timeoutMs: 10 * 60 * 1_000,
    });
  }
  await git({
    args: ["fetch", "origin", suite.evaluator.revision],
    cwd: evaluatorRoot,
    timeoutMs: 10 * 60 * 1_000,
  });
  await git({ args: ["checkout", "--detach", suite.evaluator.revision], cwd: evaluatorRoot });
  const actual = await git({ args: ["rev-parse", "HEAD"], cwd: evaluatorRoot });
  if (actual !== suite.evaluator.revision) {
    throw new Error(`Evaluator checkout is ${actual}; expected ${suite.evaluator.revision}`);
  }
  return { path: evaluatorRoot, revision: actual };
}
