import path from "node:path";
import { existsSync } from "node:fs";
import { loadEnvironmentFiles, type LoadConfigOptions } from "../config";
import { isNativePatchPolicy, type PatchRunPolicy } from "../../shared/patch-run-contracts";

export interface PatchProviderConfig {
  id: string;
  protocol: "openai";
  endpoint: string;
  model: string;
  apiKey: string;
  allowInsecureHttp: boolean;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  maxOutputTokens?: number;
  maxInputBytes?: number;
  routing?: { allow_fallbacks: boolean; require_parameters?: boolean; only?: string[]; max_price: { prompt: number; completion: number; request?: number } };
}
export type LocalCodingThinking = "disabled" | "medium";
export type LocalCodingCheckSchedule = "final_only" | "repair_window" | "host_repair_window";
export interface PatchRuntimeConfig {
  mode: "scripted" | "live";
  enabled: boolean;
  python: string;
  workerPath: string;
  image: string;
  storageRoot: string;
  cloud?: PatchProviderConfig;
  local?: PatchProviderConfig;
  episodeCapMicrousd: number;
  campaignCapMicrousd: number;
  stepLimit: number;
  wallTimeSeconds: number;
  maxOutputTokens: number;
  maxInputBytes: number;
  /** Native coding has its own envelope; the older read-only scout keeps its limits. */
  localCodingMaxOutputTokens?: number;
  localCodingMaxInputBytes?: number;
  /** Internal narrower local-only experiment budget; no public environment flag. */
  localCodingMaxCalls?: number;
  /** Internal profile experiment; defaults stay disabled and have no public flag. */
  localCodingThinking?: LocalCodingThinking;
  /** Internal early-check experiment; no public flag or default activation. */
  localCodingCheckSchedule?: LocalCodingCheckSchedule;
  /** Internal planner-generated public checks; never enabled by the environment. */
  plannerMode?: "plan" | "plan_and_checks";
  scriptedActions?: string[];
}

/** Explicit calibration profile; undated ID is not an immutable snapshot.
 * https://developers.openai.com/api/docs/models/gpt-5.6-sol
 */
export function isOpenAiSol(provider: Pick<PatchProviderConfig, "id" | "model">): boolean {
  return provider.id === "openai" && provider.model === "gpt-5.6-sol";
}

export function providerLimits(config: Pick<PatchRuntimeConfig, "maxOutputTokens" | "maxInputBytes">,
  provider: Pick<PatchProviderConfig, "maxOutputTokens" | "maxInputBytes">): { maxOutputTokens: number; maxInputBytes: number } {
  return { maxOutputTokens: provider.maxOutputTokens ?? config.maxOutputTokens,
    maxInputBytes: provider.maxInputBytes ?? config.maxInputBytes };
}

export function localCodingLimits(config: Pick<PatchRuntimeConfig, "localCodingMaxOutputTokens" | "localCodingMaxInputBytes">): { maxOutputTokens: number; maxInputBytes: number } {
  return { maxOutputTokens: config.localCodingMaxOutputTokens ?? 8192,
    maxInputBytes: config.localCodingMaxInputBytes ?? 256000 };
}

export function localCodingThinking(config: Pick<PatchRuntimeConfig, "localCodingThinking">, policy: PatchRunPolicy): LocalCodingThinking {
  const thinking = config.localCodingThinking === undefined ? "disabled" : config.localCodingThinking;
  if ((thinking !== "disabled" && thinking !== "medium") || (thinking === "medium" && policy !== "local_only")) {
    throw new Error("Native medium thinking requires an explicit local_only profile.");
  }
  return thinking;
}

