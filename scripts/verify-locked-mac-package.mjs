import asar from "@electron/asar";
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  LOCKED_NATIVE_BINARY,
  LOCKED_NATIVE_MANIFEST,
  assertLockedArchiveEntries,
  assertLockedNativeInspection,
  assertPhaseBAdHocCodeEntitlements,
  assertRendererBundleLocked,
  parseLockedFlavorManifest,
} from "./locked-credential-package-policy.mjs";

const execFileAsync = promisify(execFile);

async function boundedOutput(command, args) {
  const { stdout = "" } = await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout;
}

async function regularFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      if (entry.isFile()) files.push(candidate);
    }
    if (files.length + pending.length > 20_000) {
      throw new Error("Packaged code-object inspection exceeded its file bound.");
    }
  }
  return files;
}

async function verifyPhaseBAdHocEntitlements(appPath) {
  const files = await regularFiles(path.join(appPath, "Contents"));
  let machOCount = 0;
  for (const filePath of files) {
    const fileKind = await boundedOutput("/usr/bin/file", ["-b", filePath]);
    if (!fileKind.includes("Mach-O")) continue;
    machOCount += 1;
    if (machOCount > 128) {
      throw new Error("Packaged code-object inspection exceeded its Mach-O bound.");
    }
    const entitlementsXml = await boundedOutput("/usr/bin/codesign", [
      "--display",
      "--entitlements",
      "-",
      "--xml",
      filePath,
    ]);
    assertPhaseBAdHocCodeEntitlements({
      relativePath: path.relative(appPath, filePath).replaceAll(path.sep, "/"),
      entitlementsXml,
    });
  }
  if (machOCount === 0) {
    throw new Error("Packaged application contains no inspectable Mach-O code.");
  }
}

function archiveEntryText(archivePath, entry) {
  const value = asar.extractFile(archivePath, entry);
  if (value.byteLength > 16 * 1024 * 1024) {
    throw new Error(`Packaged source exceeds its verifier bound: ${entry}`);
  }
  return value.toString("utf8");
}

export async function verifyLockedMacPackage(appPath) {
  const resources = path.join(appPath, "Contents", "Resources");
  const archivePath = path.join(resources, "app.asar");
  const nativeBinaryPath = path.join(
    resources,
    "app.asar.unpacked",
    ...LOCKED_NATIVE_BINARY.split("/"),
  );
  const nativeMetadata = await stat(nativeBinaryPath);
  if (!nativeMetadata.isFile() || nativeMetadata.size === 0) {
    throw new Error("Locked native credential broker is missing or empty.");
  }

  const entries = asar.listPackage(archivePath, { isPack: false });
  assertLockedArchiveEntries(entries);
  parseLockedFlavorManifest(
    archiveEntryText(archivePath, LOCKED_NATIVE_MANIFEST),
  );
  const nativeEntry = asar.statFile(archivePath, LOCKED_NATIVE_BINARY);
  if (nativeEntry.unpacked !== true) {
    throw new Error("Locked native credential broker is not ASAR-unpacked.");
  }

  let bundledText = "";
  for (const rawEntry of entries) {
    const entry = rawEntry.replace(/^[/\\]+/u, "").replaceAll("\\", "/");
    if (
      entry.startsWith("out/") &&
      (entry.endsWith(".js") ||
        entry.endsWith(".cjs") ||
        entry.endsWith(".html"))
    ) {
      bundledText += archiveEntryText(archivePath, entry);
    }
  }
  assertRendererBundleLocked(bundledText);

  await boundedOutput("/usr/bin/codesign", [
    "--verify",
    "--strict",
    "--verbose=4",
    nativeBinaryPath,
  ]);
  const symbols = await boundedOutput("/usr/bin/nm", ["-u", nativeBinaryPath]);
  const strings = await boundedOutput("/usr/bin/strings", [nativeBinaryPath]);
  assertLockedNativeInspection({ symbols, strings });

  const linkedLibraries = await boundedOutput("/usr/bin/otool", [
    "-L",
    nativeBinaryPath,
  ]);
  if (!linkedLibraries.includes("Security.framework")) {
    throw new Error("Locked broker is not linked to Security.framework.");
  }

  const executableName = (
    await boundedOutput("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :CFBundleExecutable",
      path.join(appPath, "Contents", "Info.plist"),
    ])
  ).trim();
  const bundleIdentifier = (
    await boundedOutput("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :CFBundleIdentifier",
      path.join(appPath, "Contents", "Info.plist"),
    ])
  ).trim();
  if (bundleIdentifier !== "ai.soar.desktop") {
    throw new Error("Packaged bundle identifier is not the fixed SOAR identity.");
  }
  const executablePath = path.join(appPath, "Contents", "MacOS", executableName);
  const [appArchitectures, nativeArchitectures] = await Promise.all([
    boundedOutput("/usr/bin/lipo", ["-archs", executablePath]),
    boundedOutput("/usr/bin/lipo", ["-archs", nativeBinaryPath]),
  ]);
  if (appArchitectures.trim() !== nativeArchitectures.trim()) {
    throw new Error("App and locked native broker architectures do not match.");
  }
  await verifyPhaseBAdHocEntitlements(appPath);

  // The verifier itself is a direct pinned build dependency and its notice is
  // required in the same sealed package legal resource checked by the caller.
  const notices = await readFile(
    path.join(resources, "THIRD_PARTY_NOTICES.md"),
    "utf8",
  );
  if (!notices.includes("`@electron/asar` version 3.4.1")) {
    throw new Error("The @electron/asar build-verifier notice is missing.");
  }
}
