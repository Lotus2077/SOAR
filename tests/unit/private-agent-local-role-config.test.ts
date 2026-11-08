import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { SoarConfig } from "../../src/main/config";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { modelIdentity } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES, type CoordinatorProfileName } from "../../src/main/private-agent/profiles";
import { DEFAULT_SERVING_POLICY, servingCardFreeze } from "../../src/main/private-agent/serving-card";
import { buildLocalScreenModelConfig, buildLocalScreenServingCard, localScreenSourceFreeze, runLocalArtifactScreen } from "../../scripts/private-agent-local-screen";
import { ADOPTING_ENTRY, adopt, proposedServingCard, writeCard } from "../helpers/serving-card-fixture";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
function workspace(): string { const root = mkdtempSync(join(tmpdir(), "soar-local-card-")); cleanups.push(() => rmSync(root, { recursive: true, force: true })); return root; }

const config = (streamingEnabled: boolean): Pick<SoarConfig, "vllm" | "streamingEnabled"> => ({ streamingEnabled,
  vllm: { baseUrl: "http://127.0.0.1:8000/v1", apiKey: "synthetic-local-token", model: "qwen3.8-flash-next",
    costPolicy: "local_zero_cost", maxOutputTokens: 8192, timeoutMs: 300_000 } });

/** Canonical hashes of the pre-migration local-screen literal, including absence of optional fields. */
const LEGACY_CONFIGS: { profile: CoordinatorProfileName; streaming: boolean; salted: boolean; sha256: string }[] = [
  { profile: "standard", streaming: false, salted: false, sha256: "12289b9f5e9362fb1ccda577f5cb24e68fd45a0e7a037b65e081492a69c2dc6d" },
  { profile: "standard", streaming: true, salted: true, sha256: "42ff508b64fa0e323c2d709f562dbb1092c18480db4367f059ff6a7a284a07b7" },
  { profile: "heavy", streaming: false, salted: false, sha256: "e770b52cb723197dc33fb7c575d10ee6f9a93a9d1cb51ca071ecf3e9dbe4c0cd" },
  { profile: "heavy", streaming: true, salted: true, sha256: "eb226a1a50962b75d04187221e9988812f6bc7b60df6a87f1ae076b0795b1190" },
];

