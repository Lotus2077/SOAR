import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CandidateSummary } from "../../src/main/private-agent/selection";
import { LOOP_VERSION, failureCode, loopExitCode, parseLoopArguments, runSelectionLoop, type CritiqueRecord, type DriverInput, type LoopDependencies, type LoopInput, type LoopRecord } from "../../scripts/phase4-loop";
import { localScreenSourceFreeze, parseLocalArtifactScreenArguments } from "../../scripts/private-agent-local-screen";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const h = (n: string) => n.repeat(64);
const summary = (over: Partial<CandidateSummary> = {}): CandidateSummary => ({ jobId: "ja", taskJobSha256: h("1"), taskBriefSha256: h("2"), runtimeSha256: h("4"), researchFrom: null, repairSource: null,
  status: "submitted", reason: "independent_acceptance_pending", checksPassed: 2, checksTotal: 2, checksCurrent: true, artifactsPresent: 2, artifactsTotal: 2,
  entailment: null, writeIdentity: null, modelCalls: 10, toolCalls: 8, inputTokens: 1000, outputTokens: 100, cachedTokens: 500, cacheWriteTokens: 0, lengthStops: 0, feeMicrousd: 0, unknownDispatches: 0, retriedDispatches: 0, failedDispatches: 0,
  candidateSha256: h("a"), freezeSha256: h("b"), resultSha256: h("c"), startedAt: "t0", finishedAt: "t1", ...over });
