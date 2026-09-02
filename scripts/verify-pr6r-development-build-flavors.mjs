import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyNormalPr6rBuild } from "./verify-pr6r-development-build-isolation.mjs";

const EXPECTED_NORMAL_DENIAL =
  "PR6R development-canary marker survived packaging";
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function runPnpmScript(script) {
  const result = spawnSync("pnpm", ["run", script], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const outcome =
      result.signal === null ? `exit code ${result.status}` : `signal ${result.signal}`;
    throw new Error(`pnpm ${script} failed with ${outcome}.`);
  }
}

async function requireNormalPolicyToRejectDevelopmentOutput() {
  try {
    await verifyNormalPr6rBuild();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(EXPECTED_NORMAL_DENIAL)) return;
    throw new Error(
      `Normal policy rejected the development output for an unexpected reason: ${message}`,
    );
  }
  throw new Error("Normal policy accepted the PR6R development-canary output.");
}

async function main() {
  let specialFailure;
  try {
    runPnpmScript("build:pr6r-development-canary");
    await requireNormalPolicyToRejectDevelopmentOutput();
    console.log("Confirmed that normal policy rejects development-canary output.");
  } catch (error) {
    specialFailure = error;
  }

  let restoreFailure;
  try {
    runPnpmScript("build");
  } catch (error) {
    restoreFailure = error;
  }

  if (specialFailure !== undefined && restoreFailure !== undefined) {
    throw new AggregateError(
      [specialFailure, restoreFailure],
      "PR6R dual-flavor verification failed and normal output restoration also failed.",
    );
  }
  if (specialFailure !== undefined) throw specialFailure;
  if (restoreFailure !== undefined) throw restoreFailure;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
