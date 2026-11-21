import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const { doctorMatches, competingWork, confirmIdle, confirmTaskStarted, decisionFrom } = await import(resolve(import.meta.dirname, "../../scripts/e5-proxy-rehearsal.mjs"));
const identity = { servedModel: "RM-01 VLM", modelRootBasename: "Qwen3.8-Flash-Next-NVFP4",
  engineVersion: "0.33.0rc1.dev617+g821038729", contextTokens: 262144 };
const report = { ready: true, card: { configured: false }, image: { configuredMatchesQualified: true }, model: { identity } };

describe("E5 trusted rehearsal operator", () => {
  it("requires the four registered doctor values and the ready, uncarded qualified image", () => {
    expect(doctorMatches(report)).toBe(true);
    for (const field of Object.keys(identity)) {
      expect(doctorMatches({ ...report, model: { identity: { ...identity, [field]: null } } })).toBe(false);
    }
    expect(doctorMatches({ ...report, ready: false })).toBe(false);
    expect(doctorMatches({ ...report, card: { configured: true } })).toBe(false);
    expect(doctorMatches({ ...report, image: { configuredMatchesQualified: false } })).toBe(false);
  });

  it("takes three idle observations twenty seconds apart and stops on missing or busy metrics", async () => {
    const delays: number[] = [];
    let calls = 0;
    await confirmIdle(async () => { calls++; return { running: 0, waiting: 0 }; }, async (ms: number) => delays.push(ms));
    expect(calls).toBe(3);
    expect(delays).toEqual([20_000, 20_000]);
    for (const fault of [null, { running: 1, waiting: 0 }, { running: 0, waiting: 1 }]) {
      const sequence = [{ running: 0, waiting: 0 }, fault, { running: 0, waiting: 0 }];
      await expect(confirmIdle(async () => sequence.shift(), async () => {})).rejects.toThrow("endpoint_busy_or_unreadable");
      expect(sequence).toHaveLength(1);
    }
  });

  it("recognizes a stock owner app, beta and harness, excluding the rehearsal's Electron and its children", () => {
    const rows = "20 1 /stock/SOAR-owner/node_modules/Electron.app/Contents/MacOS/Electron .\n21 20 helper";
    expect(competingWork(rows)).toBe(true);
    expect(competingWork(rows, 20)).toBe(false);
    expect(competingWork(rows + "\n30 1 /Applications/SOAR.app/Contents/MacOS/SOAR", 20)).toBe(true);
    expect(competingWork(rows + "\n30 1 /stock/SOAR-research-beta/node_modules/Electron.app/Contents/MacOS/Electron .", 20)).toBe(true);
    for (const script of ["phase4-loop.ts", "serving-probe.py", "private-agent-local-screen.ts", "experiment-launcher.ts"]) {
      expect(competingWork(rows + "\n30 1 node --import tsx scripts/" + script, 20)).toBe(true);
    }
    expect(() => competingWork("")).toThrow("process_state_unavailable");
  });

  it("binds the proxy's closed decision to the exported bytes and the stock verdict form limits", () => {
    const artifactSha256 = "a".repeat(64);
    const record = { artifactSha256, decision: "accept", minutes: 8, interventions: 1 };
    expect(decisionFrom(record, artifactSha256)).toEqual(record);
    for (const update of [{ artifactSha256: "b".repeat(64) }, { minutes: -1 }, { minutes: 601 }, { minutes: 0.5 }, { interventions: 100 }, { decision: "maybe" }, { extra: true }]) {
      expect(() => decisionFrom({ ...record, ...update }, artifactSha256)).toThrow("invalid_judgment");
    }
  });

  it("confirms the fixed Heavy local task after it leaves the queue, or stops without retrying the click", async () => {
    const input = "b".repeat(64);
    const running = { id: "test-job", status: "running", routing: "local_only", profile: "heavy", sourceHash: input, network: false };
    const sequence = [null, { ...running, status: "queued" }, running];
    expect(await confirmTaskStarted(async () => sequence.shift(), input, { wait: async () => {} })).toEqual(running);
    const submitted = { ...running, status: "submitted" };
    expect(await confirmTaskStarted(async () => submitted, input)).toEqual(submitted);
    for (const fault of [{ profile: "standard" }, { routing: "ask_before_consulting" }, { network: true }, { sourceHash: "a".repeat(64) }]) {
      await expect(confirmTaskStarted(async () => ({ ...running, ...fault }), input)).rejects.toThrow("unexpected_created_task");
    }
    await expect(confirmTaskStarted(async () => ({ ...running, status: "incomplete" }), input)).rejects.toThrow("task_stopped");
    for (const missing of [null, { ...running, status: "queued" }]) {
      await expect(confirmTaskStarted(async () => missing, input, { timeoutMs: 10 })).rejects.toThrow("task_start_unconfirmed");
    }
    await expect(confirmTaskStarted(() => new Promise(() => {}), input, { timeoutMs: 10 })).rejects.toThrow("task_start_unconfirmed");
  });
});
