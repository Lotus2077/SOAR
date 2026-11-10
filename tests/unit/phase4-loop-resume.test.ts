import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { digest } from "../../src/main/private-agent/contracts";
import { acquireLoopLock, directoryInode, recoverRunClaims, recoverRunLedger } from "../../src/main/private-agent/loop-ledger";
import { readRunLedger, type CandidateSummary, type RunLedger } from "../../src/main/private-agent/selection";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { LOOP_VERSION, closeLoop, loopExitCode, rerunCannotSpend, runSelectionLoop, type DriverInput, type LoopDependencies, type LoopInput, type LoopRecord } from "../../scripts/phase4-loop";

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
  recoverClaims?: LoopDependencies["recoverClaims"]; ledgers?: (directory: string, ledger: RunLedger) => RunLedger }
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
      const found_ = found(directory)!, rows = input.rows?.[nameOf(directory)] ?? [];
      return { status: found_.status, reason: found_.reason, stageDenied: found_.stageDenied, failingCall: [...rows].reverse().find(row => row.status === "failed") ?? null,
        uncertainCall: [...rows].reverse().find(row => row.status === "unknown") ?? null, runtimeBrokerCode: null, captureFailure: null, verificationFailure: null, tokenAdmissionCode: null, brokerDenialCode: null };
    },
    readLedger: directory => {
      const found_ = found(directory), name = nameOf(directory);
      const freeze = existsSync(join(directory, "freeze.json")) && found_ ? { jobId: found_.jobId, sha256: digest(readFileSync(join(directory, "freeze.json"))), runtimeSha256: found_.runtimeSha256,
        startedAt: found_.startedAt, feeCapMicrousd: 0, localArm: true } : null;
      const ledger: RunLedger = { freeze, dispatches: input.rows?.[name] ?? [], claims: [], counts: { ...zeroCounts, modelCalls: found_?.modelCalls ?? 0, toolCalls: found_?.toolCalls ?? 0 }, lastCommittedAt: null };
      return input.ledgers ? input.ledgers(directory, ledger) : ledger;
    },
    recoverLedger: directory => recoverRunLedger(directory),
    recoverClaims: input.recoverClaims ?? (async () => "not_needed"),
    lock: input.realLock ? acquireLoopLock : () => ({ release() { /* one invocation at a time */ } }),
    transferStatus: directory => (input.transfers ?? []).includes(nameOf(directory)) ? { snapshotSha256: h("f"), code: null } : { snapshotSha256: null, code: "research_seed_no_transfer" },
    deliverables: () => ["output/report.md"],
    now: () => `2026-11-10T08:00:${String(tick++ % 60).padStart(2, "0")}.000Z`,
    runtimeSha256: () => h("4"),
  };
  return { deps, calls };
}
function loopDir() { const dir = realpathSync(mkdtempSync(join(tmpdir(), "soar-resume-"))); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return join(dir, "loop"); }
const read = (dir: string) => JSON.parse(readFileSync(join(dir, "loop.json"), "utf8")) as LoopRecord;
const ran = (calls: { runs: DriverInput[] }) => calls.runs.map(run => run.outputDirectory.split("/").pop());
const run = (dir: string, deps: LoopDependencies, over: Partial<DriverInput> = {}, signal?: AbortSignal) => runSelectionLoop({ base: base(over), loopDirectory: dir }, deps, signal ? { signal } : {});

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
    // Unfinished: the driver died after its session started.
    const dir = loopDir();
    const dying = harness({ summaries: stages(), onRun: call => { mkdirSync(call.outputDirectory, { recursive: true }); writeFileSync(join(call.outputDirectory, "freeze.json"), "{}"); throw new Error("driver_died"); } });
    await expect(run(dir, dying.deps, { pipeline: "research", cloudArm })).rejects.toThrow("driver_died");
    const after = harness({ summaries: stages() });
    await expect(run(dir, after.deps, { pipeline: "research", cloudArm })).rejects.toThrow("loop_stage_incomplete");
    expect(after.calls.runs).toHaveLength(0); expect(read(dir)).toMatchObject({ stopped: { stage: "a", failure: "loop_stage_incomplete" }, resumes: [] });
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
    await expect(run(dir2, dying([committed]).deps)).rejects.toThrow("driver_died");
    await expect(run(dir2, harness({ summaries: stages(), rows: { a: [committed] } }).deps)).rejects.toThrow("loop_stage_unresolved_dispatch");
    expect(existsSync(join(dir2, "a"))).toBe(true); expect(read(dir2)).toMatchObject({ stopped: { stage: "a", failure: "loop_stage_unresolved_dispatch" } });
    // A zero-fee committed row is admitted: sending equivalent work again costs nothing, and the rerun is a new job.
    const local = { status: "committed", destinationId: "owned_local_model", purpose: "agent reasoning and tool selection", reservedFeeMicrousd: 0 };
    const dir3 = loopDir();
    await expect(run(dir3, dying([local]).deps)).rejects.toThrow("driver_died");
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
    const closeDeps = () => { const { deps } = harness({ summaries: stages(null, { a: ended("model_unavailable") }) }); return { lock: deps.lock, recoverLedger: deps.recoverLedger, readLedger: deps.readLedger, readRunEnd: deps.readRunEnd, readCritiqueFailure: deps.readCritiqueFailure, now: deps.now }; };
    const dir = loopDir();
    await expect(run(dir, harness({ summaries: stages(null, { a: ended("model_unavailable") }) }).deps)).rejects.toThrow("loop_stage_infra");
    const closed = await closeLoop(dir, closeDeps());
    expect(closed).toMatchObject({ stopped: { stage: "a", failure: "loop_stage_infra", closed: true }, totals: { modelCalls: 10 } });
    await expect(run(dir, harness({ summaries: stages() }).deps)).rejects.toThrow("loop_terminal");
    await expect(closeLoop(dir, closeDeps())).rejects.toThrow("loop_terminal");
    // After stage 1, closing ends the loop with its draft.
    const dir2 = loopDir();
    await expect(run(dir2, harness({ summaries: stages(null, { repair: ended("model_unavailable") }) }).deps)).rejects.toThrow("loop_stage_infra");
    const closed2 = await closeLoop(dir2, { ...closeDeps(), readRunEnd: harness({ summaries: stages(null, { repair: ended("model_unavailable") }) }).deps.readRunEnd });
    expect(closed2.selected.final).toEqual({ candidate: "a", step: "repair_failed", cause: "model_unavailable" }); expect(closed2.stopped).toBeNull();
    // A stray directory is recorded as the failure, and the loop is still closed.
    const dir3 = loopDir();
    await expect(run(dir3, harness({ summaries: stages(null, { a: ended("model_unavailable") }) }).deps)).rejects.toThrow("loop_stage_infra");
    mkdirSync(join(dir3, "stray"));
    expect((await closeLoop(dir3, closeDeps())).stopped).toEqual({ stage: "a", failure: "loop_resume_mismatch", closed: true });
    await expect(closeLoop(loopDir(), closeDeps())).rejects.toThrow("loop_record_missing");
  });
});
