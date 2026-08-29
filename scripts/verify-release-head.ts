#!/usr/bin/env -S node --experimental-strip-types

import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

export const RELEASE_HEAD_DIRTY_MESSAGE =
  "Release-head verification requires a clean committed HEAD; staged, unstaged, or untracked non-ignored changes are present.";
export const RELEASE_HEAD_DIRTY_AFTER_GATE_MESSAGE =
  "Release-head verification changed the working tree; the committed-head result is not valid.";
export const RELEASE_HEAD_CHANGED_MESSAGE =
  "Git HEAD changed during release-head verification; the result is not bound to one commit.";
export const RELEASE_HEAD_MISSING_MESSAGE =
  "Release-head verification requires a Git repository with a committed HEAD.";
const LIVE_OPT_IN_FLAGS = [
  "SOAR_RUN_LIVE_VLLM",
  "SOAR_RUN_LIVE_REVIEW_SCHEMA",
  "SOAR_RUN_LIVE_REPOSITORY",
] as const;

interface ReleaseHeadVerificationOptions {
  projectRoot: string;
  runCheck: () => number;
  write?: (message: string) => void;
}

function gitOutput(projectRoot: string, arguments_: readonly string[]): string {
  try {
    return execFileSync("git", arguments_, {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(RELEASE_HEAD_MISSING_MESSAGE);
  }
}

export function committedHead(projectRoot: string): string {
  const revision = gitOutput(projectRoot, [
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ]).trim();
  if (!/^[0-9a-f]{40,64}$/u.test(revision)) {
    throw new Error(RELEASE_HEAD_MISSING_MESSAGE);
  }
  return revision;
}

export function assertCleanCommittedHead(projectRoot: string): string {
  const revision = committedHead(projectRoot);
  const status = gitOutput(projectRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  if (status.length > 0) {
    throw new Error(RELEASE_HEAD_DIRTY_MESSAGE);
  }
  return revision;
}

export function verifyReleaseHead({
  projectRoot,
  runCheck,
  write = (message) => process.stdout.write(message),
}: ReleaseHeadVerificationOptions): number {
  const revision = assertCleanCommittedHead(projectRoot);
  write(`Verifying committed HEAD ${revision} with pnpm check.\n`);

  const exitCode = runCheck();
  if (exitCode !== 0) return exitCode;

  let endingRevision: string;
  try {
    endingRevision = assertCleanCommittedHead(projectRoot);
  } catch (error) {
    if (error instanceof Error && error.message === RELEASE_HEAD_DIRTY_MESSAGE) {
      throw new Error(RELEASE_HEAD_DIRTY_AFTER_GATE_MESSAGE);
    }
    throw error;
  }
  if (endingRevision !== revision) {
    throw new Error(RELEASE_HEAD_CHANGED_MESSAGE);
  }

  write(`Committed-head verification passed for ${revision}.\n`);
  return 0;
}

export function deterministicCheckEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const deterministicEnvironment = { ...environment };
  for (const flag of LIVE_OPT_IN_FLAGS) {
    deterministicEnvironment[flag] = "false";
  }
  return deterministicEnvironment;
}

function runPnpmCheck(projectRoot: string): number {
  const pnpmEntry = process.env.npm_execpath;
  if (pnpmEntry === undefined || pnpmEntry.length === 0) {
    throw new Error(
      "Run release-head verification through pnpm: pnpm check:release-head.",
    );
  }
  const result = spawnSync(process.execPath, [pnpmEntry, "check"], {
    cwd: projectRoot,
    env: deterministicCheckEnvironment(process.env),
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  return result.status ?? 1;
}

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const invokedAsScript =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  try {
    process.exitCode = verifyReleaseHead({
      projectRoot,
      runCheck: () => runPnpmCheck(projectRoot),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ERROR ${message}\n`);
    process.exitCode = 1;
  }
}
