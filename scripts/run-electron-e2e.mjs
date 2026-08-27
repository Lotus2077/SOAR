#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const lockDirectory = path.join(tmpdir(), "soar-electron-e2e.lock");
const ownerPath = path.join(lockDirectory, "owner.json");
const configuredTimeout = Number.parseInt(process.env.SOAR_E2E_LOCK_TIMEOUT_MS ?? "", 10);
const lockTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : 120_000;
const staleAfterMs = 15 * 60_000;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function lockIsStale() {
  try {
    const owner = JSON.parse(await readFile(ownerPath, "utf8"));
    const age = Date.now() - Number(owner.startedAt);
    return age > staleAfterMs || !processIsAlive(Number(owner.pid));
  } catch {
    return true;
  }
}

async function acquireLock() {
  const deadline = Date.now() + lockTimeoutMs;
  let announcedWait = false;

  while (Date.now() < deadline) {
    try {
      await mkdir(lockDirectory);
      await writeFile(
        ownerPath,
        `${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await lockIsStale()) {
        await rm(lockDirectory, { force: true, recursive: true });
        continue;
      }
      if (!announcedWait) {
        process.stdout.write("Waiting for the active SOAR Electron E2E run to finish...\n");
        announcedWait = true;
      }
      await wait(250);
    }
  }

  throw new Error(`Timed out waiting for the Electron E2E lock at ${lockDirectory}`);
}

if (process.platform === "darwin" && process.env.CODEX_SANDBOX) {
  process.stderr.write(
    "Electron E2E cannot run inside the restricted Codex macOS sandbox. " +
      "Run this command with approved GUI access; no Electron process was launched.\n",
  );
  process.exitCode = 2;
} else {
  let child;
  const forwardSignal = (signal) => child?.kill(signal);

  try {
    await acquireLock();
    const playwright = path.join(process.cwd(), "node_modules", ".bin", "playwright");
    child = spawn(playwright, ["test", ...process.argv.slice(2)], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
    process.exitCode = exitCode;
  } finally {
    process.removeListener("SIGINT", forwardSignal);
    process.removeListener("SIGTERM", forwardSignal);
    await rm(lockDirectory, { force: true, recursive: true });
  }
}
