import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QUALIFIED_IMAGE } from "../../src/main/private-agent/capabilities";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { parseEnvFile, printableIdentity, profileContextTokens, resolveSettings, runGeneralSetup, userDataEnvFile, type GeneralSetupProbes } from "../../scripts/setup-general";
import { ADOPTING_ENTRY, adopt, proposedServingCard, writeCard } from "../helpers/serving-card-fixture";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0).reverse()) done(); });
const secretUrl = "http://private-box.example.test:58000/v1", secretKey = "sk-synthetic-secret";
function probes(overrides: Partial<GeneralSetupProbes> = {}): GeneralSetupProbes {
  return {
    dockerEndpoint: async () => "unix:///tmp/synthetic.sock",
    imageId: async (_endpoint, id) => id === QUALIFIED_IMAGE ? QUALIFIED_IMAGE : undefined,
    fetchJson: async (url, init) => url.endsWith("/models") ? { status: 200, json: { data: [{ id: "served-model" }] } }
      : { status: 200, json: { choices: [{ message: { content: "ok" } }], usage: { completion_tokens: 1, prompt_tokens: 9 }, echo: init.body } },
    ...overrides,
  };
}
/** A vLLM-like endpoint: /models lists `id` with `root` and `max_model_len`, /version answers at the origin (status 404 when `version` is null). */
function endpoint(served: { id?: string; root?: string; maxModelLen?: number; version?: string | null }, urls: string[] = []): GeneralSetupProbes["fetchJson"] {
  return async (url, init) => {
    urls.push(url);
    if (url.endsWith("/models")) return { status: 200, json: { data: [{ id: "other-model", root: "/x/other", max_model_len: 4096 },
      { id: served.id ?? "served-model", ...(served.root !== undefined ? { root: served.root } : {}), ...(served.maxModelLen !== undefined ? { max_model_len: served.maxModelLen } : {}) }] } };
    if (url.endsWith("/version")) return served.version === null ? { status: 404, json: null } : { status: 200, json: { version: served.version ?? "0.33.0" } };
    return probes().fetchJson(url, init);
  };
}
function setup(files: { userData?: string; cwd?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "soar-setup-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const userDataFile = join(root, "userData", ".env.local"), cwd = join(root, "repo"); mkdirSync(cwd);
  if (files.userData !== undefined) { mkdirSync(join(root, "userData")); writeFileSync(userDataFile, files.userData); }
  if (files.cwd !== undefined) writeFileSync(join(cwd, ".env.local"), files.cwd);
  return { root, userDataFile, cwd };
}
const endpointSettings = (model = "served-model", extra = "", base = secretUrl) =>
  `SOAR_VLLM_BASE_URL=${base}\nSOAR_VLLM_MODEL=${model}\nSOAR_VLLM_COST_POLICY=local_zero_cost\nSOAR_ALLOW_INSECURE_VLLM_HTTP=true\n${extra}`;
const HEAVY_TOKENS = profileContextTokens(COORDINATOR_PROFILES.heavy), STANDARD_TOKENS = profileContextTokens(COORDINATOR_PROFILES.standard);

describe("pnpm setup:general doctor", () => {
  it("parses env files and resolves process env, then user data, then the working directory", () => {
    expect(parseEnvFile("# c\nSOAR_VLLM_MODEL=a\nSOAR_VLLM_MODEL=b\nOTHER=1\nbroken")).toEqual({ SOAR_VLLM_MODEL: "a" });
    const f = setup({ userData: "SOAR_VLLM_MODEL=user-data\n", cwd: `SOAR_VLLM_MODEL=cwd\nSOAR_VLLM_BASE_URL=${secretUrl}\n` });
    expect(resolveSettings({ SOAR_VLLM_API_KEY: "env" }, f.userDataFile, join(f.cwd, ".env.local"))).toMatchObject({ SOAR_VLLM_MODEL: "user-data", SOAR_VLLM_BASE_URL: secretUrl, SOAR_VLLM_API_KEY: "env" });
    expect(userDataEnvFile("/Users/x", "darwin")).toBe("/Users/x/Library/Application Support/SOAR/.env.local");
  });
  it("reports readiness with a redacted endpoint and writes only the absent keys when asked", async () => {
    const f = setup({ cwd: `SOAR_VLLM_BASE_URL=${secretUrl}\nSOAR_VLLM_MODEL=served-model\nSOAR_VLLM_API_KEY=${secretKey}\nSOAR_VLLM_COST_POLICY=local_zero_cost\nSOAR_ALLOW_INSECURE_VLLM_HTTP=true\n` });
    const calls: { url: string; body?: string }[] = [];
    const report = await runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: false, nodeVersion: "v22.22.2",
      probes: probes({ fetchJson: async (url, init) => { calls.push({ url, body: init.body }); return probes().fetchJson(url, init); } }) });
    expect(report).toMatchObject({ node: { ok: true }, docker: { ok: true }, image: { installed: true, configuredMatchesQualified: false }, model: { configured: true, modelsOk: true, modelListed: true, completionOk: true }, ready: false, settings: { wrote: [] } });
    const text = JSON.stringify(report); expect(text).not.toContain(secretUrl); expect(text).not.toContain(secretKey); expect(text).not.toContain("private-box");
    expect(report.model.endpointSha256).toMatch(/^[a-f0-9]{64}$/u);
    // The probe mirrors the agent loop's request for the profile in effect (default heavy: one tool, thinking on).
    const completion = calls.find(call => call.url.endsWith("/chat/completions"))!;
    expect(JSON.parse(completion.body!)).toMatchObject({ model: "served-model", max_tokens: 1, stream: false, tool_choice: "auto", parallel_tool_calls: false, reasoning_effort: "medium", top_k: 20 });
    expect(JSON.parse(completion.body!).tools).toHaveLength(1); expect(JSON.parse(completion.body!)).not.toHaveProperty("chat_template_kwargs");
    // An endpoint that reports no window and no version leaves both unknown, which does not block readiness.
    expect(report.model.identity).toEqual({ servedModel: "served-model", modelRootBasename: null, engineVersion: null, contextTokens: null });
    expect(report.model.window).toMatchObject({ requiredTokens: HEAVY_TOKENS, ok: null });
    const written = await runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: true, nodeVersion: "v22.22.2", probes: probes() });
    expect(written).toMatchObject({ ready: true, card: { configured: false }, settings: { wrote: ["SOAR_GENERAL_TASK_IMAGE_ID", "SOAR_GENERAL_TASK_PROFILE"] } });
    expect(readFileSync(f.userDataFile, "utf8")).toBe(`SOAR_GENERAL_TASK_IMAGE_ID=${QUALIFIED_IMAGE}\nSOAR_GENERAL_TASK_PROFILE=heavy\n`);
    // Present keys are never rewritten; a second write adds nothing.
    const again = await runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: true, nodeVersion: "v22.22.2", probes: probes() });
    expect(again.settings).toMatchObject({ wrote: [], present: expect.arrayContaining(["SOAR_GENERAL_TASK_IMAGE_ID", "SOAR_GENERAL_TASK_PROFILE"]) });
  });
  it("applies the app's endpoint acknowledgments before any request or key leaves the machine", async () => {
    const f = setup({ cwd: `SOAR_VLLM_BASE_URL=${secretUrl}\nSOAR_VLLM_MODEL=served-model\nSOAR_VLLM_API_KEY=${secretKey}\n` });
    const calls: string[] = [];
    const report = await runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: false, nodeVersion: "v22.22.2",
      probes: probes({ fetchJson: async url => { calls.push(url); return { status: 200, json: {} }; } }) });
    expect(calls).toEqual([]); expect(report.ready).toBe(false);
    expect(report.model).toMatchObject({ configured: true, modelsOk: false, completionOk: false, reason: expect.stringContaining("SOAR_VLLM_COST_POLICY=local_zero_cost") });
    expect(report.model).not.toHaveProperty("identity");
    expect(JSON.stringify(report)).not.toContain(secretKey);
    // A standard profile probes with thinking off.
    const standard = setup({ cwd: `SOAR_VLLM_BASE_URL=${secretUrl}\nSOAR_VLLM_MODEL=served-model\nSOAR_VLLM_COST_POLICY=local_zero_cost\nSOAR_ALLOW_INSECURE_VLLM_HTTP=true\nSOAR_GENERAL_TASK_PROFILE=standard\n` });
    const bodies: string[] = [];
    await runGeneralSetup({ env: {}, cwd: standard.cwd, userDataFile: standard.userDataFile, write: false, nodeVersion: "v22.22.2", probes: probes({ fetchJson: async (url, init) => { if (init.body) bodies.push(init.body); return probes().fetchJson(url, init); } }) });
    expect(JSON.parse(bodies[0]!)).toMatchObject({ chat_template_kwargs: { enable_thinking: false } }); expect(JSON.parse(bodies[0]!)).not.toHaveProperty("reasoning_effort");
  });
  it("explains each missing precondition without throwing", async () => {
    const f = setup({});
    const report = await runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: true, nodeVersion: "v26.0.0",
      probes: probes({ dockerEndpoint: async () => { throw new Error("no docker"); } }) });
    expect(report).toMatchObject({ node: { ok: false }, docker: { ok: false }, image: { installed: false }, model: { configured: false }, card: { configured: false }, ready: false, settings: { wrote: ["SOAR_GENERAL_TASK_PROFILE"] } });
    expect(report.docker.reason).toContain("Docker"); expect(report.model.reason).toContain("SOAR_VLLM_BASE_URL");
    const unlisted = await runGeneralSetup({ env: { SOAR_VLLM_BASE_URL: secretUrl, SOAR_VLLM_MODEL: "other", SOAR_VLLM_COST_POLICY: "local_zero_cost", SOAR_ALLOW_INSECURE_VLLM_HTTP: "true" }, cwd: f.cwd, userDataFile: f.userDataFile, write: false, nodeVersion: "v22.22.2", probes: probes() });
    expect(unlisted.model).toMatchObject({ modelsOk: true, modelListed: false }); expect(unlisted.ready).toBe(false);
    expect(unlisted.model.identity).toEqual({ servedModel: null, modelRootBasename: null, engineVersion: null, contextTokens: null });
  });

  it("reports the configured alias's identity as probe P1 derives it, never the address or the root's path", async () => {
    const f = setup({ cwd: endpointSettings() }), urls: string[] = [];
    const report = await runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: true, nodeVersion: "v22.22.2",
      probes: probes({ fetchJson: endpoint({ root: "/srv/weights/Qwen3.8-27B-FP8/", maxModelLen: 262_144, version: "0.33.0rc1.dev617+g821038729" }, urls) }) });
    // The configured alias's row, not the first row; the basename after trailing slashes; the version from the origin, not under /v1.
    expect(report.model.identity).toEqual({ servedModel: "served-model", modelRootBasename: "Qwen3.8-27B-FP8", engineVersion: "0.33.0rc1.dev617+g821038729", contextTokens: 262_144 });
    expect(urls).toContain("http://private-box.example.test:58000/version"); expect(urls).not.toContain(`${secretUrl}/version`);
    expect(report.model.window).toEqual({ requiredTokens: HEAVY_TOKENS, ok: true }); expect(report.ready).toBe(true);
    const text = JSON.stringify(report); expect(text).not.toContain("private-box"); expect(text).not.toContain("/srv/weights");
  });
  it("withholds an identity value that would print a URL, an address, a host:port, a path or the configured host", async () => {
    expect(HEAVY_TOKENS).toBe(234_838); expect(STANDARD_TOKENS).toBe(69_632);
    // The card writer's patterns: a glued address ("v10.0.0.7", "node_10.0.0.7") is caught as the writer catches it.
    for (const unsafe of ["http://box/v", "vllm at 10.0.0.7", "v10.0.0.7", "node_10.0.0.7", "box:8000", "/opt/vllm", "~/x", "a\\b", "fe80::1", "2001:db8:0:0:0:0:2:1", "line\nbreak", "PRIVATE-BOX.example.test build"]) {
      expect(printableIdentity(unsafe, 256, "private-box.example.test"), unsafe).toBeNull();
    }
    expect(printableIdentity("0.33.0rc1.dev617+g821038729", 128, "private-box.example.test")).toBe("0.33.0rc1.dev617+g821038729");
    expect(printableIdentity("org/model", 256, "h")).toBe("org/model"); expect(printableIdentity("org/model", 256, "h", "basename")).toBeNull();
    expect(printableIdentity("x".repeat(129), 128, "h")).toBeNull();
    const f = setup({ cwd: endpointSettings() });
    const report = await runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: false, nodeVersion: "v22.22.2",
      probes: probes({ fetchJson: endpoint({ root: "/models/private-box.example.test", maxModelLen: 262_144, version: "served from 10.0.0.7:58000" }) }) });
    expect(report.model.identity).toEqual({ servedModel: "served-model", modelRootBasename: null, engineVersion: null, contextTokens: 262_144 });
    expect(JSON.stringify(report)).not.toMatch(/private-box|10\.0\.0\.7/u);
  });
  it("refuses readiness when the window is smaller than the profile assumes, and not when it is unknown", async () => {
    const f = setup({ cwd: endpointSettings() });
    const small = await runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: true, nodeVersion: "v22.22.2",
      probes: probes({ fetchJson: endpoint({ maxModelLen: 131_072 }) }) });
    expect(small.model.window).toMatchObject({ requiredTokens: HEAVY_TOKENS, ok: false, reason: expect.stringContaining("131072") });
    expect(small.model.window!.reason).toContain(`heavy profile's request guard can send (${HEAVY_TOKENS} tokens)`); expect(small.ready).toBe(false);
    // The standard profile assumes a smaller window, which the same endpoint satisfies.
    const standard = setup({ cwd: endpointSettings("served-model", "SOAR_GENERAL_TASK_PROFILE=standard\n") });
    const fits = await runGeneralSetup({ env: {}, cwd: standard.cwd, userDataFile: standard.userDataFile, write: true, nodeVersion: "v22.22.2",
      probes: probes({ fetchJson: endpoint({ maxModelLen: 131_072 }) }) });
    expect(fits.model.window).toEqual({ requiredTokens: STANDARD_TOKENS, ok: true }); expect(fits.ready).toBe(true);
    // A non-numeric or absent max_model_len is unknown: reported, not blocking.
    const unknown = await runGeneralSetup({ env: {}, cwd: standard.cwd, userDataFile: standard.userDataFile, write: false, nodeVersion: "v22.22.2",
      probes: probes({ fetchJson: endpoint({}) }) });
    expect(unknown.model.window).toMatchObject({ ok: null, reason: expect.stringContaining("unchecked") }); expect(unknown.ready).toBe(true);
  });
  it("under flash_next_v1, holds the window to the configured context and refuses a context setting the app refuses", async () => {
    const run = async (extra: string, maxModelLen = 240_000) => {
      const f = setup({ cwd: endpointSettings("served-model", extra) });
      return runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: true, nodeVersion: "v22.22.2", probes: probes({ fetchJson: endpoint({ maxModelLen }) }) });
    };
    // 240,000 fits the heavy guard (234,838) but not the 262,144 the app's token admission is pinned to.
    const pinned = await run("SOAR_VLLM_REPLY_CONTRACT=flash_next_v1\nSOAR_VLLM_CONTEXT_TOKENS=262144\n");
    expect(pinned.model.window).toMatchObject({ requiredTokens: 262_144, ok: false, reason: expect.stringContaining("SOAR_VLLM_CONTEXT_TOKENS (262144 tokens)") });
    expect(pinned.ready).toBe(false);
    expect((await run("SOAR_VLLM_REPLY_CONTRACT=flash_next_v1\nSOAR_VLLM_CONTEXT_TOKENS=262144\n", 262_144)).ready).toBe(true);
    for (const [extra, reason] of [["SOAR_VLLM_REPLY_CONTRACT=flash_next_v1\nSOAR_VLLM_CONTEXT_TOKENS=262,144\n", "integer above 16,384"],
      ["SOAR_VLLM_REPLY_CONTRACT=flash_next_v1\n", "integer above 16,384"], ["SOAR_VLLM_CONTEXT_TOKENS=262144\n", "requires SOAR_VLLM_REPLY_CONTRACT=flash_next_v1"],
      ["SOAR_VLLM_REPLY_CONTRACT=other\n", "accepts only flash_next_v1"]] as const) {
      const refused = await run(extra, 262_144);
      expect(refused.model.window, extra).toMatchObject({ ok: false, reason: expect.stringContaining(reason) }); expect(refused.ready, extra).toBe(false);
    }
  });
  it("withholds a configured alias that would print as a path, and still lists it", async () => {
    const f = setup({ cwd: endpointSettings("/models/served") });
    const report = await runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: true, nodeVersion: "v22.22.2",
      probes: probes({ fetchJson: endpoint({ id: "/models/served", maxModelLen: 262_144 }) }) });
    expect(report.model).toMatchObject({ modelListed: true, identity: { servedModel: null, contextTokens: 262_144 } }); expect(report.ready).toBe(true);
    expect(JSON.stringify(report)).not.toContain("/models/served");
  });

  describe("with the serving-card pair set", () => {
    const ALIAS = "RM-01 VLM", CARD_IDENTITY = { root: "/models/Qwen3.8-Flash-Next-NVFP4", maxModelLen: 262_144, version: "0.33.0rc1.dev617+g821038729" };
    function cardDir() { const dir = mkdtempSync(join(tmpdir(), "soar-setup-card-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }
    async function doctor(pair: Record<string, string>, served: Parameters<typeof endpoint>[0] = { id: ALIAS, ...CARD_IDENTITY }, alias = ALIAS, extra = "", base = secretUrl) {
      const f = setup({ cwd: endpointSettings(alias, extra, base) });
      return runGeneralSetup({ env: pair, cwd: f.cwd, userDataFile: f.userDataFile, write: true, nodeVersion: "v22.22.2", probes: probes({ fetchJson: endpoint(served) }) });
    }
    const adoptedCard = () => adopt(proposedServingCard(), ADOPTING_ENTRY, { defaults: true });

    it("matches an adopted card field by field and reports its sha256, date and entry, never its path", async () => {
      const dir = cardDir(), written = writeCard(dir, adoptedCard());
      const report = await doctor({ SOAR_SERVING_CARD_FILE: written.path, SOAR_SERVING_CARD_SHA256: written.sha256 });
      expect(report.card).toMatchObject({ configured: true, sha256: written.sha256, entry: ADOPTING_ENTRY, status: "matches" });
      expect(report.card.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(report.card.fields!.map(item => [item.field, item.state])).toEqual([["servedModel", "match"], ["modelRootBasename", "match"], ["engineVersion", "match"], ["contextTokens", "match"]]);
      expect(report.ready).toBe(true);
      const text = JSON.stringify(report); expect(text).not.toContain(dir); expect(text).not.toContain("serving-card.json");
    });
    it("is not ready when the endpoint differs from the card or no longer reports a value the card recorded", async () => {
      const written = writeCard(cardDir(), adoptedCard()), pair = { SOAR_SERVING_CARD_FILE: written.path, SOAR_SERVING_CARD_SHA256: written.sha256 };
      const newer = await doctor(pair, { id: ALIAS, ...CARD_IDENTITY, version: "0.34.0" });
      expect(newer.card).toMatchObject({ status: "differs", reason: expect.stringContaining("engineVersion") });
      expect(newer.card.fields!.find(item => item.field === "engineVersion")).toEqual({ field: "engineVersion", state: "differs", card: CARD_IDENTITY.version, endpoint: "0.34.0" });
      expect(newer.ready).toBe(false);
      const resized = await doctor(pair, { id: ALIAS, ...CARD_IDENTITY, maxModelLen: 524_288 });
      expect(resized.card).toMatchObject({ status: "differs", reason: expect.stringMatching(/in: contextTokens\.$/u) }); expect(resized.ready).toBe(false);
      const silent = await doctor(pair, { id: ALIAS, ...CARD_IDENTITY, version: null });
      expect(silent.card.fields!.find(item => item.field === "engineVersion")).toMatchObject({ state: "endpoint_unknown", endpoint: null });
      expect(silent.card.status).toBe("differs"); expect(silent.ready).toBe(false);
    });
    it("reports the reader's fixed refusal code, and an incomplete pair without reading anything", async () => {
      const dir = cardDir(), proposed = writeCard(dir, proposedServingCard(), "proposed.json");
      const notAdopted = await doctor({ SOAR_SERVING_CARD_FILE: proposed.path, SOAR_SERVING_CARD_SHA256: proposed.sha256 });
      expect(notAdopted.card).toMatchObject({ configured: true, status: "refused", code: "serving_card_not_adopted" }); expect(notAdopted.ready).toBe(false);
      const adopted = writeCard(dir, adoptedCard(), "adopted.json");
      const drift = await doctor({ SOAR_SERVING_CARD_FILE: adopted.path, SOAR_SERVING_CARD_SHA256: "0".repeat(64) });
      expect(drift.card).toMatchObject({ status: "refused", code: "serving_card_pin_drift" }); expect(drift.ready).toBe(false);
      // A card measured on another served alias is the reader's refusal, before any field comparison.
      const otherAlias = await doctor({ SOAR_SERVING_CARD_FILE: adopted.path, SOAR_SERVING_CARD_SHA256: adopted.sha256 }, { id: "Other Alias", ...CARD_IDENTITY }, "Other Alias");
      expect(otherAlias.card).toMatchObject({ status: "refused", code: "serving_card_model_mismatch" }); expect(otherAlias.ready).toBe(false);
      const half = await doctor({ SOAR_SERVING_CARD_FILE: adopted.path });
      expect(half.card).toEqual({ configured: true, status: "incomplete", reason: expect.stringContaining("together") }); expect(half.ready).toBe(false);
      for (const report of [notAdopted, drift, half]) expect(JSON.stringify(report)).not.toContain(dir);
      // Under flash_next_v1 the reader also checks the configured context against the card's.
      const context = await doctor({ SOAR_SERVING_CARD_FILE: adopted.path, SOAR_SERVING_CARD_SHA256: adopted.sha256 }, { id: ALIAS, ...CARD_IDENTITY }, ALIAS,
        "SOAR_VLLM_REPLY_CONTRACT=flash_next_v1\nSOAR_VLLM_CONTEXT_TOKENS=131072\n");
      expect(context.card).toMatchObject({ status: "refused", code: "serving_card_context_mismatch" }); expect(context.ready).toBe(false);
    });
    it("compares a withheld value on its raw bytes and prints neither side, and does not block on a field the card left unknown", async () => {
      // The configured host appears inside the basename on both sides: equal raw values match, and neither is printed.
      const written = writeCard(cardDir(), adoptedCard());
      const hidden = await doctor({ SOAR_SERVING_CARD_FILE: written.path, SOAR_SERVING_CARD_SHA256: written.sha256 }, { id: ALIAS, ...CARD_IDENTITY }, ALIAS, "",
        "http://flash-next:58000/v1");
      expect(hidden.card.status).toBe("matches"); expect(hidden.ready).toBe(true);
      expect(hidden.card.fields!.find(item => item.field === "modelRootBasename")).toEqual({ field: "modelRootBasename", state: "match", card: null, endpoint: null });
      expect(JSON.stringify(hidden).toLowerCase()).not.toContain("flash-next");
      // A card that recorded no engine version cannot fail on it.
      const versionless = writeCard(cardDir(), adopt(proposedServingCard(probe => { probe.P1.version = null; }), ADOPTING_ENTRY, { defaults: true }));
      const unknown = await doctor({ SOAR_SERVING_CARD_FILE: versionless.path, SOAR_SERVING_CARD_SHA256: versionless.sha256 });
      expect(unknown.card.fields!.find(item => item.field === "engineVersion")).toMatchObject({ state: "card_unknown", card: null, endpoint: CARD_IDENTITY.version });
      expect(unknown.card.status).toBe("matches"); expect(unknown.ready).toBe(true);
    });
  });
});
