import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { inspectPatchSource, inspectPatchWorkspace, materializePatchWorkspace } from "../../src/main/patch-runs/workspace";

const directories: string[] = [];
function git(root: string, args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: "/nonexistent",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Fixture", GIT_COMMITTER_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_EMAIL: "fixture@example.invalid" },
  }).trim();
}
async function fixture(files: Record<string, string> = { "calculator.py": "def add(a, b):\n    return a - b\n" }) {
  const base = await mkdtemp(path.join(tmpdir(), "soar-patch-workspace-"));
  directories.push(base);
  const root = path.join(base, "repository");
  await mkdir(root);
  git(root, ["init", "-q"]);
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text);
  }
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture"]);
  return { root, base, revision: git(root, ["rev-parse", "HEAD"]), destination: path.join(base, "snapshot") };
}
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("coding pilot committed snapshot boundary", () => {
  it("shares exact committed tree identity across inspection and materialization, ignoring dirty bytes", async () => {
    const test = await fixture({ "alpha.py": "first\n", "nested/beta.py": "second\n" });
    const source = await inspectPatchSource(test.root, test.revision);
    await writeFile(path.join(test.root, "alpha.py"), "dirty\n");
    expect(source).toMatchObject({ revision: test.revision, files: 2, bytes: 13 });
    expect(await materializePatchWorkspace(test.root, test.revision, test.destination)).toEqual(source);
    expect(await inspectPatchSource(test.root, test.revision)).toEqual(source);
    await writeFile(path.join(test.root, "alpha.py"), "other\n");
    git(test.root, ["add", "alpha.py"]); git(test.root, ["commit", "-qm", "same size bytes"]);
    const changed = await inspectPatchSource(test.root, git(test.root, ["rev-parse", "HEAD"]));
    expect(changed.bytes).toBe(source.bytes); expect(changed.sourceTreeSha256).not.toBe(source.sourceTreeSha256);
    git(test.root, ["update-index", "--chmod=+x", "alpha.py"]); git(test.root, ["commit", "-qm", "mode"]);
    const mode = await inspectPatchSource(test.root, git(test.root, ["rev-parse", "HEAD"]));
    expect(mode.bytes).toBe(changed.bytes); expect(mode.sourceTreeSha256).not.toBe(changed.sourceTreeSha256);
  });
  it.each([Buffer.from([0xff]), Buffer.from("text\0suffix")])("rejects known invalid critic text before copying (case %#)", async bytes => {
    const test = await fixture();
    await writeFile(path.join(test.root, "calculator.py"), bytes);
    git(test.root, ["add", "calculator.py"]); git(test.root, ["commit", "-qm", "binary"]);
    const revision = git(test.root, ["rev-parse", "HEAD"]);
    await expect(inspectPatchSource(test.root, revision)).rejects.toThrow();
    // Explicit cloud materialization retains its existing regular-blob behavior.
    await materializePatchWorkspace(test.root, revision, test.destination);
    expect(await readFile(path.join(test.destination, "calculator.py"))).toEqual(bytes);
  });
  it("validates critic paths for small baselines but does not load oversized source bodies", async () => {
    const invalid = await fixture({ "colon:name.py": "pass\n" });
    await expect(inspectPatchSource(invalid.root, invalid.revision)).rejects.toThrow(/critic source path/);
    const large = await fixture({ "large.bin": "x".repeat(98305) });
    await writeFile(path.join(large.root, "large.bin"), Buffer.alloc(98305));
    git(large.root, ["add", "large.bin"]); git(large.root, ["commit", "-qm", "large binary"]);
    expect(await inspectPatchSource(large.root, git(large.root, ["rev-parse", "HEAD"]))).toMatchObject({ files: 1, bytes: 98305 });
  });
  it("stops cancelled source inspection without creating materialized files", async () => {
    const test = await fixture(), cancellation = new AbortController(); cancellation.abort();
    await expect(inspectPatchSource(test.root, test.revision, cancellation.signal)).rejects.toMatchObject({ name: "AbortError" });
    await expect(readdir(test.destination)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("stops a cancelled copy without writing source files", async () => {
    const test = await fixture();
    const cancellation = new AbortController();
    const copying = materializePatchWorkspace(test.root, test.revision, test.destination, cancellation.signal);
    const rejected = expect(copying).rejects.toMatchObject({ name: "AbortError" });
    cancellation.abort();
    await rejected;
    await expect(readdir(test.destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(test.root, "calculator.py"), "utf8")).toContain("return a - b");
  });

  it("materializes committed blobs without copying history, dirty edits or untracked files", async () => {
    const test = await fixture();
    await writeFile(path.join(test.root, "calculator.py"), "user edits must survive\n");
    await writeFile(path.join(test.root, "untracked.txt"), "local-only content\n");
    const inspected = await inspectPatchWorkspace(test.root);
    expect(inspected.revision).toBe(test.revision);
    await materializePatchWorkspace(inspected.root, inspected.revision, test.destination);
    expect(await readdir(test.destination)).toEqual(["calculator.py"]);
    expect(await readFile(path.join(test.destination, "calculator.py"), "utf8")).toContain("return a - b");
    expect(await readFile(path.join(test.root, "calculator.py"), "utf8")).toBe("user edits must survive\n");
    expect(await readFile(path.join(test.root, "untracked.txt"), "utf8")).toBe("local-only content\n");
    expect(git(test.root, ["rev-parse", "HEAD"])).toBe(test.revision);
  });

  it("does not execute repository hooks or configured smudge filters", async () => {
    const test = await fixture({ ".gitattributes": "calculator.py filter=untrusted\n", "calculator.py": "original\n" });
    const marker = path.join(test.base, "executed-marker");
    const hook = path.join(test.base, "host-hook");
    await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    git(test.root, ["config", "core.hooksPath", path.dirname(hook)]);
    git(test.root, ["config", "core.fsmonitor", hook]);
    git(test.root, ["config", "filter.untrusted.smudge", hook]);
    const inspected = await inspectPatchWorkspace(test.root);
    await materializePatchWorkspace(inspected.root, inspected.revision, test.destination);
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(test.destination, "calculator.py"), "utf8")).toBe("original\n");
  });

  it("ignores git replacement refs so the recorded revision identifies the materialized tree", async () => {
    const test = await fixture();
    await writeFile(path.join(test.root, "calculator.py"), "replacement content\n");
    git(test.root, ["add", "calculator.py"]);
    git(test.root, ["commit", "-qm", "replacement"]);
    const second = git(test.root, ["rev-parse", "HEAD"]);
    git(test.root, ["replace", test.revision, second]);
    await materializePatchWorkspace(test.root, test.revision, test.destination);
    expect(await readFile(path.join(test.destination, "calculator.py"), "utf8")).toContain("return a - b");
  });

  it("rejects a selected repository subdirectory", async () => {
    const test = await fixture({ "src/module.py": "pass\n" });
    await expect(inspectPatchWorkspace(path.join(test.root, "src"))).rejects.toThrow(/repository root/);
  });

  it("rejects a committed symlink before writing source files", async () => {
    const test = await fixture();
    await symlink("calculator.py", path.join(test.root, "linked.py"));
    git(test.root, ["add", "linked.py"]);
    git(test.root, ["commit", "-qm", "link"]);
    await expect(materializePatchWorkspace(test.root, git(test.root, ["rev-parse", "HEAD"]), test.destination)).rejects.toThrow(/symlinks/);
    await expect(readdir(test.destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a committed gitlink/submodule before writing source files", async () => {
    const test = await fixture();
    git(test.root, ["update-index", "--add", "--cacheinfo", `160000,${test.revision},submodule`]);
    git(test.root, ["commit", "-qm", "gitlink"]);
    await expect(materializePatchWorkspace(test.root, git(test.root, ["rev-parse", "HEAD"]), test.destination)).rejects.toThrow(/submodules/);
    await expect(readdir(test.destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([".env", "nested/.env.production", ".netrc", "credentials.json", "secrets.json", "id_ecdsa", "auth.p12", ".ssh/config", ".aws/config"])(
    "rejects credential path %s before copying the snapshot", async (name) => {
      const test = await fixture({ "calculator.py": "pass\n", [name]: "not a real credential\n" });
      await expect(materializePatchWorkspace(test.root, test.revision, test.destination)).rejects.toThrow();
      await expect(readdir(test.destination)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("rejects a preexisting destination with a symlink parent without writing outside it", async () => {
    const test = await fixture({ "nested/module.py": "pass\n" });
    const outside = path.join(test.base, "outside");
    await mkdir(outside);
    await mkdir(test.destination);
    await symlink(outside, path.join(test.destination, "nested"));
    await expect(materializePatchWorkspace(test.root, test.revision, test.destination)).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });
});
