import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criticSourceIdentity, prepareCriticContext, verifyCriticCandidate } from "../../src/main/patch-runs/critic-context";
import { canonicalRequest } from "../../src/main/patch-runs/native-contract";
import { patchPolicyLimits, type PatchRuntimeConfig } from "../../src/main/patch-runs/config";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const original = "def add(a, b):\n    return a - b\n";
const corrected = "def add(a, b):\n    return a + b\n";
const patch = "diff --git a/calculator.py b/calculator.py\n--- a/calculator.py\n+++ b/calculator.py\n@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a - b\n+    return a + b\n";
const sha = (input: string) => createHash("sha256").update(input).digest("hex");
const identity = (text: string) => criticSourceIdentity([{ path: "calculator.py", bytes: Buffer.from(text), executable: false }]);
const provider = { id: "synthetic-loopback", protocol: "openai" as const, endpoint: "http://127.0.0.1:1/chat/completions",
  model: "fixture", apiKey: "synthetic-fixture-key", allowInsecureHttp: true, inputUsdPerMillion: 4, outputUsdPerMillion: 20 };
const config: PatchRuntimeConfig = { mode: "live", enabled: true, python: "python", workerPath: "worker.py", storageRoot: "unused",
  image: "fixture", cloud: provider, local: { ...provider, id: "local", inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
  episodeCapMicrousd: 3_000_000, campaignCapMicrousd: 150_000_000, stepLimit: 40, wallTimeSeconds: 600,
  maxInputBytes: 256000, maxOutputTokens: 8192 };
async function fixture() {
  const workspace = await mkdtemp(path.join(tmpdir(), "soar-critic-context-test-")); directories.push(workspace);
  await writeFile(path.join(workspace, "calculator.py"), original, { mode: 0o600 });
  return { workspace, taskId: "fixture", objective: "Correct addition for signed operands.", visibleCommand: "python -m unittest",
    baseRevision: "a".repeat(40), patch, expectedSourceSha256: identity(corrected), config };
}

describe("host-built compact critique context", () => {
  it("reconstructs the checked draft from the original baseline without executing candidate code", async () => {
    const input = await fixture(), result = await prepareCriticContext(input);
    expect(result.sourceSha256).toBe(identity(corrected));
    expect(result.baselineSourceSha256).toBe(identity(original));
    expect(result.bundle.contextComplete).toBe(true); expect(result.bundle.omissions).toEqual([]);
    expect(result.bundle.files.find(file => file.revision === "candidate")?.sections[0]?.text).toBe(corrected);
    expect(result.bundle.files.find(file => file.revision === "baseline")?.sections[0]?.text).toBe(original);
    expect(result.bodySha256).toBe(sha(canonicalRequest(result.body)));
    expect(result.body).not.toHaveProperty("tools");
    expect(result.reservationMicrousd).toBe(result.bodyBytes * 4 + 8192 * 20);
    expect(JSON.stringify(result.body)).not.toContain(provider.apiKey);
    expect(await readFile(path.join(input.workspace, "calculator.py"), "utf8")).toBe(original);
  });
  it("rejects source drift and changes outside a declared task scope before preparing a request", async () => {
    const input = await fixture();
    await expect(prepareCriticContext({ ...input, expectedSourceSha256: "0".repeat(64) })).rejects.toThrow("checked draft");
    await expect(prepareCriticContext({ ...input, objective: 'Fix addition.\nAllowed paths (JSON): ["tests/test_add.py"]' })).rejects.toThrow("task scope");
  });
  it("rejects source aliases and unsupported Git paths", async () => {
    const input = await fixture();
    await symlink("calculator.py", path.join(input.workspace, "alias.py"));
    await expect(prepareCriticContext(input)).rejects.toThrow("regular files");
    await rm(path.join(input.workspace, "alias.py"));
    await expect(prepareCriticContext({ ...input, patch: patch.replaceAll("calculator.py", "../escaped.py") })).rejects.toThrow();
    await expect(prepareCriticContext({ ...input, patch: patch.replaceAll("calculator.py", ".git/config") })).rejects.toThrow();
  });
  it("preserves full context limits without applying the prompt envelope to final repair verification", async () => {
    const input = await fixture(), large = "#" + "x".repeat(110000) + "\n";
    const largePatch = "diff --git a/calculator.py b/calculator.py\n--- a/calculator.py\n+++ b/calculator.py\n@@ -1,2 +1 @@\n-def add(a, b):\n-    return a - b\n+" + large;
    const final = { ...input, patch: largePatch, expectedSourceSha256: identity(large) };
    await expect(prepareCriticContext(final)).rejects.toThrow("context envelope");
    expect((await verifyCriticCandidate(final)).sourceSha256).toBe(identity(large));
    expect(await readFile(path.join(input.workspace, "calculator.py"), "utf8")).toBe(original);
  });
  it("matches Python path ordering for supplementary Unicode characters", () => {
    const paths = ["a\u{10000}.py", "a\ue000.py"], bytes = Buffer.from("# text\n");
    const rows = [paths[1]!, paths[0]!].map(file => ({ path: file, bytes: bytes.length, executable: false, sha256: sha(bytes.toString()) }));
    expect(criticSourceIdentity(paths.map(file => ({ path: file, bytes, executable: false })))).toBe(sha(canonicalRequest(rows)));
  });
  it("uses the exact existing Sol controls for its complete body", async () => {
    const input = await fixture();
    const result = await prepareCriticContext({ ...input, config: { ...config, cloud: { ...provider,
      id: "openai", model: "gpt-5.6-sol", endpoint: "https://api.openai.com/v1/chat/completions", allowInsecureHttp: false } } });
    expect(result.body).toMatchObject({ max_completion_tokens: 8192, reasoning_effort: "medium", service_tier: "default",
      prompt_cache_options: { mode: "explicit" }, stream: false });
    expect(result.body).not.toHaveProperty("max_tokens");
  });
});

describe("single-episode critique budget", () => {
  it("keeps 12 cumulative local calls distinct from 13 total model calls", () => {
    expect(patchPolicyLimits(config, "local_critic_repair")).toMatchObject({ stepLimit: 13, localStepLimit: 12,
      draftLocalStepLimit: 8, repairLocalStepLimit: 4, finishingReserve: 2, localCoding: { checkSchedule: "final_only" } });
    expect(patchPolicyLimits({ ...config, localCodingMaxCalls: 12 }, "local_critic_repair").stepLimit).toBe(13);
  });
  it("requires the dedicated local zero-token-fee profile without treating hardware as free", () => {
    expect(() => patchPolicyLimits({ ...config, local: { ...config.local!, inputUsdPerMillion: 0.1 } }, "local_critic_repair")).toThrow(/zero local API token fees/u);
  });
  it.each([{ mode: "scripted" }, { stepLimit: 12 }, { localCodingMaxCalls: 8 },
    { localCodingCheckSchedule: "repair_window" }, { localCodingCheckSchedule: "host_repair_window" },
    { plannerMode: "plan_and_checks" }, { maxOutputTokens: 4096 }])("rejects incompatible profile %j", override => {
    expect(() => patchPolicyLimits({ ...config, ...override } as PatchRuntimeConfig, "local_critic_repair")).toThrow();
  });
});