export function patchPolicyLimits(config: PatchRuntimeConfig, policy: PatchRunPolicy): {
  stepLimit: number; wallTimeSeconds: number; localStepLimit?: number; finishingReserve?: number;
  draftLocalStepLimit?: number; repairLocalStepLimit?: number;
  commandTimeoutSeconds: number; requestTimeoutSeconds: number; visibleCheckTimeoutSeconds: number;
  localCoding?: ReturnType<typeof localCodingLimits> & { thinking: LocalCodingThinking; checkSchedule: LocalCodingCheckSchedule };
  plannerMode?: "plan_and_checks"; maxOutputTokens: number; maxInputBytes: number;
} {
  const thinking = localCodingThinking(config, policy);
  if (policy === "local_critic_repair") {
    const cloudLimits = config.cloud ? providerLimits(config, config.cloud) : undefined;
    if (config.mode !== "live" || !config.cloud || !config.local ||
        config.local.inputUsdPerMillion !== 0 || config.local.outputUsdPerMillion !== 0 ||
        !Number.isInteger(config.stepLimit) || config.stepLimit < 13 ||
        (config.localCodingMaxCalls !== undefined && config.localCodingMaxCalls !== 12) ||
        (config.localCodingCheckSchedule !== undefined && config.localCodingCheckSchedule !== "final_only") ||
        (config.plannerMode !== undefined && config.plannerMode !== "plan") || cloudLimits?.maxOutputTokens !== 8192) {
      throw new Error("Local critique requires zero local API token fees, a live 8-draft/4-repair/1-critic profile, final-only checks and an 8192-token cloud envelope.");
    }
    return { stepLimit: 13, wallTimeSeconds: Math.min(config.wallTimeSeconds, 600),
      localStepLimit: 12, draftLocalStepLimit: 8, repairLocalStepLimit: 4, finishingReserve: 2,
      commandTimeoutSeconds: 30, requestTimeoutSeconds: 120, visibleCheckTimeoutSeconds: 60,
      localCoding: { ...localCodingLimits(config), thinking, checkSchedule: "final_only" },
      maxOutputTokens: config.maxOutputTokens, maxInputBytes: config.maxInputBytes };
  }
  const requestedLocalCalls = config.localCodingMaxCalls === undefined ? 24 : config.localCodingMaxCalls;
  if (!Number.isInteger(requestedLocalCalls) || requestedLocalCalls < 2 || requestedLocalCalls > 24 ||
      (requestedLocalCalls !== 24 && policy !== "local_only")) {
    throw new Error("A narrower native call budget requires local_only and an integer from 2 to 24.");
  }
  if (requestedLocalCalls < 24 && (!Number.isInteger(config.stepLimit) || config.stepLimit < 2)) {
    throw new Error("A narrower native call budget requires at least two total finishing calls.");
  }
  const localStepLimit = requestedLocalCalls < 24 ? Math.min(requestedLocalCalls, config.stepLimit) : 24;
  const checkSchedule = config.localCodingCheckSchedule === undefined ? "final_only" : config.localCodingCheckSchedule;
  if (!["final_only", "repair_window", "host_repair_window"].includes(checkSchedule) ||
      (checkSchedule !== "final_only" && (localStepLimit < 5 || !Number.isInteger(config.stepLimit) || config.stepLimit < localStepLimit ||
        (checkSchedule === "repair_window" ? policy !== "local_only" : !isNativePatchPolicy(policy))))) {
    throw new Error(checkSchedule === "repair_window"
      ? "The repair_window check schedule requires local_only and at least five local calls within the total call budget."
      : "An experimental check schedule requires an admitted native policy and at least five local calls within the total call budget.");
  }
  const plannerMode = config.plannerMode === undefined ? "plan" : config.plannerMode;
  if ((plannerMode !== "plan" && plannerMode !== "plan_and_checks") || (plannerMode === "plan_and_checks" &&
      (config.mode !== "live" || (policy !== "cloud_plan_local" && policy !== "cloud_plan_local_review") ||
        checkSchedule !== "host_repair_window" || localStepLimit !== 24 || config.stepLimit < 24))) {
    throw new Error("Planner checks require the explicit live planned-native host-check profile and its existing 24-call local budget.");
  }
  return isNativePatchPolicy(policy)
    ? { stepLimit: Math.min(config.stepLimit, localStepLimit < 24 ? localStepLimit : 40), wallTimeSeconds: Math.min(config.wallTimeSeconds, 600),
      localStepLimit, finishingReserve: 2, commandTimeoutSeconds: 30, requestTimeoutSeconds: 120,
      visibleCheckTimeoutSeconds: 60, localCoding: { ...localCodingLimits(config), thinking, checkSchedule },
      ...(plannerMode === "plan_and_checks" ? { plannerMode } : {}),
      maxOutputTokens: config.maxOutputTokens, maxInputBytes: config.maxInputBytes }
    : { stepLimit: config.stepLimit, wallTimeSeconds: config.wallTimeSeconds,
      commandTimeoutSeconds: 30, requestTimeoutSeconds: 120, visibleCheckTimeoutSeconds: 60,
      maxOutputTokens: config.maxOutputTokens, maxInputBytes: config.maxInputBytes };
}

