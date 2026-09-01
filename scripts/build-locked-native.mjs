#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  lockedNativeBinaryPath,
  projectRoot,
  syncLockedNativeBuildInputs,
} from "./locked-native-build-layout.mjs";

const electronRebuild = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  "electron-rebuild",
);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Locked native broker build failed with ${
            signal ? `signal ${signal}` : `exit code ${code}`
          }.`,
        ),
      );
    });
  });
}

async function main() {
  if (process.platform !== "darwin") {
    process.stdout.write(
      "Locked macOS credential broker is structurally unavailable on this platform.\n",
    );
    return;
  }

  if (process.env.SOAR_CREDENTIAL_BUILD_FLAVOR !== undefined) {
    throw new Error(
      "PR6B1-B does not accept an environment-selected credential build flavor.",
    );
  }

  await syncLockedNativeBuildInputs();
  await run(electronRebuild, [
    "--force",
    "--only",
    "@soar/macos-credential-lease",
    "--arch",
    process.arch,
  ]);
  await access(lockedNativeBinaryPath);
  process.stdout.write("Built the locked macOS credential broker.\n");
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Locked native broker build failed."}\n`,
  );
  process.exitCode = 1;
});
