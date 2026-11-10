import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { summarizeRun, type CandidateSummary } from "../../src/main/private-agent/selection";
import { ServingCardError } from "../../src/main/private-agent/serving-card";
import { LOOP_VERSION, failureCode, loopExitCode, loopFailureLine, parseLoopArguments, productionDependencies, runSelectionLoop, type CritiqueRecord, type DriverInput, type LoopDependencies, type LoopInput, type LoopRecord } from "../../scripts/phase4-loop";
import { localScreenSourceFreeze, parseLocalArtifactScreenArguments } from "../../scripts/private-agent-local-screen";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const h = (n: string) => n.repeat(64);
const summary = (over: Partial<CandidateSummary> = {}): CandidateSummary => ({ jobId: "ja", taskJobSha256: h("1"), taskBriefSha256: h("2"), runtimeSha256: h("4"), researchFrom: null, repairSource: null,
  status: "submitted", reason: "independent_acceptance_pending", checksPassed: 2, checksTotal: 2, checksCurrent: true, artifactsPresent: 2, artifactsTotal: 2,
  entailment: null, writeIdentity: null, modelCalls: 10, toolCalls: 8, inputTokens: 1000, outputTokens: 100, cachedTokens: 500, cacheWriteTokens: 0, lengthStops: 0, feeMicrousd: 0, unknownDispatches: 0, retriedDispatches: 0, failedDispatches: 0, zeroFeeFailedDispatches: 0, assistSkippedDispatches: 0, assistFailedDispatches: 0, stageDenied: null,
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
function fakes(input: { summaries: Record<string, CandidateSummary>; transfers?: string[]; critiqueFails?: string | Error; critiqueFinishReason?: string; onRun?: (run: DriverInput) => void; onWritten?: (run: DriverInput) => void; runtime?: string;
  /** Part 3b: a stage's ledger rows, and the summary of a stage's rerun once its first run has moved aside. */
  rows?: Record<string, Record<string, unknown>[]>; reruns?: Record<string, CandidateSummary> }) {
  const calls: { runs: DriverInput[]; critiques: Parameters<LoopDependencies["critique"]>[0][] } = { runs: [], critiques: [] };
  let tick = 0;
  const snapshot = (directory: string) => (input.transfers ?? []).includes(directory.split("/").pop()!) ? h("f") : null;
  const usage = { inputTokens: 500, outputTokens: 40, cacheReadTokens: 100 };
  const nameOf = (directory: string) => directory.split("/").pop()!;
  /** A stage's summary: its rerun's once the first run moved aside to `<stage>.infra-1`, else its own. */
  const found = (directory: string) => { const name = nameOf(directory); return (existsSync(join(directory, "..", `${name}.infra-1`)) && input.reruns?.[name]) || input.summaries[name]; };
  const deps: LoopDependencies = {
    async runSample(run) { calls.runs.push(run); input.onRun?.(run); mkdirSync(run.outputDirectory, { recursive: true }); writeFileSync(join(run.outputDirectory, "freeze.json"), JSON.stringify({ run: calls.runs.length }));
      writeFileSync(join(run.outputDirectory, "result.json"), "{}"); input.onWritten?.(run); },
    async critique(request) {
      calls.critiques.push(request);
      if (input.critiqueFails) throw typeof input.critiqueFails === "string" ? new Error(input.critiqueFails) : input.critiqueFails;
      const selected = input.summaries[request.runDirectory.split("/").pop()!]!;
      const record: CritiqueRecord = { packetSha256: h("d"), critiqueSha256: h("e"), feeMicrousd: 0, finishReason: input.critiqueFinishReason ?? "stop", usage, source: { resultSha256: selected.resultSha256, freezeSha256: selected.freezeSha256 },
        ...(selected.researchFrom ? { researchSnapshotSha256: selected.researchFrom.snapshotSha256 } : (input.transfers ?? []).includes("a") ? { researchSnapshotSha256: h("f") } : {}) };
      mkdirSync(request.outputDirectory, { recursive: true }); writeFileSync(join(request.outputDirectory, "critique.json"), JSON.stringify(record));
      return { binding: { packetSha256: record.packetSha256, critiqueSha256: record.critiqueSha256, source: record.source! }, feeMicrousd: 0, finishReason: record.finishReason, usage };
    },
    readCritique(directory) { return JSON.parse(readFileSync(join(directory, "critique.json"), "utf8")) as CritiqueRecord; },
    summarize(directory) { const summary = found(directory); if (!summary) throw new Error(`no summary for ${nameOf(directory)}`); return summary; },
    transferStatus: directory => { const sha256 = snapshot(directory); return { snapshotSha256: sha256, code: sha256 ? null : "research_seed_no_transfer" }; },
    deliverables: () => ["output/report.md", "output/claims.json"],
    now: () => `t${tick++}`,
    runtimeSha256: () => input.runtime ?? h("4"),
    // Part 3b's readers, from each stage's summary: a stage the fakes ran has a readable freeze, a local arm capped at 0 and no ledger rows.
    readRunEnd(directory) {
      const summary = found(directory), rows = input.rows?.[nameOf(directory)] ?? [];
      const last = (status: string) => [...rows].reverse().find(row => row.status === status && row.purpose !== "research plan assist" && row.purpose !== "research synthesis assist") ?? null;
      return { status: summary?.status ?? "", reason: summary?.reason ?? "", stageDenied: summary?.stageDenied ?? null, failingCall: last("failed"), uncertainCall: last("unknown"), runtimeBrokerCode: null,
        captureFailure: null, verificationFailure: null, tokenAdmissionCode: null, brokerDenialCode: null };
    },
    readLedger(directory) {
      const summary = found(directory);
      return { freeze: summary && existsSync(join(directory, "freeze.json")) ? { jobId: summary.jobId, sha256: summary.freezeSha256, runtimeSha256: summary.runtimeSha256, startedAt: summary.startedAt, feeCapMicrousd: 0, localArm: true } : null,
        dispatches: input.rows?.[nameOf(directory)] ?? [], claims: [], counts: { modelCalls: summary?.modelCalls ?? 0, toolCalls: summary?.toolCalls ?? 0, inputTokens: summary?.inputTokens ?? 0, outputTokens: summary?.outputTokens ?? 0,
          cachedTokens: summary?.cachedTokens ?? 0, cacheWriteTokens: summary?.cacheWriteTokens ?? 0, lengthStops: summary?.lengthStops ?? 0, feeMicrousd: summary?.feeMicrousd ?? 0,
          unknownDispatches: summary?.unknownDispatches ?? 0, retriedDispatches: 0, failedDispatches: summary?.failedDispatches ?? 0, zeroFeeFailedDispatches: summary?.zeroFeeFailedDispatches ?? 0,
          assistSkippedDispatches: summary?.assistSkippedDispatches ?? 0, assistFailedDispatches: summary?.assistFailedDispatches ?? 0 }, lastCommittedAt: null };
    },
    readCritiqueFailure(directory) {
      const path = join(directory, "critique-failure.json");
      return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as ReturnType<LoopDependencies["readCritiqueFailure"]> : null;
    },
    recoverLedger() { /* the fakes leave no journal */ },
    recoverClaims: async () => "not_needed",
    lock: () => ({ release() { /* one invocation at a time in these tests */ } }),
  };
  return { deps, calls };
}
function loopDir() { const dir = mkdtempSync(join(tmpdir(), "soar-loop-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return join(dir, "loop"); }
const read = (dir: string) => JSON.parse(readFileSync(join(dir, "loop.json"), "utf8")) as LoopRecord;
/** Real result-to-summary mapping: committed receipts must block just like UNKNOWN; an assist row carries its purpose. */
function transportStoppedSummary(status: "unknown" | "committed" | "failed", purpose?: string): CandidateSummary {
  const directory = loopDir(); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "freeze.json"), JSON.stringify({ jobId: "ja", startedAt: "t0", sourceFreezeSha256: h("4"),
    taskBinding: { jobSha256: h("1"), briefSha256: h("2") } }));
  // A task end, so part 1's own stops are what decide: part 3b resumes an infrastructure end instead (tests/unit/phase4-loop-resume.test.ts).
  writeFileSync(join(directory, "result.json"), JSON.stringify({ status: "incomplete", reason: "bounded_allowance_exhausted",
    finishedAt: "t1", snapshotSha256: h("7"), candidateFiles: [], dispatches: [{ status, feeMicrousd: 0, ...(purpose ? { purpose, reservedFeeMicrousd: 160_000 } : {}) }] }));
  const db = new Database(join(directory, "state.sqlite"));
  db.exec("CREATE TABLE private_agent_events (job_id TEXT, sequence INTEGER, value TEXT)"); db.close();
  return summarizeRun(directory, []);
}

/** The real summary of an incomplete run whose one dispatch row is `row`, under a freeze whose arm is `arm` (backlog item 11's zero-fee predicate). */
function rowSummary(row: Record<string, unknown>, arm?: Record<string, unknown>, reason = "bounded_allowance_exhausted"): CandidateSummary {
  const directory = loopDir(); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "freeze.json"), JSON.stringify({ jobId: "ja", startedAt: "t0", sourceFreezeSha256: h("4"), taskBinding: { jobSha256: h("1"), briefSha256: h("2") }, ...(arm ? { arm } : {}) }));
  writeFileSync(join(directory, "result.json"), JSON.stringify({ status: "incomplete", reason, finishedAt: "t1", snapshotSha256: h("7"), candidateFiles: [], dispatches: [row] }));
  const db = new Database(join(directory, "state.sqlite"));
  db.exec("CREATE TABLE private_agent_events (job_id TEXT, sequence INTEGER, value TEXT)"); db.close();
  return summarizeRun(directory, []);
}
/** A zero-fee local reader row the broker resolved `failed` (backlog item 1). */
const ZERO_FEE_FAILED = { status: "failed", destinationId: "owned_local_model", purpose: "research source index", reservedFeeMicrousd: 0 };

describe("H4 select-and-repair loop", () => {
  it("runs a, b, the critique of the selected sample and the repair, keeps a and then the selected draft on ties (selection protocol 2), and records counts only", async () => {
    const dir = loopDir();
    const { deps, calls } = fakes({ summaries: candidates(false, { repair: { modelCalls: 7 } }) });
    const record = await runSelectionLoop({ base: base(), loopDirectory: dir }, deps);
    expect(calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["a", "b", "repair"]);
    expect(calls.runs.every(run => run.researchFrom === undefined && run.pipeline === undefined && run.cloudArm === undefined)).toBe(true);
    expect(calls.runs[2]).toMatchObject({ repairFrom: join(dir, "critique") });
    expect(calls.critiques).toEqual([{ runDirectory: join(dir, "a"), taskDirectory: "task", expectedJobSha256: h("1"), expectedBriefSha256: h("2"), imageId: `sha256:${h("5")}`, outputDirectory: join(dir, "critique"), critic: "local" }]);
    expect(record.selected).toEqual({ stage1: { candidate: "a", step: "tie", entailmentRates: [null, null] }, final: { candidate: "a", step: "tie", entailmentRates: [null, null] } });
    expect(record.seeded).toEqual({ a: false, b: false, repair: false, snapshotSha256: null }); expect(record.failure).toBeNull(); expect(record.writeIdentityEqual).toBeNull();
    expect(record.critique).toEqual({ packetSha256: h("d"), critiqueSha256: h("e"), feeMicrousd: 0, finishReason: "stop", usage: { inputTokens: 500, outputTokens: 40, cacheReadTokens: 100 }, modelCalls: 1 });
    // The critique's one call and its usage join the totals beside the three runs.
    expect(record.totals).toMatchObject({ modelCalls: 28, toolCalls: 24, inputTokens: 3500, outputTokens: 340, cachedTokens: 1600, feeMicrousd: 0 });
    expect(record.stages.map(stage => [stage.stage, stage.reused])).toEqual([["a", false], ["b", false], ["critique", false], ["repair", false]]);
    const saved = read(dir);
    expect(saved).toMatchObject({ version: LOOP_VERSION, selectionRule: 2, arm: "local", pipeline: null, runtimeSha256: h("4"), startedAt: "t0", finishedAt: expect.any(String) });
    expect(JSON.stringify(saved)).not.toContain(dir);
    expect(readFileSync(join(dir, "log.txt"), "utf8")).toContain("final a (tie)");
    expect(existsSync(join(dir, "errors.txt"))).toBe(false);  // backlog item 4: the error side file exists only when something was caught
    expect(loopExitCode(record)).toBe(0);
  });
  it("adds a truncated critique to the samples' length stops without changing the selection rule", async () => {
    const dir = loopDir();
    const { deps } = fakes({ summaries: candidates(false, { a: { lengthStops: 2 }, b: { lengthStops: 1 }, repair: { lengthStops: 1 } }), critiqueFinishReason: "length" });
    const record = await runSelectionLoop({ base: base(), loopDirectory: dir }, deps);
    expect(record.totals.lengthStops).toBe(5);
    expect(record.selected.final).toMatchObject({ candidate: "a", step: "tie" });
  });
  it("picks the submitted sample, and the draft over a repair that failed to submit", async () => {
    const dir = loopDir();
    const { deps, calls } = fakes({ summaries: candidates(false, { a: { status: "incomplete", reason: "bounded_allowance_exhausted" }, repair: { status: "incomplete", reason: "cancelled_or_deadline" } }) });
    const record = await runSelectionLoop({ base: base(), loopDirectory: dir }, deps);
    expect(record.selected).toMatchObject({ stage1: { candidate: "b", step: "submitted" }, final: { candidate: "b", step: "submitted" } });
    expect(calls.critiques[0]!.runDirectory).toBe(join(dir, "b")); expect(loopExitCode(record)).toBe(0);
  });
  it("chooses the repair only when it beats the selected draft on submission, checks or deliverables; the entailment rates are evidence only (protocol 2)", async () => {
    const entailed = (supported: number, contradicted = 0) => ({ supported, partial: 0, unsupported: 0, contradicted, not_judged: 0, truncated: false });
    const pick = async (over: Parameters<typeof candidates>[1]) => (await runSelectionLoop({ base: base(), loopDirectory: loopDir() }, fakes({ summaries: candidates(false, over) }).deps)).selected;
    expect((await pick({ a: { checksPassed: 1 }, b: { checksPassed: 1 }, repair: { checksPassed: 2 } })).final).toEqual({ candidate: "repair", step: "checks", entailmentRates: [null, null] });
    expect((await pick({ a: { status: "incomplete", reason: "x" }, b: { status: "incomplete", reason: "y" } })).final).toEqual({ candidate: "repair", step: "submitted", entailmentRates: [null, null] });
    expect((await pick({ a: { artifactsPresent: 2 }, repair: { artifactsPresent: 1 } })).final).toEqual({ candidate: "a", step: "artifacts", entailmentRates: [null, null] });
    // A repair whose balance rate is far higher, or a b whose rate is, wins nothing on it: the rates are recorded [first, second] and the tie keeps the original.
    const rated = await pick({ a: { entailment: entailed(10, 5) }, b: { entailment: entailed(30) }, repair: { entailment: entailed(30) } });
    expect(rated).toEqual({ stage1: { candidate: "a", step: "tie", entailmentRates: [5 / 15, 1] }, final: { candidate: "a", step: "tie", entailmentRates: [5 / 15, 1] } });
  });
  it.each(["unknown", "committed", "failed"] as const)("stops after a %s receipt (a failed one with no recorded zero reservation) even when a completed research packet exists", async status => {
    const dir = loopDir(), a = transportStoppedSummary(status);
    const code = status === "failed" ? "loop_stage_failed_dispatch" : "loop_stage_unresolved_dispatch";
    expect(a).toMatchObject({ unknownDispatches: status === "failed" ? 0 : 1, failedDispatches: status === "failed" ? 1 : 0, zeroFeeFailedDispatches: 0 });
    const { deps, calls } = fakes({ summaries: candidates(true, { a }), transfers: ["a"] });
    await expect(runSelectionLoop({ base: base({ pipeline: "research" }), loopDirectory: dir }, deps)).rejects.toThrow(code);
    expect(calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["a"]); expect(calls.critiques).toHaveLength(0);
    expect(existsSync(join(dir, "b"))).toBe(false);
    expect(read(dir)).toMatchObject({ failure: code, stopped: { stage: "a", failure: code }, candidates: { a: { unknownDispatches: a.unknownDispatches, failedDispatches: a.failedDispatches } },
      totals: { unknownDispatches: a.unknownDispatches, failedDispatches: a.failedDispatches }, selected: { stage1: null, final: null }, finishedAt: expect.any(String) });
    // Part 3b: the stop is for good, so the loop is terminal and a rerun touches nothing.
    const reused = fakes({ summaries: candidates(true, { a }), transfers: ["a"] });
    await expect(runSelectionLoop({ base: base({ pipeline: "research" }), loopDirectory: dir }, reused.deps)).rejects.toThrow("loop_terminal");
    expect(reused.calls.runs).toHaveLength(0); expect(reused.calls.critiques).toHaveLength(0);
  });
  it("admits a sample whose failed rows are all resolved zero-fee failures (backlog item 11), and still stops on a priced, cloud, approved or unreserved failure", async () => {
    const a = rowSummary(ZERO_FEE_FAILED);
    expect(a).toMatchObject({ unknownDispatches: 0, failedDispatches: 1, zeroFeeFailedDispatches: 1 });
    const dir = loopDir();
    const { deps, calls } = fakes({ summaries: candidates(true, { a }), transfers: ["a"] });
    const record = await runSelectionLoop({ base: base({ pipeline: "research" }), loopDirectory: dir }, deps);
    expect(calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["a", "b", "repair"]); expect(calls.critiques).toHaveLength(1);
    expect(record.failure).toBeNull(); expect(record.totals).toMatchObject({ failedDispatches: 1, zeroFeeFailedDispatches: 1 });
    expect(record.selected).toMatchObject({ stage1: { candidate: "b", step: "submitted" }, final: { candidate: "b", step: "tie" } });
    expect(read(dir).totals).toMatchObject({ failedDispatches: 1, zeroFeeFailedDispatches: 1 });
    const cloudArm = { arm: "cloud", modelConfig: { destinationId: "cloud_coordinator" } };
    const stopping: [Record<string, unknown>, Record<string, unknown>?][] = [[{ ...ZERO_FEE_FAILED, reservedFeeMicrousd: 160_000 }], [{ ...ZERO_FEE_FAILED, destinationId: "cloud_coordinator" }, cloudArm],
      [{ ...ZERO_FEE_FAILED, approval: { proposalId: "p", maxFeeMicrousd: 0 } }], [{ ...ZERO_FEE_FAILED, reservedFeeMicrousd: undefined }], [{ ...ZERO_FEE_FAILED, feeMicrousd: 1 }]];
    for (const [row, arm] of stopping) {
      const stopped = rowSummary(row, arm);
      expect(stopped).toMatchObject({ failedDispatches: 1, zeroFeeFailedDispatches: 0 });
      const run = fakes({ summaries: candidates(true, { a: stopped }), transfers: ["a"] });
      await expect(runSelectionLoop({ base: base({ pipeline: "research" }), loopDirectory: loopDir() }, run.deps)).rejects.toThrow("loop_stage_failed_dispatch");
      expect(run.calls.runs).toHaveLength(1); expect(run.calls.critiques).toHaveLength(0);
    }
  });
  it("ends at stage_failed with the seed refusal, a final selection, when a's reading stage left a zero-fee failure and no packet (backlog item 11)", async () => {
    const dir = loopDir();
    const { deps, calls } = fakes({ summaries: { a: rowSummary(ZERO_FEE_FAILED) } });
    const record = await runSelectionLoop({ base: base({ pipeline: "research" }), loopDirectory: dir }, deps);
    expect(record.selected).toEqual({ stage1: null, final: { candidate: "a", step: "stage_failed", seedRefusal: "research_seed_no_transfer" } });
    expect(record.failure).toBeNull(); expect(calls.runs).toHaveLength(1); expect(calls.critiques).toHaveLength(0);
    expect(record.totals).toMatchObject({ failedDispatches: 1, zeroFeeFailedDispatches: 1 }); expect(loopExitCode(record)).toBe(2);
    expect(read(dir)).toMatchObject({ failure: null, selected: { final: { step: "stage_failed" } } });
  });
  it.each([["unknown", "research plan assist", "assistSkippedDispatches"], ["failed", "research synthesis assist", "assistFailedDispatches"]] as const)("admits a sample whose assist row is %s (backlog item 10) and goes on to b, the critique and the repair, counting it apart", async (status, purpose, column) => {
    const dir = loopDir(), a = transportStoppedSummary(status, purpose);
    expect(a).toMatchObject({ unknownDispatches: 0, failedDispatches: 0, [column]: 1 });
    const { deps, calls } = fakes({ summaries: candidates(true, { a }), transfers: ["a"] });
    const record = await runSelectionLoop({ base: base({ pipeline: "research" }), loopDirectory: dir }, deps);
    expect(calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["a", "b", "repair"]);
    expect(record.failure).toBeNull(); expect(record.totals).toMatchObject({ unknownDispatches: 0, failedDispatches: 0, [column]: 1 });
    expect(record.selected.final).not.toBeNull();
    // A committed assist row is still an unresolved dispatch: the process died mid-call and nothing can resolve it.
    const committed = transportStoppedSummary("committed", purpose);
    expect(committed).toMatchObject({ unknownDispatches: 1, assistSkippedDispatches: 0, assistFailedDispatches: 0 });
    await expect(runSelectionLoop({ base: base({ pipeline: "research" }), loopDirectory: loopDir() }, fakes({ summaries: candidates(true, { a: committed }), transfers: ["a"] }).deps)).rejects.toThrow("loop_stage_unresolved_dispatch");
  });
  it.each([[{ unknownDispatches: 1 }, "loop_stage_unresolved_dispatch"], [{ failedDispatches: 1 }, "loop_stage_failed_dispatch"], [{ failedDispatches: 2, zeroFeeFailedDispatches: 1 }, "loop_stage_failed_dispatch"]] as const)("does not admit a critique or repair after b has stopped dispatches: %j", async (stopped, code) => {
    const dir = loopDir();
    const { deps, calls } = fakes({ summaries: candidates(true, { b: { ...stopped, status: "incomplete" } }), transfers: ["a"] });
    await expect(runSelectionLoop({ base: base({ pipeline: "research" }), loopDirectory: dir }, deps)).rejects.toThrow(code);
    expect(calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["a", "b"]);
    expect(calls.critiques).toHaveLength(0); expect(existsSync(join(dir, "repair"))).toBe(false);
    expect(read(dir).selected).toEqual({ stage1: null, final: null });
  });
  it("keeps an evaluated incomplete research draft eligible when all dispatches settled", async () => {
    const dir = loopDir();
    const { deps, calls } = fakes({ summaries: candidates(true, { a: { status: "incomplete", reason: "bounded_allowance_exhausted" } }), transfers: ["a"] });
    const record = await runSelectionLoop({ base: base({ pipeline: "research" }), loopDirectory: dir }, deps);
    expect(calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["a", "b", "repair"]);
    expect(calls.critiques).toHaveLength(1); expect(record.failure).toBeNull(); expect(record.selected.stage1).toMatchObject({ candidate: "b", step: "submitted" });
  });
  it("does not accept a final repair whose dispatch remains unresolved: part 3b ends the loop with the draft (repair_failed)", async () => {
    const dir = loopDir();
    const { deps, calls } = fakes({ summaries: candidates(false, { repair: { unknownDispatches: 1 } }) });
    const record = await runSelectionLoop({ base: base(), loopDirectory: dir }, deps);
    expect(calls.runs).toHaveLength(3); expect(calls.critiques).toHaveLength(1);
    expect(record.selected.final).toEqual({ candidate: "a", step: "repair_failed", cause: "submitted" }); expect(loopExitCode(record)).toBe(2);
    expect(read(dir)).toMatchObject({ failure: "loop_stage_unresolved_dispatch", failedStage: "repair", stopped: null, totals: { unknownDispatches: 1 } });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, fakes({ summaries: candidates(false) }).deps)).rejects.toThrow("loop_terminal");
  });
  it("seeds b and the repair from a's packet on a research task, stripping the stage and the cloud writer, compares the write identities, and ends the loop when a left no packet", async () => {
    const dir = loopDir();
    const { deps, calls } = fakes({ summaries: candidates(true, { a: { writeIdentity: h("7") }, b: { writeIdentity: h("7") }, repair: { writeIdentity: h("8") } }), transfers: ["a"] });
    const record = await runSelectionLoop({ base: base({ pipeline: "research", cloudArm: cloud }), loopDirectory: dir }, deps);
    expect(calls.runs[0]).toMatchObject({ pipeline: "research", cloudArm: cloud }); expect(calls.runs[0]!.researchFrom).toBeUndefined();
    expect(calls.runs[1]).toMatchObject({ researchFrom: join(dir, "a") }); expect(calls.runs[1]!.pipeline).toBeUndefined(); expect(calls.runs[1]!.cloudArm).toBeUndefined();
    expect(calls.runs[2]).toMatchObject({ researchFrom: join(dir, "a"), repairFrom: join(dir, "critique") }); expect(calls.runs[2]!.pipeline).toBeUndefined(); expect(calls.runs[2]!.cloudArm).toBeUndefined();
    expect(record).toMatchObject({ arm: "cloud", pipeline: "research", seeded: { a: false, b: true, repair: true, snapshotSha256: h("f") }, writeIdentityEqual: true });
    // A write-phase drift between a and b is recorded, never hidden.
    const dir2 = loopDir();
    const drift = fakes({ summaries: candidates(true, { a: { writeIdentity: h("7") }, b: { writeIdentity: h("9") } }), transfers: ["a"] });
    expect((await runSelectionLoop({ base: base({ pipeline: "research" }), loopDirectory: dir2 }, drift.deps)).writeIdentityEqual).toBe(false);
    // One reading stage per loop: when a's stage left no packet the loop ends with a's failure; no second stage, no second cap.
    const dir3 = loopDir();
    const third = fakes({ summaries: { a: summary({ status: "incomplete", reason: "research_plan_invalid", artifactsPresent: 0 }) } });
    const record3 = await runSelectionLoop({ base: base({ pipeline: "research", cloudArm: cloud }), loopDirectory: dir3 }, third.deps);
    expect(record3.selected).toEqual({ stage1: null, final: { candidate: "a", step: "stage_failed", seedRefusal: "research_seed_no_transfer" } }); expect(third.calls.runs).toHaveLength(1); expect(third.calls.critiques).toHaveLength(0);
    expect(record3.seeded).toEqual({ a: false, b: false, repair: false, snapshotSha256: null }); expect(read(dir3)).toMatchObject({ selected: { final: { step: "stage_failed", seedRefusal: "research_seed_no_transfer" } }, failure: null });
    // Backlog item 4: the seed loader's refusal code is in the log too, and a loop that ended by rule wrote no error side file.
    expect(readFileSync(join(dir3, "log.txt"), "utf8")).toContain("stage failed in a (research_seed_no_transfer): loop ends"); expect(existsSync(join(dir3, "errors.txt"))).toBe(false);
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
    expect(record2.selected.final).toEqual({ candidate: "a", step: "critique_failed", cause: "task" }); expect(failing.calls.runs).toHaveLength(2);
    expect(record2.critique).toEqual({ failure: "repair_critique_empty", feeMicrousd: 0, finishReason: "length", usage: { inputTokens: 15_000, outputTokens: 16_384 }, modelCalls: 1 });
    expect(record2.totals).toMatchObject({ modelCalls: 21, inputTokens: 17_000, outputTokens: 16_584, lengthStops: 1 });
    expect(read(dir2)).toMatchObject({ critique: { failure: "repair_critique_empty" }, failure: null });
    // A failure before the call carries no usage and counts no call; a raw message (a host path) is replaced by a code.
    const dir3 = loopDir();
    const early = fakes({ summaries: candidates(false), critiqueFails: new Error("ENOENT: no such file or directory, lstat '/Users/someone/task'") });
    const record3 = await runSelectionLoop({ base: base(), loopDirectory: dir3 }, early.deps);
    expect(record3.critique).toEqual({ failure: "repair_critique_failed", feeMicrousd: 0, finishReason: null, usage: null, modelCalls: 0 }); expect(record3.totals).toMatchObject({ modelCalls: 20, lengthStops: 0 });
    expect(readFileSync(join(dir3, "loop.json"), "utf8")).not.toContain("/Users"); expect(readFileSync(join(dir3, "log.txt"), "utf8")).not.toContain("/Users");
    // Backlog item 4 (finding B6): the full error, name and message, reaches the operator through the side file beside its code.
    expect(readFileSync(join(dir3, "errors.txt"), "utf8")).toMatch(/ repair_critique_failed Error: ENOENT: no such file or directory, lstat '\/Users\/someone\/task'\n$/u);
    expect(readFileSync(join(dir2, "errors.txt"), "utf8")).toContain(" repair_critique_empty Error: repair_critique_empty\n");
    // A loop that chose is terminal whether or not the critique directory exists: a rerun is refused, never retried.
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir3 }, fakes({ summaries: candidates(false) }).deps)).rejects.toThrow("loop_terminal");
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, fakes({ summaries: candidates(false) }).deps)).rejects.toThrow("loop_terminal");
  });
  it("resumes at stage granularity, keeping the loop's start and the reused stages' times, refuses an unfinished stage, and records a failure as a code", async () => {
    const dir = loopDir();
    const first = fakes({ summaries: candidates(false), critiqueFinishReason: "length", onRun: run => { if (run.outputDirectory.endsWith("repair")) throw new Error("ENOSPC: no space left on device, write '/Users/someone/loop/repair/x'"); } });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, first.deps)).rejects.toThrow("ENOSPC");
    const stopped = read(dir);
    expect(stopped).toMatchObject({ failure: "loop_failed", startedAt: "t0", finishedAt: expect.any(String) }); expect(stopped.selected.final).toBeNull();
    expect(JSON.stringify(stopped)).not.toContain("/Users"); expect(existsSync(join(dir, "log.txt"))).toBe(true);
    // Backlog item 4 (finding B6): errors.txt holds the name and message; loop.json and log.txt keep the code.
    expect(readFileSync(join(dir, "errors.txt"), "utf8")).toMatch(/ loop_failed Error: ENOSPC: no space left on device, write '\/Users\/someone\/loop\/repair\/x'\n$/u);
    expect(readFileSync(join(dir, "log.txt"), "utf8")).not.toContain("/Users");
    const reusedTimes = Object.fromEntries(stopped.stages.map(stage => [stage.stage, [stage.startedAt, stage.finishedAt]]));
    // The operator moves the unfinished repair aside and reruns: a, b and the critique are reused with their first times, the clock keeps its start.
    rmSync(join(dir, "repair"), { recursive: true, force: true });
    const second = fakes({ summaries: candidates(false) });
    const record = await runSelectionLoop({ base: base(), loopDirectory: dir }, second.deps);
    expect(second.calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["repair"]); expect(second.calls.critiques).toHaveLength(0);
    expect(record.stages.map(stage => [stage.stage, stage.reused])).toEqual([["a", true], ["b", true], ["critique", true], ["repair", false]]);
    for (const name of ["a", "b", "critique"]) expect([record.stages.find(stage => stage.stage === name)!.startedAt, record.stages.find(stage => stage.stage === name)!.finishedAt]).toEqual(reusedTimes[name]);
    expect(record.startedAt).toBe("t0"); expect(record.critique).toMatchObject({ critiqueSha256: h("e"), finishReason: "length", modelCalls: 1 }); expect(record.totals).toMatchObject({ modelCalls: 31, lengthStops: 1 });
    // Part 3b: a directory the record does not name is refused before any stage, and nothing is written; the operator never makes or moves one.
    const dir2 = loopDir();
    mkdirSync(join(dir2, "a"), { recursive: true });
    const third = fakes({ summaries: candidates(false) });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir2 }, third.deps)).rejects.toThrow("loop_resume_mismatch");
    expect(third.calls.runs).toHaveLength(0); expect(existsSync(join(dir2, "loop.json"))).toBe(false);
    // A stage whose run died after creating its directory is unfinished: the next invocation moves it to a.infra-1 and runs it again, once.
    const dir3 = loopDir();
    const dying = fakes({ summaries: candidates(false), onRun: run => { if (run.outputDirectory.endsWith("/a")) { mkdirSync(run.outputDirectory, { recursive: true }); writeFileSync(join(run.outputDirectory, "freeze.json"), "{}"); throw new Error("driver_died"); } } });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir3 }, dying.deps)).rejects.toThrow("driver_died");
    expect(read(dir3)).toMatchObject({ failure: "driver_died", failedStage: "a", begun: [{ stage: "a" }], stopped: null });
    const fourth = fakes({ summaries: candidates(false) });
    expect((await runSelectionLoop({ base: base(), loopDirectory: dir3 }, fourth.deps)).selected.final).toMatchObject({ candidate: "a", step: "tie" });
    expect(fourth.calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["a", "b", "repair"]);
    expect(read(dir3).resumes).toEqual([expect.objectContaining({ stage: "a", cause: "run_unfinished", as: "rerun", cleanup: "not_needed" })]);
    expect(existsSync(join(dir3, "a.infra-1", "freeze.json"))).toBe(true);
  });
  it("refuses a reused stage that is not this loop's: another task, another runtime, another packet, or a critique of the other sample", async () => {
    for (const foreign of [{ taskJobSha256: h("9") }, { taskBriefSha256: h("9") }, { runtimeSha256: h("9") }, { researchFrom: { sourceJobId: "jx", snapshotSha256: h("f") } }]) {
      // The loop ran a and stopped before b; the reused a then turns out to be another task's, runtime's or packet's: a stop for good (part 3b).
      const dir = loopDir();
      await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, fakes({ summaries: candidates(false), onRun: run => { if (run.outputDirectory.endsWith("/b")) throw new Error("stop_here"); } }).deps)).rejects.toThrow("stop_here");
      const { deps, calls } = fakes({ summaries: candidates(false, { a: foreign }) });
      await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, deps)).rejects.toThrow("loop_stage_mismatch"); expect(calls.runs).toHaveLength(0);
      expect(read(dir)).toMatchObject({ stopped: { stage: "a", failure: "loop_stage_mismatch" } });
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
    // Backlog item 11: the stage running when the interrupt fired is marked; a marked stage that still submitted is complete and reused.
    const marked = read(dir).stages;
    expect(marked).toEqual([{ stage: "a", startedAt: expect.any(String), finishedAt: expect.any(String), reused: false, interrupted: true }]);
    const again = fakes({ summaries: candidates(false) });
    const resumed = await runSelectionLoop({ base: base(), loopDirectory: dir }, again.deps);
    expect(resumed.selected.final).toEqual({ candidate: "a", step: "tie", entailmentRates: [null, null] });
    expect(again.calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["b", "repair"]);
    expect(resumed.stages[0]).toEqual({ ...marked[0], reused: true }); expect(resumed.stages.slice(1).every(entry => entry.interrupted === undefined)).toBe(true);
  });
  it("resumes a stage its own interrupt cut, once (backlog item 11, part 3b): the mark leaves with the moved run, and a second cut stops the loop for good", async () => {
    const dir = loopDir(), abort = new AbortController();
    // The driver cancels the running stage on the same signal: the run ends cancelled_or_deadline, which part 3a gives to the operator when the loop marked it.
    const quiet = candidates(false, { b: { status: "incomplete", reason: "cancelled_or_deadline" } });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, fakes({ summaries: quiet, onRun: run => { if (run.outputDirectory.endsWith("/b")) abort.abort(); } }).deps, { signal: abort.signal })).rejects.toThrow("loop_interrupted");
    expect(read(dir).stages.find(entry => entry.stage === "b")).toMatchObject({ interrupted: true });
    // The rerun moves the cut b to b.infra-1 under a write-ahead entry and runs b again; the loop carries on, and the moved run's counts stay in the totals.
    const rerun = fakes({ summaries: quiet, reruns: { b: summary({ jobId: "jb2", freezeSha256: h("d"), resultSha256: h("e") }) } });
    const record = await runSelectionLoop({ base: base(), loopDirectory: dir }, rerun.deps);
    expect(rerun.calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["b", "repair"]); expect(record.failure).toBeNull();
    expect(record.resumes).toEqual([expect.objectContaining({ stage: "b", cause: "operator_stop", as: "rerun", cleanup: "not_needed" })]);
    expect(record.stages.every(entry => entry.interrupted === undefined)).toBe(true); expect(existsSync(join(dir, "b.infra-1"))).toBe(true);
    expect(record.totals.modelCalls).toBe(4 * 10 + 1); expect(read(dir).begun.map(entry => entry.stage).sort()).toEqual(["a", "b", "critique", "repair"]);
    expect(readFileSync(join(dir, "log.txt"), "utf8")).toContain("b moved to b.infra-1 (operator_stop)");
    // A second cut of a stage that used its resume stops the loop for good.
    const dir2 = loopDir(), abort2 = new AbortController(), abort3 = new AbortController();
    const cutB = (signal: AbortController) => fakes({ summaries: quiet, onRun: run => { if (run.outputDirectory.endsWith("/b")) signal.abort(); } }).deps;
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir2 }, cutB(abort2), { signal: abort2.signal })).rejects.toThrow("loop_interrupted");
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir2 }, cutB(abort3), { signal: abort3.signal })).rejects.toThrow("loop_interrupted");
    const last = fakes({ summaries: quiet });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir2 }, last.deps)).rejects.toThrow("loop_stage_interrupted"); expect(last.calls.runs).toHaveLength(0);
    expect(read(dir2)).toMatchObject({ stopped: { stage: "b", failure: "loop_stage_interrupted" }, resumes: [{ stage: "b", cause: "operator_stop" }] });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir2 }, fakes({ summaries: quiet }).deps)).rejects.toThrow("loop_terminal");
    // A stage that ended on the session deadline, with no interrupt from the loop, is unmarked and stays an ordinary candidate.
    const deadline = fakes({ summaries: candidates(false, { b: { status: "incomplete", reason: "cancelled_or_deadline" } }) });
    expect((await runSelectionLoop({ base: base(), loopDirectory: loopDir() }, deadline.deps)).selected).toMatchObject({ stage1: { candidate: "a", step: "submitted" }, final: { candidate: "a" } });
    // Decision (1): a marked stage whose end is the task's (a fee cap the interrupt crossed) is an ordinary candidate, neither refused nor resumed.
    const dir3 = loopDir(), abort4 = new AbortController();
    const capped = candidates(false, { b: { status: "incomplete", reason: "fee_cap_reached" } });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir3 }, fakes({ summaries: capped, onRun: run => { if (run.outputDirectory.endsWith("/b")) abort4.abort(); } }).deps, { signal: abort4.signal })).rejects.toThrow("loop_interrupted");
    const kept = fakes({ summaries: capped });
    expect((await runSelectionLoop({ base: base(), loopDirectory: dir3 }, kept.deps)).selected).toMatchObject({ stage1: { candidate: "a", step: "submitted" } });
    expect(kept.calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["repair"]); expect(read(dir3).resumes).toEqual([]);
  });
  it("refuses, before any stage, a stale runtime hash and a prior record of another protocol, version, runtime, task, arm or pipeline, leaving that record as it was (backlog item 11)", async () => {
    // The live source freeze must be the one the operator names: a reused stage never calls the driver that checks it.
    const dir = loopDir();
    const stale = fakes({ summaries: candidates(false), runtime: h("9") });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, stale.deps)).rejects.toThrow("loop_reviewed_source_changed");
    expect(existsSync(dir)).toBe(false); expect(stale.calls.runs).toHaveLength(0);
    // A loop that stopped before the protocol bump, with every stage on disk, is never finished under protocol 2.
    const stopped = loopDir();
    const firstPass = fakes({ summaries: candidates(false), onRun: run => { if (run.outputDirectory.endsWith("repair")) throw new Error("stop_here"); } });
    await expect(runSelectionLoop({ base: base(), loopDirectory: stopped }, firstPass.deps)).rejects.toThrow("stop_here");
    const saved = readFileSync(join(stopped, "loop.json"), "utf8");
    const rewrite = (over: Record<string, unknown>) => writeFileSync(join(stopped, "loop.json"), JSON.stringify({ ...JSON.parse(saved), ...over }));
    for (const over of [{ selectionRule: 1 }, { version: 0 }, { runtimeSha256: h("9") }, { task: { jobSha256: h("9"), briefSha256: h("2") } }, { task: { jobSha256: h("1"), briefSha256: h("9") } }, { task: null },
      { arm: "cloud" }, { pipeline: "research" }, { stages: null }]) {
      rewrite(over);
      const before = readFileSync(join(stopped, "loop.json"), "utf8");
      const resumed = fakes({ summaries: candidates(false) });
      await expect(runSelectionLoop({ base: base(), loopDirectory: stopped }, resumed.deps)).rejects.toThrow("loop_record_mismatch");
      expect(resumed.calls.runs).toHaveLength(0); expect(readFileSync(join(stopped, "loop.json"), "utf8")).toBe(before);
    }
    // The same record under its own protocol resumes as before.
    rewrite({});
    rmSync(join(stopped, "repair"), { recursive: true, force: true });
    const resumed = fakes({ summaries: candidates(false) });
    expect((await runSelectionLoop({ base: base(), loopDirectory: stopped }, resumed.deps)).selected.final).toMatchObject({ candidate: "a", step: "tie" });
    expect(resumed.calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["repair"]);
    // The production dependency is the live source freeze the driver itself checks.
    expect(productionDependencies({ base: base(), loopDirectory: dir }).runtimeSha256()).toBe(localScreenSourceFreeze().sha256);
  });
  it("keeps an interrupt mark across invocations that stop before reaching the marked stage, and marks a cut stage whose run then threw (backlog item 11)", async () => {
    // A transient failure before the marked stage is reached keeps the mark: the cut repair is resumed later, never selected as it was.
    const dir2 = loopDir(), abort3 = new AbortController();
    const cutRepair = candidates(false, { repair: { status: "incomplete", reason: "cancelled_or_deadline", checksPassed: 3 } });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir2 }, fakes({ summaries: cutRepair, onRun: run => { if (run.outputDirectory.endsWith("/repair")) abort3.abort(); } }).deps, { signal: abort3.signal })).rejects.toThrow("loop_interrupted");
    const flaky = fakes({ summaries: cutRepair }); flaky.deps.summarize = () => { throw new Error("EMFILE: too many open files"); };
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir2 }, flaky.deps)).rejects.toThrow("EMFILE");
    expect(read(dir2).stages.find(entry => entry.stage === "repair")).toMatchObject({ interrupted: true });
    const resumed = fakes({ summaries: cutRepair, reruns: { repair: summary({ jobId: "jr2", freezeSha256: h("5"), resultSha256: h("6"), repairSource: { resultSha256: h("c"), freezeSha256: h("b") } }) } });
    const record = await runSelectionLoop({ base: base(), loopDirectory: dir2 }, resumed.deps);
    expect(resumed.calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["repair"]); expect(record.selected.final).toMatchObject({ candidate: "a", step: "tie" });
    expect(record.resumes).toEqual([expect.objectContaining({ stage: "repair", cause: "operator_stop" })]);
    // The driver writes result.json and then throws (a cleanup failure) while the interrupt has fired: the stage is still marked, and resumed.
    const quiet = candidates(false, { b: { status: "incomplete", reason: "cancelled_or_deadline" } });
    const dir3 = loopDir(), abort4 = new AbortController();
    const throwing = fakes({ summaries: quiet, onWritten: run => { if (run.outputDirectory.endsWith("/b")) { abort4.abort(); throw new Error("public_snapshot_cleanup_failed"); } } });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir3 }, throwing.deps, { signal: abort4.signal })).rejects.toThrow("public_snapshot_cleanup_failed");
    expect(read(dir3).stages.find(entry => entry.stage === "b")).toMatchObject({ reused: false, interrupted: true });
    const after = fakes({ summaries: quiet, reruns: { b: summary({ jobId: "jb2", freezeSha256: h("d"), resultSha256: h("e") }) } });
    expect((await runSelectionLoop({ base: base(), loopDirectory: dir3 }, after.deps)).resumes).toEqual([expect.objectContaining({ stage: "b", cause: "operator_stop" })]);
  });
  it("passes its interrupt to the critique, and a critique the interrupt cuts stops the loop resumably, never as a failed critique (backlog item 11, part 3a; E1's bug d)", async () => {
    const dir = loopDir(), abort = new AbortController();
    const { deps, calls } = fakes({ summaries: candidates(false) });
    let seen: AbortSignal | undefined;
    // The critique tool on the real broker: its zero-fee local call fails when the signal aborts it, it records the failure, and it throws.
    deps.critique = async (request, control) => {
      calls.critiques.push(request); seen = control?.signal;
      mkdirSync(request.outputDirectory, { recursive: true });
      abort.abort();
      await new Promise<void>(resolve => { if (control?.signal?.aborted) resolve(); else control?.signal?.addEventListener("abort", () => resolve(), { once: true }); });
      writeFileSync(join(request.outputDirectory, "critique-failure.json"), JSON.stringify({ critic: "local", code: "request_failed", usage: null, feeMicrousd: 0 }));
      throw new Error("ECONNRESET: socket hang up reading /Users/someone/critique/state.sqlite");
    };
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, deps, { signal: abort.signal })).rejects.toThrow("loop_interrupted");
    expect(seen).toBe(abort.signal); expect(calls.critiques[0]).not.toHaveProperty("signal");
    const record = read(dir);
    expect(record).toMatchObject({ failure: "loop_interrupted", critique: null, selected: { final: null } });
    expect(record.stages.find(entry => entry.stage === "critique")).toMatchObject({ reused: false, interrupted: true });
    // The critique's own failure, whatever it names, reaches only the operator's side file; the record and the log keep the code.
    expect(readFileSync(join(dir, "errors.txt"), "utf8")).toMatch(/ loop_interrupted Error: ECONNRESET: socket hang up reading \/Users\/someone\/critique\/state\.sqlite\n/u);
    expect(readFileSync(join(dir, "loop.json"), "utf8")).not.toContain("/Users"); expect(readFileSync(join(dir, "log.txt"), "utf8")).not.toContain("/Users");
    // Part 3b: the next invocation finds the cut critique without its record and resumes it once: moved to critique.infra-1 and run again.
    const resumed = fakes({ summaries: candidates(false) });
    expect((await runSelectionLoop({ base: base(), loopDirectory: dir }, resumed.deps)).selected.final).toMatchObject({ candidate: "a", step: "tie" });
    expect(resumed.calls.critiques).toHaveLength(1); expect(resumed.calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["repair"]);
    expect(read(dir).resumes).toEqual([expect.objectContaining({ stage: "critique", cause: "operator_stop", as: "rerun" })]);
    expect(existsSync(join(dir, "critique.infra-1", "critique-failure.json"))).toBe(true);
    // A critique that fails on its own, with no interrupt, still ends the loop as before.
    const failing = fakes({ summaries: candidates(false), critiqueFails: "request_failed" });
    // The fake fails before creating the critique's directory, so there is nothing to resume: the loop ends with the failure's own cause.
    expect((await runSelectionLoop({ base: base(), loopDirectory: loopDir() }, failing.deps)).selected.final).toEqual({ candidate: "a", step: "critique_failed", cause: "request_failed" });
  });
  it("refuses a summary that lacks a count the totals add, and still records the failure", async () => {
    const dir = loopDir();
    const { zeroFeeFailedDispatches: _dropped, ...partial } = summary();
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, fakes({ summaries: { ...candidates(false), a: partial as CandidateSummary } }).deps)).rejects.toThrow("loop_stage_mismatch");
    expect(read(dir)).toMatchObject({ failure: "loop_stage_mismatch", finishedAt: expect.any(String) });
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
  it("records a serving-card refusal as the loop's failure code, names its key path in the logs, creates no stage directory and stays resumable (SC)", async () => {
    const dir = loopDir();
    // The driver refuses a card before it creates the stage's directory, so the loop's own stage guard never sees a half-made stage.
    const refused = fakes({ summaries: candidates(false), onRun: run => { if (run.outputDirectory.endsWith("/a")) throw new ServingCardError("serving_card_not_adopted", "decision"); } });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, refused.deps)).rejects.toThrow("serving_card_not_adopted");
    expect(read(dir)).toMatchObject({ failure: "serving_card_not_adopted", selected: { stage1: null, final: null } });
    expect(existsSync(join(dir, "a"))).toBe(false);
    // The allowlisted key path follows the code in log.txt, errors.txt and the CLI line, as on the driver's failure line; loop.json keeps the code.
    expect(readFileSync(join(dir, "log.txt"), "utf8")).toMatch(/ failure serving_card_not_adopted at decision\n$/u);
    expect(readFileSync(join(dir, "errors.txt"), "utf8")).toMatch(/ serving_card_not_adopted ServingCardError: serving_card_not_adopted at decision\n$/u);
    expect(loopFailureLine(new ServingCardError("serving_card_cap_out_of_range", "roles.plan.maxOutputTokens[0]")))
      .toBe("{\"error\":\"serving_card_cap_out_of_range\",\"parameter\":\"roles.plan.maxOutputTokens[0]\",\"state\":\"incomplete\"}\n");
    expect(loopFailureLine(new ServingCardError("serving_card_pin_drift"))).toBe("{\"error\":\"serving_card_pin_drift\",\"state\":\"incomplete\"}\n");
    // Every other failure prints the bytes it printed before SC.
    expect(loopFailureLine(new Error("loop_stage_mismatch"))).toBe("{\"error\":\"loop_stage_mismatch\",\"state\":\"incomplete\"}\n");
    expect(loopFailureLine(new Error("ENOSPC: no space left on device, write '/Users/someone/loop'"))).toBe("{\"error\":\"loop_failed\",\"state\":\"incomplete\"}\n");
    const resumed = fakes({ summaries: candidates(false) });
    const record = await runSelectionLoop({ base: base(), loopDirectory: dir }, resumed.deps);
    expect(record.failure).toBeNull(); expect(resumed.calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["a", "b", "repair"]);
    expect(record.selected.final).toMatchObject({ candidate: "a" });
  });
});

