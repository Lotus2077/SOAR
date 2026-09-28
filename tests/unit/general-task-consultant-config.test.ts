import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectConsultantProfile, resolveConsultantProfile } from "../../src/main/general-tasks/consultant-config";
import { generalConsultantPreflight } from "../../scripts/check-general-consultant";
const prefix = "SOAR_GENERAL_CONSULTANT_";
function configured(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { SOAR_GENERAL_CONSULTANT_ENDPOINT: "https://consultant.example/v1/chat/completions", SOAR_GENERAL_CONSULTANT_MODEL: "synthetic-model",
    SOAR_GENERAL_CONSULTANT_ACCOUNT_ID: "synthetic-account", SOAR_GENERAL_CONSULTANT_CREDENTIAL_VERSION: "1", SOAR_GENERAL_CONSULTANT_API_KEY: "synthetic-key-only",
    SOAR_GENERAL_CONSULTANT_MAX_OUTPUT_TOKENS: "4096", SOAR_GENERAL_CONSULTANT_INPUT_MICROUSD_PER_MILLION: "1000000", SOAR_GENERAL_CONSULTANT_OUTPUT_MICROUSD_PER_MILLION: "2000000",
    SOAR_GENERAL_CONSULTANT_TIMEOUT_MS: "300000", SOAR_GENERAL_CONSULTANT_MAX_FEE_MICROUSD: "100000", ...extra };
}
describe("explicit host consultant profile", () => {
  it("stays unavailable without a complete explicit profile, including legacy credential-only environments", () => {
    expect(resolveConsultantProfile({})).toBeUndefined();
    expect(resolveConsultantProfile({ OPENAI_API_KEY: "legacy", SOAR_PATCH_API_KEY: "legacy", SOAR_VLLM_API_KEY: "legacy" })).toBeUndefined();
    for (const key of Object.keys(configured())) {
      const env = configured(); delete env[key]; expect(resolveConsultantProfile(env), key).toBeUndefined();
    }
  });
  it("requires synthetic-only exact priced grants and freezes the host-only descriptor", () => {
    const profile = resolveConsultantProfile(configured())!;
    expect(profile).toBeDefined();
    expect(profile.destination).toMatchObject({ kind: "cloud_model", syntheticOnly: true, privateDataAdmitted: false, requireExactGrant: true, credentialVersion: 1 });
    expect(profile.destination.approvalPriceProfileSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.keys(profile).sort()).toEqual(["destination", "identity", "maxFeeMicrousd", "model"]);
    expect(profile.identity).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(profile.destination)).toBe(true); expect(Object.isFrozen(profile.model)).toBe(true);
  });
  it("binds key rotation and every economic/destination identity but ignores unrelated environment", () => {
    const baseline = resolveConsultantProfile(configured())!;
    for (const [name, value] of Object.entries({ API_KEY: "rotated-synthetic-key", ACCOUNT_ID: "different", CREDENTIAL_VERSION: "2",
      ENDPOINT: "https://other.example/v1/chat/completions", MODEL: "other-model", MAX_OUTPUT_TOKENS: "2048", TIMEOUT_MS: "290000",
      INPUT_MICROUSD_PER_MILLION: "999999", OUTPUT_MICROUSD_PER_MILLION: "1999999", CACHED_INPUT_MICROUSD_PER_MILLION: "500000", MAX_FEE_MICROUSD: "99999", SERVICE_TIER: "default" })) {
      expect(resolveConsultantProfile(configured({ [prefix + name]: value }))?.identity, name).not.toBe(baseline.identity);
    }
    expect(resolveConsultantProfile(configured({ UNRELATED: "ignored" }))?.identity).toBe(baseline.identity);
  });
  it("rejects invalid prices, caps, URLs, metadata and header injection without exposing errors", () => {
    for (const extra of [{ INPUT_MICROUSD_PER_MILLION: "1.5" }, { MAX_FEE_MICROUSD: "-1" }, { OUTPUT_MICROUSD_PER_MILLION: "1e6" },
      { MAX_OUTPUT_TOKENS: "4097" }, { MAX_OUTPUT_TOKENS: "127" }, { TIMEOUT_MS: "300001" }, { CREDENTIAL_VERSION: "-1" },
      { CACHED_INPUT_MICROUSD_PER_MILLION: "1000001" }, { ENDPOINT: "https://key@consultant.example/v1" },
      { ENDPOINT: "https://consultant.example/v1?key=forbidden" }, { ENDPOINT: "https://consultant.example/v1#fragment" },
      { ACCOUNT_ID: "name\nsecret" }, { API_KEY: "key\r\nheader:value" }]) {
      expect(resolveConsultantProfile(configured(Object.fromEntries(Object.entries(extra).map(([key, value]) => [prefix + key, value]))))).toBeUndefined();
    }
  });
  it("permits only literal-loopback HTTP with both explicit fixture and test mode", () => {
    const options = { SOAR_GENERAL_CONSULTANT_ENDPOINT: "http://127.0.0.1:12345/v1/chat/completions" };
    expect(resolveConsultantProfile(configured(options))).toBeUndefined();
    expect(resolveConsultantProfile(configured({ ...options, NODE_ENV: "test" }))).toBeUndefined();
    expect(resolveConsultantProfile(configured({ ...options, SOAR_GENERAL_CONSULTANT_LOOPBACK_FIXTURE: "true" }))).toBeUndefined();
    expect(resolveConsultantProfile(configured({ ...options, NODE_ENV: "test", SOAR_GENERAL_CONSULTANT_LOOPBACK_FIXTURE: "true" }))?.destination.loopbackFixture).toBe(true);
    for (const host of ["localhost", "127.0.0.2", "remote.example", "192.168.1.1"]) expect(resolveConsultantProfile(configured({
      NODE_ENV: "test", SOAR_GENERAL_CONSULTANT_LOOPBACK_FIXTURE: "true", SOAR_GENERAL_CONSULTANT_ENDPOINT: `http://${host}:12345/v1/chat/completions`,
    }))).toBeUndefined();
  });
  it("names every missing explicit field without adopting legacy credentials", () => {
    const absent = inspectConsultantProfile({ SOAR_PATCH_API_KEY: "legacy-synthetic-key", OPENAI_API_KEY: "other-synthetic-key" });
    expect(absent).toMatchObject({ status: "missing", invalidFields: [] });
    expect(absent.missingFields).toEqual(Object.keys(configured()));
    for (const key of Object.keys(configured())) {
      const env = configured({ [key]: "" });
      expect(inspectConsultantProfile(env)).toMatchObject({ status: "missing", missingFields: [key] });
      expect(generalConsultantPreflight(env).exitCode).toBe(2);
      expect(resolveConsultantProfile(env)).toBeUndefined();
    }
  });
  it("binds only an explicitly configured default service tier while preserving absence", () => {
    const legacy = resolveConsultantProfile(configured())!;
    expect(legacy.model).not.toHaveProperty("serviceTier");
    const explicit = configured({ SOAR_GENERAL_CONSULTANT_SERVICE_TIER: "default" });
    expect(resolveConsultantProfile(explicit)?.model.serviceTier).toBe("default");
    expect(inspectConsultantProfile(explicit).status).toBe("ready");
    expect(resolveConsultantProfile(explicit)?.identity).not.toBe(legacy.identity);
    for (const value of ["auto", "priority", "flex", "", " default"]) {
      const env = configured({ SOAR_GENERAL_CONSULTANT_SERVICE_TIER: value });
      expect(resolveConsultantProfile(env)).toBeUndefined();
      expect(inspectConsultantProfile(env)).toMatchObject({ status: "invalid", invalidFields: [prefix + "SERVICE_TIER"] });
    }
  });
  it("reports only allowlisted invalid field names even when values contain sensitive-looking diagnostics", () => {
    const cases = [
      ["ENDPOINT", "not a URL: synthetic-endpoint-canary"],
      ["ENDPOINT", "https://synthetic-key@private-canary.example/v1?token=synthetic-query"],
      ["API_KEY", "synthetic-secret-canary\r\nAuthorization: forbidden"],
      ["ACCOUNT_ID", "synthetic-account-canary\n"],
      ["MODEL", "synthetic-model-canary\u0000"],
      ["INPUT_MICROUSD_PER_MILLION", "1.2"],
      ["OUTPUT_MICROUSD_PER_MILLION", "1e6"],
      ["CACHED_INPUT_MICROUSD_PER_MILLION", "1000001"],
      ["MAX_OUTPUT_TOKENS", "4097"],
      ["TIMEOUT_MS", "300001"],
      ["CREDENTIAL_VERSION", "-1"],
      ["MAX_FEE_MICROUSD", "9007199254740992"],
    ];
    for (const [field, value] of cases) {
      const env = configured({ [prefix + field]: value }), result = generalConsultantPreflight(env);
      expect(result.exitCode).toBe(2); expect(result.inspection).toMatchObject({ status: "invalid", missingFields: [], invalidFields: [prefix + field] });
      expect(JSON.stringify(result)).not.toContain(value); expect(resolveConsultantProfile(env)).toBeUndefined();
    }
    expect(inspectConsultantProfile(configured({ SOAR_GENERAL_CONSULTANT_LOOPBACK_FIXTURE: "true" })).invalidFields).toEqual([prefix + "LOOPBACK_FIXTURE"]);
  });
  it("distinguishes syntax readiness from authorization without exposing profile or credential identities", () => {
    const env = configured(), result = generalConsultantPreflight(env), profile = resolveConsultantProfile(env)!;
    expect(result.exitCode).toBe(0);
    expect(result.inspection).toMatchObject({ status: "ready", missingFields: [], invalidFields: [] });
    expect(result.inspection.reason).toContain("have not been verified");
    expect(result.inspection.reason).toContain("sends no request and grants no permission");
    expect(Object.keys(result.inspection).sort()).toEqual(["invalidFields", "missingFields", "reason", "status"]);
    const printed = JSON.stringify(result.inspection);
    for (const field of ["ENDPOINT", "API_KEY", "ACCOUNT_ID", "MODEL"]) expect(printed).not.toContain(env[prefix + field]);
    expect(printed).not.toContain(profile.identity); expect(printed).not.toContain(profile.destination.approvalPriceProfileSha256);
  });
  // Allow both bounded 15-second child launches plus test-runner overhead.
  it("runs the actual CLI using only a synthetic child environment and never echoes argument values", () => {
    const script = fileURLToPath(new URL("../../scripts/check-general-consultant.ts", import.meta.url));
    const options = { env: configured({ PATH: process.env.PATH }), timeout: 15000, encoding: "utf8" as const };
    const stdout = execFileSync(process.execPath, ["--import", "tsx", script], options);
    expect(JSON.parse(stdout)).toEqual(inspectConsultantProfile(configured()));
    try { execFileSync(process.execPath, ["--import", "tsx", script, "synthetic-secret-argument-canary"], { ...options, stdio: "pipe" });
      throw new Error("expected_argument_rejection");
    } catch (error) {
      const result = error as { status?: number; stdout?: string; stderr?: string };
      expect(result.status).toBe(2); expect(result.stdout).toBe(""); expect(result.stderr).toContain("takes no arguments");
      expect(result.stderr).not.toContain("synthetic-secret-argument-canary");
    }
  }, 40000);
});
