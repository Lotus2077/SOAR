import { createHash } from "node:crypto";
import { PatchRunRoutingSelectionSchema, type PatchRunRoutingSelection } from "../../shared/patch-run-contracts";
import { isOpenAiSol, localCodingLimits, patchPolicyLimits, providerLimits,
  type PatchProviderConfig, type PatchRuntimeConfig } from "./config";
import { canonicalRequest } from "./native-contract";
import { AUTOMATIC_CRITIC_MAX_BYTES, AUTOMATIC_CRITIC_MAX_FILES, type PatchSourceSnapshot } from "./workspace";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const requireThat = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
type ConcretePolicy = PatchRunRoutingSelection["selectedPolicy"];

export function validateAutomaticTaskInput(objective: string, visibleCommand: string): void {
  requireThat(Boolean(objective.trim()) && Buffer.byteLength(objective) <= 16384 && Boolean(visibleCommand.trim()) &&
    Buffer.byteLength(visibleCommand) <= 4096 && [objective, visibleCommand].every(value => !value.includes("\0") &&
      !Array.from(value).some(character => { const point = character.codePointAt(0)!; return point >= 0xd800 && point <= 0xdfff; })),
  "Automatic routing task text exceeds the critic input limits.");
}

function validateProvider(config: PatchRuntimeConfig, provider: PatchProviderConfig | undefined, local: boolean): void {
  requireThat(provider && provider.protocol === "openai" && provider.id && provider.model && (local || provider.apiKey),
    "Automatic routing requires an admitted live cloud profile and session key.");
  const value = provider!, endpoint = new URL(value.endpoint);
  requireThat(!endpoint.username && !endpoint.password && !endpoint.hash &&
    (endpoint.protocol === "https:" || (endpoint.protocol === "http:" && value.allowInsecureHttp)), "Provider transport is not admitted.");
  requireThat(Number.isFinite(value.inputUsdPerMillion) && Number.isFinite(value.outputUsdPerMillion) &&
    (local ? value.inputUsdPerMillion === 0 && value.outputUsdPerMillion === 0
      : value.inputUsdPerMillion > 0 && value.outputUsdPerMillion > 0), "Provider prices are not admitted.");
  const limits = local ? localCodingLimits(config) : providerLimits(config, value);
  requireThat(Number.isInteger(limits.maxOutputTokens) && limits.maxOutputTokens >= 128 && limits.maxOutputTokens <= 16384 &&
    Number.isInteger(limits.maxInputBytes) && limits.maxInputBytes > 0 && limits.maxInputBytes <= 2_000_000,
  "Provider limits are not admitted.");
  if (isOpenAiSol(value)) requireThat(value.endpoint === "https://api.openai.com/v1/chat/completions" && !value.allowInsecureHttp &&
    value.inputUsdPerMillion === 4 && value.outputUsdPerMillion === 20 && limits.maxOutputTokens === 8192 &&
    limits.maxInputBytes <= 256000 && value.routing === undefined, "Sol calibration configuration changed.");
}

/** Derive only an automatic episode's controls; explicit policy configurations are untouched. */
export function automaticRuntimeConfig(config: PatchRuntimeConfig, policy: ConcretePolicy, maxCostMicrousd: number): PatchRuntimeConfig {
  requireThat(Number.isSafeInteger(maxCostMicrousd) && maxCostMicrousd > 0 &&
    maxCostMicrousd <= config.episodeCapMicrousd && maxCostMicrousd <= (policy === "local_critic_repair" ? 700_000 : 3_000_000),
  "Automatic routing cannot increase the episode budget.");
  const result = structuredClone(config);
  result.episodeCapMicrousd = maxCostMicrousd;
  result.stepLimit = Math.min(config.stepLimit, policy === "local_critic_repair" ? 13 : 40);
  result.wallTimeSeconds = Math.min(config.wallTimeSeconds, 600);
  delete result.localCodingMaxCalls;
  if (policy === "prepared_cloud") {
    delete result.localCodingThinking;
    delete result.localCodingCheckSchedule;
    delete result.plannerMode;
  }
  patchPolicyLimits(result, policy);
  return result;
}

