#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const archivePath = path.join(projectRoot, "dist", "SOAR-mac-arm64.zip");
const canarySpec = "tests/e2e/packaged-credential-status.spec.ts";
const temporaryPrefix = path.join(tmpdir(), "soar-packaged-canary-extract-");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? projectRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const outcome = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`${command} failed with ${outcome}.`));
    });
  });
}

async function requireFile(candidate, label) {
  const metadata = await stat(candidate);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`${label} is missing or empty.`);
  }
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("The packaged credential-status canary requires macOS.");
  }
  await requireFile(archivePath, "The packaged SOAR archive");

  const extractionRoot = await mkdtemp(temporaryPrefix);
  try {
    await run("/usr/bin/ditto", ["-x", "-k", archivePath, extractionRoot]);
    const executablePath = path.join(
      extractionRoot,
      "SOAR.app",
      "Contents",
      "MacOS",
      "SOAR",
    );
    await requireFile(executablePath, "The extracted SOAR executable");

    const e2eRunner = path.join(projectRoot, "scripts", "run-electron-e2e.mjs");
    await run(process.execPath, [e2eRunner, canarySpec], {
      env: {
        ...process.env,
        SOAR_E2E_EXECUTABLE: executablePath,
      },
    });
  } finally {
    if (!extractionRoot.startsWith(temporaryPrefix)) {
      throw new Error("Refusing to clean an unexpected canary extraction path.");
    }
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