describe("E1 recoverability: the harness loop admits retried rows and stops on an interrupt in any later sample (S1, S2)", () => {
  /** A sample whose result lists these dispatch rows, read through the real result-to-summary mapping (selection.ts). */
  function ledgerSummary(rows: { status: string; purpose?: string }[]): CandidateSummary {
    const directory = loopDir(); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "freeze.json"), JSON.stringify({ jobId: "ja", startedAt: "t0", sourceFreezeSha256: h("4"), taskBinding: { jobSha256: h("1"), briefSha256: h("2") } }));
    writeFileSync(join(directory, "result.json"), JSON.stringify({ status: "incomplete", reason: "runtime_failure_progress_preserved", finishedAt: "t1", snapshotSha256: h("7"), candidateFiles: [],
      dispatches: rows.map(row => ({ feeMicrousd: 0, ...row })) }));
    const db = new Database(join(directory, "state.sqlite"));
    db.exec("CREATE TABLE private_agent_events (job_id TEXT, sequence INTEGER, value TEXT)"); db.close();
    return summarizeRun(directory, []);
  }

  it("admits a sample whose ledger holds rows a zero-fee retry superseded, goes on to b, the critique and the repair, and counts them as retried", async () => {
    // Finding D14's shape: the extraction call was cut once and retried (superseded, then settled), and an Anthropic-shaped planner call was retried after a 529.
    const dir = loopDir(), a = ledgerSummary([{ status: "settled" }, { status: "superseded" }, { status: "settled" }, { status: "superseded", purpose: "research plan" }, { status: "settled" }]);
    expect(a).toMatchObject({ retriedDispatches: 2, unknownDispatches: 0, failedDispatches: 0, assistSkippedDispatches: 0, assistFailedDispatches: 0 });
    const { deps, calls } = fakes({ summaries: candidates(true, { a }), transfers: ["a"] });
    const record = await runSelectionLoop({ base: base({ pipeline: "research" }), loopDirectory: dir }, deps);
    expect(calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(["a", "b", "repair"]); expect(calls.critiques).toHaveLength(1);
    expect(record.failure).toBeNull(); expect(record.selected.final).not.toBeNull();
    expect(record.totals).toMatchObject({ retriedDispatches: 2, unknownDispatches: 0, failedDispatches: 0 });
  });

  it.each([["b", ["a", "b"], 0, ["repair"], 1], ["repair", ["a", "b", "repair"], 1, [], 0]] as const)(
    "stops after %s on an interrupt during it, starts nothing after it, and a rerun reuses every finished stage and selects", async (name, ran, critiques, rerun, recritiques) => {
      // The interrupted stage here submitted before the interrupt was seen, so every loop version reuses it; a stage the interrupt cut before it
      // submitted is the pin below. No tie winner is asserted: item 11's PR 11.1 changes the tie rule.
      const dir = loopDir(), abort = new AbortController();
      const { deps, calls } = fakes({ summaries: candidates(false), onRun: run => { if (run.outputDirectory.endsWith(`/${name}`)) abort.abort(); } });
      await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, deps, { signal: abort.signal })).rejects.toThrow("loop_interrupted");
      expect(calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(ran); expect(calls.critiques).toHaveLength(critiques);
      expect(read(dir)).toMatchObject({ failure: "loop_interrupted", selected: { final: null }, finishedAt: expect.any(String) });
      expect(loopExitCode(read(dir))).toBe(2);
      const again = fakes({ summaries: candidates(false) });
      const record = await runSelectionLoop({ base: base(), loopDirectory: dir }, again.deps);
      expect(again.calls.runs.map(run => run.outputDirectory.split("/").pop())).toEqual(rerun); expect(again.calls.critiques).toHaveLength(recritiques);
      expect(record.failure).toBeNull(); expect(record.selected.final).not.toBeNull();
      expect(record.stages.filter(stage => stage.reused).map(stage => stage.stage)).toEqual(name === "b" ? ["a", "b"] : ["a", "b", "critique", "repair"]);
    });

  it("pins the limitation item 11's PR 11.1 flipped: a rerun refuses, with loop_stage_interrupted, a sample the loop's interrupt cut before it submitted", async () => {
    // In production the driver's own interrupt handler cancels the sample's session, so the cut sample ends cancelled. Before 11.1 the rerun reused it
    // and never ran it again; since 11.1 the rerun refuses such a stage with loop_stage_interrupted, runs nothing and keeps the stage's mark.
    const summaries = candidates(false, { b: { status: "incomplete", reason: "cancelled_or_deadline" } });
    const dir = loopDir(), abort = new AbortController();
    const { deps } = fakes({ summaries, onRun: run => { if (run.outputDirectory.endsWith("/b")) abort.abort(); } });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, deps, { signal: abort.signal })).rejects.toThrow("loop_interrupted");
    const again = fakes({ summaries });
    await expect(runSelectionLoop({ base: base(), loopDirectory: dir }, again.deps)).rejects.toThrow("loop_stage_interrupted");
    expect(again.calls.runs).toHaveLength(0);
    expect(read(dir)).toMatchObject({ failure: "loop_stage_interrupted", selected: { stage1: null, final: null },
      stages: [{ stage: "a", reused: true }, { stage: "b", reused: true, interrupted: true }] });
  });
});
