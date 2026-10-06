import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QUALIFIED_IMAGE } from "../../src/main/private-agent/capabilities";
import { parseEnvFile, resolveSettings, runGeneralSetup, userDataEnvFile, type GeneralSetupProbes } from "../../scripts/setup-general";

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
function setup(files: { userData?: string; cwd?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "soar-setup-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const userDataFile = join(root, "userData", ".env.local"), cwd = join(root, "repo"); mkdirSync(cwd);
  if (files.userData !== undefined) { mkdirSync(join(root, "userData")); writeFileSync(userDataFile, files.userData); }
  if (files.cwd !== undefined) writeFileSync(join(cwd, ".env.local"), files.cwd);
  return { root, userDataFile, cwd };
}

describe("pnpm setup:general doctor", () => {
  it("parses env files and resolves process env, then user data, then the working directory", () => {
    expect(parseEnvFile("# c\nSOAR_VLLM_MODEL=a\nSOAR_VLLM_MODEL=b\nOTHER=1\nbroken")).toEqual({ SOAR_VLLM_MODEL: "a" });
    const f = setup({ userData: "SOAR_VLLM_MODEL=user-data\n", cwd: `SOAR_VLLM_MODEL=cwd\nSOAR_VLLM_BASE_URL=${secretUrl}\n` });
    expect(resolveSettings({ SOAR_VLLM_API_KEY: "env" }, f.userDataFile, join(f.cwd, ".env.local"))).toMatchObject({ SOAR_VLLM_MODEL: "user-data", SOAR_VLLM_BASE_URL: secretUrl, SOAR_VLLM_API_KEY: "env" });
    expect(userDataEnvFile("/Users/x", "darwin")).toBe("/Users/x/Library/Application Support/SOAR/.env.local");
  });
  it("reports readiness with a redacted endpoint and writes only the absent keys when asked", async () => {
    const f = setup({ cwd: `SOAR_VLLM_BASE_URL=${secretUrl}\nSOAR_VLLM_MODEL=served-model\nSOAR_VLLM_API_KEY=${secretKey}\n` });
    const calls: { url: string; body?: string }[] = [];
    const report = await runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: false, nodeVersion: "v22.22.2",
      probes: probes({ fetchJson: async (url, init) => { calls.push({ url, body: init.body }); return probes().fetchJson(url, init); } }) });
    expect(report).toMatchObject({ node: { ok: true }, docker: { ok: true }, image: { installed: true, configuredMatchesQualified: false }, model: { configured: true, modelsOk: true, modelListed: true, completionOk: true }, ready: false, settings: { wrote: [] } });
    const text = JSON.stringify(report); expect(text).not.toContain(secretUrl); expect(text).not.toContain(secretKey); expect(text).not.toContain("private-box");
    expect(report.model.endpointSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(calls[1]!.body!)).toMatchObject({ model: "served-model", max_tokens: 1, stream: false, chat_template_kwargs: { enable_thinking: false } });
    expect(calls[1]!.body).not.toContain("tools");
    const written = await runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: true, nodeVersion: "v22.22.2", probes: probes() });
    expect(written).toMatchObject({ ready: true, settings: { wrote: ["SOAR_GENERAL_TASK_IMAGE_ID", "SOAR_GENERAL_TASK_PROFILE"] } });
    expect(readFileSync(f.userDataFile, "utf8")).toBe(`SOAR_GENERAL_TASK_IMAGE_ID=${QUALIFIED_IMAGE}\nSOAR_GENERAL_TASK_PROFILE=heavy\n`);
    // Present keys are never rewritten; a second write adds nothing.
    const again = await runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: true, nodeVersion: "v22.22.2", probes: probes() });
    expect(again.settings).toMatchObject({ wrote: [], present: expect.arrayContaining(["SOAR_GENERAL_TASK_IMAGE_ID", "SOAR_GENERAL_TASK_PROFILE"]) });
  });
  it("explains each missing precondition without throwing", async () => {
    const f = setup({});
    const report = await runGeneralSetup({ env: {}, cwd: f.cwd, userDataFile: f.userDataFile, write: true, nodeVersion: "v26.0.0",
      probes: probes({ dockerEndpoint: async () => { throw new Error("no docker"); } }) });
    expect(report).toMatchObject({ node: { ok: false }, docker: { ok: false }, image: { installed: false }, model: { configured: false }, ready: false, settings: { wrote: ["SOAR_GENERAL_TASK_PROFILE"] } });
    expect(report.docker.reason).toContain("Docker"); expect(report.model.reason).toContain("SOAR_VLLM_BASE_URL");
    const unlisted = await runGeneralSetup({ env: { SOAR_VLLM_BASE_URL: secretUrl, SOAR_VLLM_MODEL: "other" }, cwd: f.cwd, userDataFile: f.userDataFile, write: false, nodeVersion: "v22.22.2", probes: probes() });
    expect(unlisted.model).toMatchObject({ modelsOk: true, modelListed: false }); expect(unlisted.ready).toBe(false);
  });
});
