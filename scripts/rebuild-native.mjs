#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";
import path from "node:path";

import {
  projectRoot,
  syncLockedNativeBuildInputs,
} from "./locked-native-build-layout.mjs";

const electronRebuild = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  "electron-rebuild",
);
const modules = [
  "better-sqlite3",
  ...(process.platform === "darwin"
    ? ["@soar/macos-credential-lease"]
    : []),
];

async function main() {
  if (process.platform === "darwin") await syncLockedNativeBuildInputs();
  const child = spawn(
    electronRebuild,
    ["--force", "--only", modules.join(","), "--arch", process.arch],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    },
  );
  child.once("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (code === 0) return;
    process.stderr.write(
      `Native rebuild failed with ${
        signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`
      }.\n`,
    );
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Native rebuild failed."}\n`,
  );
  process.exitCode = 1;
});
