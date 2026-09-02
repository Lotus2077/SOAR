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
const MAX_PACKAGED_OUT_FILES = 2_000;
const MAX_PACKAGED_OUT_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_PACKAGED_OUT_BYTES = 64 * 1024 * 1024;

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

function archiveEntryBytes(archivePath, entry) {
  const value = asar.extractFile(archivePath, entry);
  if (value.byteLength > MAX_PACKAGED_OUT_ENTRY_BYTES) {
    throw new Error(`Packaged source exceeds its verifier bound: ${entry}`);
  }
  return value;
}

function archiveEntryText(archivePath, entry) {
  return archiveEntryBytes(archivePath, entry).toString("utf8");
}

export function packagedOutputText(archivePath, entries) {
  const outputEntries = [];
  let declaredBytes = 0;
  for (const rawEntry of entries) {
    const entry = rawEntry.replace(/^[/\\]+/u, "").replaceAll("\\", "/");
    if (!entry.startsWith("out/")) continue;
    const metadata = asar.statFile(archivePath, entry, false);
    if ("files" in metadata) continue;
    if ("link" in metadata) {
      throw new Error("Packaged output contains an unsupported symbolic link.");
    }
    if (
      typeof metadata.size !== "number" ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 0
    ) {
      throw new Error("Packaged output contains an unsupported entry type.");
    }
    if (metadata.size > MAX_PACKAGED_OUT_ENTRY_BYTES) {
      throw new Error(`Packaged source exceeds its verifier bound: ${entry}`);
    }
    declaredBytes += metadata.size;
    if (declaredBytes > MAX_PACKAGED_OUT_BYTES) {
      throw new Error("Packaged output inspection exceeded its byte bound.");
    }
    outputEntries.push({ entry, declaredSize: metadata.size });
    if (outputEntries.length > MAX_PACKAGED_OUT_FILES) {
      throw new Error("Packaged output inspection exceeded its file bound.");
    }
  }

  outputEntries.sort((left, right) => left.entry.localeCompare(right.entry));
  let totalBytes = 0;
  let bundledText = "";
  for (const { entry, declaredSize } of outputEntries) {
    const value = archiveEntryBytes(archivePath, entry);
    if (value.byteLength !== declaredSize) {
      throw new Error(`Packaged output size changed during inspection: ${entry}`);
    }
    totalBytes += value.byteLength;
    if (totalBytes > MAX_PACKAGED_OUT_BYTES) {
      throw new Error("Packaged output inspection exceeded its byte bound.");
    }
    bundledText += value.toString("utf8");
  }
  return bundledText;
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

  assertRendererBundleLocked(packagedOutputText(archivePath, entries));

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
