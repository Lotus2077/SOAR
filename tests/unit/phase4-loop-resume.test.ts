import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { digest } from "../../src/main/private-agent/contracts";
import { acquireLoopLock, directoryInode, recoverRunClaims, recoverRunLedger } from "../../src/main/private-agent/loop-ledger";
import { readRunEndEvidence, readRunLedger, type CandidateSummary, type RunLedger } from "../../src/main/private-agent/selection";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { LOOP_VERSION, closeLoop, ledgerDependencies, loopExitCode, parseCloseArguments, productionDependencies, rerunCannotSpend, runSelectionLoop, type DriverInput, type LoopDependencies,
  type LoopInput, type LoopRecord } from "../../scripts/phase4-loop";

/**
 * Backlog item 11, part 3b (BL-20261110-0637-infra-resume-design): the loop's zero-fee resume, its lock, its write-ahead moves and
 * their reconciliation, void starts, terminal stops and `--close`, on real directories with fakes standing in for the driver.
 */
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const h = (n: string) => n.repeat(64);
const summary = (over: Partial<CandidateSummary> = {}): CandidateSummary => ({ jobId: "ja", taskJobSha256: h("1"), taskBriefSha256: h("2"), runtimeSha256: h("4"), researchFrom: null, repairSource: null,
  status: "submitted", reason: "independent_acceptance_pending", checksPassed: 2, checksTotal: 2, checksCurrent: true, artifactsPresent: 2, artifactsTotal: 2,
  entailment: null, writeIdentity: null, modelCalls: 10, toolCalls: 8, inputTokens: 1000, outputTokens: 100, cachedTokens: 500, cacheWriteTokens: 0, lengthStops: 0, feeMicrousd: 0, unknownDispatches: 0, retriedDispatches: 0, failedDispatches: 0, zeroFeeFailedDispatches: 0, assistSkippedDispatches: 0, assistFailedDispatches: 0, stageDenied: null,
  candidateSha256: h("a"), freezeSha256: h("b"), resultSha256: h("c"), startedAt: "t0", finishedAt: "t1", ...over });
/** b and the repair of one well-formed loop; on a research task they write from `seed`. */
function stages(seed: CandidateSummary["researchFrom"] = null, over: Partial<Record<"a" | "b" | "repair", Partial<CandidateSummary>>> = {}) {
  const a = summary({ jobId: "ja", ...over.a }), b = summary({ jobId: "jb", freezeSha256: h("d"), resultSha256: h("e"), researchFrom: seed, ...over.b });
  return { a, b, repair: summary({ jobId: "jr", freezeSha256: h("5"), resultSha256: h("6"), researchFrom: seed, repairSource: { resultSha256: a.resultSha256, freezeSha256: a.freezeSha256 }, ...over.repair }) };
}
function base(over: Partial<DriverInput> = {}): LoopInput["base"] {
  return { taskDirectory: "task", expectedJobSha256: h("1"), expectedBriefSha256: h("2"), syntheticAuthoritySha256: h("3"), expectedRuntimeSha256: h("4"), imageId: `sha256:${h("5")}`, profile: "heavy", claimsLedger: true, ...over };
}
const cloudArm = { model: "m", endpoint: "https://api.example.invalid/v1/responses", prices: { input: 2, output: 10, cached: 0.2 }, maxFeeUsd: 0.6 };
const zeroFeeFailed = { status: "failed", destinationId: "owned_local_model", purpose: "agent reasoning and tool selection", reservedFeeMicrousd: 0, failure: { phase: "transport", code: "request_timeout" } };
const ended = (reason: string, over: Partial<CandidateSummary> = {}) => ({ status: "incomplete" as const, reason, ...over });
const zeroCounts = { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, lengthStops: 0, feeMicrousd: 0, unknownDispatches: 0, retriedDispatches: 0,
  failedDispatches: 0, zeroFeeFailedDispatches: 0, assistSkippedDispatches: 0, assistFailedDispatches: 0 };
interface Harness { summaries: Record<string, CandidateSummary>; reruns?: Record<string, CandidateSummary>; rows?: Record<string, Record<string, unknown>[]>; failing?: Record<string, Record<string, unknown>>;
  transfers?: string[]; onRun?: (run: DriverInput) => void; onWritten?: (run: DriverInput) => void; realLock?: boolean; critique?: LoopDependencies["critique"];
  recoverClaims?: LoopDependencies["recoverClaims"]; ledgers?: (directory: string, ledger: RunLedger) => RunLedger;
  /** A run whose result cannot be read (a crash while it was written). */ endFails?: (directory: string) => boolean;
  /** The clock's minute, so a later invocation runs later. */ minute?: number }
/** Fakes standing in for the driver, the critique tool and the readers; a stage's run writes its freeze, then its result, as the driver does. */
function harness(input: Harness) {
  const calls: { runs: DriverInput[]; critiques: number } = { runs: [], critiques: 0 };
  let tick = 0;
  const nameOf = (directory: string) => directory.split("/").pop()!;
  const found = (directory: string) => { const name = nameOf(directory); return (existsSync(join(directory, "..", `${name}.infra-1`)) && input.reruns?.[name]) || input.summaries[name.replace(/\.infra-1$/u, "")]; };
  const deps: LoopDependencies = {
    async runSample(run) {
      calls.runs.push(run); input.onRun?.(run);
      mkdirSync(run.outputDirectory, { recursive: true }); writeFileSync(join(run.outputDirectory, "freeze.json"), JSON.stringify({ run: calls.runs.length }));
      writeFileSync(join(run.outputDirectory, "result.json"), "{}"); input.onWritten?.(run);
    },
    critique: input.critique ?? (async request => {
      calls.critiques++;
      mkdirSync(request.outputDirectory, { recursive: true });
      const selected = found(request.runDirectory)!;
      writeFileSync(join(request.outputDirectory, "critique.json"), JSON.stringify({ packetSha256: h("d"), critiqueSha256: h("e"), feeMicrousd: 0, finishReason: "stop", usage: { inputTokens: 500 },
        source: { resultSha256: selected.resultSha256, freezeSha256: selected.freezeSha256 },
        ...(selected.researchFrom ? { researchSnapshotSha256: selected.researchFrom.snapshotSha256 } : (input.transfers ?? []).length ? { researchSnapshotSha256: h("f") } : {}) }));
      return { binding: { packetSha256: h("d"), critiqueSha256: h("e"), source: { resultSha256: selected.resultSha256, freezeSha256: selected.freezeSha256 } }, feeMicrousd: 0, finishReason: "stop", usage: { inputTokens: 500 } };
    }),
    readCritique: directory => JSON.parse(readFileSync(join(directory, "critique.json"), "utf8")),
    readCritiqueFailure: directory => existsSync(join(directory, "critique-failure.json")) ? JSON.parse(readFileSync(join(directory, "critique-failure.json"), "utf8")) : null,
    summarize: directory => { const found_ = found(directory); if (!found_) throw new Error(`no summary for ${nameOf(directory)}`); return found_; },
    readRunEnd: directory => {
      if (input.endFails?.(directory)) throw new SyntaxError("Unexpected end of JSON input");
      const found_ = found(directory)!, rows = input.rows?.[nameOf(directory)] ?? [];
      return { status: found_.status, reason: found_.reason, stageDenied: found_.stageDenied, failingCall: [...rows].reverse().find(row => row.status === "failed") ?? null,
        uncertainCall: [...rows].reverse().find(row => row.status === "unknown") ?? null, runtimeBrokerCode: null, captureFailure: null, verificationFailure: null, tokenAdmissionCode: null, brokerDenialCode: null };
    },
    readLedger: directory => {
      const found_ = found(directory), name = nameOf(directory);
      const freeze = existsSync(join(directory, "freeze.json")) && found_ ? { jobId: found_.jobId, sha256: digest(readFileSync(join(directory, "freeze.json"))), runtimeSha256: found_.runtimeSha256,
        startedAt: found_.startedAt, feeCapMicrousd: 0, localArm: true } : null;
      const ledger: RunLedger = { freeze, dispatches: input.rows?.[name] ?? [], claims: [], counts: { ...zeroCounts, modelCalls: found_?.modelCalls ?? 0, toolCalls: found_?.toolCalls ?? 0 }, lastCommittedAt: null, finishedAt: null };
      return input.ledgers ? input.ledgers(directory, ledger) : ledger;
    },
    recoverLedger: directory => recoverRunLedger(directory),
    recoverClaims: input.recoverClaims ?? (async () => "not_needed"),
    lock: input.realLock ? acquireLoopLock : () => ({ release() { /* one invocation at a time */ } }),
    transferStatus: directory => (input.transfers ?? []).includes(nameOf(directory)) ? { snapshotSha256: h("f"), code: null } : { snapshotSha256: null, code: "research_seed_no_transfer" },
    deliverables: () => ["output/report.md"],
    now: () => `2026-11-10T08:${String(input.minute ?? 0).padStart(2, "0")}:${String(tick++ % 60).padStart(2, "0")}.000Z`,
    runtimeSha256: () => h("4"),
  };
  return { deps, calls };
}
function loopDir() { const dir = realpathSync(mkdtempSync(join(tmpdir(), "soar-resume-"))); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return join(dir, "loop"); }
const read = (dir: string) => JSON.parse(readFileSync(join(dir, "loop.json"), "utf8")) as LoopRecord;
const ran = (calls: { runs: DriverInput[] }) => calls.runs.map(run => run.outputDirectory.split("/").pop());
const run = (dir: string, deps: LoopDependencies, over: Partial<DriverInput> = {}, signal?: AbortSignal) => runSelectionLoop({ base: base(over), loopDirectory: dir }, deps, signal ? { signal } : {});
/** The dependencies `--close` takes, from a harness's. */
const closing = (deps: LoopDependencies) => ({ lock: deps.lock, recoverLedger: deps.recoverLedger, readLedger: deps.readLedger, readRunEnd: deps.readRunEnd, readCritique: deps.readCritique,
  readCritiqueFailure: deps.readCritiqueFailure, now: deps.now });

