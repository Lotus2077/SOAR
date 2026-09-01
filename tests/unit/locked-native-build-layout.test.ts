import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LOCKED_NATIVE_BUILD_INPUTS,
  syncLockedNativeBuildInputs,
} from "../../scripts/locked-native-build-layout.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("locked native build layout", () => {
  it("enumerates every reviewed Objective-C++ build input", () => {
    expect(LOCKED_NATIVE_BUILD_INPUTS).toEqual([
      "package.json",
      "locked-flavor.json",
      "binding.gyp",
      "src/addon.mm",
      "src/identity-policy.cc",
      "src/identity-policy.hpp",
      "src/lease-state-machine.cc",
      "src/lease-state-machine.hpp",
      "src/secure-zero.hpp",
    ]);
  });

  it("keeps the installed file dependency byte-identical after synchronization", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "soar-native-layout-"));
    temporaryRoots.push(root);
    const sourceRoot = path.join(root, "source");
    const installedRoot = path.join(root, "installed");
    for (const [index, relativePath] of LOCKED_NATIVE_BUILD_INPUTS.entries()) {
      const sourcePath = path.join(sourceRoot, relativePath);
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, `reviewed-input-${index}\n`, "utf8");
    }

    await syncLockedNativeBuildInputs({ sourceRoot, installedRoot });
    for (const relativePath of LOCKED_NATIVE_BUILD_INPUTS) {
      const [source, installed] = await Promise.all([
        readFile(path.join(sourceRoot, relativePath)),
        readFile(path.join(installedRoot, relativePath)),
      ]);
      expect(installed.equals(source), relativePath).toBe(true);
    }
  });

  it("rejects an empty reviewed build input instead of preserving stale data", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "soar-native-layout-empty-"));
    temporaryRoots.push(root);
    const sourceRoot = path.join(root, "source");
    const installedRoot = path.join(root, "installed");
    for (const relativePath of LOCKED_NATIVE_BUILD_INPUTS) {
      const sourcePath = path.join(sourceRoot, relativePath);
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, "reviewed\n", "utf8");
    }
    await writeFile(path.join(sourceRoot, "src/addon.mm"), "", "utf8");

    await expect(
      syncLockedNativeBuildInputs({ sourceRoot, installedRoot }),
    ).rejects.toThrow(/missing, empty, or oversized/u);
  });
});
