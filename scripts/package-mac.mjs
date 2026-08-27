import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(projectRoot, "dist");
const archivePath = join(distDir, "SOAR-mac-arm64.zip");
const stagedArchivePath = join(
  distDir,
  `.SOAR-mac-arm64-${process.pid}.zip`,
);
const electronBuilder = join(
  projectRoot,
  "node_modules",
  ".bin",
  "electron-builder",
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

      const outcome = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`${command} failed with ${outcome}.`));
    });
  });
}

async function verifyApp(appPath) {
  await run("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=4",
    appPath,
  ]);
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("macOS packaging must run on macOS.");
  }

  let buildDir;
  let verificationDir;

  try {
    buildDir = await mkdtemp(join(tmpdir(), "soar-mac-package-"));
    verificationDir = await mkdtemp(join(tmpdir(), "soar-mac-verify-"));
    const appPath = join(buildDir, "mac-arm64", "SOAR.app");
    const extractedAppPath = join(verificationDir, "SOAR.app");

    console.log("Building and signing SOAR in temporary storage...");
    await run(electronBuilder, [
      "--mac",
      "dir",
      "--arm64",
      `--config.directories.output=${buildDir}`,
    ]);

    console.log("Verifying the packaged application signature...");
    await verifyApp(appPath);

    await mkdir(distDir, { recursive: true });
    await rm(stagedArchivePath, { force: true });
    console.log("Creating the distributable archive...");
    await run("/usr/bin/ditto", [
      "-c",
      "-k",
      "--keepParent",
      appPath,
      stagedArchivePath,
    ]);

    console.log("Extracting and verifying the distributable archive...");
    await run("/usr/bin/ditto", [
      "-x",
      "-k",
      stagedArchivePath,
      verificationDir,
    ]);
    await verifyApp(extractedAppPath);

    await rm(archivePath, { force: true });
    await rename(stagedArchivePath, archivePath);

    console.log(`Created and verified ${relative(projectRoot, archivePath)}.`);
  } finally {
    await Promise.all([
      buildDir
        ? rm(buildDir, { recursive: true, force: true })
        : Promise.resolve(),
      verificationDir
        ? rm(verificationDir, { recursive: true, force: true })
        : Promise.resolve(),
      rm(stagedArchivePath, { force: true }),
    ]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