function configurationSha(config: PatchRuntimeConfig, effective: PatchRuntimeConfig, policy: ConcretePolicy): string {
  const profile = (provider: PatchProviderConfig | undefined) => provider ? {
    id: provider.id, protocol: provider.protocol, destinationSha256: hash(provider.endpoint), model: provider.model,
    allowInsecureHttp: provider.allowInsecureHttp, inputUsdPerMillion: provider.inputUsdPerMillion,
    outputUsdPerMillion: provider.outputUsdPerMillion, limits: providerLimits(config, provider), routing: provider.routing ?? null,
  } : null;
  return hash(canonicalRequest({ mode: config.mode, cloud: profile(config.cloud), local: profile(config.local),
    localCoding: { ...localCodingLimits(config), maxCalls: config.localCodingMaxCalls ?? null,
      thinking: config.localCodingThinking ?? "disabled", checkSchedule: config.localCodingCheckSchedule ?? "final_only" },
    plannerMode: config.plannerMode ?? "plan", image: config.image, pythonSha256: hash(config.python), workerPathSha256: hash(config.workerPath),
    campaignCapMicrousd: config.campaignCapMicrousd,
    episodeCapMicrousd: effective.episodeCapMicrousd, limits: patchPolicyLimits(effective, policy) }));
}

/** Pure pre-request choice. Eligibility is necessary only; no future draft is trimmed to fit. */
export function selectAutomaticRouting(config: PatchRuntimeConfig, source: PatchSourceSnapshot,
  requestedMicrousd: number, campaignHeadroomMicrousd: number): { selection: PatchRunRoutingSelection; config: PatchRuntimeConfig } {
  requireThat(config.mode === "live", "Automatic routing requires live providers.");
  validateProvider(config, config.cloud, false);
  requireThat(Number.isSafeInteger(requestedMicrousd) && requestedMicrousd > 0 && requestedMicrousd <= config.episodeCapMicrousd &&
    Number.isSafeInteger(campaignHeadroomMicrousd) && campaignHeadroomMicrousd >= 0 &&
    Number.isInteger(config.stepLimit) && config.stepLimit > 0 && Number.isInteger(config.wallTimeSeconds) && config.wallTimeSeconds > 0,
  "Automatic routing limits are invalid.");
  let selectedPolicy: ConcretePolicy = "prepared_cloud";
  let reason: PatchRunRoutingSelection["reason"] = "baseline_exceeds_critic_hard_limits";
  if (source.files <= AUTOMATIC_CRITIC_MAX_FILES && source.bytes <= AUTOMATIC_CRITIC_MAX_BYTES) {
    let profileReady = false;
    try { validateProvider(config, config.local, true); patchPolicyLimits(config, "local_critic_repair"); profileReady = true; }
    catch { /* A missing/incompatible optional critic profile selects cloud before generation. */ }
    reason = "critic_profile_unavailable";
    if (profileReady) {
      const provider = config.cloud!, limits = providerLimits(config, provider);
      const reserve = Math.ceil(Math.min(128000, limits.maxInputBytes) * provider.inputUsdPerMillion + 8192 * provider.outputUsdPerMillion);
      requireThat(Number.isSafeInteger(reserve) && reserve > 0, "Critic reservation is invalid.");
      reason = "critic_budget_unavailable";
      if (reserve <= Math.min(requestedMicrousd, 700_000, campaignHeadroomMicrousd)) {
        selectedPolicy = "local_critic_repair"; reason = "baseline_within_critic_hard_limits";
      }
    }
  }
  const maxCostMicrousd = Math.min(requestedMicrousd, selectedPolicy === "local_critic_repair" ? 700_000 : 3_000_000);
  const effective = automaticRuntimeConfig(config, selectedPolicy, maxCostMicrousd);
  const selection = PatchRunRoutingSelectionSchema.parse({ schemaVersion: 1, selector: "source_size_v1", requestedPolicy: "automatic",
    selectedPolicy, reason, baseRevision: source.revision, sourceFiles: source.files, sourceBytes: source.bytes,
    sourceTreeSha256: source.sourceTreeSha256, configurationSha256: configurationSha(config, effective, selectedPolicy), maxCostMicrousd });
  return { selection, config: effective };
}

/** Re-selection may only confirm the saved decision, never replace it after creation. */
export function validateAutomaticSelection(config: PatchRuntimeConfig, saved: PatchRunRoutingSelection,
  source: PatchSourceSnapshot, campaignHeadroomMicrousd: number): PatchRuntimeConfig {
  const result = selectAutomaticRouting(config, source, saved.maxCostMicrousd, campaignHeadroomMicrousd);
  requireThat(canonicalRequest(result.selection) === canonicalRequest(saved), "Automatic routing source or configuration changed. Create a new run.");
  return result.config;
}