describe("the loop's zero-fee resume (backlog item 11, part 3b)", () => {
  it("defers a fresh infrastructure end to the next invocation, which moves the stage aside under a write-ahead entry and runs it again, once", async () => {
    const dir = loopDir();
    const summaries = stages(null, { a: ended("model_unavailable") });
    await expect(run(dir, harness({ summaries, rows: { a: [zeroFeeFailed] } }).deps)).rejects.toThrow("loop_stage_infra");
    // The stage's spend is in the totals of the record saved at the stop, before it is moved or kept.
    expect(read(dir)).toMatchObject({ version: LOOP_VERSION, failure: "loop_stage_infra", failedStage: "a", stopped: null, begun: [{ stage: "a" }], resumes: [], totals: { modelCalls: 10, toolCalls: 8 } });
    const inode = directoryInode(join(dir, "a"));
    const second = harness({ summaries, rows: { a: [zeroFeeFailed] }, reruns: { a: summary({ jobId: "ja2" }) } });
    const record = await run(dir, second.deps);
    expect(ran(second.calls)).toEqual(["a", "b", "repair"]); expect(record.selected.final).toMatchObject({ candidate: "a" }); expect(loopExitCode(record)).toBe(0);
    expect(record.resumes).toEqual([{ stage: "a", cause: "model_unavailable", as: "rerun", identity: { inode, sha256: expect.stringMatching(/^[a-f0-9]{64}$/u), jobId: "ja" },
      counts: expect.objectContaining({ modelCalls: 10, toolCalls: 8 }), span: { startedAt: expect.any(String), endedAt: expect.any(String) }, cleanup: "not_needed", at: expect.any(String) }]);
    expect(existsSync(join(dir, "a.infra-1", "freeze.json"))).toBe(true); expect(directoryInode(join(dir, "a.infra-1"))).toBe(inode);
    // Three runs, the critique and the moved a: the moved run is counted once, through its entry.
    expect(record.totals).toMatchObject({ modelCalls: 41, toolCalls: 32 });
    expect(readFileSync(join(dir, "log.txt"), "utf8")).toContain("a moved to a.infra-1 (model_unavailable)");
    // After its one resume, a second infrastructure end is an ordinary candidate (part 1).
    const dir2 = loopDir(), failing = stages(null, { a: ended("model_unavailable"), repair: { repairSource: { resultSha256: h("e"), freezeSha256: h("d") } } });
    await expect(run(dir2, harness({ summaries: failing }).deps)).rejects.toThrow("loop_stage_infra");
    const again = harness({ summaries: failing, reruns: { a: summary({ jobId: "ja2", ...ended("model_unavailable") }) } });
    expect((await run(dir2, again.deps)).selected).toMatchObject({ stage1: { candidate: "b", step: "submitted" } });
    expect(ran(again.calls)).toEqual(["a", "b", "repair"]);
  });
  it("resumes a sample a whose reading stage completed as a writer seeded from the moved run, whatever its arm, and seeds b and the repair from that run", async () => {
    const dir = loopDir();
    const first = harness({ summaries: stages(null, { a: ended("model_unavailable") }), rows: { a: [zeroFeeFailed] }, transfers: ["a"] });
    await expect(run(dir, first.deps, { pipeline: "research", cloudArm })).rejects.toThrow("loop_stage_infra");
    expect(first.calls.runs[0]).toMatchObject({ pipeline: "research", cloudArm });
    const movedFreeze = digest(readFileSync(join(dir, "a", "freeze.json")));
    const seed = { sourceJobId: "ja", snapshotSha256: h("f"), sourceFreezeSha256: movedFreeze };
    const second = harness({ summaries: stages(seed, { a: ended("model_unavailable") }), rows: { a: [zeroFeeFailed] }, transfers: ["a", "a.infra-1"], reruns: { a: summary({ jobId: "ja2", researchFrom: seed }) } });
    const record = await run(dir, second.deps, { pipeline: "research", cloudArm });
    expect(ran(second.calls)).toEqual(["a", "b", "repair"]);
    // The rerun of a writes from the moved run's packet with no stage and no cloud writer of its own; b and the repair write from the same run.
    for (const call of second.calls.runs) { expect(call).toMatchObject({ researchFrom: join(dir, "a.infra-1") }); expect(call.cloudArm).toBeUndefined(); expect(call.pipeline).toBeUndefined(); }
    expect(record).toMatchObject({ seeded: { a: true, b: true, repair: true, snapshotSha256: h("f") }, resumes: [{ stage: "a", as: "seeded_writer", cause: "model_unavailable" }] });
    expect(record.selected.final).toMatchObject({ candidate: "a" });
    // A rerun whose seed names another freeze than the moved run's is not this loop's: a stop for good.
    const dir2 = loopDir();
    await expect(run(dir2, harness({ summaries: stages(null, { a: ended("model_unavailable") }), rows: { a: [zeroFeeFailed] }, transfers: ["a"] }).deps, { pipeline: "research", cloudArm })).rejects.toThrow("loop_stage_infra");
    const wrong = { sourceJobId: "ja", snapshotSha256: h("f"), sourceFreezeSha256: h("9") };
    const third = harness({ summaries: stages(wrong, { a: ended("model_unavailable") }), transfers: ["a", "a.infra-1"], reruns: { a: summary({ jobId: "ja2", researchFrom: wrong }) } });
    await expect(run(dir2, third.deps, { pipeline: "research", cloudArm })).rejects.toThrow("loop_stage_mismatch");
    expect(read(dir2)).toMatchObject({ stopped: { stage: "a", failure: "loop_stage_mismatch" } });
  });
  it("never resumes a cloud-armed a without a packet: finished, it ends at stage_failed; unfinished or cut, it stops for good; a missing begun a is never run again", async () => {
    // Finished: part 1's path, at stage_failed with the seed refusal.
    const finished = harness({ summaries: stages(null, { a: ended("model_unavailable") }), rows: { a: [zeroFeeFailed] } });
    expect((await run(loopDir(), finished.deps, { pipeline: "research", cloudArm })).selected.final).toEqual({ candidate: "a", step: "stage_failed", seedRefusal: "research_seed_no_transfer" });
    // Unfinished: the driver threw after its session started. The invocation that ran it examines it and stops for good.
    const dir = loopDir();
    const dying = harness({ summaries: stages(), onRun: call => { mkdirSync(call.outputDirectory, { recursive: true }); writeFileSync(join(call.outputDirectory, "freeze.json"), "{}"); throw new Error("driver_died"); } });
    await expect(run(dir, dying.deps, { pipeline: "research", cloudArm })).rejects.toThrow("loop_stage_incomplete");
    expect(read(dir)).toMatchObject({ stopped: { stage: "a", failure: "loop_stage_incomplete" }, resumes: [], totals: { modelCalls: 10 } });
    expect(readFileSync(join(dir, "errors.txt"), "utf8")).toContain("Error: driver_died");
    const after = harness({ summaries: stages() });
    await expect(run(dir, after.deps, { pipeline: "research", cloudArm })).rejects.toThrow("loop_terminal");
    expect(after.calls.runs).toHaveLength(0);
    // Cut by the loop's interrupt, ended cancelled, with no packet.
    const dir2 = loopDir(), abort = new AbortController();
    const cut = stages(null, { a: ended("cancelled_or_deadline") });
    await expect(run(dir2, harness({ summaries: cut, onRun: () => abort.abort() }).deps, { pipeline: "research", cloudArm }, abort.signal)).rejects.toThrow("loop_interrupted");
    await expect(run(dir2, harness({ summaries: cut }).deps, { pipeline: "research", cloudArm })).rejects.toThrow("loop_stage_interrupted");
    expect(read(dir2)).toMatchObject({ stopped: { stage: "a", failure: "loop_stage_interrupted" } });
    // A begun cloud a whose directory is missing (a start killed before its directory existed, or a directory removed by hand) is refused, never paid again.
    const dir3 = loopDir();
    await expect(run(dir3, harness({ summaries: stages(), onRun: () => { throw new Error("stop_here"); } }).deps, { pipeline: "research", cloudArm })).rejects.toThrow("stop_here");
    expect(read(dir3).begun).toEqual([]);
    const killed = read(dir3); killed.begun = [{ stage: "a", at: "2026-11-10T08:00:00.000Z" }]; writeFileSync(join(dir3, "loop.json"), JSON.stringify(killed));
    const missing = harness({ summaries: stages() });
    await expect(run(dir3, missing.deps, { pipeline: "research", cloudArm })).rejects.toThrow("loop_stage_missing");
    expect(missing.calls.runs).toHaveLength(0); expect(read(dir3).stopped).toEqual({ stage: "a", failure: "loop_stage_missing" });
    // A local a in the same state costs nothing to run again: it is started again and logged.
    const dir4 = loopDir();
    await expect(run(dir4, harness({ summaries: stages(), onRun: () => { throw new Error("stop_here"); } }).deps)).rejects.toThrow("stop_here");
    const local = read(dir4); local.begun = [{ stage: "a", at: "2026-11-10T08:00:00.000Z" }]; writeFileSync(join(dir4, "loop.json"), JSON.stringify(local));
    const restarted = harness({ summaries: stages() });
    expect((await run(dir4, restarted.deps)).selected.final).toMatchObject({ candidate: "a" }); expect(ran(restarted.calls)).toEqual(["a", "b", "repair"]);
    expect(readFileSync(join(dir4, "log.txt"), "utf8")).toContain("a missing: started again");
  });
  it("moves a start that sent nothing (no freeze) aside as a void start, without using the stage's resume, for a cloud-armed a too", async () => {
    const dir = loopDir();
    const refusing = (n: number) => harness({ summaries: stages(null, { a: ended("model_unavailable") }), transfers: ["a"],
      onRun: call => { if (call.outputDirectory.endsWith("/a")) { mkdirSync(call.outputDirectory, { recursive: true }); throw new Error(`local_screen_cloud_key_missing_${n}`); } } });
    await expect(run(dir, refusing(1).deps, { pipeline: "research", cloudArm })).rejects.toThrow("local_screen_cloud_key_missing_1");
    await expect(run(dir, refusing(2).deps, { pipeline: "research", cloudArm })).rejects.toThrow("local_screen_cloud_key_missing_2");
    expect(read(dir).voids).toEqual([expect.objectContaining({ stage: "a", n: 1, identity: expect.objectContaining({ sha256: null }) })]);
    const fixed = harness({ summaries: stages({ sourceJobId: "ja", snapshotSha256: h("f") }), transfers: ["a"] });
    const record = await run(dir, fixed.deps, { pipeline: "research", cloudArm });
    // Both refusals moved aside; the third start is a's first paid run, not a resume.
    expect(record.voids.map(entry => entry.n)).toEqual([1, 2]); expect(record.resumes).toEqual([]);
    expect(fixed.calls.runs[0]).toMatchObject({ pipeline: "research", cloudArm }); expect(existsSync(join(dir, "a.void-1"))).toBe(true); expect(existsSync(join(dir, "a.void-2"))).toBe(true);
    expect(readFileSync(join(dir, "log.txt"), "utf8")).toContain("a moved to a.void-2 (void)");
  });
  it("stops for good on a priced unresolved or failed row in a stage's ledger before deferring or moving it, and admits a zero-fee committed row", async () => {
    const priced = { status: "failed", destinationId: "cloud_coordinator", purpose: "research plan", reservedFeeMicrousd: 160_000, failure: { phase: "transport", code: "http_rejected", status: 402 } };
    const dir = loopDir();
    // The run ended on its zero-fee local call (infrastructure), after an earlier priced call failed: the priced row stops the loop, never a resume.
    const fresh = harness({ summaries: stages(null, { a: ended("model_unavailable") }), rows: { a: [priced, zeroFeeFailed] } });
    await expect(run(dir, fresh.deps)).rejects.toThrow("loop_stage_failed_dispatch");
    expect(read(dir)).toMatchObject({ stopped: { stage: "a", failure: "loop_stage_failed_dispatch" }, resumes: [], totals: { modelCalls: 10 } });
    // An unfinished stage with a priced committed row, the call a dying process left in flight, is never resumed or moved.
    const committed = { status: "committed", destinationId: "cloud_coordinator", purpose: "research plan", reservedFeeMicrousd: 160_000 };
    const dying = (rows: Record<string, unknown>[]) => harness({ summaries: stages(), rows: { a: rows }, onRun: call => { if (call.outputDirectory.endsWith("/a")) { mkdirSync(call.outputDirectory, { recursive: true }); writeFileSync(join(call.outputDirectory, "freeze.json"), "{}"); throw new Error("driver_died"); } } });
    const dir2 = loopDir();
    await expect(run(dir2, dying([committed]).deps)).rejects.toThrow("loop_stage_unresolved_dispatch");
    expect(existsSync(join(dir2, "a"))).toBe(true); expect(read(dir2)).toMatchObject({ stopped: { stage: "a", failure: "loop_stage_unresolved_dispatch" } });
    await expect(run(dir2, harness({ summaries: stages(), rows: { a: [committed] } }).deps)).rejects.toThrow("loop_terminal");
    // A zero-fee committed row is admitted: sending equivalent work again costs nothing, and the rerun is a new job.
    const local = { status: "committed", destinationId: "owned_local_model", purpose: "agent reasoning and tool selection", reservedFeeMicrousd: 0 };
    const dir3 = loopDir();
    await expect(run(dir3, dying([local]).deps)).rejects.toThrow("loop_stage_infra");
    const resumed = harness({ summaries: stages(), rows: { a: [local] }, reruns: { a: summary({ jobId: "ja2" }) }, ledgers: (directory, ledger) => directory.endsWith("/a") && existsSync(join(directory, "..", "a.infra-1")) ? { ...ledger, dispatches: [] } : ledger });
    expect((await run(dir3, resumed.deps)).resumes).toEqual([expect.objectContaining({ stage: "a", cause: "run_unfinished", as: "rerun" })]);
  });
  it("recovers a stage's unreleased claims before moving it; a cleanup that fails leaves the stage in place and refuses resumably", async () => {
    const dir = loopDir();
    const summaries = stages(null, { a: ended("cleanup_required") });
    await expect(run(dir, harness({ summaries }).deps)).rejects.toThrow("loop_stage_infra");
    await expect(run(dir, harness({ summaries, recoverClaims: async () => { throw new Error("loop_stage_cleanup_required"); } }).deps)).rejects.toThrow("loop_stage_cleanup_required");
    expect(existsSync(join(dir, "a"))).toBe(true); expect(read(dir)).toMatchObject({ failure: "loop_stage_cleanup_required", stopped: null, resumes: [] });
    const confirmed = harness({ summaries, reruns: { a: summary({ jobId: "ja2" }) }, recoverClaims: async () => "confirmed" });
    expect((await run(dir, confirmed.deps)).resumes).toEqual([expect.objectContaining({ stage: "a", cause: "cleanup_required", cleanup: "confirmed" })]);
  });
  it("recovers claims through the store's own recovery path, writing only the claims table", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "soar-claims-"))); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const stage = (name: string) => {
      const directory = join(root, name); mkdirSync(directory);
      const database = new Database(join(directory, "state.sqlite")), store = new PrivateAgentStore(database);
      store.createJob({ version: 1, id: "job", mode: "private", revision: 0, cancelled: false, destinations: ["owned_local_model"], maxRequests: 10, maxFeeMicrousd: 0 });
      store.createContext({ id: "context", jobId: "job", sources: [{ id: "source", version: digest("synthetic"), classification: "private", synthetic: true }] });
      store.acquireRun("context", "dead-owner", "unix:///var/run/docker.sock", 999_999);
      database.close();
      return directory;
    };
    const claimsOf = (directory: string) => readRunLedger(directory).claims;
    const good = stage("good"), seen: unknown[] = [];
    expect(await recoverRunClaims(good, { freeze: { jobId: "job", sha256: h("1"), runtimeSha256: h("4"), startedAt: null, feeCapMicrousd: 0, localArm: true }, claims: claimsOf(good) },
      async input => { seen.push(input); })).toBe("confirmed");
    expect(seen).toEqual([{ endpoint: "unix:///var/run/docker.sock", jobId: "job", contextId: "context" }]); expect(claimsOf(good)).toEqual([expect.objectContaining({ state: "released" })]);
    const bad = stage("bad");
    await expect(recoverRunClaims(bad, { freeze: { jobId: "job", sha256: h("1"), runtimeSha256: h("4"), startedAt: null, feeCapMicrousd: 0, localArm: true }, claims: claimsOf(bad) },
      async () => { throw new Error("docker unavailable"); })).rejects.toThrow("loop_stage_cleanup_required");
    expect(claimsOf(bad)).toEqual([expect.objectContaining({ state: "cleanup_required" })]);
    expect(await recoverRunClaims(bad, { freeze: null, claims: [] })).toBe("not_needed");
  });
  it("holds the loop's lock for the whole invocation: a second invocation is refused and writes nothing; a stopped invocation releases it", async () => {
    const dir = loopDir(); mkdirSync(dir, { recursive: true });
    const held = acquireLoopLock(dir);
    await expect(run(dir, harness({ summaries: stages(), realLock: true }).deps)).rejects.toThrow("loop_locked");
    expect(readdirSync(dir).filter(name => !name.startsWith("loop.lock"))).toEqual([]);
    held.release();
    await expect(run(dir, harness({ summaries: stages(null, { a: ended("model_unavailable") }), realLock: true }).deps)).rejects.toThrow("loop_stage_infra");
    acquireLoopLock(dir).release();
    const corrupt = loopDir(); mkdirSync(corrupt, { recursive: true }); writeFileSync(join(corrupt, "loop.lock"), "not a database, and long enough to be read as one".repeat(4));
    await expect(run(corrupt, harness({ summaries: stages(), realLock: true }).deps)).rejects.toThrow("loop_locked");
  });
  it("completes a move a crash cut after its entry was saved, and refuses a directory or an identity the record does not explain", async () => {
    const setup = async () => {
      const dir = loopDir();
      await expect(run(dir, harness({ summaries: stages(null, { b: ended("model_unavailable") }) }).deps)).rejects.toThrow("loop_stage_infra");
      return dir;
    };
    const pending = (dir: string, identity: { inode: string; sha256: string | null; jobId: string | null }) => {
      const record = read(dir);
      record.resumes.push({ stage: "b", cause: "model_unavailable", as: "rerun", identity, counts: { ...zeroCounts, modelCalls: 10 }, span: { startedAt: "s", endedAt: "e" }, cleanup: "not_needed", at: "t" });
      record.begun = record.begun.filter(entry => entry.stage !== "b");
      writeFileSync(join(dir, "loop.json"), JSON.stringify(record));
    };
    const dir = await setup();
    pending(dir, { inode: directoryInode(join(dir, "b")), sha256: digest(readFileSync(join(dir, "b", "freeze.json"))), jobId: "jb" });
    const resumed = harness({ summaries: stages(null, { b: ended("model_unavailable") }), reruns: { b: summary({ jobId: "jb2", freezeSha256: h("d"), resultSha256: h("e") }) } });
    const record = await run(dir, resumed.deps);
    expect(readFileSync(join(dir, "log.txt"), "utf8")).toContain("b moved to b.infra-1 (completed)"); expect(ran(resumed.calls)).toEqual(["b", "repair"]);
    expect(record.resumes).toHaveLength(1); expect(record.totals.modelCalls).toBe(41);
    // An entry whose identity matches neither directory, or a moved directory with another freeze, refuses and leaves the record as it was.
    for (const identity of [{ inode: "1", sha256: null, jobId: "jb" }]) {
      const other = await setup(); pending(other, identity);
      const before = readFileSync(join(other, "loop.json"), "utf8");
      await expect(run(other, harness({ summaries: stages() }).deps)).rejects.toThrow("loop_resume_mismatch");
      expect(readFileSync(join(other, "loop.json"), "utf8")).toBe(before);
    }
    const tampered = await setup();
    pending(tampered, { inode: directoryInode(join(tampered, "b")), sha256: digest(readFileSync(join(tampered, "b", "freeze.json"))), jobId: "jb" });
    await run(tampered, harness({ summaries: stages(null, { b: ended("model_unavailable") }), reruns: { b: summary({ jobId: "jb2", freezeSha256: h("d"), resultSha256: h("e") }) } }).deps);
    writeFileSync(join(tampered, "b.infra-1", "freeze.json"), "{\"other\":true}");
    const record2 = read(tampered); record2.selected.final = null; writeFileSync(join(tampered, "loop.json"), JSON.stringify(record2));
    await expect(run(tampered, harness({ summaries: stages() }).deps)).rejects.toThrow("loop_resume_mismatch");
  });
  it("recovers a hot journal in place before reading a stage, and refuses a ledger it cannot read", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "soar-journal-"))); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const live = join(root, "live"), copy = join(root, "copy"); mkdirSync(live); mkdirSync(copy);
    // A process killed during a commit: the database's pages already spilled, the journal holding the originals, and no lock held.
    const database = new Database(join(live, "state.sqlite"));
    database.exec("CREATE TABLE private_agent_dispatches (value TEXT NOT NULL)");
    const insert = database.prepare("INSERT INTO private_agent_dispatches VALUES (?)");
    for (let i = 0; i < 20; i++) insert.run(JSON.stringify({ status: "settled", feeMicrousd: 0, n: i }));
    database.pragma("cache_size = 1"); database.exec("BEGIN IMMEDIATE");
    for (let i = 0; i < 400; i++) insert.run(JSON.stringify({ status: "committed", pad: "x".repeat(400) }));
    for (const name of readdirSync(live)) copyFileSync(join(live, name), join(copy, name));
    database.exec("ROLLBACK"); database.close();
    expect(existsSync(join(copy, "state.sqlite-journal"))).toBe(true);
    expect(() => readRunLedger(copy)).toThrow();
    recoverRunLedger(copy);
    expect(readRunLedger(copy).dispatches).toHaveLength(20); expect(existsSync(join(copy, "state.sqlite-journal"))).toBe(false);
    const broken = join(root, "broken"); mkdirSync(broken); writeFileSync(join(broken, "state.sqlite"), "not a database".repeat(100));
    expect(() => recoverRunLedger(broken)).toThrow("loop_stage_ledger_unreadable");
    const linked = join(root, "linked"); mkdirSync(linked); symlinkSync(join(copy, "state.sqlite"), join(linked, "state.sqlite"));
    expect(() => recoverRunLedger(linked)).toThrow("loop_stage_ledger_unreadable");
    expect(() => recoverRunLedger(join(root, "empty"))).not.toThrow();
  });
  it("stops for good when a resumed stage's run shows any priced row, counting it", async () => {
    const dir = loopDir(), summaries = stages(null, { a: ended("model_unavailable") });
    await expect(run(dir, harness({ summaries }).deps)).rejects.toThrow("loop_stage_infra");
    const spent = harness({ summaries, reruns: { a: summary({ jobId: "ja2" }) },
      ledgers: (directory, ledger) => directory.endsWith("/a") && existsSync(join(directory, "..", "a.infra-1")) ? { ...ledger, dispatches: [{ status: "settled", destinationId: "cloud_coordinator", reservedFeeMicrousd: 160_000, feeMicrousd: 1 }] } : ledger });
    await expect(run(dir, spent.deps)).rejects.toThrow("loop_resume_spent");
    expect(read(dir)).toMatchObject({ stopped: { stage: "a", failure: "loop_resume_spent" }, totals: { modelCalls: 20 } });
  });
  it("marks every key of the driver's input as spend-free or not, and fails closed on a key it does not know", () => {
    expect(rerunCannotSpend({ ...base(), outputDirectory: "a", pipeline: "research", publicRetrieval: true, researchFrom: "a.infra-1", repairFrom: "critique" })).toBe(true);
    expect(rerunCannotSpend({ ...base(), outputDirectory: "a", cloudArm })).toBe(false);
    expect(rerunCannotSpend({ ...base(), outputDirectory: "a", cloudArm: undefined })).toBe(true);
    expect(rerunCannotSpend({ ...base(), outputDirectory: "a", assistPolicy: { purposes: ["research plan assist"] } } as unknown as DriverInput)).toBe(false);
  });
  it("ends the loop with its draft when the critique or the repair stops for good after stage 1", async () => {
    // The critique's second infrastructure end: critique_failed, with its cause.
    const dir = loopDir();
    const failing = (code: string) => async (request: { outputDirectory: string }) => {
      mkdirSync(request.outputDirectory, { recursive: true }); writeFileSync(join(request.outputDirectory, "critique-failure.json"), JSON.stringify({ code, usage: { inputTokens: 300 }, feeMicrousd: 0 }));
      throw Object.assign(new Error(code), { usage: { inputTokens: 300 }, feeMicrousd: 0 });
    };
    await expect(run(dir, harness({ summaries: stages(), critique: failing("request_failed") as never }).deps)).rejects.toThrow("loop_stage_infra");
    expect(read(dir).totals.modelCalls).toBe(21);
    const second = await run(dir, harness({ summaries: stages(), critique: failing("request_failed") as never }).deps);
    expect(second.selected.final).toEqual({ candidate: "a", step: "critique_failed", cause: "request_failed" });
    expect(second.resumes).toEqual([expect.objectContaining({ stage: "critique", cause: "request_failed" })]); expect(second.totals.modelCalls).toBe(22);
    // The repair cut twice: repair_failed, the draft delivered, the cause the operator's stop.
    const dir2 = loopDir(), cut = stages(null, { repair: ended("cancelled_or_deadline") });
    for (let attempt = 0; attempt < 2; attempt++) {
      const abort = new AbortController();
      await expect(run(dir2, harness({ summaries: cut, onRun: call => { if (call.outputDirectory.endsWith("/repair")) abort.abort(); } }).deps, {}, abort.signal)).rejects.toThrow("loop_interrupted");
    }
    const ended_ = await run(dir2, harness({ summaries: cut }).deps);
    expect(ended_.selected.final).toEqual({ candidate: "a", step: "repair_failed", cause: "operator_stop" }); expect(loopExitCode(ended_)).toBe(2);
    expect(ended_).toMatchObject({ failure: "loop_stage_interrupted", failedStage: "repair", stopped: null });
  });
  it("closes a loop at a resumable stop with every run's spend, after which the loop is terminal", async () => {
    const closeDeps = () => closing(harness({ summaries: stages(null, { a: ended("model_unavailable") }) }).deps);
    const dir = loopDir();
    await expect(run(dir, harness({ summaries: stages(null, { a: ended("model_unavailable") }) }).deps)).rejects.toThrow("loop_stage_infra");
    const closed = await closeLoop(dir, closeDeps());
    expect(closed).toMatchObject({ stopped: { stage: "a", failure: "loop_stage_infra", closed: true }, closed: true, totals: { modelCalls: 10 } });
    await expect(run(dir, harness({ summaries: stages() }).deps)).rejects.toThrow("loop_terminal");
    await expect(closeLoop(dir, closeDeps())).rejects.toThrow("loop_terminal");
    // After stage 1, closing ends the loop with its draft.
    const dir2 = loopDir();
    await expect(run(dir2, harness({ summaries: stages(null, { repair: ended("model_unavailable") }) }).deps)).rejects.toThrow("loop_stage_infra");
    const closed2 = await closeLoop(dir2, { ...closeDeps(), readRunEnd: harness({ summaries: stages(null, { repair: ended("model_unavailable") }) }).deps.readRunEnd });
    expect(closed2.selected.final).toEqual({ candidate: "a", step: "repair_failed", cause: "model_unavailable" }); expect(closed2).toMatchObject({ stopped: null, closed: true });
    // A stray directory is recorded as the failure, and the loop is still closed.
    const dir3 = loopDir();
    await expect(run(dir3, harness({ summaries: stages(null, { a: ended("model_unavailable") }) }).deps)).rejects.toThrow("loop_stage_infra");
    mkdirSync(join(dir3, "stray"));
    expect((await closeLoop(dir3, closeDeps())).stopped).toEqual({ stage: "a", failure: "loop_resume_mismatch", closed: true });
    await expect(closeLoop(loopDir(), closeDeps())).rejects.toThrow("loop_record_missing");
  });
});

