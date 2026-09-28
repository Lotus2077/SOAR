import { spawn, execFileSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const demo = process.argv.includes("--demo");
const env = { ...process.env, SOAR_PATCH_MODE: demo ? "scripted" : "live" };
if (process.argv.includes("--cloud-only")) {
  // Cloud-only coding does not require or attest an older remote local provider.
  // The retained investigator is unavailable in this launch; normal `pnpm dev`
  // and `pnpm dev:patch:hybrid` keep the operator's local configuration.
  Object.assign(env, { SOAR_PATCH_CLOUD_ONLY: "true", SOAR_PROVIDER_MODE: "local",
    SOAR_VLLM_BASE_URL: "http://127.0.0.1:1/v1", SOAR_VLLM_MODEL: "Local model not configured for this launch",
    SOAR_VLLM_API_KEY: "", SOAR_VLLM_COST_POLICY: "local_zero_cost", SOAR_ALLOW_INSECURE_VLLM_HTTP: "false",
    SOAR_ENABLE_HYBRID_SIMULATION: "false", SOAR_HYBRID_SIMULATION_FAKE_CLOUD_SCENARIO: "success" });
}
if (demo) {
  const directory = path.join(root, ".soar", "demo-repository");
  await mkdir(path.dirname(directory), { recursive: true });
  await cp(path.join(root, "tests", "fixtures", "patch-pilot"), directory, { recursive: true, force: false, errorOnExist: false });
  const git = (args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...args], { cwd: directory, stdio: "ignore" });
  git(["init", "-q"]);
  git(["add", "--", "calculator.py", "tests"]);
  git(["-c", "user.name=SOAR", "-c", "user.email=soar@invalid", "commit", "--allow-empty", "-qm", "Public synthetic mechanics fixture"]);
  Object.assign(env, { SOAR_PROVIDER_MODE: "fake", SOAR_TEST_WORKSPACE: directory, SOAR_DB_PATH: path.join(root, ".soar", "patch-demo.sqlite"),
    SOAR_VLLM_BASE_URL: "http://127.0.0.1:1/v1", SOAR_VLLM_MODEL: "unused-demo-model", SOAR_VLLM_API_KEY: "",
    SOAR_VLLM_COST_POLICY: "local_zero_cost", SOAR_ALLOW_INSECURE_VLLM_HTTP: "false",
    SOAR_ENABLE_HYBRID_SIMULATION: "false", SOAR_HYBRID_SIMULATION_FAKE_CLOUD_SCENARIO: "success",
  });
}
const child = spawn("pnpm", ["dev"], { cwd: root, env, stdio: "inherit" });
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.once("exit", (code) => { process.exitCode = code ?? 1; });
