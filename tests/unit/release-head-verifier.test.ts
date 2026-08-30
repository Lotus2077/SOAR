import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  RELEASE_HEAD_CHANGED_MESSAGE,
  RELEASE_HEAD_DIRTY_AFTER_GATE_MESSAGE,
  RELEASE_HEAD_DIRTY_MESSAGE,
  deterministicCheckEnvironment,
  verifyReleaseHead,
} from "../../scripts/verify-release-head";

const temporaryDirectories: string[] = [];

function git(repository: string, ...arguments_: string[]): string {
  return execFileSync("git", arguments_, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function repository(): string {
  const root = mkdtempSync(path.join(tmpdir(), "soar-release-head-"));
  temporaryDirectories.push(root);
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "release-head@example.invalid");
  git(root, "config", "user.name", "SOAR release-head test");
  writeFileSync(path.join(root, ".gitignore"), "dist/\n", "utf8");
  writeFileSync(path.join(root, "tracked.txt"), "committed\n", "utf8");
  git(root, "add", ".gitignore", "tracked.txt");
  git(root, "commit", "--quiet", "-m", "fixture");
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("release-head verifier", () => {
  it("forces every live provider opt-in off for the deterministic child gate", () => {
    const inherited = {
      SAFE_VALUE: "preserved",
      GIT_DIR: "/tmp/alternate/.git",
      GIT_WORK_TREE: "/tmp/alternate",
      SOAR_RUN_LIVE_VLLM: "true",
      SOAR_RUN_LIVE_REVIEW_SCHEMA: "true",
      SOAR_RUN_LIVE_REPOSITORY: "true",
      SOAR_RUN_LIVE_LOCAL_REVIEW_V1: "true",
    };

    const deterministic = deterministicCheckEnvironment(inherited);
    expect(deterministic).toMatchObject({
      SAFE_VALUE: "preserved",
      SOAR_RUN_LIVE_VLLM: "false",
      SOAR_RUN_LIVE_REVIEW_SCHEMA: "false",
      SOAR_RUN_LIVE_REPOSITORY: "false",
      SOAR_RUN_LIVE_LOCAL_REVIEW_V1: "false",
    });
    expect(deterministic.GIT_DIR).toBeUndefined();
    expect(deterministic.GIT_WORK_TREE).toBeUndefined();
    expect(inherited.SOAR_RUN_LIVE_VLLM).toBe("true");
    expect(inherited.GIT_DIR).toBe("/tmp/alternate/.git");
  });

  it("ignores inherited Git repository overrides for both exact-head checks", () => {
    const target = repository();
    const inherited = repository();
    writeFileSync(path.join(inherited, "alternate.txt"), "alternate\n", "utf8");
    git(inherited, "add", "alternate.txt");
    git(inherited, "commit", "--quiet", "-m", "alternate");
    const targetRevision = git(target, "rev-parse", "HEAD");
    expect(git(inherited, "rev-parse", "HEAD")).not.toBe(targetRevision);
    const priorGitDirectory = process.env.GIT_DIR;
    const priorGitWorkTree = process.env.GIT_WORK_TREE;
    process.env.GIT_DIR = path.join(inherited, ".git");
    process.env.GIT_WORK_TREE = inherited;
    const output: string[] = [];
    try {
      expect(
        verifyReleaseHead({
          projectRoot: target,
          runCheck: () => 0,
          write: (message) => output.push(message),
        }),
      ).toBe(0);
      expect(output).toEqual([
        `Verifying committed HEAD ${targetRevision} with pnpm check.\n`,
        `Committed-head verification passed for ${targetRevision}.\n`,
      ]);
    } finally {
      if (priorGitDirectory === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = priorGitDirectory;
      if (priorGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = priorGitWorkTree;
    }
  });

  it("runs the committed-head gate once and allows ignored build artifacts", () => {
    const root = repository();
    mkdirSync(path.join(root, "dist"));
    writeFileSync(path.join(root, "dist", "SOAR.zip"), "ignored", "utf8");
    let calls = 0;
    const output: string[] = [];

    expect(
      verifyReleaseHead({
        projectRoot: root,
        runCheck: () => {
          calls += 1;
          return 0;
        },
        write: (message) => output.push(message),
      }),
    ).toBe(0);
    expect(calls).toBe(1);
    expect(output).toEqual([
      expect.stringMatching(/^Verifying committed HEAD [0-9a-f]{40} with pnpm check\.\n$/u),
      expect.stringMatching(/^Committed-head verification passed for [0-9a-f]{40}\.\n$/u),
    ]);
  });

  it.each([
    [
      "unstaged",
      (root: string) =>
        writeFileSync(path.join(root, "tracked.txt"), "changed\n"),
    ],
    [
      "staged",
      (root: string) => {
        writeFileSync(path.join(root, "tracked.txt"), "changed\n");
        git(root, "add", "tracked.txt");
      },
    ],
    [
      "untracked non-ignored",
      (root: string) =>
        writeFileSync(path.join(root, "new-source.ts"), "export {};\n"),
    ],
  ])("rejects a %s tree before running the gate", (_label, makeDirty) => {
    const root = repository();
    makeDirty(root);
    let calls = 0;

    expect(() =>
      verifyReleaseHead({
        projectRoot: root,
        runCheck: () => {
          calls += 1;
          return 0;
        },
      }),
    ).toThrow(RELEASE_HEAD_DIRTY_MESSAGE);
    expect(calls).toBe(0);
  });

  it("rejects tracked changes created while the gate runs", () => {
    const root = repository();

    expect(() =>
      verifyReleaseHead({
        projectRoot: root,
        runCheck: () => {
          writeFileSync(path.join(root, "tracked.txt"), "changed during gate\n");
          return 0;
        },
        write: () => undefined,
      }),
    ).toThrow(RELEASE_HEAD_DIRTY_AFTER_GATE_MESSAGE);
  });

  it("rejects a different commit created while the gate runs", () => {
    const root = repository();

    expect(() =>
      verifyReleaseHead({
        projectRoot: root,
        runCheck: () => {
          writeFileSync(path.join(root, "second.txt"), "second\n", "utf8");
          git(root, "add", "second.txt");
          git(root, "commit", "--quiet", "-m", "second");
          return 0;
        },
        write: () => undefined,
      }),
    ).toThrow(RELEASE_HEAD_CHANGED_MESSAGE);
  });

  it("returns a failing gate status without claiming committed-head success", () => {
    const root = repository();
    const output: string[] = [];

    expect(
      verifyReleaseHead({
        projectRoot: root,
        runCheck: () => 7,
        write: (message) => output.push(message),
      }),
    ).toBe(7);
    expect(output).toHaveLength(1);
    expect(output[0]).toContain("Verifying committed HEAD");
  });
});
