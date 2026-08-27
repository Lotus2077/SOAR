import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_READ_TEXT_FILE_BYTE_CAP,
  readTextFile,
} from "../../src/main/tools/read-text-file";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("readTextFile", () => {
  it("reads bounded UTF-8 text and reports byte metadata", async () => {
    const workspaceRoot = await createTemporaryDirectory("soar-read-text-");
    await mkdir(path.join(workspaceRoot, "notes"));
    await writeFile(path.join(workspaceRoot, "notes", "hello.txt"), "Hello, 世界\n", "utf8");

    await expect(
      readTextFile({ workspaceRoot, relativePath: "notes/hello.txt" }),
    ).resolves.toEqual({
      text: "Hello, 世界\n",
      bytes: Buffer.byteLength("Hello, 世界\n"),
      truncated: false,
    });
  });

  it("uses a 256 KiB default byte cap", () => {
    expect(DEFAULT_READ_TEXT_FILE_BYTE_CAP).toBe(256 * 1024);
  });

  it.each(["/etc/hosts", "C:\\Windows\\system.ini", "\\\\server\\share\\file.txt"])(
    "rejects absolute path %s",
    async (relativePath) => {
      const workspaceRoot = await createTemporaryDirectory("soar-read-text-");
      await expect(readTextFile({ workspaceRoot, relativePath })).rejects.toMatchObject({
        code: "ABSOLUTE_PATH",
      });
    },
  );

  it.each(["../secret.txt", "folder/../../secret.txt", "folder\\..\\secret.txt"])(
    "rejects traversal path %s",
    async (relativePath) => {
      const workspaceRoot = await createTemporaryDirectory("soar-read-text-");
      await expect(readTextFile({ workspaceRoot, relativePath })).rejects.toMatchObject({
        code: "PATH_TRAVERSAL",
      });
    },
  );

  it("rejects symbolic links that escape the workspace", async () => {
    const parent = await createTemporaryDirectory("soar-read-text-");
    const workspaceRoot = path.join(parent, "workspace");
    const outsidePath = path.join(parent, "outside.txt");
    await mkdir(workspaceRoot);
    await writeFile(outsidePath, "private", "utf8");
    await symlink(outsidePath, path.join(workspaceRoot, "escape.txt"));

    await expect(readTextFile({ workspaceRoot, relativePath: "escape.txt" })).rejects.toMatchObject({
      code: "PATH_OUTSIDE_WORKSPACE",
    });
  });

  it("allows symbolic links whose canonical target stays in the workspace", async () => {
    const workspaceRoot = await createTemporaryDirectory("soar-read-text-");
    await writeFile(path.join(workspaceRoot, "target.txt"), "safe", "utf8");
    await symlink("target.txt", path.join(workspaceRoot, "alias.txt"));

    await expect(readTextFile({ workspaceRoot, relativePath: "alias.txt" })).resolves.toEqual({
      text: "safe",
      bytes: 4,
      truncated: false,
    });
  });

  it("rejects missing paths", async () => {
    const workspaceRoot = await createTemporaryDirectory("soar-read-text-");
    await expect(readTextFile({ workspaceRoot, relativePath: "missing.txt" })).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
    });
  });

  it("rejects directories and other non-file paths", async () => {
    const workspaceRoot = await createTemporaryDirectory("soar-read-text-");
    await mkdir(path.join(workspaceRoot, "folder"));
    await expect(readTextFile({ workspaceRoot, relativePath: "folder" })).rejects.toMatchObject({
      code: "NOT_A_FILE",
    });
  });

  it.each([
    Buffer.from([0x74, 0x65, 0x00, 0x78, 0x74]),
    Buffer.from([0xc3, 0x28]),
    Buffer.from([0x74, 0x65, 0x01, 0x78, 0x74]),
  ])("rejects binary or invalid UTF-8 content", async (contents) => {
    const workspaceRoot = await createTemporaryDirectory("soar-read-text-");
    await writeFile(path.join(workspaceRoot, "binary.dat"), contents);

    await expect(readTextFile({ workspaceRoot, relativePath: "binary.dat" })).rejects.toMatchObject({
      code: "BINARY_FILE",
    });
  });

  it("rejects files larger than the configured byte cap", async () => {
    const workspaceRoot = await createTemporaryDirectory("soar-read-text-");
    await writeFile(path.join(workspaceRoot, "large.txt"), "12345", "utf8");

    await expect(
      readTextFile({ workspaceRoot, relativePath: "large.txt", byteCap: 4 }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("accepts a file exactly equal to the configured byte cap", async () => {
    const workspaceRoot = await createTemporaryDirectory("soar-read-text-");
    await writeFile(path.join(workspaceRoot, "exact.txt"), "1234", "utf8");

    await expect(
      readTextFile({ workspaceRoot, relativePath: "exact.txt", byteCap: 4 }),
    ).resolves.toEqual({ text: "1234", bytes: 4, truncated: false });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid byte cap %s", async (byteCap) => {
    const workspaceRoot = await createTemporaryDirectory("soar-read-text-");
    await expect(readTextFile({ workspaceRoot, relativePath: "file.txt", byteCap })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });
});