/** A critique tool that writes its failure record, as phase2-repair.ts does, and throws its code with the call's usage. */
const critiqueFailing = (code: string, usage: Record<string, number> | null = { inputTokens: 300 }) => (async (request: { outputDirectory: string }) => {
  mkdirSync(request.outputDirectory, { recursive: true }); writeFileSync(join(request.outputDirectory, "critique-failure.json"), JSON.stringify({ code, usage, feeMicrousd: 0 }));
  throw Object.assign(new Error(code), { usage, feeMicrousd: 0 });
}) as unknown as LoopDependencies["critique"];
/** A driver that freezes its run and then throws, as a run cut after its session started. */
const freezesThenThrows = (stage: string, message = "driver_died") => (call: DriverInput) => {
  if (!call.outputDirectory.endsWith(`/${stage}`)) return;
  mkdirSync(call.outputDirectory, { recursive: true }); writeFileSync(join(call.outputDirectory, "freeze.json"), "{}"); throw new Error(message);
};

describe("part 3b after its code review: spans, carried counts, driver throws, critique resumes and --close", () => {
  it("spans a resumed stage by the times it ran, never the wait between invocations, and an unrecorded run by its ledger", async () => {
    const dir = loopDir(), summaries = stages(null, { a: ended("model_unavailable") });
    await expect(run(dir, harness({ summaries }).deps)).rejects.toThrow("loop_stage_infra");
    const ranAt = read(dir).stages.find(entry => entry.stage === "a")!;
    const record = await run(dir, harness({ summaries, reruns: { a: summary({ jobId: "ja2" }) }, minute: 30 }).deps);
    expect(record.resumes[0]!.span).toEqual({ startedAt: ranAt.startedAt, endedAt: ranAt.finishedAt });
    expect(record.resumes[0]!.span.endedAt.startsWith("2026-11-10T08:00:")).toBe(true);
    // A run cut before the loop recorded its end: its freeze's start to its last commit, else to its result's end.
    for (const [over, endedAt] of [[{ lastCommittedAt: Date.parse("2026-11-10T07:05:00.000Z") }, "2026-11-10T07:05:00.000Z"],
      [{ lastCommittedAt: null, finishedAt: "2026-11-10T07:09:00.000Z" }, "2026-11-10T07:09:00.000Z"], [{ lastCommittedAt: Date.parse("2026-11-10T06:00:00.000Z") }, "2026-11-10T07:00:00.000Z"]] as const) {
      const cut = loopDir();
      const ledgers = (directory: string, ledger: RunLedger) => ledger.freeze ? { ...ledger, ...over, freeze: { ...ledger.freeze, startedAt: "2026-11-10T07:00:00.000Z" } } : ledger;
      await expect(run(cut, harness({ summaries: stages(), onRun: freezesThenThrows("a"), ledgers }).deps)).rejects.toThrow("loop_stage_infra");
      expect(read(cut).stages).toEqual([]);
      const resumed = await run(cut, harness({ summaries: stages(), reruns: { a: summary({ jobId: "ja2" }) }, ledgers, minute: 30 }).deps);
      expect(resumed.resumes[0]!.span).toEqual({ startedAt: "2026-11-10T07:00:00.000Z", endedAt });
    }
  });
  it("keeps every count an earlier invocation saved until its stage is reused, moved or held, so an early stop lowers no total", async () => {
    const dir = loopDir(), summaries = stages(null, { b: ended("model_unavailable") });
    await expect(run(dir, harness({ summaries }).deps)).rejects.toThrow("loop_stage_infra");
    expect(read(dir)).toMatchObject({ totals: { modelCalls: 20 }, held: { stage: "b", counts: expect.objectContaining({ modelCalls: 10 }) }, candidates: { b: null } });
    // The next invocation cannot read a's ledger: it stops before reusing a, and its record still counts a and the held b.
    const unreadable = (directory: string, ledger: RunLedger) => { if (directory.endsWith("/a")) throw new Error("run_ledger_missing"); return ledger; };
    await expect(run(dir, harness({ summaries, ledgers: unreadable }).deps)).rejects.toThrow("loop_stage_ledger_unreadable");
    expect(read(dir)).toMatchObject({ failure: "loop_stage_ledger_unreadable", failedStage: "a", stopped: null, totals: { modelCalls: 20 }, candidates: { a: expect.objectContaining({ jobId: "ja" }) } });
    // Resumed: b moves aside, its entry counts it, and nothing is counted twice.
    const record = await run(dir, harness({ summaries, reruns: { b: summary({ jobId: "jb2", freezeSha256: h("d"), resultSha256: h("e") }) } }).deps);
    expect(record).toMatchObject({ held: null, totals: { modelCalls: 41 } });
    // A malformed carried count refuses the resume.
    const tampered = loopDir();
    await expect(run(tampered, harness({ summaries }).deps)).rejects.toThrow("loop_stage_infra");
    const saved = read(tampered); (saved.candidates.a as unknown as Record<string, unknown>).modelCalls = "10"; writeFileSync(join(tampered, "loop.json"), JSON.stringify(saved));
    await expect(run(tampered, harness({ summaries }).deps)).rejects.toThrow("loop_record_mismatch");
  });
  it("examines a run whose driver threw after its freeze: an unfinished local stage is deferred with its spend held, then resumed", async () => {
    const dir = loopDir();
    await expect(run(dir, harness({ summaries: stages(), onRun: freezesThenThrows("b", "sandbox failed at /private/var/run") }).deps)).rejects.toThrow("loop_stage_infra");
    expect(read(dir)).toMatchObject({ failure: "loop_stage_infra", failedStage: "b", stopped: null, totals: { modelCalls: 20 } });
    expect(readFileSync(join(dir, "errors.txt"), "utf8")).toContain("loop_stage_failed Error: sandbox failed");
    expect(readFileSync(join(dir, "log.txt"), "utf8")).not.toContain("/private/var/run");
    const resumed = harness({ summaries: stages(), reruns: { b: summary({ jobId: "jb2", freezeSha256: h("d"), resultSha256: h("e") }) } });
    const record = await run(dir, resumed.deps);
    expect(record.resumes).toEqual([expect.objectContaining({ stage: "b", cause: "run_unfinished", as: "rerun" })]); expect(ran(resumed.calls)).toEqual(["b", "repair"]);
    // A driver that threw before it froze anything keeps its own refusal.
    await expect(run(loopDir(), harness({ summaries: stages(), onRun: () => { throw new Error("local_screen_serving_card_refused"); } }).deps)).rejects.toThrow("local_screen_serving_card_refused");
  });
  it("reads a result it cannot parse as a run that did not finish, and resumes it", async () => {
    const dir = loopDir(), torn = (directory: string) => directory.endsWith("/a") && !existsSync(join(directory, "..", "a.infra-1"));
    await expect(run(dir, harness({ summaries: stages(), endFails: torn }).deps)).rejects.toThrow("loop_stage_infra");
    const second = harness({ summaries: stages(), endFails: torn, reruns: { a: summary({ jobId: "ja2" }) } });
    expect((await run(dir, second.deps)).resumes).toEqual([expect.objectContaining({ stage: "a", cause: "run_unfinished", as: "rerun" })]);
  });
  it("resumes an unfinished cloud-armed a whose reading stage completed as a seeded writer, and a local research a without a packet as a rerun", async () => {
    const dir = loopDir();
    await expect(run(dir, harness({ summaries: stages(), transfers: ["a"], onRun: freezesThenThrows("a") }).deps, { pipeline: "research", cloudArm })).rejects.toThrow("loop_stage_infra");
    const seed = { sourceJobId: "ja", snapshotSha256: h("f"), sourceFreezeSha256: digest(readFileSync(join(dir, "a", "freeze.json"))) };
    const second = harness({ summaries: stages(seed), transfers: ["a", "a.infra-1"], reruns: { a: summary({ jobId: "ja2", researchFrom: seed }) } });
    const record = await run(dir, second.deps, { pipeline: "research", cloudArm });
    expect(record.resumes).toEqual([expect.objectContaining({ stage: "a", cause: "run_unfinished", as: "seeded_writer" })]);
    expect(second.calls.runs[0]).toMatchObject({ researchFrom: join(dir, "a.infra-1") }); expect(second.calls.runs[0]!.cloudArm).toBeUndefined();
    // A local research a that ended on infrastructure before its packet: its reading stage costs nothing, so it is run again.
    const dir2 = loopDir(), transfers: string[] = [];
    await expect(run(dir2, harness({ summaries: stages(null, { a: ended("model_unavailable") }), transfers }).deps, { pipeline: "research" })).rejects.toThrow("loop_stage_infra");
    const local = harness({ summaries: stages({ sourceJobId: "ja2", snapshotSha256: h("f") }, { a: ended("model_unavailable") }), transfers, reruns: { a: summary({ jobId: "ja2" }) },
      onWritten: written => { if (written.outputDirectory.endsWith("/a")) transfers.push("a"); } });
    const record2 = await run(dir2, local.deps, { pipeline: "research" });
    expect(record2.resumes).toEqual([expect.objectContaining({ stage: "a", cause: "model_unavailable", as: "rerun" })]); expect(local.calls.runs[0]).toMatchObject({ pipeline: "research" });
    expect(record2.seeded).toEqual({ a: false, b: true, repair: true, snapshotSha256: h("f") }); expect(record2.selected.final).toMatchObject({ candidate: "a" });
  });
  it("resumes a critique the loop's interrupt cancelled at its token admission, and runs again one stopped while its draft was rendered", async () => {
    const dir = loopDir(), abort = new AbortController();
    const admission = (async (request: { outputDirectory: string }) => {
      mkdirSync(request.outputDirectory, { recursive: true }); abort.abort();
      writeFileSync(join(request.outputDirectory, "critique-failure.json"), JSON.stringify({ code: "local_token_admission_cancelled", usage: null, feeMicrousd: null }));
      throw new Error("local_token_admission_cancelled");
    }) as unknown as LoopDependencies["critique"];
    await expect(run(dir, harness({ summaries: stages(), critique: admission }).deps, {}, abort.signal)).rejects.toThrow("loop_interrupted");
    const resumed = harness({ summaries: stages() });
    const record = await run(dir, resumed.deps);
    expect(record.resumes).toEqual([expect.objectContaining({ stage: "critique", cause: "operator_stop", as: "rerun" })]); expect(resumed.calls.critiques).toBe(1);
    expect(record.selected.final).toMatchObject({ candidate: "a" });
    // The critique tool stops before its directory exists when the interrupt fires while it renders the draft: the critique leaves begun.
    const dir2 = loopDir(), abort2 = new AbortController();
    const rendering = (async () => { abort2.abort(); throw new Error("request_cancelled"); }) as unknown as LoopDependencies["critique"];
    await expect(run(dir2, harness({ summaries: stages(), critique: rendering }).deps, {}, abort2.signal)).rejects.toThrow("loop_interrupted");
    expect(read(dir2).begun.map(entry => entry.stage)).toEqual(["a", "b"]); expect(existsSync(join(dir2, "critique"))).toBe(false);
    const again = harness({ summaries: stages() });
    expect((await run(dir2, again.deps)).selected.final).toMatchObject({ candidate: "a" }); expect(again.calls.critiques).toBe(1);
  });
  it("stops for good when a resumed critique that failed shows a priced row, counting its call", async () => {
    const dir = loopDir();
    await expect(run(dir, harness({ summaries: stages(), critique: critiqueFailing("request_failed") }).deps)).rejects.toThrow("loop_stage_infra");
    const priced = [{ status: "settled", destinationId: "cloud_critic", reservedFeeMicrousd: 5, feeMicrousd: 5 }];
    await expect(run(dir, harness({ summaries: stages(), critique: critiqueFailing("request_failed"), rows: { critique: priced } }).deps)).rejects.toThrow("loop_resume_spent");
    expect(read(dir)).toMatchObject({ stopped: { stage: "critique", failure: "loop_resume_spent" }, held: { stage: "critique" }, totals: { modelCalls: 22 } });
  });
  it("closes a loop cut during its critique after stage 1 with the mark's class, and at a repair start that froze nothing as the task's", async () => {
    const dir = loopDir(), abort = new AbortController();
    const cancelled = (async (request: { outputDirectory: string }) => {
      mkdirSync(request.outputDirectory, { recursive: true }); abort.abort();
      writeFileSync(join(request.outputDirectory, "critique-failure.json"), JSON.stringify({ code: "request_cancelled", usage: null, feeMicrousd: null }));
      throw new Error("request_cancelled");
    }) as unknown as LoopDependencies["critique"];
    await expect(run(dir, harness({ summaries: stages(), critique: cancelled }).deps, {}, abort.signal)).rejects.toThrow("loop_interrupted");
    expect(read(dir)).toMatchObject({ failedStage: "critique", stages: expect.arrayContaining([expect.objectContaining({ stage: "critique", interrupted: true })]) });
    const closed = await closeLoop(dir, closing(harness({ summaries: stages() }).deps));
    // The critique's record keeps the critique's own code, as a critique that failed in the loop records it.
    expect(closed).toMatchObject({ selected: { final: { candidate: "a", step: "critique_failed", cause: "operator_stop" } }, closed: true, stopped: null,
      critique: { failure: "request_cancelled", modelCalls: 0 }, failure: "loop_interrupted", totals: { modelCalls: 20 } });
    expect(loopExitCode(closed)).toBe(2);
    const dir2 = loopDir();
    const refusing = harness({ summaries: stages(), onRun: call => { if (call.outputDirectory.endsWith("/repair")) { mkdirSync(call.outputDirectory, { recursive: true }); throw new Error("local_screen_serving_card_refused"); } } });
    await expect(run(dir2, refusing.deps)).rejects.toThrow("local_screen_serving_card_refused");
    const closed2 = await closeLoop(dir2, closing(harness({ summaries: stages() }).deps));
    expect(closed2.selected.final).toEqual({ candidate: "a", step: "repair_failed", cause: "task" }); expect(closed2.closed).toBe(true);
    // An integrity stop the close itself finds is never converted into a final selection.
    const dir3 = loopDir();
    await expect(run(dir3, harness({ summaries: stages(null, { repair: ended("model_unavailable") }) }).deps)).rejects.toThrow("loop_stage_infra");
    mkdirSync(join(dir3, "stray"));
    expect(await closeLoop(dir3, closing(harness({ summaries: stages() }).deps))).toMatchObject({ stopped: { stage: "repair", failure: "loop_resume_mismatch", closed: true }, closed: true, selected: { final: null } });
  });
  it("wires part 3b's production helpers, and parses --close", () => {
    const deps = ledgerDependencies();
    expect(deps.readLedger).toBe(readRunLedger); expect(deps.readRunEnd).toBe(readRunEndEvidence); expect(deps.recoverLedger).toBe(recoverRunLedger); expect(deps.lock).toBe(acquireLoopLock);
    const production = productionDependencies({ base: base(), loopDirectory: "loop" });
    for (const key of ["readLedger", "readRunEnd", "recoverLedger", "lock"] as const) expect(production[key]).toBe(deps[key]);
    expect(parseCloseArguments(["--close", "--loop-directory", "loop"])).toBe("loop");
    for (const args of [["--close"], ["--close", "--loop-directory"], ["--close", "--loop-directory", "loop", "--x"], ["--loop-directory", "loop", "--close"], ["--close", "--loop-directory", ""]]) {
      expect(() => parseCloseArguments(args)).toThrow("loop_cli_invalid");
    }
  });
});