function number(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) throw new Error("Invalid coding pilot limit or price.");
  return parsed;
}

function scriptedActions(value: string | undefined): string[] {
  if (value === undefined) return [
    "python -m unittest discover -s tests -v",
    "python -c \"from pathlib import Path; p=Path('calculator.py'); s=p.read_text(); old='return a - b'; assert old in s; p.write_text(s.replace(old, 'return a + b'))\"",
    "python -m unittest discover -s tests -v", "SOAR_SUBMIT",
  ];
  try {
    if (Buffer.byteLength(value) > 2_000_000) throw new Error();
    const actions: unknown = JSON.parse(value);
    if (!Array.isArray(actions) || !actions.length || actions.length > 60 ||
        actions.some(action => typeof action !== "string" || !action.trim() || action.length > 32768)) throw new Error();
    return actions;
  } catch { throw new Error("Invalid scripted coding fixture actions."); }
}

export function loadPatchRuntimeConfig(options: LoadConfigOptions = {}): PatchRuntimeConfig {
  const env = loadEnvironmentFiles(options);
  const appPath = options.appPath ?? process.cwd();
  const localRuntime = path.join(appPath, ".soar", "patch-runtime", "bin", "python");
  const mode = env.SOAR_PATCH_MODE === "scripted" ? "scripted" : "live";
  const providerId = env.SOAR_PATCH_PROVIDER ?? "openrouter";
  if (providerId !== "openai" && providerId !== "openrouter") {
    throw new Error("Coding pilot provider must be openai or openrouter.");
  }
  const model = env.SOAR_PATCH_MODEL ?? (providerId === "openai"
    ? "gpt-4.1-mini-2025-04-14"
    : env.SOAR_OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash-0731");
  const sol = isOpenAiSol({ id: providerId, model });
  const defaultPrices = providerId === "openai" && model === "gpt-4.1-mini-2025-04-14"
    ? { input: 0.40, output: 1.60 }
    : sol ? { input: 4, output: 20 }
    : providerId === "openrouter" && model === "deepseek/deepseek-v4-flash-0731"
      ? { input: 0.44, output: 1.32 } : { input: 0, output: 0 };
  const inputPrice = number(env.SOAR_PATCH_INPUT_USD_PER_MILLION, defaultPrices.input, 1000);
  const outputPrice = number(env.SOAR_PATCH_OUTPUT_USD_PER_MILLION, defaultPrices.output, 1000);
  if (sol && (inputPrice !== 4 || outputPrice !== 20)) {
    throw new Error("The Sol calibration requires standard input/output prices of USD 4/20 per million tokens.");
  }
  const apiKey = env.SOAR_PATCH_API_KEY ?? "";
  const cloud: PatchProviderConfig | undefined = apiKey && inputPrice > 0 && outputPrice > 0 ? {
    id: providerId, protocol: "openai",
    endpoint: providerId === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions",
    model, apiKey,
    allowInsecureHttp: false, inputUsdPerMillion: inputPrice, outputUsdPerMillion: outputPrice,
    ...(providerId === "openrouter" ? { routing: { allow_fallbacks: false, require_parameters: true,
      ...(env.SOAR_PATCH_PROVIDER_SLUG ? { only: [env.SOAR_PATCH_PROVIDER_SLUG] } : model === "deepseek/deepseek-v4-flash-0731" ? { only: ["deepseek"] } : {}),
      max_price: { prompt: inputPrice, completion: outputPrice, request: 0 } } } : {}),
  } : undefined;
  const localBase = env.SOAR_VLLM_BASE_URL;
  // Existing endpoint settings do not establish zero token fees. Preserve the
  // normal Local provider's explicit operator-attested cost boundary.
  const local: PatchProviderConfig | undefined = env.SOAR_PATCH_CLOUD_ONLY !== "true" && localBase && env.SOAR_VLLM_MODEL && env.SOAR_VLLM_COST_POLICY === "local_zero_cost" ? {
    id: "local", protocol: "openai", endpoint: `${localBase.replace(/\/$/u, "")}/chat/completions`,
    model: env.SOAR_VLLM_MODEL, apiKey: env.SOAR_VLLM_API_KEY ?? "",
    allowInsecureHttp: env.SOAR_ALLOW_INSECURE_VLLM_HTTP === "true",
    inputUsdPerMillion: 0, outputUsdPerMillion: 0,
    maxOutputTokens: Math.floor(number(env.SOAR_PATCH_LOCAL_MAX_OUTPUT_TOKENS, 2048, 16384)),
    maxInputBytes: Math.floor(number(env.SOAR_PATCH_LOCAL_MAX_INPUT_BYTES, 64000, 2000000)),
  } : undefined;
  // Scripted mode is explicitly selected and visibly labeled; it never resolves a cloud key for its worker.
  return {
    mode, enabled: env.SOAR_PATCH_MODE === "live" || env.SOAR_PATCH_MODE === "scripted",
    python: env.SOAR_PATCH_PYTHON ?? (existsSync(localRuntime) ? localRuntime : "python3"),
    workerPath: path.join(appPath, "runtime", "patch-worker", "worker.py"),
    image: env.SOAR_PATCH_IMAGE ?? "soar-patch-python:1",
    storageRoot: path.join(options.userDataPath ?? path.join(appPath, ".soar"), "patch-runs"),
    ...(mode === "live" && cloud ? { cloud } : {}), ...(mode === "live" && local ? { local } : {}),
    episodeCapMicrousd: Math.floor(number(env.SOAR_PATCH_EPISODE_USD, 5, 5) * 1_000_000),
    campaignCapMicrousd: Math.floor(number(env.SOAR_PATCH_CAMPAIGN_USD, 70, 180) * 1_000_000),
    stepLimit: Math.floor(number(env.SOAR_PATCH_STEPS, 60, 120)),
    wallTimeSeconds: Math.floor(number(env.SOAR_PATCH_TIMEOUT_SECONDS, 1200, 3600)),
    // Sol uses a total reasoning + visible output allowance. The byte envelope
    // stays below its 272K-input-token long-context pricing boundary.
    maxOutputTokens: sol ? 8192 : 4096, maxInputBytes: sol ? 256000 : 512000,
    localCodingMaxOutputTokens: Math.floor(number(env.SOAR_PATCH_LOCAL_CODING_MAX_OUTPUT_TOKENS, 8192, 8192)),
    localCodingMaxInputBytes: Math.floor(number(env.SOAR_PATCH_LOCAL_CODING_MAX_INPUT_BYTES, 256000, 256000)),
    ...(mode === "scripted" ? { scriptedActions: scriptedActions(env.SOAR_PATCH_SCRIPTED_ACTIONS_JSON) } : {}),
  };
}
