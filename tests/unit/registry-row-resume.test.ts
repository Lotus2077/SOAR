import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { acquireLoopLock } from "../../src/main/private-agent/loop-ledger";
import { readRunLedger } from "../../src/main/private-agent/selection";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

/**
 * Backlog item 11, part 3b (BL-20261110-0637-infra-resume-design, decisions (9) and (10)): a loop row of version 1 or 2 sums every
 * run the loop made, names its cloud stage through `stage_run`, and rows a loop that ended without a selection by its stop's class.
 */
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "registry-row.py");
const h = (n: string) => n.repeat(64);
const COMMIT = "a".repeat(40);
function scratch() { const dir = realpathSync(mkdtempSync(join(tmpdir(), "soar-resume-row-"))); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }
const time = (minute: number) => `2026-11-10T10:${String(minute).padStart(2, "0")}:00.000Z`;
const zeroFee = { status: "failed", destinationId: "owned_local_model", purpose: "agent reasoning and tool selection", reservedFeeMicrousd: 0, failure: { phase: "transport", code: "request_timeout" } };
const cloudSettled = { status: "settled", destinationId: "cloud_coordinator", purpose: "research plan", reservedFeeMicrousd: 160_000, feeMicrousd: 120_000 };
interface Run { status?: string; reason?: string; result?: boolean; freeze?: boolean | string; calls?: number; dispatches?: Record<string, unknown>[]; events?: Record<string, unknown>[];
  start?: number; end?: number; arm?: Record<string, unknown>; jobId?: string; task?: string; git?: boolean; claim?: boolean }
/** A run directory as the driver leaves one: its freeze, its result unless it died first, and its ledger's events and rows. */
function runDirectory(root: string, name: string, input: Run = {}) {
  const dir = join(root, name); mkdirSync(dir, { recursive: true });
  const jobId = input.jobId ?? `job-${name.replace(/[^A-Za-z0-9_-]/gu, "-")}`, dispatches = input.dispatches ?? [];
  if (input.freeze !== false) writeFileSync(join(dir, "freeze.json"), typeof input.freeze === "string" ? input.freeze : `${canonical({ version: 1, jobId, startedAt: time(input.start ?? 0),
    sourceFreezeSha256: h("4"), taskBinding: { jobSha256: input.task ?? h("1"), briefSha256: h("2") }, profile: "heavy", modelConfig: { maxOutputTokens: 16384, thinking: "medium" },
    limits: { feeMicrousd: input.arm ? 600_000 : 0 }, arm: input.arm ?? { arm: "local" }, ...(input.git ? { git: { commit: COMMIT, dirty: false } } : {}) })}\n`);
  if (input.result !== false) writeFileSync(join(dir, "result.json"), `${canonical({ status: input.status ?? "submitted", reason: input.reason ?? "independent_acceptance_pending",
    finishedAt: time(input.end ?? 5), snapshotSha256: h("7"), candidateFiles: [], dispatches: dispatches.map(row => ({ ...row, jobId })) })}\n`);
  const db = new Database(join(dir, "state.sqlite")), store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["owned_local_model"], maxRequests: 50, maxFeeMicrousd: 0 });
  store.append(jobId, { type: "session_started", identity: h("3"), startedAt: 1, privateContextId: "p", publicContextId: "q" });
  for (let i = 0; i < (input.calls ?? 1); i++) store.append(jobId, { type: "model_finished", contextId: "p", operationId: `o${i}`, usage: { inputTokens: 100, outputTokens: 10 }, finishReason: "stop" });
  for (const event of input.events ?? []) store.append(jobId, event as never);
  dispatches.forEach((row, i) => db.prepare("INSERT INTO private_agent_dispatches VALUES (?, ?, ?)").run(`d${i}`, jobId, canonical({ ...row, jobId, committedAt: 1_000 + i })));
  if (input.claim) {
    store.createContext({ id: "context", jobId, sources: [{ id: "source", version: digest("synthetic"), classification: "private", synthetic: true }] });
    store.acquireRun("context", "owner", "unix:///var/run/docker.sock", 999_999);
  }
  db.close();
  return dir;
}
const span = (start: number, end: number) => ({ startedAt: time(start), finishedAt: time(end) });
const counts = { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, lengthStops: 0, feeMicrousd: 0, unknownDispatches: 0, retriedDispatches: 0,
  failedDispatches: 0, zeroFeeFailedDispatches: 0, assistSkippedDispatches: 0, assistFailedDispatches: 0 };
