import { execFile } from "node:child_process";
import { chmod, lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { acquireMaterializedChangeSnapshot } from "../../benchmarks/change-review/validate-materialization";
import { deriveVerifiedCalibrationSourceDiffV1 } from "../../src/main/review-risk";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function git(repository: string, ...arguments_: string[]): Promise<string> {
  const result = await execFileAsync("/usr/bin/git", arguments_, {
    cwd: repository,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  });
  return result.stdout.trim();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("calibration materialization security", () => {
  it("never executes repository-local textconv while deriving or applying a pinned patch", async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "soar-calibration-security-"));
    temporaryDirectories.push(repository);
    await git(repository, "init", "--quiet");
    await git(repository, "config", "user.name", "SOAR Test");
    await git(repository, "config", "user.email", "soar@example.invalid");

    const marker = path.join(repository, "textconv-executed");
    const driver = path.join(repository, "hostile-textconv.sh");
    await writeFile(
      driver,
      `#!/bin/sh\nprintf invoked >> ${shellQuote(marker)}\ncat "$1"\n`,
    );
    await chmod(driver, 0o755);
    await git(repository, "config", "diff.hostile.textconv", driver);
    await writeFile(path.join(repository, ".gitattributes"), "*.txt diff=hostile\n");
    await writeFile(path.join(repository, "tracked.txt"), "base\n");
    await git(repository, "add", ".gitattributes", "tracked.txt");
    await git(repository, "commit", "--quiet", "-m", "base");
    const baseRevision = await git(repository, "rev-parse", "HEAD");

    await writeFile(path.join(repository, "tracked.txt"), "changed\n");
    await git(repository, "add", "tracked.txt");
    await git(repository, "commit", "--quiet", "-m", "change");
    const changeRevision = await git(repository, "rev-parse", "HEAD");

    const acquired = await acquireMaterializedChangeSnapshot(
      repository,
      baseRevision,
      changeRevision,
    );
    expect(deriveVerifiedCalibrationSourceDiffV1(acquired.snapshot)).toHaveLength(
      1,
    );
    expect(acquired.risk.complete).toBe(true);
    await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  }, 20_000);
});
