import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPatchRuntimeConfig, patchPolicyLimits, providerLimits } from "../../src/main/patch-runs/config";

describe("coding pilot configuration", () => {
  it("accepts bounded fixture actions only in explicitly scripted mode", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "soar-scripted-config-"));
    try {
      const environment = { SOAR_PATCH_MODE: "scripted", SOAR_PATCH_SCRIPTED_ACTIONS_JSON: '["SOAR_REQUEST_HELP","SOAR_SUBMIT"]' };
      const fixture = loadPatchRuntimeConfig({ cwd, appPath: cwd, environment });
      expect(fixture.scriptedActions).toEqual(["SOAR_REQUEST_HELP", "SOAR_SUBMIT"]);
      expect(fixture.cloud).toBeUndefined();
      expect(fixture.local).toBeUndefined();
      expect(loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: { ...environment, SOAR_PATCH_MODE: "live", SOAR_PATCH_SCRIPTED_ACTIONS_JSON: "invalid" } }).scriptedActions).toBeUndefined();
      for (const value of ["invalid", "[]", "{}", '[null]', '[""]', JSON.stringify(Array(61).fill("true"))]) {
        expect(() => loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: { ...environment, SOAR_PATCH_SCRIPTED_ACTIONS_JSON: value } })).toThrow(/Invalid scripted/);
      }
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });

  it("separates local bounds from Sol and requires an explicit bounded campaign override", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "soar-patch-config-"));
    try {
      const environment = { SOAR_PATCH_MODE: "live", SOAR_PATCH_PROVIDER: "openai", SOAR_PATCH_MODEL: "gpt-5.6-sol",
        SOAR_PATCH_API_KEY: "fixture-session-key", SOAR_VLLM_BASE_URL: "http://127.0.0.1:1/v1",
        SOAR_VLLM_MODEL: "fixture-local", SOAR_VLLM_COST_POLICY: "local_zero_cost", SOAR_PATCH_CAMPAIGN_USD: "180" };
      const config = loadPatchRuntimeConfig({ cwd, appPath: cwd, environment });
      expect(providerLimits(config, config.local!)).toEqual({ maxOutputTokens: 2048, maxInputBytes: 64000 });
      expect(providerLimits(config, config.cloud!)).toEqual({ maxOutputTokens: 8192, maxInputBytes: 256000 });
      const episode = { ...config, stepLimit: 40, wallTimeSeconds: 600 };
      for (const policy of ["prepared_cloud", "local_only", "local_first", "cloud_plan_local", "cloud_plan_local_review"] as const) {
        expect(patchPolicyLimits(episode, policy)).toMatchObject({ stepLimit: 40, wallTimeSeconds: 600,
          maxOutputTokens: 8192, maxInputBytes: 256000, commandTimeoutSeconds: 30,
          requestTimeoutSeconds: 120, visibleCheckTimeoutSeconds: 60 });
      }
      expect(config.campaignCapMicrousd).toBe(180_000_000);
      expect(() => loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: { ...environment, SOAR_PATCH_CAMPAIGN_USD: "181" } })).toThrow(/limit/);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it("pins the default OpenRouter provider and all admitted price controls", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "soar-patch-config-"));
    try {
      const config = loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: { SOAR_PATCH_MODE: "live", SOAR_PATCH_API_KEY: "fixture-session-key" } });
      expect(config.cloud?.routing).toEqual({ only: ["deepseek"], require_parameters: true, allow_fallbacks: false, max_price: { prompt: 0.44, completion: 1.32, request: 0 } });
      expect(config.campaignCapMicrousd).toBe(70_000_000);
      expect(config.episodeCapMicrousd).toBe(5_000_000);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it("keeps local authority absent in a cloud-only launch", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "soar-patch-config-"));
    try {
      const env = { SOAR_PATCH_MODE: "live", SOAR_PATCH_CLOUD_ONLY: "true", SOAR_VLLM_BASE_URL: "http://127.0.0.1:1/v1", SOAR_VLLM_MODEL: "not-configured", SOAR_VLLM_COST_POLICY: "local_zero_cost" };
      expect(loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: env }).local).toBeUndefined();
      expect(loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: { ...env, SOAR_PATCH_CLOUD_ONLY: "false" } }).local).toBeDefined();
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it("isolates direct OpenAI defaults from legacy OpenRouter models and upstream pins", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "soar-patch-config-"));
    try {
      const config = loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: {
        SOAR_PATCH_MODE: "live", SOAR_PATCH_PROVIDER: "openai", SOAR_PATCH_API_KEY: "fixture-session-key",
        SOAR_OPENROUTER_MODEL: "legacy-router-model", SOAR_OPENROUTER_BASE_URL: "https://legacy.invalid/v1",
        SOAR_PATCH_PROVIDER_SLUG: "deepinfra/fp8",
      } });
      expect(config.cloud).toEqual({ id: "openai", protocol: "openai", endpoint: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4.1-mini-2025-04-14", apiKey: "fixture-session-key", allowInsecureHttp: false,
        inputUsdPerMillion: 0.40, outputUsdPerMillion: 1.60 });
      expect(config.cloud).not.toHaveProperty("routing");
      expect(config.campaignCapMicrousd).toBe(70_000_000);
      expect(config.episodeCapMicrousd).toBe(5_000_000);
      expect(config.maxOutputTokens).toBe(4096);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it("requires explicit prices for other direct OpenAI models and rejects unknown providers", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "soar-patch-config-"));
    try {
      const environment = { SOAR_PATCH_MODE: "live", SOAR_PATCH_PROVIDER: "openai", SOAR_PATCH_API_KEY: "fixture-session-key",
        SOAR_PATCH_MODEL: "deepseek/deepseek-v4-flash-0731" };
      expect(loadPatchRuntimeConfig({ cwd, appPath: cwd, environment }).cloud).toBeUndefined();
      expect(() => loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: { ...environment, SOAR_PATCH_PROVIDER: "unknown" } })).toThrow(/provider must be/);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it("never puts a configured session key in a scripted worker configuration", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "soar-patch-config-"));
    try {
      const config = loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: { SOAR_PATCH_MODE: "scripted", SOAR_PATCH_API_KEY: "fixture-session-key" } });
      expect(config.cloud).toBeUndefined();
      expect(JSON.stringify(config)).not.toContain("fixture-session-key");
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it("narrows only programmatic local-only call budgets and leaves all default policies unchanged", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "soar-native-budget-config-"));
    try {
      const base = loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: { SOAR_PATCH_MODE: "scripted" } });
      for (const policy of ["cloud", "prepared_cloud", "hybrid", "local_only", "local_first", "cloud_plan_local", "cloud_plan_local_review"] as const) {
        expect(patchPolicyLimits({ ...base, localCodingMaxCalls: 24 }, policy)).toEqual(patchPolicyLimits(base, policy));
        if (policy !== "local_only") expect(() => patchPolicyLimits({ ...base, localCodingMaxCalls: 8 }, policy)).toThrow(/local_only/);
      }
      const narrowed = patchPolicyLimits({ ...base, localCodingMaxCalls: 8 }, "local_only");
      expect(narrowed).toMatchObject({ stepLimit: 8, localStepLimit: 8, finishingReserve: 2,
        localCoding: { maxOutputTokens: 8192, maxInputBytes: 256000 } });
      expect(patchPolicyLimits({ ...base, localCodingMaxCalls: 8, stepLimit: 5 }, "local_only")).toMatchObject({ stepLimit: 5, localStepLimit: 5, finishingReserve: 2 });
      expect(() => patchPolicyLimits({ ...base, localCodingMaxCalls: 8, stepLimit: 1 }, "local_only")).toThrow(/two total/);
      expect(patchPolicyLimits(base, "local_only")).toMatchObject({ stepLimit: 40, localStepLimit: 24, finishingReserve: 2 });
      for (const value of [0, 1, 25, 8.5, Number.NaN, Infinity, "8", true, null]) {
        expect(() => patchPolicyLimits({ ...base, localCodingMaxCalls: value as number }, "local_only")).toThrow(/integer/);
      }
      // No public environment flag is introduced for the private diagnostic.
      expect(loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: { SOAR_PATCH_MODE: "scripted", SOAR_PATCH_LOCAL_CODING_MAX_CALLS: "8" } }).localCodingMaxCalls).toBeUndefined();
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it("keeps thinking disabled unless a programmatic local-only medium profile is selected", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "soar-native-thinking-config-"));
    try {
      const base = loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: { SOAR_PATCH_MODE: "scripted" } });
      expect(base.localCodingThinking).toBeUndefined();
      for (const policy of ["cloud", "prepared_cloud", "hybrid", "local_only", "local_first", "cloud_plan_local", "cloud_plan_local_review"] as const) {
        expect(patchPolicyLimits({ ...base, localCodingThinking: "disabled" }, policy)).toEqual(patchPolicyLimits(base, policy));
        if (policy !== "local_only") expect(() => patchPolicyLimits({ ...base, localCodingThinking: "medium" }, policy)).toThrow(/local_only/);
      }
      const disabled = patchPolicyLimits({ ...base, stepLimit: 8, localCodingMaxCalls: 8 }, "local_only");
      const medium = patchPolicyLimits({ ...base, stepLimit: 8, localCodingMaxCalls: 8, localCodingThinking: "medium" }, "local_only");
      expect(disabled.localCoding).toEqual({ maxOutputTokens: 8192, maxInputBytes: 256000, thinking: "disabled", checkSchedule: "final_only" });
      expect(medium).toEqual({ ...disabled, localCoding: { ...disabled.localCoding, thinking: "medium" } });
      for (const value of [null, true, false, "", "high", "none", 0, {}]) {
        expect(() => patchPolicyLimits({ ...base, localCodingThinking: value as never }, "local_only")).toThrow(/profile/);
      }
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it("keeps final-only checking by default and bounds the explicit repair window", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "soar-native-check-schedule-"));
    try {
      const base = loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: {
        SOAR_PATCH_MODE: "scripted", SOAR_PATCH_LOCAL_CODING_CHECK_SCHEDULE: "repair_window",
      } });
      expect(base.localCodingCheckSchedule).toBeUndefined();
      for (const policy of ["cloud", "prepared_cloud", "hybrid", "local_only", "local_first", "cloud_plan_local", "cloud_plan_local_review"] as const) {
        expect(patchPolicyLimits({ ...base, localCodingCheckSchedule: "final_only" }, policy)).toEqual(patchPolicyLimits(base, policy));
        if (policy !== "local_only") expect(() => patchPolicyLimits({ ...base, localCodingCheckSchedule: "repair_window" }, policy)).toThrow(/local_only/);
      }
      const config = { ...base, stepLimit: 8, localCodingMaxCalls: 8 };
      const old = patchPolicyLimits(config, "local_only");
      expect(patchPolicyLimits({ ...config, localCodingCheckSchedule: "repair_window" }, "local_only"))
        .toEqual({ ...old, localCoding: { ...old.localCoding, checkSchedule: "repair_window" } });
      for (const calls of [2, 3, 4]) expect(() => patchPolicyLimits({ ...config,
        localCodingMaxCalls: calls, localCodingCheckSchedule: "repair_window" }, "local_only")).toThrow(/five local/);
      expect(() => patchPolicyLimits({ ...config, stepLimit: 4, localCodingCheckSchedule: "repair_window" }, "local_only")).toThrow(/five local/);
      expect(() => patchPolicyLimits({ ...base, stepLimit: 8, localCodingCheckSchedule: "repair_window" }, "local_only")).toThrow(/total call budget/);
      expect(patchPolicyLimits({ ...config, localCodingMaxCalls: 5, localCodingCheckSchedule: "repair_window" }, "local_only").localStepLimit).toBe(5);
      for (const schedule of [null, true, "", "early", 1, {}]) expect(() => patchPolicyLimits({ ...config,
        localCodingCheckSchedule: schedule as never }, "local_only")).toThrow(/check schedule/);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
