import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import { loadPatchRuntimeConfig, type PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import { admitPreparedRequest, canonicalRequest, launchPatchWorker } from "../../src/main/patch-runs/worker";

const processState = vi.hoisted(() => ({ child: undefined as any }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const { promisify } = await import("node:util");
  const execFile = Object.assign(vi.fn(), { [promisify.custom]: async () => ({ stdout: "", stderr: "" }) });
  return { ...actual, execFile, spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    processState.child = child;
    return child;
  }) };
});

let cwd: string;
const authority = { policy: "cloud" as const, phase: "cloud_solver" as const };
beforeAll(async () => { cwd = await mkdtemp(path.join(tmpdir(), "soar-sol-contract-")); });
afterAll(async () => { await rm(cwd, { recursive: true, force: true }); });

function configuration(environment: NodeJS.ProcessEnv = {}): PatchRuntimeConfig {
  return loadPatchRuntimeConfig({ cwd, appPath: cwd, environment: {
    SOAR_PATCH_MODE: "live", SOAR_PATCH_PROVIDER: "openai", SOAR_PATCH_API_KEY: "fixture-session-key",
    SOAR_PATCH_MODEL: "gpt-5.6-sol", SOAR_PATCH_EPISODE_USD: "1", ...environment,
  } });
}
function request(config: PatchRuntimeConfig, change: (body: Record<string, unknown>) => void = () => {}): Record<string, unknown> {
  const provider = config.cloud!;
  const body: Record<string, unknown> = { model: provider.model, messages: [{ role: "user", content: "Fix the public task. 中文" }],
    max_completion_tokens: 8192, reasoning_effort: "medium", service_tier: "default", prompt_cache_options: { mode: "explicit" }, stream: false };
  change(body);
  const encoded = canonicalRequest(body);
  const digest = createHash("sha256").update(encoded).digest("hex");
  return { phase: "cloud", model: provider.model, requestId: "b".repeat(32), maxOutputTokens: config.maxOutputTokens,
    estimatedInputTokens: Buffer.byteLength(encoded), bodySha256: digest,
    provider: { id: provider.id, protocol: provider.protocol, endpoint: provider.endpoint },
    preparedRequest: { method: "POST", url: provider.endpoint, body, bodySha256: digest } };
}