/** A version-2 loop record, as scripts/phase4-loop.ts saves one. */
function loopRecord(root: string, over: Record<string, unknown>) {
  writeFileSync(join(root, "loop.json"), `${canonical({ version: 2, selectionRule: 2, startedAt: time(0), finishedAt: time(40), task: { jobSha256: h("1"), briefSha256: h("2") }, runtimeSha256: h("4"),
    arm: "local", pipeline: null, stages: [], begun: [], resumes: [], voids: [], candidates: { a: null, b: null, repair: null }, seeded: { a: false, b: false, repair: false, snapshotSha256: null },
    writeIdentityEqual: null, critique: null, selected: { stage1: null, final: null }, totals: counts, failure: null, failedStage: null, stopped: null, ...over })}\n`);
}
const candidate = (status: string, reason = "independent_acceptance_pending") => ({ status, reason });
function row(args: string[], outcome: string, extra: string[] = []): Record<string, unknown> {
  return JSON.parse(execFileSync("python3", ["-I", SCRIPT, ...args, "--id", "x", "--batch", "b", "--task", "t", "--family", "research", "--exposure", "fresh", "--arm", "local-loop", "--outcome", outcome,
    "--verdict-by", "none", "--lesson", "l", ...extra], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}
function refused(args: string[], outcome: string): string {
  try { row(args, outcome); } catch (error) { return String((error as { stderr?: unknown }).stderr ?? error); }
  throw new Error("the row was written");
}
const infra = (cause: string) => ({ version: 1, infra: true, cause }), task = (cause = "task") => ({ version: 1, infra: false, cause });

// Each test spawns python3 several times; under the system interpreter (about 150 ms a spawn) and full-suite load the default 5 s is too short.
describe("loop rows of version 2 (backlog item 11, part 3b)", { timeout: 60_000 }, () => {
  it("sums every run a version-2 loop made, moved runs and its moved critique included; names the cloud stage through stage_run; records resumes, active time and each sample's class", () => {
    const loop = scratch();
    const claude = { arm: "cloud", modelConfig: { model: "claude-sonnet-5-5", api: "anthropic_messages" } };
    runDirectory(loop, "a.infra-1", { status: "incomplete", reason: "model_unavailable", calls: 3, dispatches: [cloudSettled, zeroFee], arm: claude, start: 0, end: 6 });
    mkdirSync(join(loop, "a.void-1"));
    runDirectory(loop, "a", { calls: 2, start: 8, end: 12 });
    runDirectory(loop, "b", { calls: 2, start: 12, end: 16 });
    mkdirSync(join(loop, "critique.infra-1")); writeFileSync(join(loop, "critique.infra-1", "critique-failure.json"), `${canonical({ code: "request_failed", usage: { inputTokens: 300 }, feeMicrousd: 0 })}\n`);
    mkdirSync(join(loop, "critique")); writeFileSync(join(loop, "critique", "critique.json"), `${canonical({ critiqueSha256: h("e"), usage: { inputTokens: 700, outputTokens: 60 }, feeMicrousd: 0, finishReason: "stop" })}\n`);
    runDirectory(loop, "repair", { calls: 4, start: 20, end: 26 });
    loopRecord(loop, { arm: "cloud", pipeline: "research", stages: [{ stage: "a", ...span(8, 12), reused: false }, { stage: "b", ...span(12, 16), reused: false },
      { stage: "critique", ...span(16, 18), reused: false }, { stage: "repair", ...span(20, 26), reused: false }],
      begun: ["a", "b", "critique", "repair"].map(stage => ({ stage, at: time(0) })),
      resumes: [{ stage: "a", cause: "model_unavailable", as: "seeded_writer", identity: { inode: "1", sha256: null, jobId: "job-a-infra-1" }, counts, span: { startedAt: time(0), endedAt: time(6) }, cleanup: "not_needed", at: time(7) },
        { stage: "critique", cause: "request_failed", as: "rerun", identity: { inode: "2", sha256: null, jobId: null }, counts, span: { startedAt: time(14), endedAt: time(15) }, cleanup: "not_needed", at: time(15) }],
      voids: [{ stage: "a", n: 1, identity: { inode: "3", sha256: null, jobId: null }, at: time(7) }],
      candidates: { a: candidate("submitted"), b: candidate("submitted"), repair: candidate("submitted") }, seeded: { a: true, b: true, repair: true, snapshotSha256: h("f") },
      critique: { critiqueSha256: h("e"), modelCalls: 1 }, selected: { stage1: { candidate: "a", step: "tie" }, final: { candidate: "a", step: "tie" } } });
    const loopRow = row(["--loop-dir", loop], "accepted");
    expect(loopRow).toMatchObject({ modelCalls: 3 + 2 + 2 + 4 + 1 + 1, inputTokens: 100 * 11 + 700 + 300, usd: 0.12, failedDispatches: 1, zeroFeeFailedDispatches: 1, wallSeconds: 40 * 60,
      activeSeconds: (4 + 4 + 2 + 6 + 6 + 1) * 60, cloudModel: "claude-sonnet-5-5", cloudApi: "anthropic_messages", runStatus: "submitted", runClass: task("submitted"),
      loop: { version: 2, selected: "a", step: "tie", critiqued: true, resumes: [{ stage: "a", cause: "model_unavailable", as: "seeded_writer" }, { stage: "critique", cause: "request_failed", as: "rerun" }],
        seeded: { a: true, b: true, repair: true, snapshotSha256: h("f") }, candidates: { a: { status: "submitted", runClass: task("submitted") }, repair: { runClass: task("submitted") } } } });
    expect(loopRow).not.toHaveProperty("loop.stopped");
  });
  it("refuses a version-2 loop whose directory holds what its record does not name, or lacks what it moved, and sums everything once the loop is closed", () => {
    const loop = scratch();
    runDirectory(loop, "a", { status: "incomplete", reason: "model_unavailable", dispatches: [zeroFee] });
    runDirectory(loop, "stray", { calls: 7 });
    const record = { begun: [{ stage: "a", at: time(0) }], candidates: { a: null, b: null, repair: null }, failure: "loop_stage_infra", failedStage: "a" };
    loopRecord(loop, { ...record, stopped: { stage: "a", failure: "loop_stage_infra" } });
    expect(refused(["--loop-dir", loop], "infra_invalid")).toContain("stray, which its record does not name");
    loopRecord(loop, { ...record, stopped: { stage: "a", failure: "loop_stage_infra", closed: true } });
    expect(row(["--loop-dir", loop], "infra_invalid")).toMatchObject({ modelCalls: 1 + 7, runClass: infra("model_unavailable"), loop: { selected: null, stopped: { stage: "a", failure: "loop_stage_infra", closed: true } } });
    rmSync(join(loop, "stray"), { recursive: true });
    loopRecord(loop, { ...record, stopped: { stage: "a", failure: "loop_stage_infra" }, resumes: [{ stage: "b", cause: "operator_stop", as: "rerun", identity: { inode: "1", sha256: null, jobId: null }, counts, span: { startedAt: time(0), endedAt: time(1) }, cleanup: "not_needed", at: time(1) }] });
    expect(refused(["--loop-dir", loop], "infra_invalid")).toContain("moved aside is missing: b.infra-1");
    loopRecord(loop, { ...record, stopped: null });
    expect(refused(["--loop-dir", loop], "infra_invalid")).toContain("resume it, or close it");
    loopRecord(loop, { ...record, version: 3 });
    expect(refused(["--loop-dir", loop], "infra_invalid")).toContain("neither 1 nor 2");
  });
  it("rows a loop that stopped for good by its stop's class, with the stopped stage's fields or the loop's own, and never as accepted", () => {
    const stoppedLoop = (setup: (loop: string) => void, stop: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      const loop = scratch(); setup(loop); loopRecord(loop, { begun: [{ stage: "a", at: time(0) }, { stage: "b", at: time(5) }].filter(entry => existsSync(join(loop, entry.stage))), stopped: stop, failure: stop.failure, failedStage: stop.stage, ...extra });
      return loop;
    };
    const unfinished = stoppedLoop(loop => runDirectory(loop, "a", { result: false, calls: 2 }), { stage: "a", failure: "loop_stage_incomplete" });
    const unfinishedRow = row(["--loop-dir", unfinished], "infra_invalid");
    expect(unfinishedRow).toMatchObject({ runClass: infra("run_unfinished"), runStatus: null, terminalCause: null, date: "2026-11-10", taskJobSha256: h("1"), modelCalls: 2,
      loop: { selected: null, step: null, stopped: { stage: "a", failure: "loop_stage_incomplete", closed: false } } });
    expect(refused(["--loop-dir", unfinished], "rejected")).toContain("record --outcome infra_invalid");
    expect(refused(["--loop-dir", unfinished], "accepted")).toContain("the loop selected nothing");
    // A sample cut by the loop's interrupt that ended cancelled, its resume used: the operator's stop.
    const cut = stoppedLoop(loop => { runDirectory(loop, "a"); runDirectory(loop, "b", { status: "incomplete", reason: "cancelled_or_deadline" }); },
      { stage: "b", failure: "loop_stage_interrupted" }, { stages: [{ stage: "b", ...span(5, 9), reused: false, interrupted: true }], candidates: { a: candidate("submitted"), b: candidate("incomplete", "cancelled_or_deadline"), repair: null } });
    expect(row(["--loop-dir", cut], "infra_invalid")).toMatchObject({ runClass: infra("operator_stop"), runStatus: "incomplete", terminalCause: "cancelled_or_deadline", modelCalls: 2 });
    // An unfinished run's ledger decides: a priced call in flight is infrastructure; a priced call refused with 402 is the arm's.
    const committed = { status: "committed", destinationId: "cloud_coordinator", purpose: "research plan", reservedFeeMicrousd: 160_000 };
    const inFlight = stoppedLoop(loop => runDirectory(loop, "a", { result: false, dispatches: [committed] }), { stage: "a", failure: "loop_stage_unresolved_dispatch" });
    expect(row(["--loop-dir", inFlight], "infra_invalid")).toMatchObject({ runClass: infra("stage_unresolved_dispatch"), unknownDispatches: 1 });
    const refusedCall = { status: "failed", destinationId: "cloud_coordinator", purpose: "research plan", reservedFeeMicrousd: 160_000, failure: { phase: "transport", code: "http_rejected", status: 402 } };
    const billing = stoppedLoop(loop => runDirectory(loop, "a", { result: false, dispatches: [refusedCall] }), { stage: "a", failure: "loop_stage_failed_dispatch" });
    expect(row(["--loop-dir", billing], "rejected")).toMatchObject({ runClass: task() });
    expect(refused(["--loop-dir", billing], "infra_invalid")).toContain("did not end on infrastructure");
    // An integrity stop, with no directory left for the stage.
    const missing = stoppedLoop(() => undefined, { stage: "a", failure: "loop_stage_missing" });
    expect(row(["--loop-dir", missing], "infra_invalid")).toMatchObject({ runClass: infra("loop_stage_missing"), modelCalls: 0 });
  });
  it("classifies a version-2 critique_failed or repair_failed loop by its draft, or by the stop's recorded cause when the draft did not submit", () => {
    const ending = (draft: Record<string, unknown>, final: Record<string, unknown>) => {
      const loop = scratch();
      runDirectory(loop, "a", draft); runDirectory(loop, "b", { status: "incomplete", reason: "bounded_allowance_exhausted" });
      loopRecord(loop, { begun: [{ stage: "a", at: time(0) }, { stage: "b", at: time(5) }], candidates: { a: candidate(String(draft.status ?? "submitted")), b: candidate("incomplete", "bounded_allowance_exhausted"), repair: null },
        selected: { stage1: { candidate: "a", step: "artifacts" }, final: { candidate: "a", ...final } } });
      return loop;
    };
    const unsubmitted = { status: "incomplete", reason: "bounded_allowance_exhausted" };
    expect(row(["--loop-dir", ending(unsubmitted, { step: "critique_failed", cause: "request_failed" })], "infra_invalid")).toMatchObject({ runClass: infra("critique_request_failed") });
    expect(row(["--loop-dir", ending(unsubmitted, { step: "repair_failed", cause: "operator_stop" })], "infra_invalid")).toMatchObject({ runClass: infra("repair_operator_stop") });
    expect(row(["--loop-dir", ending(unsubmitted, { step: "critique_failed", cause: "task" })], "rejected")).toMatchObject({ runClass: task() });
    expect(row(["--loop-dir", ending({}, { step: "repair_failed", cause: "stage_unresolved_dispatch" })], "accepted")).toMatchObject({ runClass: task("submitted"), loop: { step: "repair_failed" } });
  });
  it("classifies a loop whose repair ended on infrastructure and lost as repair_<cause> (BL-20261110-0723 (c)), in either version", () => {
    for (const version of [1, 2]) {
      const loop = scratch();
      runDirectory(loop, "a", { status: "incomplete", reason: "bounded_allowance_exhausted" }); runDirectory(loop, "b", { status: "incomplete", reason: "bounded_allowance_exhausted" });
      runDirectory(loop, "repair", { status: "incomplete", reason: "model_unavailable", dispatches: [zeroFee] });
      mkdirSync(join(loop, "critique")); writeFileSync(join(loop, "critique", "critique.json"), `${canonical({ usage: { inputTokens: 1 }, feeMicrousd: 0 })}\n`);
      loopRecord(loop, { version, begun: ["a", "b", "critique", "repair"].map(stage => ({ stage, at: time(0) })),
        candidates: { a: candidate("incomplete", "bounded_allowance_exhausted"), b: candidate("incomplete", "bounded_allowance_exhausted"), repair: candidate("incomplete", "model_unavailable") },
        critique: { critiqueSha256: h("e"), modelCalls: 1 }, selected: { stage1: { candidate: "a", step: "tie" }, final: { candidate: "a", step: "tie" } } });
      expect(row(["--loop-dir", loop], "infra_invalid"), `version ${version}`).toMatchObject({ runClass: infra("repair_model_unavailable"),
        loop: { candidates: { a: { runClass: task() }, repair: { runClass: infra("model_unavailable") } } } });
    }
  });
  it("sums a version-1 loop's hand-moved stages, once per job, refuses one moved out of its directory or of another task, and reads a damaged freeze as no record", () => {
    const loop = scratch();
    runDirectory(loop, "a", { calls: 2 }); runDirectory(loop, "a.moved", { status: "incomplete", reason: "cancelled_or_deadline", calls: 5, dispatches: [cloudSettled] }); runDirectory(loop, "b", { calls: 1 });
    writeFileSync(join(loop, "log.txt"), ["a start", "a end", "a start", "a end", "b start", "b end"].map(line => `${time(1)} ${line}`).join("\n") + "\n");
    writeFileSync(join(loop, "loop.json"), `${canonical({ version: 1, selectionRule: 2, startedAt: time(0), finishedAt: time(30), task: { jobSha256: h("1"), briefSha256: h("2") }, runtimeSha256: h("4"),
      candidates: { a: candidate("submitted"), b: candidate("submitted") }, seeded: { b: false, repair: false, snapshotSha256: null }, writeIdentityEqual: null, critique: null,
      selected: { stage1: { candidate: "a", step: "tie" }, final: { candidate: "a", step: "no_draft" } } })}\n`);
    expect(row(["--loop-dir", loop], "accepted")).toMatchObject({ modelCalls: 2 + 5 + 1, usd: 0.12, activeSeconds: null });
    // A copy of a run (the whole directory, as `cp -r` makes one) counts once; a run of another task refuses the row.
    const copy = mkdirAndReturn(join(loop, "a.copy"));
    for (const name of readdirSync(join(loop, "a.moved"))) copyFileSync(join(loop, "a.moved", name), join(copy, name));
    expect(row(["--loop-dir", loop], "accepted")).toMatchObject({ modelCalls: 2 + 5 + 1 });
    rmSync(join(loop, "a.copy"), { recursive: true });
    runDirectory(loop, "foreign", { task: h("9") });
    expect(refused(["--loop-dir", loop], "accepted")).toContain("another task (foreign)");
    rmSync(join(loop, "foreign"), { recursive: true });
    // A damaged freeze in a moved stage is no record: its counts still add and its commit counts as differing, with no traceback.
    writeFileSync(join(loop, "a.moved", "freeze.json"), "{\"jobId\": ");
    expect(row(["--loop-dir", loop], "accepted")).toMatchObject({ modelCalls: 2 + 5 + 1, gitSource: "row_written" });
    // A finished run the log records but the directory lacks was moved out of it: its spend would be hidden, so the row is refused.
    rmSync(join(loop, "a.moved"), { recursive: true });
    expect(refused(["--loop-dir", loop], "accepted")).toContain("log.txt records 3 finished runs but the loop directory holds 2");
  });
  it("reads every ledger from a private copy, so a hot journal neither blocks the row nor is touched", () => {
    const loop = scratch();
    runDirectory(loop, "a", { result: false, calls: 0 });
    // A process killed during a commit: the ledger's pages spilled, the journal holding the originals, no lock held.
    const live = scratch(), path = join(loop, "a", "state.sqlite");
    const database = new Database(join(live, "state.sqlite")); copyFileSync(path, join(live, "state.sqlite")); database.close();
    const writer = new Database(join(live, "state.sqlite")); writer.pragma("cache_size = 1"); writer.exec("BEGIN IMMEDIATE");
    const insert = writer.prepare("INSERT INTO private_agent_events VALUES (?, ?, ?)");
    for (let i = 0; i < 300; i++) insert.run("job-a", 100 + i, JSON.stringify({ type: "model_finished", usage: { inputTokens: 1 }, pad: "x".repeat(400) }));
    for (const name of readdirSync(live)) copyFileSync(join(live, name), join(loop, "a", name));
    writer.exec("ROLLBACK"); writer.close();
    expect(existsSync(`${path}-journal`)).toBe(true);
    loopRecord(loop, { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "loop_stage_incomplete" }, failure: "loop_stage_incomplete", failedStage: "a" });
    expect(row(["--loop-dir", loop], "infra_invalid")).toMatchObject({ modelCalls: 0, runClass: infra("run_unfinished") });
    expect(existsSync(`${path}-journal`)).toBe(true);
  });
  it("refuses a row while a loop holds its lock", () => {
    const loop = scratch();
    runDirectory(loop, "a", { status: "incomplete", reason: "model_unavailable", result: false });
    loopRecord(loop, { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "loop_stage_incomplete" } });
    const held = acquireLoopLock(loop);
    expect(refused(["--loop-dir", loop], "infra_invalid")).toContain("the loop is running");
    held.release();
    expect(row(["--loop-dir", loop], "infra_invalid")).toMatchObject({ runClass: infra("run_unfinished") });
  });
  it("supersedes a stopped loop's row with the same refusals, accepted included", () => {
    const loop = scratch();
    runDirectory(loop, "a", { result: false });
    loopRecord(loop, { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "loop_stage_incomplete" } });
    const original = { ...row(["--loop-dir", loop], "infra_invalid"), id: "stopped-1" };
    const registry = join(scratch(), "registry.jsonl"); writeFileSync(registry, `${JSON.stringify(original)}\n`);
    const supersede = (outcome: string) => ["--supersedes", "stopped-1", "--registry", registry, "--id", "stopped-2", "--outcome", outcome, "--verdict-by", "none", "--lesson", "l"];
    const run = (args: string[]) => execFileSync("python3", ["-I", SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(() => run(supersede("accepted"))).toThrow(/the loop selected nothing/u);
    expect(() => run(supersede("rejected"))).toThrow(/record --outcome infra_invalid/u);
    expect(JSON.parse(run(supersede("infra_invalid")))).toMatchObject({ supersedes: "stopped-1", outcome: "infra_invalid", loop: { selected: null } });
  });
  it("takes a stopped row's provenance from its stopped run, and never counts a critique directory as a run that differs", () => {
    const loop = scratch();
    runDirectory(loop, "a", { git: true }); runDirectory(loop, "b", { git: true, status: "incomplete", reason: "cancelled_or_deadline" });
    mkdirSync(join(loop, "critique")); writeFileSync(join(loop, "critique", "critique-failure.json"), `${canonical({ code: "repair_critique_empty", usage: null })}\n`);
    loopRecord(loop, { begun: ["a", "b", "critique"].map(stage => ({ stage, at: time(0) })), candidates: { a: candidate("submitted"), b: candidate("incomplete", "cancelled_or_deadline"), repair: null },
      critique: { failure: "repair_critique_empty", modelCalls: 0 }, selected: { stage1: { candidate: "a", step: "submitted" }, final: { candidate: "a", step: "critique_failed", cause: "task" } } });
    expect(row(["--loop-dir", loop], "accepted")).toMatchObject({ git: COMMIT.slice(0, 12), gitSource: "run", gitDirty: false });
    loopRecord(loop, { begun: ["a", "b", "critique"].map(stage => ({ stage, at: time(0) })), stages: [{ stage: "b", ...span(5, 9), reused: false, interrupted: true }],
      stopped: { stage: "b", failure: "loop_stage_interrupted" }, failure: "loop_stage_interrupted", failedStage: "b" });
    expect(row(["--loop-dir", loop], "infra_invalid")).toMatchObject({ git: COMMIT.slice(0, 12), gitSource: "run", runClass: infra("operator_stop") });
  });
});

describe("a run's ledger, read the same way by the loop and the registry (backlog item 11, part 3b)", { timeout: 60_000 }, () => {
  it("reads a run with or without a result, its claims and its last commit, in both languages", () => {
    const root = scratch();
    const dirs = [runDirectory(root, "finished", { calls: 3, dispatches: [cloudSettled, zeroFee] }), runDirectory(root, "unfinished", { result: false, calls: 2, dispatches: [{ status: "committed", destinationId: "owned_local_model", reservedFeeMicrousd: 0 }], claim: true }),
      runDirectory(root, "unfrozen", { freeze: false, result: false, calls: 0 }), runDirectory(root, "damaged", { freeze: "{\"jobId\": ", result: false })];
    const probe = ["import importlib.util, json, sys", "spec = importlib.util.spec_from_file_location('registry_row', sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)",
      "print(json.dumps([module.run_ledger(path) for path in sys.argv[2:]]))"].join("\n");
    const python = JSON.parse(execFileSync("python3", ["-I", "-c", probe, SCRIPT, ...dirs], { encoding: "utf8" })) as Record<string, unknown>[];
    dirs.forEach((dir, i) => {
      const ledger = readRunLedger(dir), mirrored = python[i] as { freeze: unknown; dispatches: unknown; claims: unknown; counts: Record<string, number>; lastCommittedAt: unknown };
      expect(mirrored.freeze, dir).toEqual(ledger.freeze); expect(mirrored.dispatches).toEqual(ledger.dispatches); expect(mirrored.claims).toEqual(ledger.claims);
      expect(mirrored.lastCommittedAt).toEqual(ledger.lastCommittedAt);
      const { usd, ...rest } = mirrored.counts;
      expect({ ...rest, feeMicrousd: Math.round(usd! * 1_000_000) }).toEqual(ledger.counts);
    });
    expect(readRunLedger(dirs[0]!)).toMatchObject({ freeze: { jobId: "job-finished", runtimeSha256: h("4"), feeCapMicrousd: 0, localArm: true }, counts: { modelCalls: 3, feeMicrousd: 120_000, zeroFeeFailedDispatches: 1 }, lastCommittedAt: 1_001 });
    expect(readRunLedger(dirs[1]!)).toMatchObject({ counts: { unknownDispatches: 1 }, claims: [{ state: "active", ownerId: "owner" }] });
    expect(readRunLedger(dirs[2]!).freeze).toBeNull(); expect(readRunLedger(dirs[3]!).freeze).toBeNull();
  });
});

function mkdirAndReturn(path: string) { mkdirSync(path, { recursive: true }); return path; }
