#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const nativeRoot = path.join(
  projectRoot,
  "native",
  "macos-credential-lease",
);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        LANG: "C",
        LC_ALL: "C",
      },
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
          `Native core proof failed with ${
            signal ? `signal ${signal}` : `exit code ${code}`
          }.`,
        ),
      );
    });
  });
}

async function main() {
  if (process.platform === "win32") {
    process.stdout.write(
      "Native core compiler proof is not configured on Windows; the macOS broker remains unavailable there.\n",
    );
    return;
  }

  const directory = await mkdtemp(
    path.join(tmpdir(), "soar-native-credential-core-"),
  );
  const executable = path.join(directory, "native-core-test");
  try {
    const compiler = process.platform === "darwin" ? "/usr/bin/xcrun" : "c++";
    const prefix = process.platform === "darwin" ? ["clang++"] : [];
    await run(compiler, [
      ...prefix,
      "-std=c++20",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-DSOAR_CREDENTIAL_NATIVE_CORE_TEST=1",
      path.join(nativeRoot, "src", "identity-policy.cc"),
      path.join(nativeRoot, "src", "lease-state-machine.cc"),
      path.join(nativeRoot, "test", "native-core-test.cc"),
      "-I",
      path.join(nativeRoot, "src"),
      "-o",
      executable,
    ]);
    await run(executable, []);
    process.stdout.write("Locked native credential core proof passed.\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Native core proof failed."}\n`,
  );
  process.exitCode = 1;
});
