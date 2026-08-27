import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { searchText } from "../../src/main/tools/search-text";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(prefix = "soar-search-text-"): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("searchText", () => {
  it("returns deterministic relative paths, 1-based line numbers, and matching lines", async () => {
    const workspaceRoot = await createTemporaryDirectory();
    await mkdir(path.join(workspaceRoot, "src"));
    await writeFile(path.join(workspaceRoot, "README.md"), "first\nneedle root\n", "utf8");
    await writeFile(path.join(workspaceRoot, "src", "main.ts"), "needle one\nnone\nneedle two", "utf8");

    const result = await searchText({ workspaceRoot, query: "needle" });

    expect(result.matches).toEqual([
      { path: "README.md", lineNumber: 2, text: "needle root", textTruncated: false },
      { path: "src/main.ts", lineNumber: 1, text: "needle one", textTruncated: false },
      { path: "src/main.ts", lineNumber: 3, text: "needle two", textTruncated: false },
    ]);
    expect(result.filesSearched).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("supports literal, case-insensitive matching", async () => {
    const workspaceRoot = await createTemporaryDirectory();
    await writeFile(path.join(workspaceRoot, "symbols.ts"), "const A+B = 'value';\n", "utf8");

    const result = await searchText({
      workspaceRoot,
      query: "a+b",
      caseSensitive: false,
    });

    expect(result.matches).toMatchObject([{ path: "symbols.ts", lineNumber: 1 }]);
  });

  it("reports match, scan, and output limits", async () => {
    const workspaceRoot = await createTemporaryDirectory();
    await writeFile(path.join(workspaceRoot, "a.txt"), "hit one\nhit two\nhit three\n", "utf8");
    await writeFile(path.join(workspaceRoot, "b.txt"), "x".repeat(300), "utf8");

    const matchLimited = await searchText({ workspaceRoot, query: "hit", maxMatches: 1 });
    expect(matchLimited.matches).toHaveLength(1);
    expect(matchLimited.truncation?.reasons).toContain("match_limit");

    const scanLimited = await searchText({ workspaceRoot, query: "absent", scanByteCap: 256 });
    expect(scanLimited.truncation?.reasons).toContain("scan_byte_limit");

    await writeFile(path.join(workspaceRoot, "long.txt"), `hit ${"z".repeat(2_000)}`, "utf8");
    const outputLimited = await searchText({
      workspaceRoot,
      query: "hit",
      outputByteCap: 384,
    });
    expect(outputLimited.outputBytes).toBeLessThanOrEqual(384);
    expect(outputLimited.truncation?.reasons).toContain("output_byte_limit");
  });

  it("skips binary, oversized, sensitive, heavy, and descendant symlink content", async () => {
    const parent = await createTemporaryDirectory();
    const workspaceRoot = path.join(parent, "workspace");
    const outside = path.join(parent, "outside.txt");
    await mkdir(workspaceRoot);
    await mkdir(path.join(workspaceRoot, "node_modules"));
    await mkdir(path.join(workspaceRoot, ".pnpm-store"));
    await mkdir(path.join(workspaceRoot, "benchmarks", "runs"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "binary.dat"), Buffer.from([0x00, 0x68, 0x69]));
    await writeFile(path.join(workspaceRoot, "large.txt"), `needle${"x".repeat(300)}`, "utf8");
    await writeFile(path.join(workspaceRoot, ".env.local"), "needle secret", "utf8");
    await writeFile(path.join(workspaceRoot, "node_modules", "package.js"), "needle hidden", "utf8");
    await writeFile(path.join(workspaceRoot, ".pnpm-store", "index.json"), "needle hidden", "utf8");
    await writeFile(
      path.join(workspaceRoot, "benchmarks", "runs", "trace.json"),
      "needle hidden",
      "utf8",
    );
    await writeFile(outside, "needle outside", "utf8");
    await symlink(outside, path.join(workspaceRoot, "linked.txt"));

    const result = await searchText({ workspaceRoot, query: "needle", fileByteCap: 256 });

    expect(result.matches).toEqual([]);
    expect(result.skipped).toMatchObject({ binary: 1, ignored: 4, symlink: 1, tooLarge: 1 });
  });

  it("rejects traversal and direct symbolic-link escape", async () => {
    const parent = await createTemporaryDirectory();
    const workspaceRoot = path.join(parent, "workspace");
    const outside = path.join(parent, "outside.txt");
    await mkdir(workspaceRoot);
    await writeFile(outside, "needle", "utf8");
    await symlink(outside, path.join(workspaceRoot, "escape.txt"));

    await expect(
      searchText({ workspaceRoot, query: "needle", relativePath: "../outside.txt" }),
    ).rejects.toMatchObject({ code: "PATH_TRAVERSAL" });
    await expect(
      searchText({ workspaceRoot, query: "needle", relativePath: "escape.txt" }),
    ).rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });
  });

  it("does not follow a directly selected in-workspace symbolic link", async () => {
    const workspaceRoot = await createTemporaryDirectory();
    await writeFile(path.join(workspaceRoot, "target.txt"), "needle", "utf8");
    await symlink("target.txt", path.join(workspaceRoot, "alias.txt"));

    const result = await searchText({
      workspaceRoot,
      query: "needle",
      relativePath: "alias.txt",
    });

    expect(result.matches).toEqual([]);
    expect(result.filesSearched).toBe(0);
    expect(result.bytesScanned).toBe(0);
    expect(result.skipped.symlink).toBe(1);
  });

  it("truncates very long matching lines while preserving the match", async () => {
    const workspaceRoot = await createTemporaryDirectory();
    const longLine = `${"x".repeat(2_000)}needle${"y".repeat(2_000)}`;
    await writeFile(path.join(workspaceRoot, "long-line.txt"), longLine, "utf8");

    const result = await searchText({ workspaceRoot, query: "needle" });

    expect(result.matches[0]?.text).toContain("needle");
    expect(result.matches[0]?.textTruncated).toBe(true);
    expect(Buffer.byteLength(result.matches[0]?.text ?? "", "utf8")).toBeLessThanOrEqual(1_024);
  });

  it("honors cancellation", async () => {
    const workspaceRoot = await createTemporaryDirectory();
    const controller = new AbortController();
    controller.abort();

    await expect(
      searchText({ workspaceRoot, query: "needle", signal: controller.signal }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
