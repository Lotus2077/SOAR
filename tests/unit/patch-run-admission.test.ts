import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { providerLimits, type PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import { admitPreparedRequest, canonicalRequest } from "../../src/main/patch-runs/worker";

const config: PatchRuntimeConfig = {
  mode: "live", enabled: true, python: "python3", workerPath: "/fixture/worker.py", image: "fixture:1", storageRoot: "/fixture/runs",
  episodeCapMicrousd: 5_000_000, campaignCapMicrousd: 70_000_000, stepLimit: 60, wallTimeSeconds: 1200,
  maxOutputTokens: 4096, maxInputBytes: 512000,
  cloud: { id: "openrouter", protocol: "openai", endpoint: "https://api.example.invalid/chat/completions", model: "fixture-model", apiKey: "fixture-private-value",
    allowInsecureHttp: false, inputUsdPerMillion: 1, outputUsdPerMillion: 3,
    routing: { allow_fallbacks: false, max_price: { prompt: 1, completion: 3 } } },
  local: { id: "local", protocol: "openai", endpoint: "http://127.0.0.1:8888/v1/chat/completions", model: "fixture-local", apiKey: "",
    allowInsecureHttp: true, inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
};
const cloudAuthority = { policy: "cloud" as const, phase: "cloud_solver" as const };
function event(phase = "cloud", selectedConfig = config): Record<string, unknown> {
  const provider = phase === "scout" ? selectedConfig.local! : selectedConfig.cloud!;
  const limits = providerLimits(selectedConfig, provider);
  const body = { model: provider.model, messages: [{ role: "user", content: "Fix arithmetic. 中文" }], max_tokens: limits.maxOutputTokens,
    stream: false, ...(provider.routing ? { provider: provider.routing } : {}) };
  const encoded = canonicalRequest(body);
  const digest = createHash("sha256").update(encoded).digest("hex");
  return { phase, model: provider.model, requestId: "a".repeat(32), maxOutputTokens: limits.maxOutputTokens,
    estimatedInputTokens: Buffer.byteLength(encoded), bodySha256: digest,
    provider: { id: provider.id, protocol: provider.protocol, endpoint: provider.endpoint },
    preparedRequest: { method: "POST", url: provider.endpoint, body, bodySha256: digest } };
}
function alteredBody(change: (body: Record<string, unknown>) => void): Record<string, unknown> {
  const input = event();
  const prepared = input.preparedRequest as { body: Record<string, unknown>; bodySha256: string };
  change(prepared.body);
  const encoded = canonicalRequest(prepared.body);
  prepared.bodySha256 = createHash("sha256").update(encoded).digest("hex");
  input.bodySha256 = prepared.bodySha256;
  input.estimatedInputTokens = Buffer.byteLength(encoded);
  return input;
}

describe("coding provider request admission", () => {
  it("keeps local input/output authority separate from the Sol cloud allowance", () => {
    const selected: PatchRuntimeConfig = { ...config, maxOutputTokens: 8192, maxInputBytes: 256000,
      local: { ...config.local!, maxOutputTokens: 2048, maxInputBytes: 1024 } };
    const localAuthority = { policy: "hybrid" as const, phase: "local_investigation" as const };
    const input = event("scout", selected);
    expect(admitPreparedRequest(input, selected, localAuthority)).toMatchObject({ phase: "scout", reservation: 0 });
    const prepared = input.preparedRequest as { body: { max_tokens: number; messages: { role: string; content: string }[] }; bodySha256: string };
    prepared.body.max_tokens = 8192;
    expect(() => admitPreparedRequest(input, selected, localAuthority)).toThrow(/configuration/);
    prepared.body.max_tokens = 2048;
    prepared.body.messages[0]!.content = "x".repeat(2048);
    const encoded = canonicalRequest(prepared.body);
    prepared.bodySha256 = createHash("sha256").update(encoded).digest("hex");
    input.bodySha256 = prepared.bodySha256;
    input.estimatedInputTokens = Buffer.byteLength(encoded);
    expect(() => admitPreparedRequest(input, selected, localAuthority)).toThrow(/envelope/);
  });

  it("binds direct OpenAI requests to their endpoint and rejects OpenRouter-only routing", () => {
    const directConfig: PatchRuntimeConfig = { ...config, cloud: {
      id: "openai", protocol: "openai", endpoint: "https://api.openai.com/v1/chat/completions",
      model: "gpt-4.1-mini-2025-04-14", apiKey: "fixture-private-value", allowInsecureHttp: false,
      inputUsdPerMillion: 0.40, outputUsdPerMillion: 1.60,
    } };
    const input = event("cloud", directConfig);
    const admitted = admitPreparedRequest(input, directConfig, cloudAuthority);
    expect(admitted.provider.id).toBe("openai");
    expect(admitted.reservation).toBe(Math.ceil(Number(input.estimatedInputTokens) * 0.40 + 4096 * 1.60));
    const prepared = input.preparedRequest as { body: Record<string, unknown> };
    expect(prepared.body).not.toHaveProperty("provider");
    expect(() => admitPreparedRequest({ ...input, preparedRequest: { ...prepared, method: "POST", bodySha256: input.bodySha256,
      url: "https://openrouter.ai/api/v1/chat/completions" } }, directConfig, cloudAuthority)).toThrow(/configuration/);
    prepared.body.provider = config.cloud!.routing;
    expect(() => admitPreparedRequest(input, directConfig, cloudAuthority)).toThrow(/routing/);
  });
  it("prices the exact canonical UTF-8 request and output ceiling before dispatch", () => {
    const input = event();
    const admitted = admitPreparedRequest(input, config, cloudAuthority);
    expect(admitted.digest).toBe(input.bodySha256);
    expect(admitted.reservation).toBe(Number(input.estimatedInputTokens) + 4096 * 3);
    expect(admitted.provider).toBe(config.cloud);
  });
  it("rejects fake mode, absent providers and phase/policy drift", () => {
    expect(() => admitPreparedRequest(event(), { ...config, mode: "scripted" }, cloudAuthority)).toThrow(/not admitted/);
    expect(() => admitPreparedRequest(event(), { ...config, cloud: undefined }, cloudAuthority)).toThrow(/not admitted/);
    expect(() => admitPreparedRequest(event("arbitrary"), config, cloudAuthority)).toThrow();
    expect(() => admitPreparedRequest(event("scout"), config, { policy: "cloud", phase: "local_investigation" })).toThrow(/phase/);
    expect(() => admitPreparedRequest(event(), config, { policy: "hybrid", phase: "checking" })).toThrow(/phase/);
    expect(admitPreparedRequest(event("scout"), config, { policy: "hybrid", phase: "local_investigation" }).reservation).toBe(0);
  });
  it("rejects alternate model, destination, method and provider identity", () => {
    const input = event();
    expect(() => admitPreparedRequest({ ...input, model: "other" }, config, cloudAuthority)).toThrow(/configuration/);
    const prepared = input.preparedRequest as object;
    expect(() => admitPreparedRequest({ ...input, preparedRequest: { ...prepared, url: "https://other.example.invalid" } }, config, cloudAuthority)).toThrow(/configuration/);
    expect(() => admitPreparedRequest({ ...input, preparedRequest: { ...prepared, method: "GET" } }, config, cloudAuthority)).toThrow();
    expect(() => admitPreparedRequest({ ...input, provider: { id: "other", protocol: "openai", endpoint: config.cloud!.endpoint } }, config, cloudAuthority)).toThrow(/identity/);
  });
  it("rejects changed price routing, fallback, extra request fields and native tools", () => {
    expect(() => admitPreparedRequest(alteredBody((body) => { body.provider = { allow_fallbacks: true, max_price: { prompt: 1, completion: 3 } }; }), config, cloudAuthority)).toThrow(/routing/);
    expect(() => admitPreparedRequest(alteredBody((body) => { body.provider = { allow_fallbacks: false, max_price: { prompt: 2, completion: 3 } }; }), config, cloudAuthority)).toThrow(/routing/);
    expect(() => admitPreparedRequest(alteredBody((body) => { body.tools = []; }), config, cloudAuthority)).toThrow(/Unexpected/);
    expect(() => admitPreparedRequest(alteredBody((body) => { body.messages = [{ role: "tool", content: "unadmitted protocol" }]; }), config, cloudAuthority)).toThrow();
  });
  it("rejects changed digests, forged token estimates and oversized input/output", () => {
    const input = event();
    expect(() => admitPreparedRequest({ ...input, bodySha256: "0".repeat(64) }, config, cloudAuthority)).toThrow(/digest/);
    expect(() => admitPreparedRequest({ ...input, estimatedInputTokens: 1 }, config, cloudAuthority)).toThrow(/envelope/);
    expect(() => admitPreparedRequest(input, { ...config, maxInputBytes: 10 }, cloudAuthority)).toThrow(/envelope/);
    expect(() => admitPreparedRequest(alteredBody((body) => { body.max_tokens = 99999; }), config, cloudAuthority)).toThrow(/configuration/);
  });
  it("rejects credential leakage, unknown prices and unadmitted HTTP transport", () => {
    expect(() => admitPreparedRequest(alteredBody((body) => { body.messages = [{ role: "user", content: config.cloud!.apiKey }]; }), config, cloudAuthority)).toThrow(/Credential/);
    expect(() => admitPreparedRequest(event(), { ...config, cloud: { ...config.cloud!, inputUsdPerMillion: Number.NaN } }, cloudAuthority)).toThrow();
    expect(() => admitPreparedRequest(event(), { ...config, cloud: { ...config.cloud!, inputUsdPerMillion: 0 } }, cloudAuthority)).toThrow(/pricing/);
    const insecure = { ...config, local: { ...config.local!, allowInsecureHttp: false } };
    expect(() => admitPreparedRequest(event("scout"), insecure, { policy: "hybrid", phase: "local_investigation" })).toThrow(/transport/);
  });
});
