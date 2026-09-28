import { describe, expect, it } from "vitest";
import { automaticRuntimeConfig, selectAutomaticRouting, validateAutomaticSelection, validateAutomaticTaskInput } from "../../src/main/patch-runs/automatic-routing";
import { patchPolicyLimits, type PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import type { PatchSourceSnapshot } from "../../src/main/patch-runs/workspace";

const source: PatchSourceSnapshot = { revision: "a".repeat(40), files: 6, bytes: 1288, sourceTreeSha256: "b".repeat(64) };
function configuration(): PatchRuntimeConfig {
  return { mode: "live", enabled: true, python: "/private/python", workerPath: "/private/worker.py", image: "fixture-image", storageRoot: "/private/storage",
    episodeCapMicrousd: 5_000_000, campaignCapMicrousd: 150_000_000, stepLimit: 60, wallTimeSeconds: 1200,
    maxInputBytes: 256000, maxOutputTokens: 8192,
    cloud: { id: "openai", protocol: "openai", endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-5.6-sol",
      apiKey: "cloud-secret", allowInsecureHttp: false, inputUsdPerMillion: 4, outputUsdPerMillion: 20 },
    local: { id: "local", protocol: "openai", endpoint: "http://127.0.0.1:9900/v1/chat/completions", model: "local-fixture",
      apiKey: "local-secret", allowInsecureHttp: true, inputUsdPerMillion: 0, outputUsdPerMillion: 0, maxOutputTokens: 2048, maxInputBytes: 64000 } };
}
const choose = (config = configuration(), snapshot = source, budget = 5_000_000, headroom = 100_000_000) =>
  selectAutomaticRouting(config, snapshot, budget, headroom);

describe("automatic source-size routing", () => {
  it.each([[64, 98304, "local_critic_repair"], [65, 98304, "prepared_cloud"], [64, 98305, "prepared_cloud"]] as const)(
    "selects the exact baseline boundary %s files/%s bytes", (files, bytes, policy) => {
      const result = choose(configuration(), { ...source, files, bytes });
      expect(result.selection).toMatchObject({ selectedPolicy: policy, sourceFiles: files, sourceBytes: bytes,
        reason: policy === "local_critic_repair" ? "baseline_within_critic_hard_limits" : "baseline_exceeds_critic_hard_limits" });
      expect(patchPolicyLimits(result.config, policy)).toMatchObject({ stepLimit: policy === "local_critic_repair" ? 13 : 40, wallTimeSeconds: 600 });
      expect(result.config.episodeCapMicrousd).toBe(policy === "local_critic_repair" ? 700000 : 3000000);
    });
  it("retains every original six-task source size and selects three local and three cloud episodes", () => {
    const sizes = [[43, 232059], [39, 677398], [6, 1699], [6, 1288], [112, 980231], [5, 3761]];
    expect(sizes.map(([files, bytes]) => choose(configuration(), { ...source, files, bytes }).selection.selectedPolicy))
      .toEqual(["prepared_cloud", "prepared_cloud", "local_critic_repair", "local_critic_repair", "prepared_cloud", "local_critic_repair"]);
  });
  it.each(["missing", "paid", "output", "calls", "thinking", "schedule"])("uses cloud when the optional critic profile is %s", reason => {
    const config = configuration();
    if (reason === "missing") delete config.local;
    if (reason === "paid") config.local!.inputUsdPerMillion = 1;
    if (reason === "output") { config.cloud!.id = "fixture"; config.maxOutputTokens = 4096; }
    if (reason === "calls") config.localCodingMaxCalls = 24;
    if (reason === "thinking") config.localCodingThinking = "medium";
    if (reason === "schedule") config.localCodingCheckSchedule = "host_repair_window";
    const result = choose(config);
    expect(result.selection.reason).toBe("critic_profile_unavailable");
    expect(result.config.localCodingMaxCalls).toBeUndefined();
    expect(() => patchPolicyLimits(result.config, "prepared_cloud")).not.toThrow();
  });
  it("uses the conservative 675840 reservation and never raises the owner's ceiling", () => {
    expect(choose(configuration(), source, 675840).selection).toMatchObject({ selectedPolicy: "local_critic_repair", maxCostMicrousd: 675840 });
    expect(choose(configuration(), source, 675839).selection).toMatchObject({ selectedPolicy: "prepared_cloud", reason: "critic_budget_unavailable", maxCostMicrousd: 675839 });
    expect(choose(configuration(), source, 5000000, 675839).selection.reason).toBe("critic_budget_unavailable");
    expect(choose(configuration(), source, 5000000, 675840).selection.selectedPolicy).toBe("local_critic_repair");
    expect(() => choose(configuration(), source, 5000001)).toThrow();
    const config = configuration(); config.episodeCapMicrousd = 600000;
    expect(choose(config, source, 600000).selection.maxCostMicrousd).toBe(600000);
  });
  it("requires a usable live cloud profile even when source is oversized", () => {
    const config = configuration();
    for (const invalid of [{ ...config, mode: "scripted" as const }, { ...config, cloud: undefined },
      { ...config, cloud: { ...config.cloud!, apiKey: "" } }, { ...config, cloud: { ...config.cloud!, inputUsdPerMillion: 0 } }]) {
      expect(() => choose(invalid, { ...source, bytes: 200000 })).toThrow();
    }
  });
  it("binds exact nonsecret configuration and allows only key rotation", () => {
    const config = configuration(), saved = choose(config).selection;
    const encoded = JSON.stringify(saved);
    for (const privateValue of [config.cloud!.apiKey, config.local!.apiKey, config.cloud!.endpoint, config.local!.endpoint, config.workerPath, config.python]) {
      expect(encoded).not.toContain(privateValue);
    }
    config.cloud!.apiKey = "rotated"; config.local!.apiKey = "also-rotated";
    expect(() => validateAutomaticSelection(config, saved, source, 100000000)).not.toThrow();
    const mutations: ((value: PatchRuntimeConfig) => void)[] = [
      value => { value.local!.model = "changed"; }, value => { value.local!.endpoint += "/changed"; },
      value => { value.local!.maxInputBytes = 32000; }, value => { value.localCodingMaxOutputTokens = 4096; },
      value => { value.cloud!.outputUsdPerMillion = 21; }, value => { value.stepLimit = 12; },
      value => { value.wallTimeSeconds = 599; }, value => { value.image = "changed"; },
      value => { value.workerPath = "/changed"; }, value => { value.python = "/changed"; },
    ];
    for (const mutate of mutations) { const changed = structuredClone(config); mutate(changed); expect(() => validateAutomaticSelection(changed, saved, source, 100000000)).toThrow(); }
    expect(() => validateAutomaticSelection(config, saved, { ...source, sourceTreeSha256: "c".repeat(64) }, 100000000)).toThrow(/changed/);
    expect(() => validateAutomaticSelection(config, saved, source, 675839)).toThrow(/changed/);
  });
  it("derives compatible cloud controls without mutating explicit policy configuration", () => {
    const config = configuration(); config.localCodingMaxCalls = 12; config.stepLimit = 35; config.wallTimeSeconds = 500;
    const original = structuredClone(config), effective = automaticRuntimeConfig(config, "prepared_cloud", 3000000);
    expect(effective).toMatchObject({ stepLimit: 35, wallTimeSeconds: 500, episodeCapMicrousd: 3000000 });
    expect(effective.localCodingMaxCalls).toBeUndefined(); expect(config).toEqual(original);
    expect(patchPolicyLimits(config, "local_critic_repair").stepLimit).toBe(13);
  });
  it("rejects oversized known task text by UTF-8 bytes before drafting", () => {
    expect(() => validateAutomaticTaskInput("x".repeat(16384), "x".repeat(4096))).not.toThrow();
    expect(() => validateAutomaticTaskInput("界".repeat(5462), "tests")).toThrow();
    expect(() => validateAutomaticTaskInput("task", "界".repeat(1366))).toThrow();
    expect(() => validateAutomaticTaskInput("task\0", "tests")).toThrow();
    expect(() => validateAutomaticTaskInput("task", "\ud800")).toThrow();
    expect(() => validateAutomaticTaskInput("task 😀", "tests")).not.toThrow();
  });
});