describe("shared harness local role configuration", () => {
  it.each(LEGACY_CONFIGS)("preserves the $profile config bytes with streaming=$streaming and salt=$salted", row => {
    const model = buildLocalScreenModelConfig(config(row.streaming), COORDINATOR_PROFILES[row.profile], row.salted);
    expect(model).not.toHaveProperty("localReplyContract");
    expect(model).not.toHaveProperty("localContextTokens");
    expect(model).not.toHaveProperty("localTokenAdmissionSha256");
    expect(digest(canonical(model))).toBe(row.sha256);
  });

  it("binds the explicit contract while retaining Heavy sampling, streaming, limits and per-job cache salt", () => {
    const legacy = buildLocalScreenModelConfig(config(true), COORDINATOR_PROFILES.heavy);
    const optedConfig = config(true); optedConfig.vllm.localReplyContract = "flash_next_v1";
    optedConfig.vllm.localContextTokens = 262_144;
    // local-screen uses this config for its reader, writer, local planner/synthesiser and judge;
    // phase2-repair uses the same default-salted builder for its separate critic job.
    const opted = buildLocalScreenModelConfig(optedConfig, COORDINATOR_PROFILES.heavy);
    expect(opted).toEqual({ ...legacy, localReplyContract: "flash_next_v1", localContextTokens: 262_144 });
    expect(opted).toMatchObject({ thinking: "medium", maxOutputTokens: 16_384, maxRequestBytes: 640 * 1024,
      sampling: { temperature: 1, top_p: 0.95, top_k: 20 }, streaming: true, promptCaching: "vllm_job_salt_v1" });
    expect(modelIdentity(opted)).not.toEqual(modelIdentity(legacy));
    const changedConfig = config(true); changedConfig.vllm.localReplyContract = "flash_next_v1"; changedConfig.vllm.localContextTokens = 131_072;
    expect(modelIdentity(buildLocalScreenModelConfig(changedConfig, COORDINATOR_PROFILES.heavy))).not.toEqual(modelIdentity(opted));
    expect(buildLocalScreenModelConfig(optedConfig, COORDINATOR_PROFILES.heavy, false)).not.toHaveProperty("promptCaching");
  });

  it("binds the same exact-token policy for every harness local role without exposing its path", () => {
    const roleConfig = config(true);
    roleConfig.vllm.localReplyContract = "flash_next_v1"; roleConfig.vllm.localContextTokens = 262_144;
    roleConfig.vllm.localTokenAdmission = { path: "/synthetic/operator/policy.json", sha256: "a".repeat(64) };
    const model = buildLocalScreenModelConfig(roleConfig, COORDINATOR_PROFILES.heavy);
    expect(model.localTokenAdmissionSha256).toBe("a".repeat(64));
    expect(canonical(model)).not.toContain(roleConfig.vllm.localTokenAdmission.path);
    roleConfig.vllm.localTokenAdmission = { path: "/another/operator/policy.json", sha256: "a".repeat(64) };
    expect(modelIdentity(buildLocalScreenModelConfig(roleConfig, COORDINATOR_PROFILES.heavy))).toEqual(modelIdentity(model));
    roleConfig.vllm.localTokenAdmission.sha256 = "b".repeat(64);
    expect(modelIdentity(buildLocalScreenModelConfig(roleConfig, COORDINATOR_PROFILES.heavy))).not.toEqual(modelIdentity(model));
  });

  it("L1: builds the serving card only through the pair, records its digest and never its path, and leaves every model config unchanged (SC)", () => {
    expect(buildLocalScreenServingCard(config(true))).toBeUndefined();
    const root = workspace(), card = adopt(proposedServingCard(probe => { probe.P1.models[0].id = "qwen3.8-flash-next"; }), ADOPTING_ENTRY, { defaults: true });
    const written = writeCard(root, card), descriptor = { path: written.path, sha256: written.sha256 };
    const paired = config(true); paired.vllm.servingCard = descriptor;
    const loaded = buildLocalScreenServingCard(paired)!;
    expect(loaded.policy).toEqual(DEFAULT_SERVING_POLICY);
    expect(servingCardFreeze(loaded)).toEqual({ servingCard: { sha256: written.sha256, version: 1, date: "2026-11-08", entry: ADOPTING_ENTRY } });
    expect(canonical(servingCardFreeze(loaded))).not.toContain(root);
    for (const row of LEGACY_CONFIGS) {
      const withPair = config(row.streaming); withPair.vllm.servingCard = descriptor;
      const model = buildLocalScreenModelConfig(withPair, COORDINATOR_PROFILES[row.profile], row.salted);
      expect(digest(canonical(model))).toBe(row.sha256); expect(canonical(model)).not.toContain(root);
    }
  });

  it("L2: refuses a card before any directory, database or request exists, reading configuration only from its arguments (SC)", async () => {
    const root = workspace(), cwd = join(root, "empty-cwd"), task = join(root, "operator-task"); mkdirSync(cwd); mkdirSync(join(task, "input"), { recursive: true });
    const data = Buffer.from("21"), brief = "Read input/input.txt, double its integer and write output/result.txt. Keep all input files unchanged.";
    const job = canonical({ schemaVersion: 1, jobId: "synthetic_operator_fixture", goalFile: "brief.md",
      inputs: [{ path: "input.txt", sha256: digest(data), bytes: data.length, confidentiality: "private" }],
      requiredArtifacts: ["output/result.txt"], requiredCapabilities: ["local_calculation"],
      permissions: { externalModelDisclosure: "none", publicWeb: "none", publish: false, send: false, mutateInputs: false },
      verification: { deterministic: "independent arithmetic", humanCriteria: ["computed result"], runtimeAndPrivacyReceiptRequired: true },
      labelIsMetadataOnly: true, synthetic: true });
    writeFileSync(join(task, "job.json"), job); writeFileSync(join(task, "brief.md"), brief); writeFileSync(join(task, "input/input.txt"), data);
    const options = { taskDirectory: task, expectedJobSha256: digest(job), expectedBriefSha256: digest(brief), syntheticAuthoritySha256: digest("authored synthetic fixture"),
      expectedRuntimeSha256: localScreenSourceFreeze().sha256, imageId: `sha256:${"0".repeat(64)}`, outputDirectory: join(root, "operator-result") };
    const environment = (card: { path: string; sha256: string }) => ({ SOAR_PROVIDER_MODE: "local", SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1",
      SOAR_VLLM_COST_POLICY: "local_zero_cost", SOAR_VLLM_MODEL: "RM-01 VLM", SOAR_SERVING_CARD_FILE: card.path, SOAR_SERVING_CARD_SHA256: card.sha256 });
    const proposed = writeCard(root, proposedServingCard(), "proposed.json");
    const otherAlias = writeCard(root, adopt(proposedServingCard(probe => { probe.P1.models[0].id = "another-model"; }), ADOPTING_ENTRY, { defaults: true }), "other.json");
    for (const [card, code, parameter] of [[proposed, "serving_card_not_adopted", "decision"], [otherAlias, "serving_card_model_mismatch", "identity.servedModel"]] as const) {
      await expect(runLocalArtifactScreen(options, { environment: environment(card), cwd })).rejects.toMatchObject({ code, parameter, message: code });
      expect(existsSync(options.outputDirectory)).toBe(false);
    }
  });
});
