import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { localReviewEvaluationInternals } from "../../src/benchmark/local-review-evaluation";

const temporaryDirectories: string[] = [];
const TEST_GIT_ENVIRONMENT: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  TZ: "UTC",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

function git(repository: string, args: readonly string[]): string {
  return execFileSync("/usr/bin/git", ["-C", repository, ...args], {
    encoding: "utf8",
    env: TEST_GIT_ENVIRONMENT,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function createRepository(label: string): Promise<{
  root: string;
  revision: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), `soar-${label}-`));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "src"));
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  await writeFile(path.join(root, "src", "marker.txt"), `${label}\n`, "utf8");
  git(root, ["add", "--", "src/marker.txt"]);
  git(root, [
    "-c",
    "user.name=SOAR Test",
    "-c",
    "user.email=soar-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    `Create ${label}`,
  ]);
  return { root, revision: git(root, ["rev-parse", "HEAD"]) };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("local-review exact implementation admission", () => {
  it("ignores inherited Git repository overrides and checks the requested root", async () => {
    const target = await createRepository("target-implementation");
    const override = await createRepository("inherited-override");
    expect(target.revision).not.toBe(override.revision);

    const priorGitDirectory = process.env.GIT_DIR;
    const priorGitWorkTree = process.env.GIT_WORK_TREE;
    process.env.GIT_DIR = path.join(override.root, ".git");
    process.env.GIT_WORK_TREE = override.root;
    try {
      expect(
        localReviewEvaluationInternals.resolveCleanImplementationRevision(
          target.root,
        ),
      ).toBe(target.revision);

      await writeFile(
        path.join(target.root, "src", "marker.txt"),
        "dirty target implementation\n",
        "utf8",
      );
      expect(() =>
        localReviewEvaluationInternals.resolveCleanImplementationRevision(
          target.root,
        ),
      ).toThrow(/clean committed revision/u);
    } finally {
      if (priorGitDirectory === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = priorGitDirectory;
      if (priorGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = priorGitWorkTree;
    }
  });
});
