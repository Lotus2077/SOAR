import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { listFiles } from "../../src/main/tools/list-files";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(prefix = "soar-list-files-"): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("listFiles", () => {
  it("returns deterministic recursive POSIX paths and omits heavy or sensitive entries", async () => {
    const workspaceRoot = await createTemporaryDirectory();
    await mkdir(path.join(workspaceRoot, "src", "nested"), { recursive: true });
    await mkdir(path.join(workspaceRoot, "node_modules"));
    await mkdir(path.join(workspaceRoot, ".pnpm-store"));
    await mkdir(path.join(workspaceRoot, "benchmarks", "cache"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "README.md"), "readme", "utf8");
    await writeFile(path.join(workspaceRoot, ".env.local"), "SECRET=value", "utf8");
    await writeFile(path.join(workspaceRoot, "node_modules", "hidden.js"), "hidden", "utf8");
    await writeFile(path.join(workspaceRoot, ".pnpm-store", "hidden.json"), "hidden", "utf8");
    await writeFile(
      path.join(workspaceRoot, "benchmarks", "cache", "oracle.json"),
      "gold",
      "utf8",
    );
    await writeFile(path.join(workspaceRoot, "src", "a.ts"), "a", "utf8");
    await writeFile(path.join(workspaceRoot, "src", "nested", "b.ts"), "bb", "utf8");

    const result = await listFiles({ workspaceRoot });

    expect(result.entries).toEqual([
      { path: "README.md", type: "file", size: 6 },
      { path: "benchmarks", type: "directory" },
      { path: "src", type: "directory" },
      { path: "src/a.ts", type: "file", size: 1 },
      { path: "src/nested", type: "directory" },
      { path: "src/nested/b.ts", type: "file", size: 2 },
    ]);
    expect(result.skipped.ignored).toBe(4);
    expect(result.entries.some((entry) => entry.path.includes("oracle.json"))).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.outputBytes).toBeLessThanOrEqual(64 * 1024);
  });

  it("does not descend when recursive is false", async () => {
    const workspaceRoot = await createTemporaryDirectory();
    await mkdir(path.join(workspaceRoot, "src"));
    await writeFile(path.join(workspaceRoot, "src", "index.ts"), "text", "utf8");

    const result = await listFiles({ workspaceRoot, recursive: false });

    expect(result.entries).toEqual([{ path: "src", type: "directory" }]);
    expect(result.truncated).toBe(false);
  });

  it("reports item and output truncation explicitly", async () => {
    const workspaceRoot = await createTemporaryDirectory();
    for (let index = 0; index < 8; index += 1) {
      await writeFile(path.join(workspaceRoot, `long-file-name-${index}-${"x".repeat(40)}.txt`), "x", "utf8");
    }

    const itemLimited = await listFiles({ workspaceRoot, maxItems: 2 });
    expect(itemLimited.entries).toHaveLength(2);
    expect(itemLimited.truncation?.reasons).toContain("item_limit");
    expect(itemLimited.truncation?.message).toContain("maximum item count reached");

    const byteLimited = await listFiles({ workspaceRoot, outputByteCap: 384 });
    expect(byteLimited.outputBytes).toBeLessThanOrEqual(384);
    expect(byteLimited.truncation?.reasons).toContain("output_byte_limit");
  });

  it("rejects traversal and direct symbolic-link escape", async () => {
    const parent = await createTemporaryDirectory();
    const workspaceRoot = path.join(parent, "workspace");
    const outside = path.join(parent, "outside");
    await mkdir(workspaceRoot);
    await mkdir(outside);
    await writeFile(path.join(outside, "private.txt"), "private", "utf8");
    await symlink(outside, path.join(workspaceRoot, "escape"));

    await expect(listFiles({ workspaceRoot, relativePath: "../outside" })).rejects.toMatchObject({
      code: "PATH_TRAVERSAL",
    });
    await expect(listFiles({ workspaceRoot, relativePath: "escape" })).rejects.toMatchObject({
      code: "PATH_OUTSIDE_WORKSPACE",
    });
  });

  it("reports but never follows descendant symbolic links", async () => {
    const parent = await createTemporaryDirectory();
    const workspaceRoot = path.join(parent, "workspace");
    const outside = path.join(parent, "outside");
    await mkdir(workspaceRoot);
    await mkdir(outside);
    await writeFile(path.join(outside, "private.txt"), "private", "utf8");
    await symlink(outside, path.join(workspaceRoot, "linked"));

    const result = await listFiles({ workspaceRoot });

    expect(result.entries).toEqual([{ path: "linked", type: "symlink" }]);
    expect(result.entries.some((entry) => entry.path.includes("private.txt"))).toBe(false);
  });

  it("reports but does not follow a directly selected in-workspace symbolic link", async () => {
    const workspaceRoot = await createTemporaryDirectory();
    await mkdir(path.join(workspaceRoot, "real-directory"));
    await writeFile(
      path.join(workspaceRoot, "real-directory", "nested.txt"),
      "private",
      "utf8",
    );
    await symlink("real-directory", path.join(workspaceRoot, "alias"));

    const result = await listFiles({ workspaceRoot, relativePath: "alias" });

    expect(result.entries).toEqual([{ path: "alias", type: "symlink" }]);
    expect(result.entries.some((entry) => entry.path.includes("nested.txt"))).toBe(false);
  });

  it("rejects sensitive direct targets", async () => {
    const workspaceRoot = await createTemporaryDirectory();
    await writeFile(path.join(workspaceRoot, ".env"), "TOKEN=secret", "utf8");

    await expect(listFiles({ workspaceRoot, relativePath: ".env" })).rejects.toMatchObject({
      code: "PATH_IGNORED",
    });
  });

  it("honors cancellation before touching the workspace", async () => {
    const workspaceRoot = await createTemporaryDirectory();
    const controller = new AbortController();
    controller.abort();

    await expect(listFiles({ workspaceRoot, signal: controller.signal })).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });
});
