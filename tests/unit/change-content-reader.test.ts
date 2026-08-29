import { chmod, mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_CHANGE_SOURCE_BYTES_PER_SIDE,
  admitGitBlobSide,
  readWorkingTreeSide,
} from "../../src/main/tools/change-content-reader";

const temporaryRoots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), "soar-change-content-"));
  temporaryRoots.push(value);
  return realpath(value);
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("change content admission", () => {
  it("admits bounded UTF-8 blobs and refuses binary, symlink, submodule, and oversized blobs", () => {
    const text = admitGitBlobSide("100644", Buffer.from("hello\n"));
    expect(text).toMatchObject({
      identity: { mode: "100644", sizeBytes: 6 },
      text: "hello\n",
      omissionCodes: [],
    });
    expect(text.identity.admittedContentSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(admitGitBlobSide("100644", Buffer.from([0, 1])).omissionCodes).toEqual([
      "binary",
    ]);
    expect(admitGitBlobSide("120000", Buffer.from("target")).omissionCodes).toEqual([
      "symlink",
    ]);
    expect(admitGitBlobSide("160000", null).omissionCodes).toEqual(["submodule"]);
    expect(
      admitGitBlobSide("100644", Buffer.alloc(MAX_CHANGE_SOURCE_BYTES_PER_SIDE + 1))
        .omissionCodes,
    ).toEqual(["oversized"]);
  });

  it("reads a regular file without following a final symlink", async () => {
    const workspace = await root();
    await mkdir(path.join(workspace, "src"));
    await writeFile(path.join(workspace, "src", "a.ts"), "export const a = 1;\n");
    const admitted = await readWorkingTreeSide({
      canonicalRoot: workspace,
      relativePath: "src/a.ts",
    });
    expect(admitted.text).toBe("export const a = 1;\n");
    expect(admitted.identity.mode).toBe("100644");
    expect(admitted.omissionCodes).toEqual([]);

    await symlink("a.ts", path.join(workspace, "src", "alias.ts"));
    const link = await readWorkingTreeSide({
      canonicalRoot: workspace,
      relativePath: "src/alias.ts",
    });
    expect(link.text).toBeNull();
    expect(link.identity.mode).toBe("120000");
    expect(link.omissionCodes).toEqual(["symlink"]);
  });

  it("marks escaping links and sensitive files without reading their targets", async () => {
    const workspace = await root();
    await symlink("/etc/passwd", path.join(workspace, "escape"));
    const link = await readWorkingTreeSide({
      canonicalRoot: workspace,
      relativePath: "escape",
    });
    expect(link.text).toBeNull();
    expect(link.omissionCodes).toEqual(["symlink", "unsafe_path"]);

    await writeFile(path.join(workspace, ".env"), "TOP_SECRET=value\n");
    const sensitive = await readWorkingTreeSide({
      canonicalRoot: workspace,
      relativePath: ".env",
    });
    expect(sensitive.text).toBeNull();
    expect(sensitive.omissionCodes).toEqual(["unsafe_path"]);
  });

  it("uses only owner-execute when projecting a regular file to Git mode", async () => {
    const workspace = await root();
    await writeFile(path.join(workspace, "run.sh"), "#!/bin/sh\nexit 0\n");
    for (const nonOwnerMode of [0o645, 0o654]) {
      await chmod(path.join(workspace, "run.sh"), nonOwnerMode);
      const nonOwnerExecutable = await readWorkingTreeSide({
        canonicalRoot: workspace,
        relativePath: "run.sh",
      });
      expect(nonOwnerExecutable.identity.mode).toBe("100644");
    }

    await chmod(path.join(workspace, "run.sh"), 0o744);
    const ownerExecutable = await readWorkingTreeSide({
      canonicalRoot: workspace,
      relativePath: "run.sh",
    });
    expect(ownerExecutable.identity.mode).toBe("100755");
  });

  it("bounds working content", async () => {
    const workspace = await root();

    await writeFile(
      path.join(workspace, "large.txt"),
      Buffer.alloc(MAX_CHANGE_SOURCE_BYTES_PER_SIDE + 1, 0x61),
    );
    const large = await readWorkingTreeSide({
      canonicalRoot: workspace,
      relativePath: "large.txt",
    });
    expect(large.text).toBeNull();
    expect(large.omissionCodes).toEqual(["oversized"]);
  });

  it("honors cancellation before opening content", async () => {
    const workspace = await root();
    await writeFile(path.join(workspace, "a.txt"), "hello");
    const controller = new AbortController();
    controller.abort();
    await expect(
      readWorkingTreeSide({
        canonicalRoot: workspace,
        relativePath: "a.txt",
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/u);
  });
});