describe("part 3b after the review of its fixes: --close's stage and critique, and the critique tool's records", () => {
  it("closes at the last begun stage the loop had not accepted when a hard kill recorded none, a torn or unexamined result included", async () => {
    for (const torn of [true, false]) {
      const dir = loopDir(), summaries = stages(null, { a: ended("model_unavailable") });
      await expect(run(dir, harness({ summaries }).deps)).rejects.toThrow("loop_stage_infra");
      // A process killed while it wrote a's result, or before it examined it: the catch that records the stage never ran.
      const killed = read(dir); killed.failure = null; killed.failedStage = null; killed.held = null; writeFileSync(join(dir, "loop.json"), JSON.stringify(killed));
      const deps = harness({ summaries, endFails: () => torn }).deps;
      expect(await closeLoop(dir, closing(deps)), `torn ${torn}`).toMatchObject({ stopped: { stage: "a", failure: "loop_closed", closed: true }, failedStage: "a", totals: { modelCalls: 10 } });
    }
  });
  it("closes a loop whose critique answered before the loop recorded it at the repair, keeping the answer, and one whose critique failed with the critique's own code", async () => {
    const dir = loopDir(), abort = new AbortController();
    const answering = harness({ summaries: stages() });
    const answer = answering.deps.critique;
    answering.deps.critique = async (request, control) => { const reply = await answer(request, control); abort.abort(); return reply; };
    await expect(run(dir, answering.deps, {}, abort.signal)).rejects.toThrow("loop_interrupted");
    expect(read(dir)).toMatchObject({ failedStage: "critique", critique: null, held: { stage: "critique" }, totals: { modelCalls: 21 } });
    const closed = await closeLoop(dir, closing(harness({ summaries: stages() }).deps));
    expect(closed).toMatchObject({ selected: { final: { candidate: "a", step: "repair_failed", cause: "operator_stop" } }, critique: { critiqueSha256: h("e"), modelCalls: 1 }, totals: { modelCalls: 21 } });
    expect(closed.critique).not.toHaveProperty("failure");
    const dir2 = loopDir();
    await expect(run(dir2, harness({ summaries: stages(), critique: critiqueFailing("request_failed") }).deps)).rejects.toThrow("loop_stage_infra");
    expect(await closeLoop(dir2, closing(harness({ summaries: stages() }).deps))).toMatchObject({ selected: { final: { step: "critique_failed", cause: "request_failed" } },
      critique: { failure: "request_failed", modelCalls: 1 }, failure: "loop_stage_infra", totals: { modelCalls: 21 } });
  });
  it("reads the critique tool's records strictly: a code, never a message; null, a byte-order mark or a link is no record", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "soar-critique-records-"))); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const deps = ledgerDependencies();
    const failureIn = (name: string, text: string) => { const dir = join(root, name); mkdirSync(dir); writeFileSync(join(dir, "critique-failure.json"), text); return dir; };
    expect(deps.readCritiqueFailure(failureIn("message", JSON.stringify({ code: "ECONNRESET: socket hang up reading /Users/someone/state.sqlite", usage: { inputTokens: 3 }, feeMicrousd: 2 }))))
      .toEqual({ code: "repair_critique_failed", usage: { inputTokens: 3 }, feeMicrousd: 2, finishReason: null });
    expect(deps.readCritiqueFailure(failureIn("code", JSON.stringify({ code: "request_failed", usage: null, feeMicrousd: -5 })))).toEqual({ code: "request_failed", usage: null, feeMicrousd: 0, finishReason: null });
    for (const [name, text] of [["null", "null"], ["bom", `\ufeff${JSON.stringify({ code: "request_failed" })}`], ["torn", "{\"code\": \"req"]]) {
      expect(deps.readCritiqueFailure(failureIn(name, text)), name).toEqual({ code: null, usage: null, feeMicrousd: 0, finishReason: null });
    }
    const linked = join(root, "linked"); mkdirSync(linked); symlinkSync(join(root, "code", "critique-failure.json"), join(linked, "critique-failure.json"));
    expect(deps.readCritiqueFailure(linked)).toEqual({ code: null, usage: null, feeMicrousd: 0, finishReason: null });
    expect(deps.readCritiqueFailure(join(root, "message", ".."))).toBeNull();
    const answered = join(root, "answered"); mkdirSync(answered); writeFileSync(join(answered, "critique.json"), `\ufeff${JSON.stringify({ packetSha256: h("d"), critiqueSha256: h("e") })}`);
    expect(() => deps.readCritique(answered)).toThrow("loop_critique_unreadable");
    // A result led by a byte-order mark is no result, in the loop's reader as in the registry's.
    const run_ = join(root, "run"); mkdirSync(run_); writeFileSync(join(run_, "result.json"), `\ufeff${JSON.stringify({ status: "submitted", reason: "x", finishedAt: "t" })}`);
    expect(() => readRunEndEvidence(run_)).toThrow("run_result_unreadable");
  });
  it("resumes a torn critique record as a critique that did not finish, and a record saved before `held` existed", async () => {
    const dir = loopDir(), abort = new AbortController();
    const tearing = (async (request: { outputDirectory: string }) => {
      mkdirSync(request.outputDirectory, { recursive: true }); writeFileSync(join(request.outputDirectory, "critique.json"), "{\"packetSha256\": \"dd"); abort.abort();
      throw new Error("request_cancelled");
    }) as unknown as LoopDependencies["critique"];
    await expect(run(dir, harness({ summaries: stages(), critique: tearing }).deps, {}, abort.signal)).rejects.toThrow("loop_interrupted");
    const older = read(dir) as unknown as Record<string, unknown>; delete older.held; writeFileSync(join(dir, "loop.json"), JSON.stringify(older));
    const resumed = harness({ summaries: stages() });
    resumed.deps.readCritique = ledgerDependencies().readCritique;
    const record = await run(dir, resumed.deps);
    expect(record.resumes).toEqual([expect.objectContaining({ stage: "critique", cause: "operator_stop" })]); expect(record.selected.final).toMatchObject({ candidate: "a" });
  });
});

