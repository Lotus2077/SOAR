import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const choices = [process.env.SOAR_PATCH_SETUP_PYTHON, "python3.12", "python3.11", "python3"].filter(Boolean);
const python = choices.find((candidate) => spawnSync(candidate, ["-c", "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)"], { stdio: "ignore" }).status === 0);
if (!python) throw new Error("Install Python 3.10+ or set SOAR_PATCH_SETUP_PYTHON to its executable.");
async function execute(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", env: process.env });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (exit ${code}).`)));
  });
}
await execute(python, ["runtime/patch-worker/bootstrap.py", "--venv", path.join(root, ".soar", "patch-runtime")]);
await execute("docker", ["build", "--tag", "soar-patch-python:1", "runtime/patch-worker"]);
process.stdout.write("Coding pilot ready. Run pnpm demo:patch for the scripted fixture, or set SOAR_PATCH_API_KEY and run pnpm dev:patch for OpenRouter.\n");