/** The candidates of one well-formed loop: b and the repair seeded from a on a research task, the repair bound to the selected draft. */
function candidates(research: boolean, over: Partial<Record<"a" | "b" | "repair", Partial<CandidateSummary>>> = {}): Record<string, CandidateSummary> {
  const seed = research ? { researchFrom: { sourceJobId: "ja", snapshotSha256: h("f") } } : {};
  const a = summary({ jobId: "ja", ...over.a }), b = summary({ jobId: "jb", freezeSha256: h("d"), resultSha256: h("e"), ...seed, ...over.b });
  const selected = research && over.b?.status === "submitted" && over.a?.status !== "submitted" ? b : over.a?.status === "incomplete" && (over.b?.status ?? "submitted") === "submitted" ? b : a;
  return { a, b, repair: summary({ jobId: "jr", freezeSha256: h("5"), resultSha256: h("6"), ...seed, repairSource: { resultSha256: selected.resultSha256, freezeSha256: selected.freezeSha256 }, ...over.repair }) };
}
function base(over: Partial<DriverInput> = {}): LoopInput["base"] {
  return { taskDirectory: "task", expectedJobSha256: h("1"), expectedBriefSha256: h("2"), syntheticAuthoritySha256: h("3"), expectedRuntimeSha256: h("4"), imageId: `sha256:${h("5")}`, profile: "heavy", claimsLedger: true, ...over };
}
const cloud = { model: "m", endpoint: "https://api.example.invalid/v1/responses", prices: { input: 2, output: 10, cached: 0.2 }, maxFeeUsd: 0.6 };
/** Fakes standing in for the driver, the critique tool and the summariser; each stage leaves the marker file the real tool leaves. */
function fakes(input: { summaries: Record<string, CandidateSummary>; transfers?: string[]; critiqueFails?: string | Error; onRun?: (run: DriverInput) => void }) {
  const calls: { runs: DriverInput[]; critiques: Parameters<LoopDependencies["critique"]>[0][] } = { runs: [], critiques: [] };
  let tick = 0;
  const snapshot = (directory: string) => (input.transfers ?? []).includes(directory.split("/").pop()!) ? h("f") : null;
  const usage = { inputTokens: 500, outputTokens: 40, cacheReadTokens: 100 };
  const deps: LoopDependencies = {
    async runSample(run) { calls.runs.push(run); input.onRun?.(run); mkdirSync(run.outputDirectory, { recursive: true }); writeFileSync(join(run.outputDirectory, "result.json"), "{}"); },
    async critique(request) {
      calls.critiques.push(request);
      if (input.critiqueFails) throw typeof input.critiqueFails === "string" ? new Error(input.critiqueFails) : input.critiqueFails;
      const selected = input.summaries[request.runDirectory.split("/").pop()!]!;
      const record: CritiqueRecord = { packetSha256: h("d"), critiqueSha256: h("e"), feeMicrousd: 0, finishReason: "stop", usage, source: { resultSha256: selected.resultSha256, freezeSha256: selected.freezeSha256 },
        ...(selected.researchFrom ? { researchSnapshotSha256: selected.researchFrom.snapshotSha256 } : (input.transfers ?? []).includes("a") ? { researchSnapshotSha256: h("f") } : {}) };
      mkdirSync(request.outputDirectory, { recursive: true }); writeFileSync(join(request.outputDirectory, "critique.json"), JSON.stringify(record));
      return { binding: { packetSha256: record.packetSha256, critiqueSha256: record.critiqueSha256, source: record.source! }, feeMicrousd: 0, finishReason: "stop", usage };
    },
    readCritique(directory) { return JSON.parse(readFileSync(join(directory, "critique.json"), "utf8")) as CritiqueRecord; },
    summarize(directory) { const name = directory.split("/").pop()!; const found = input.summaries[name]; if (!found) throw new Error(`no summary for ${name}`); return found; },
    transferSnapshot: snapshot,
    deliverables: () => ["output/report.md", "output/claims.json"],
    now: () => `t${tick++}`,
  };
  return { deps, calls };
}
function loopDir() { const dir = mkdtempSync(join(tmpdir(), "soar-loop-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return join(dir, "loop"); }
const read = (dir: string) => JSON.parse(readFileSync(join(dir, "loop.json"), "utf8")) as LoopRecord;

describe("H4 select-and-repair loop", () => {
  it("runs a, b, the critique of the selected sample and the repair, prefers a and then the repair on ties, and records counts only", async () => {
    const dir = loopDir();
    const { deps, calls } = fakes({ summaries: candidates(false, { repair: { modelCalls: 7 } }) });
    const record = await runSelectionLoop({ base: base(), loopDirectory: dir }, deps);
    expect(calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["a", "b", "repair"]);
    expect(calls.runs.every(run => run.researchFrom === undefined && run.pipeline === undefined && run.cloudArm === undefined)).toBe(true);
    expect(calls.runs[2]).toMatchObject({ repairFrom: join(dir, "critique") });
    expect(calls.critiques).toEqual([{ runDirectory: join(dir, "a"), taskDirectory: "task", expectedJobSha256: h("1"), expectedBriefSha256: h("2"), imageId: `sha256:${h("5")}`, outputDirectory: join(dir, "critique"), critic: "local" }]);
    expect(record.selected).toEqual({ stage1: { candidate: "a", step: "tie", entailmentRates: [null, null] }, final: { candidate: "repair", step: "tie", entailmentRates: [null, null] } });
    expect(record.seeded).toEqual({ b: false, repair: false, snapshotSha256: null }); expect(record.failure).toBeNull(); expect(record.writeIdentityEqual).toBeNull();
    expect(record.critique).toEqual({ packetSha256: h("d"), critiqueSha256: h("e"), feeMicrousd: 0, finishReason: "stop", usage: { inputTokens: 500, outputTokens: 40, cacheReadTokens: 100 }, modelCalls: 1 });
    // The critique's one call and its usage join the totals beside the three runs.
    expect(record.totals).toMatchObject({ modelCalls: 28, toolCalls: 24, inputTokens: 3500, outputTokens: 340, cachedTokens: 1600, feeMicrousd: 0 });
    expect(record.stages.map(stage => [stage.stage, stage.reused])).toEqual([["a", false], ["b", false], ["critique", false], ["repair", false]]);
    const saved = read(dir);
    expect(saved).toMatchObject({ version: LOOP_VERSION, selectionRule: 1, arm: "local", pipeline: null, runtimeSha256: h("4"), startedAt: "t0", finishedAt: expect.any(String) });
    expect(JSON.stringify(saved)).not.toContain(dir);
    expect(readFileSync(join(dir, "log.txt"), "utf8")).toContain("final repair (tie)");
    expect(loopExitCode(record)).toBe(0);
  });
  it("picks the submitted sample, and the draft over a repair that failed to submit", async () => {
    const dir = loopDir();
    const { deps, calls } = fakes({ summaries: candidates(false, { a: { status: "incomplete", reason: "bounded_allowance_exhausted" }, repair: { status: "incomplete", reason: "cancelled_or_deadline" } }) });
    const record = await runSelectionLoop({ base: base(), loopDirectory: dir }, deps);
    expect(record.selected).toMatchObject({ stage1: { candidate: "b", step: "submitted" }, final: { candidate: "b", step: "submitted" } });
    expect(calls.critiques[0]!.runDirectory).toBe(join(dir, "b")); expect(loopExitCode(record)).toBe(0);
  });
  it("seeds b and the repair from a's packet on a research task, stripping the stage and the cloud writer, compares the write identities, and ends the loop when a left no packet", async () => {
    const dir = loopDir();
    const { deps, calls } = fakes({ summaries: candidates(true, { a: { writeIdentity: h("7") }, b: { writeIdentity: h("7") }, repair: { writeIdentity: h("8") } }), transfers: ["a"] });
    const record = await runSelectionLoop({ base: base({ pipeline: "research", cloudArm: cloud }), loopDirectory: dir }, deps);
    expect(calls.runs[0]).toMatchObject({ pipeline: "research", cloudArm: cloud }); expect(calls.runs[0]!.researchFrom).toBeUndefined();
    expect(calls.runs[1]).toMatchObject({ researchFrom: join(dir, "a") }); expect(calls.runs[1]!.pipeline).toBeUndefined(); expect(calls.runs[1]!.cloudArm).toBeUndefined();
    expect(calls.runs[2]).toMatchObject({ researchFrom: join(dir, "a"), repairFrom: join(dir, "critique") }); expect(calls.runs[2]!.pipeline).toBeUndefined(); expect(calls.runs[2]!.cloudArm).toBeUndefined();
    expect(record).toMatchObject({ arm: "cloud", pipeline: "research", seeded: { b: true, repair: true, snapshotSha256: h("f") }, writeIdentityEqual: true });
    // A write-phase drift between a and b is recorded, never hidden.
    const dir2 = loopDir();
    const drift = fakes({ summaries: candidates(true, { a: { writeIdentity: h("7") }, b: { writeIdentity: h("9") } }), transfers: ["a"] });
    expect((await runSelectionLoop({ base: base({ pipeline: "research" }), loopDirectory: dir2 }, drift.deps)).writeIdentityEqual).toBe(false);
    // One reading stage per loop: when a's stage left no packet the loop ends with a's failure; no second stage, no second cap.
    const dir3 = loopDir();
    const third = fakes({ summaries: { a: summary({ status: "incomplete", reason: "research_plan_invalid", artifactsPresent: 0 }) } });
    const record3 = await runSelectionLoop({ base: base({ pipeline: "research", cloudArm: cloud }), loopDirectory: dir3 }, third.deps);
    expect(record3.selected).toEqual({ stage1: null, final: { candidate: "a", step: "stage_failed" } }); expect(third.calls.runs).toHaveLength(1); expect(third.calls.critiques).toHaveLength(0);
    expect(record3.seeded).toEqual({ b: false, repair: false, snapshotSha256: null }); expect(read(dir3)).toMatchObject({ selected: { final: { step: "stage_failed" } }, failure: null });
    expect(loopExitCode(record3)).toBe(2);
  });
  it("stops without a critique when the selected sample left no draft, keeps the stage-1 choice when the critique fails and counts the call it made, and is terminal afterwards", async () => {
    const dir = loopDir();
    const none = fakes({ summaries: candidates(false, { a: { status: "incomplete", reason: "x", artifactsPresent: 0, checksPassed: 0 }, b: { status: "incomplete", reason: "y", artifactsPresent: 0, checksPassed: 0 } }) });
    const record = await runSelectionLoop({ base: base(), loopDirectory: dir }, none.deps);
    expect(record.selected.final).toEqual({ candidate: "a", step: "no_draft" }); expect(none.calls.critiques).toHaveLength(0); expect(none.calls.runs).toHaveLength(2); expect(loopExitCode(record)).toBe(2);
    // An empty reply is a completed call: the tool attaches its usage and fee to the error and the loop counts them.
    const dir2 = loopDir();
    const empty = Object.assign(new Error("repair_critique_empty"), { finishReason: "length", usage: { inputTokens: 15_000, outputTokens: 16_384 }, feeMicrousd: 0 });
    const failing = fakes({ summaries: candidates(false), critiqueFails: empty });
    const record2 = await runSelectionLoop({ base: base(), loopDirectory: dir2 }, failing.deps);
    expect(record2.selected.final).toEqual({ candidate: "a", step: "critique_failed" }); expect(failing.calls.runs).toHaveLength(2);
    expect(record2.critique).toEqual({ failure: "repair_critique_empty", feeMicrousd: 0, finishReason: "length", usage: { inputTokens: 15_000, outputTokens: 16_384 }, modelCalls: 1 });
    expect(record2.totals).toMatchObject({ modelCalls: 21, inputTokens: 17_000, outputTokens: 16_584 });
    expect(read(dir2)).toMatchObject({ critique: { failure: "repair_critique_empty" }, failure: null });
    // A failure before the call carries no usage and counts no call; a raw message (a host path) is replaced by a code.
    const dir3 = loopDir();
    const early = fakes({ summaries: candidates(false), critiqueFails: new Error("ENOENT: no such file or directory, lstat '/Users/someone/task'") });
    const record3 = await runSelectionLoop({ base: base(), loopDirectory: dir3 }, early.deps);
    expect(record3.critique).toEqual({ failure: "repair_critique_failed", feeMicrousd: 0, finishReason: null, usage: null, modelCalls: 0 }); expect(record3.totals.modelCalls).toBe(20);
    expect(readFileSync(join(dir3, "loop.json"), "utf8")).not.toContain("/Users"); expect(readFileSync(join(dir3, "log.txt"), "utf8")).not.toContain("/Users");
    // A loop that chose is terminal whether or not the critique directory exists: a rerun is refused, never retried.
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir3 }, fakes({ summaries: candidates(false) }).deps)).rejects.toThrow("loop_terminal");
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, fakes({ summaries: candidates(false) }).deps)).rejects.toThrow("loop_terminal");
  });
  it("resumes at stage granularity, keeping the loop's start and the reused stages' times, refuses an unfinished stage, and records a failure as a code", async () => {
    const dir = loopDir();
    const first = fakes({ summaries: candidates(false), onRun: run => { if (run.outputDirectory.endsWith("repair")) throw new Error("ENOSPC: no space left on device, write '/Users/someone/loop/repair/x'"); } });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, first.deps)).rejects.toThrow("ENOSPC");
    const stopped = read(dir);
    expect(stopped).toMatchObject({ failure: "loop_failed", startedAt: "t0", finishedAt: expect.any(String) }); expect(stopped.selected.final).toBeNull();
    expect(JSON.stringify(stopped)).not.toContain("/Users"); expect(existsSync(join(dir, "log.txt"))).toBe(true);
    const reusedTimes = Object.fromEntries(stopped.stages.map(stage => [stage.stage, [stage.startedAt, stage.finishedAt]]));
    // The operator moves the unfinished repair aside and reruns: a, b and the critique are reused with their first times, the clock keeps its start.
    rmSync(join(dir, "repair"), { recursive: true, force: true });
    const second = fakes({ summaries: candidates(false) });
    const record = await runSelectionLoop({ base: base(), loopDirectory: dir }, second.deps);
    expect(second.calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["repair"]); expect(second.calls.critiques).toHaveLength(0);
    expect(record.stages.map(stage => [stage.stage, stage.reused])).toEqual([["a", true], ["b", true], ["critique", true], ["repair", false]]);
    for (const name of ["a", "b", "critique"]) expect([record.stages.find(stage => stage.stage === name)!.startedAt, record.stages.find(stage => stage.stage === name)!.finishedAt]).toEqual(reusedTimes[name]);
    expect(record.startedAt).toBe("t0"); expect(record.critique).toMatchObject({ critiqueSha256: h("e"), modelCalls: 1 }); expect(record.totals.modelCalls).toBe(31);
    // A stage directory without its result is refused.
    const dir2 = loopDir();
    mkdirSync(join(dir2, "a"), { recursive: true });
    const third = fakes({ summaries: candidates(false) });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir2 }, third.deps)).rejects.toThrow("loop_stage_incomplete");
    expect(third.calls.runs).toHaveLength(0); expect(read(dir2)).toMatchObject({ failure: "loop_stage_incomplete" });
  });
  it("refuses a reused stage that is not this loop's: another task, another runtime, another packet, or a critique of the other sample", async () => {
    const dir = loopDir();
    mkdirSync(join(dir, "a"), { recursive: true }); writeFileSync(join(dir, "a", "result.json"), "{}");
    for (const foreign of [{ taskJobSha256: h("9") }, { taskBriefSha256: h("9") }, { runtimeSha256: h("9") }, { researchFrom: { sourceJobId: "jx", snapshotSha256: h("f") } }]) {
      const { deps, calls } = fakes({ summaries: candidates(false, { a: foreign }) });
      await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, deps)).rejects.toThrow("loop_stage_mismatch"); expect(calls.runs).toHaveLength(0);
      rmSync(join(dir, "loop.json"), { force: true });
    }
    // On a research task, b must be seeded from a's own packet; a repair must start from the chosen draft and the loop's packet.
    const dir2 = loopDir();
    const wrongSeed = fakes({ summaries: candidates(true, { b: { researchFrom: { sourceJobId: "ja", snapshotSha256: h("9") } } }), transfers: ["a"] });
    await expect(runSelectionLoop({ base: base({ pipeline: "research" }), loopDirectory: dir2 }, wrongSeed.deps)).rejects.toThrow("loop_stage_mismatch");
    const dir3 = loopDir();
    const wrongRepair = fakes({ summaries: candidates(false, { repair: { repairSource: { resultSha256: h("e"), freezeSha256: h("d") } } }) });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir3 }, wrongRepair.deps)).rejects.toThrow("loop_stage_mismatch");
    // A reused critique of the other sample (the operator re-sampled b after the critique of a) is refused rather than repaired from.
    const dir4 = loopDir();
    const firstPass = fakes({ summaries: candidates(false), onRun: run => { if (run.outputDirectory.endsWith("repair")) throw new Error("stop_here"); } });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir4 }, firstPass.deps)).rejects.toThrow("stop_here");
    rmSync(join(dir4, "b"), { recursive: true, force: true }); rmSync(join(dir4, "repair"), { recursive: true, force: true });
    const resampled = fakes({ summaries: candidates(false, { a: { status: "incomplete", reason: "x", checksPassed: 1 } }) });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir4 }, resampled.deps)).rejects.toThrow("loop_stage_mismatch");
    expect(resampled.calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["b"]);
  });
  it("stops after the running stage on an interrupt and never starts the next one", async () => {
    const dir = loopDir();
    const abort = new AbortController();
    const { deps, calls } = fakes({ summaries: candidates(false), onRun: run => { if (run.outputDirectory.endsWith("/a")) abort.abort(); } });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, deps, { signal: abort.signal })).rejects.toThrow("loop_interrupted");
    expect(calls.runs).toHaveLength(1); expect(read(dir)).toMatchObject({ failure: "loop_interrupted", finishedAt: expect.any(String) });
    // The interrupted loop is not terminal: a rerun reuses a and carries on.
    const again = fakes({ summaries: candidates(false) });
    expect((await runSelectionLoop({ base: base(), loopDirectory: dir }, again.deps)).selected.final).toEqual({ candidate: "repair", step: "tie", entailmentRates: [null, null] });
    expect(again.calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["b", "repair"]);
  });
  it("parses the loop's command line from the driver's flags, refuses the flags the loop sets itself, a cloud writer without the pipeline and any profile but heavy; the driver accepts --research-from only as a local heavy claims-ledger writer", () => {
    const driver = ["--task-directory", "t", "--job-sha256", h("1"), "--brief-sha256", h("2"), "--authority-sha256", h("3"), "--image-id", `sha256:${h("4")}`, "--runtime-sha256", h("5"), "--profile", "heavy", "--claims-ledger", "true"];
    const parsed = parseLoopArguments(["--select-and-repair", "--loop-directory", "L", ...driver, "--pipeline", "research"]);
    expect(parsed.loopDirectory).toBe("L"); expect(parsed.base).toMatchObject({ taskDirectory: "t", profile: "heavy", claimsLedger: true, pipeline: "research" }); expect(parsed.base).not.toHaveProperty("outputDirectory");
    expect(() => parseLoopArguments(["--select-and-repair", ...driver])).toThrow("loop_cli_invalid");
    for (const extra of [["--output-directory", "o"], ["--repair-from", "r"], ["--research-from", "a"], ["--pause-after-tools", "3"]]) expect(() => parseLoopArguments(["--select-and-repair", "--loop-directory", "L", ...driver, ...extra])).toThrow("loop_cli_invalid");
    expect(() => parseLoopArguments(["--execute-synthetic-local", "--loop-directory", "L", ...driver])).toThrow("loop_cli_invalid");
    // H5's split arm on Claude (BL-20261030-0620): the Messages endpoint, no long-context tier.
    const claude = parseLoopArguments(["--select-and-repair", "--loop-directory", "L", ...driver, "--pipeline", "research", "--arm", "cloud", "--cloud-model", "claude-sonnet-5-5",
      "--cloud-endpoint", "https://api.anthropic.com/v1/messages", "--cloud-prices", "2,10,0.1,2.5", "--max-fee-usd", "0.6", "--proxy-fake-ip", "true"]);
    expect(claude.base.cloudArm).toEqual({ model: "claude-sonnet-5-5", endpoint: "https://api.anthropic.com/v1/messages", prices: { input: 2, output: 10, cached: 0.1, write: 2.5 }, maxFeeUsd: 0.6, proxyFakeIp: true });
    const cloudFlags = ["--arm", "cloud", "--cloud-model", "m", "--cloud-endpoint", "https://e.invalid/v1/responses", "--cloud-prices", "1,1,1", "--cloud-long-context", "1,1,1,1", "--max-fee-usd", "0.6"];
    expect(parseLoopArguments(["--select-and-repair", "--loop-directory", "L", ...driver, "--pipeline", "research", ...cloudFlags]).base.cloudArm).toBeDefined();
    expect(() => parseLoopArguments(["--select-and-repair", "--loop-directory", "L", ...driver, ...cloudFlags])).toThrow("loop_cli_invalid");
    expect(() => parseLoopArguments(["--select-and-repair", "--loop-directory", "L", ...driver.slice(0, 12), "--profile", "standard"])).toThrow("loop_cli_invalid");
    expect(() => parseLoopArguments(["--select-and-repair", "--loop-directory", "L", ...driver.slice(0, 12)])).toThrow("loop_cli_invalid");
    expect(failureCode(new Error("ENOENT: x '/Users/y'"), "loop_failed")).toBe("loop_failed"); expect(failureCode(new Error("repair_source_task_mismatch"), "x")).toBe("repair_source_task_mismatch"); expect(failureCode("boom", "loop_failed")).toBe("loop_failed");
    // The loop and the critique tool are part of the runtime every sample is frozen under.
    expect(localScreenSourceFreeze().files.map(file => file.path)).toEqual(expect.arrayContaining(["scripts/phase4-loop.ts", "scripts/phase2-repair.ts"]));
    const run = [...driver.slice(0, 12), "--output-directory", "o"];
    expect(parseLocalArtifactScreenArguments(["--execute-synthetic-local", ...run, "--profile", "heavy", "--claims-ledger", "true", "--research-from", "a"]).researchFrom).toBe("a");
    expect(parseLocalArtifactScreenArguments(["--execute-synthetic-local", ...run, "--profile", "heavy", "--claims-ledger", "true", "--research-from", "a", "--repair-from", "c"])).toMatchObject({ researchFrom: "a", repairFrom: "c" });
    for (const bad of [["--profile", "heavy", "--claims-ledger", "true", "--research-from", "a", "--pipeline", "research"], ["--profile", "heavy", "--research-from", "a"], ["--profile", "standard", "--claims-ledger", "true", "--research-from", "a"],
      ["--profile", "heavy", "--claims-ledger", "true", "--research-from", "a", "--document-review", "true"], ["--profile", "heavy", "--claims-ledger", "true", "--research-from", ""],
      ["--profile", "heavy", "--claims-ledger", "true", "--research-from", "a", ...cloudFlags]]) {
      expect(() => parseLocalArtifactScreenArguments(["--execute-synthetic-local", ...run, ...bad])).toThrow("local_screen_cli_invalid");
    }
  });
});