describe("explicit direct OpenAI Sol calibration", () => {
  it("derives the current profile without changing the default provider or legacy OpenAI selection", () => {
    const config = configuration();
    expect(config.cloud).toMatchObject({ id: "openai", model: "gpt-5.6-sol", inputUsdPerMillion: 4, outputUsdPerMillion: 20 });
    expect(config.cloud?.routing).toBeUndefined();
    expect([config.maxInputBytes, config.maxOutputTokens, config.episodeCapMicrousd, config.campaignCapMicrousd])
      .toEqual([256000, 8192, 1_000_000, 70_000_000]);
    const legacy = configuration({ SOAR_PATCH_MODEL: undefined });
    expect(legacy.cloud?.model).toBe("gpt-4.1-mini-2025-04-14");
    expect([legacy.maxInputBytes, legacy.maxOutputTokens]).toEqual([512000, 4096]);
    expect(configuration({ SOAR_PATCH_PROVIDER: undefined, SOAR_PATCH_MODEL: undefined }).cloud?.id).toBe("openrouter");
  });

  it.each([
    { SOAR_PATCH_INPUT_USD_PER_MILLION: "0.4" },
    { SOAR_PATCH_OUTPUT_USD_PER_MILLION: "8" },
    { SOAR_PATCH_INPUT_USD_PER_MILLION: "8" },
  ])("rejects inherited price overrides that would misstate this profile: %o", (environment) => {
    expect(() => configuration(environment)).toThrow(/Sol calibration requires/);
  });

  it("accepts exactly documented prices and keeps unknown model pricing explicit", () => {
    expect(configuration({ SOAR_PATCH_INPUT_USD_PER_MILLION: "4", SOAR_PATCH_OUTPUT_USD_PER_MILLION: "20" }).cloud).toBeDefined();
    expect(configuration({ SOAR_PATCH_MODEL: "gpt-5.6" }).cloud).toBeUndefined();
    expect(configuration({ SOAR_PATCH_MODEL: "unknown-model" }).cloud).toBeUndefined();
    expect(configuration({ SOAR_PATCH_MODEL: "gpt-4.1-2025-04-14", SOAR_PATCH_INPUT_USD_PER_MILLION: "2", SOAR_PATCH_OUTPUT_USD_PER_MILLION: "8" }).cloud)
      .toMatchObject({ model: "gpt-4.1-2025-04-14", inputUsdPerMillion: 2, outputUsdPerMillion: 8 });
  });

  it("reserves the exact UTF-8 input plus all reasoning and visible output", () => {
    const config = configuration();
    const event = request(config);
    expect(admitPreparedRequest(event, config, authority).reservation).toBe(Number(event.estimatedInputTokens) * 4 + 8192 * 20);
  });

  it("durably settles reasoning within output and records the returned model before a truncated run stops", async () => {
    const db = createSoarDatabase();
    try {
      const config = configuration();
      const store = new PatchRunStore(db);
      const snapshot = store.create({ workspaceRoot: cwd, objective: "Fix public code", policy: "cloud", executionMode: "live",
        baseRevision: "a".repeat(40), maxCostMicrousd: 1_000_000 });
      store.start(snapshot.id);
      const handle = launchPatchWorker({ config, store, snapshot, workspace: cwd, image: "fixture:1", publish() {} });
      let sequence = 0;
      let acknowledgements = "";
      processState.child.stdin.on("data", (data: Buffer) => { acknowledgements += data.toString(); });
      const emit = (type: string, values: Record<string, unknown> = {}) => {
        processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, type, runId: snapshot.id, sequence: ++sequence, ...values })}\n`);
      };
      emit("ready", { runId: "" });
      emit("phase.started", { phase: "cloud", model: "gpt-5.6-sol" });
      emit("request.prepare", request(config));
      await vi.waitFor(() => expect(acknowledgements).toContain("request.admitted"));
      emit("request.finished", { requestId: "b".repeat(32), phase: "cloud", model: "gpt-5.6-sol", reportedModel: "gpt-5.6-sol",
        usage: { inputTokens: 100, outputTokens: 30, reasoningTokens: 25, cacheReadTokens: 0, cacheWriteTokens: 0, reported: true } });
      emit("terminal", { status: "failed", errorCode: "provider_output_truncated" });
      processState.child.emit("close", 0, null);
      await handle.done;
      const completed = store.get(snapshot.id);
      expect(completed.status).toBe("failed");
      expect(completed.spentMicrousd).toBe(100 * 4 + 30 * 20);
      expect(completed.reservedMicrousd).toBe(0);
      expect(completed.events.some((event) => event.type === "provider.model" && event.summary === "Provider reported model: gpt-5.6-sol")).toBe(true);
      const receipt = db.prepare("SELECT finish_json FROM patch_run_requests WHERE request_id = ?").get("b".repeat(32)) as { finish_json: string };
      expect(JSON.parse(receipt.finish_json).usage).toMatchObject({ outputTokens: 30, reasoningTokens: 25 });
    } finally { db.close(); }
  });

  it.each([
    ["legacy output field", (body: Record<string, unknown>) => { body.max_tokens = 8192; }],
    ["wrong completion allowance", (body: Record<string, unknown>) => { body.max_completion_tokens = 16384; }],
    ["different effort", (body: Record<string, unknown>) => { body.reasoning_effort = "high"; }],
    ["omitted effort", (body: Record<string, unknown>) => { delete body.reasoning_effort; }],
    ["project-default tier", (body: Record<string, unknown>) => { body.service_tier = "auto"; }],
    ["implicit cache writes", (body: Record<string, unknown>) => { body.prompt_cache_options = { mode: "implicit" }; }],
    ["extra cache option", (body: Record<string, unknown>) => { body.prompt_cache_options = { mode: "explicit", ttl: "30m" }; }],
    ["content-block breakpoint", (body: Record<string, unknown>) => {
      body.messages = [{ role: "user", content: [{ type: "text", text: "fix", prompt_cache_breakpoint: { mode: "explicit" } }] }];
    }],
    ["routing", (body: Record<string, unknown>) => { body.provider = { allow_fallbacks: true }; }],
    ["API tools", (body: Record<string, unknown>) => { body.tools = []; }],
    ["over input envelope", (body: Record<string, unknown>) => { body.messages = [{ role: "user", content: "x".repeat(256000) }]; }],
  ] as const)("rejects %s even when its request digest is internally valid", (_label, change) => {
    const config = configuration();
    expect(() => admitPreparedRequest(request(config, change), config, authority)).toThrow();
  });

  it.each([
    (config: PatchRuntimeConfig) => { config.cloud!.inputUsdPerMillion = 1; },
    (config: PatchRuntimeConfig) => { config.cloud!.outputUsdPerMillion = 10; },
    (config: PatchRuntimeConfig) => { config.cloud!.endpoint = "https://different.invalid/v1/chat/completions"; },
    (config: PatchRuntimeConfig) => { config.maxInputBytes = 512000; },
    (config: PatchRuntimeConfig) => { config.maxOutputTokens = 4096; },
  ])("rejects profile drift in main-process configuration", (change) => {
    const config = configuration();
    change(config);
    expect(() => admitPreparedRequest(request(config), config, authority)).toThrow(/Sol calibration/);
  });
});
