import { describe, expect, it } from "vitest";

import type { SoarConfig } from "../../src/main/config";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { modelIdentity } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES, type CoordinatorProfileName } from "../../src/main/private-agent/profiles";
import { buildLocalScreenModelConfig } from "../../scripts/private-agent-local-screen";

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
});
