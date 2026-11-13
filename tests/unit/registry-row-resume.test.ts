import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { acquireLoopLock } from "../../src/main/private-agent/loop-ledger";
import { readRunLedger } from "../../src/main/private-agent/selection";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

/**
 * Backlog item 11, part 3b (BL-20261113-0836-infra-resume-design, decisions (9) and (10)): a loop row of version 1 or 2 sums every
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
  start?: number; end?: number; arm?: Record<string, unknown>; jobId?: string; task?: string; git?: boolean; claim?: boolean; runtime?: string; committed?: number; ledger?: boolean }
/** A run directory as the driver leaves one: its freeze, its result unless it died first, and its ledger's events and rows. */
function runDirectory(root: string, name: string, input: Run = {}) {
  const dir = join(root, name); mkdirSync(dir, { recursive: true });
  const jobId = input.jobId ?? `job-${name.replace(/[^A-Za-z0-9_-]/gu, "-")}`, dispatches = input.dispatches ?? [];
  if (input.freeze !== false) writeFileSync(join(dir, "freeze.json"), typeof input.freeze === "string" ? input.freeze : `${canonical({ version: 1, jobId, startedAt: time(input.start ?? 0),
    sourceFreezeSha256: input.runtime ?? h("4"), taskBinding: { jobSha256: input.task ?? h("1"), briefSha256: h("2") }, profile: "heavy", modelConfig: { maxOutputTokens: 16384, thinking: "medium" },
    limits: { feeMicrousd: input.arm ? 600_000 : 0 }, arm: input.arm ?? { arm: "local" }, ...(input.git ? { git: { commit: COMMIT, dirty: false } } : {}) })}\n`);
  if (input.result !== false) writeFileSync(join(dir, "result.json"), `${canonical({ status: input.status ?? "submitted", reason: input.reason ?? "independent_acceptance_pending",
    finishedAt: time(input.end ?? 5), snapshotSha256: h("7"), candidateFiles: [], dispatches: dispatches.map(row => ({ ...row, jobId })) })}\n`);
  if (input.ledger === false) return dir;
  const db = new Database(join(dir, "state.sqlite")), store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["owned_local_model"], maxRequests: 50, maxFeeMicrousd: 0 });
  store.append(jobId, { type: "session_started", identity: h("3"), startedAt: 1, privateContextId: "p", publicContextId: "q" });
  for (let i = 0; i < (input.calls ?? 1); i++) store.append(jobId, { type: "model_finished", contextId: "p", operationId: `o${i}`, usage: { inputTokens: 100, outputTokens: 10 }, finishReason: "stop" });
  for (const event of input.events ?? []) store.append(jobId, event as never);
  dispatches.forEach((row, i) => db.prepare("INSERT INTO private_agent_dispatches VALUES (?, ?, ?)").run(`d${i}`, jobId, canonical({ ...row, jobId, committedAt: (input.committed ?? 1_000) + i })));
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
      loop: { version: 2, closed: false, selected: "a", step: "tie", critiqued: true, resumes: [{ stage: "a", cause: "model_unavailable", as: "seeded_writer" }, { stage: "critique", cause: "request_failed", as: "rerun" }],
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
    expect(row(["--loop-dir", loop], "infra_invalid")).toMatchObject({ modelCalls: 1 + 7, runClass: infra("model_unavailable"), loop: { selected: null, closed: true, stopped: { stage: "a", failure: "loop_stage_infra", closed: true } } });
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
    // A recorded cause that is not an identifier, or that names no infrastructure (`task`, `submitted`), never becomes a class.
    for (const cause of ["Request Failed", "submitted", "../x"]) {
      expect(row(["--loop-dir", ending(unsubmitted, { step: "repair_failed", cause })], "rejected"), cause).toMatchObject({ runClass: task() });
    }
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

/** A version-1 loop record, as part 1's loop saved one. */
function loopRecordV1(root: string, over: Record<string, unknown>) {
  writeFileSync(join(root, "loop.json"), `${canonical({ version: 1, selectionRule: 2, startedAt: time(0), finishedAt: time(30), task: { jobSha256: h("1"), briefSha256: h("2") }, runtimeSha256: h("4"),
    candidates: { a: candidate("submitted"), b: candidate("submitted") }, seeded: { b: false, repair: false, snapshotSha256: null }, writeIdentityEqual: null, critique: null,
    selected: { stage1: { candidate: "a", step: "tie" }, final: { candidate: "a", step: "no_draft" } }, ...over })}\n`);
}
const ledgerProbe = ["import importlib.util, json, sys", "spec = importlib.util.spec_from_file_location('registry_row', sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)",
  "print(json.dumps([module.run_ledger(path) for path in sys.argv[2:]]))"].join("\n");

describe("loop rows after part 3b's code review", { timeout: 60_000 }, () => {
  it("classes each sample by its own mark: an unmarked final beside a marked sample (finding M8)", () => {
    const loop = scratch();
    runDirectory(loop, "a", { status: "incomplete", reason: "cancelled_or_deadline" }); runDirectory(loop, "b", { status: "incomplete", reason: "cancelled_or_deadline" });
    loopRecord(loop, { begun: ["a", "b"].map(stage => ({ stage, at: time(0) })), stages: [{ stage: "b", ...span(5, 9), reused: false, interrupted: true }],
      candidates: { a: candidate("incomplete", "cancelled_or_deadline"), b: candidate("incomplete", "cancelled_or_deadline"), repair: null },
      selected: { stage1: { candidate: "a", step: "artifacts" }, final: { candidate: "a", step: "no_draft" } } });
    expect(row(["--loop-dir", loop], "rejected")).toMatchObject({ runClass: task(), loop: { candidates: { a: { runClass: task() }, b: { runClass: infra("operator_stop") } } } });
  });
  it("refuses a version-2 record whose begun entries, stop, task, pipeline or closed mark are malformed, and a version-1 record without a selection names no --close", () => {
    const loop = scratch();
    runDirectory(loop, "a", { result: false });
    const stop = { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "loop_stage_incomplete" } };
    for (const [over, message] of [[{ begun: [{ stage: "x", at: time(0) }] }, "malformed begun entry"], [{ begun: [{ stage: "a" }] }, "malformed begun entry"],
      [{ stopped: { stage: "a", failure: "loop_stage_incomplete", closed: false } }, "malformed stop"], [{ stopped: { stage: "a", failure: "Loop Stage" } }, "malformed stop"],
      [{ task: { jobSha256: "j" } }, "task is malformed"], [{ task: null }, "task is malformed"], [{ pipeline: "other" }, "pipeline is neither"], [{ closed: "yes" }, "closed mark is malformed"]] as const) {
      loopRecord(loop, { ...stop, ...over });
      expect(refused(["--loop-dir", loop], "infra_invalid"), JSON.stringify(over)).toContain(message);
    }
    const old = scratch();
    runDirectory(old, "a");
    loopRecordV1(old, { selected: { stage1: null, final: null } });
    const message = refused(["--loop-dir", old], "accepted");
    expect(message).toContain("the loop has no final selection: resume it"); expect(message).not.toContain("--close");
  });
  it("sums a version-1 loop's unfinished hand-moved run and hand-moved critique, refuses a run of another runtime, and counts a repair's end in its log", () => {
    const loop = scratch();
    runDirectory(loop, "a", { calls: 2 }); runDirectory(loop, "b", { calls: 1 }); runDirectory(loop, "a.moved", { result: false, calls: 3 });
    mkdirSync(join(loop, "critique.old")); writeFileSync(join(loop, "critique.old", "critique-failure.json"), `${canonical({ code: "request_failed", usage: { inputTokens: 300 }, feeMicrousd: 0 })}\n`);
    loopRecordV1(loop, {});
    expect(row(["--loop-dir", loop], "accepted")).toMatchObject({ modelCalls: 2 + 1 + 3 + 1, inputTokens: 600 + 300, loop: { critiqued: false } });
    runDirectory(loop, "foreign", { runtime: h("9") });
    expect(refused(["--loop-dir", loop], "accepted")).toContain("another runtime (foreign)");
    rmSync(join(loop, "foreign"), { recursive: true });
    writeFileSync(join(loop, "log.txt"), ["a end", "b end", "repair end"].map(line => `${time(1)} ${line}`).join("\n") + "\n");
    expect(refused(["--loop-dir", loop], "accepted")).toContain("log.txt records 3 finished runs but the loop directory holds 2");
  });
  it("sums every directory of a loop closed after stage 1, a stray included, once per job with the stage's own directory first, and refuses a stray of another task", () => {
    const loop = scratch();
    runDirectory(loop, "a", { calls: 2 }); runDirectory(loop, "b", { calls: 1, status: "incomplete", reason: "bounded_allowance_exhausted" });
    runDirectory(loop, "repair", { result: false, calls: 4 }); runDirectory(loop, "stray", { calls: 7 });
    // A partial copy of b (its freeze alone) is the same job: it is skipped, never read.
    mkdirSync(join(loop, "b.copy")); copyFileSync(join(loop, "b", "freeze.json"), join(loop, "b.copy", "freeze.json"));
    mkdirSync(join(loop, "critique")); writeFileSync(join(loop, "critique", "critique.json"), `${canonical({ usage: { inputTokens: 1 }, feeMicrousd: 0 })}\n`);
    const closed = { closed: true, begun: ["a", "b", "critique", "repair"].map(stage => ({ stage, at: time(0) })), candidates: { a: candidate("submitted"), b: candidate("incomplete", "bounded_allowance_exhausted"), repair: null },
      critique: { critiqueSha256: h("e"), modelCalls: 1 }, failure: "loop_stage_infra", failedStage: "repair",
      selected: { stage1: { candidate: "a", step: "submitted" }, final: { candidate: "a", step: "repair_failed", cause: "run_unfinished" } } };
    loopRecord(loop, closed);
    expect(row(["--loop-dir", loop], "accepted")).toMatchObject({ modelCalls: 2 + 1 + 4 + 7 + 1, runClass: task("submitted"), loop: { step: "repair_failed", closed: true } });
    // The same directory without the closed mark is refused: the record names neither the stray nor the copy.
    const { closed: _mark, ...open } = closed;
    loopRecord(loop, open);
    expect(refused(["--loop-dir", loop], "accepted")).toContain("which its record does not name");
    loopRecord(loop, closed);
    runDirectory(loop, "foreign", { task: h("9") });
    expect(refused(["--loop-dir", loop], "accepted")).toContain("another task (foreign)");
  });
  it("refuses a stage whose freeze or result is readable but whose ledger is missing, and reads a stopped stage's torn result as a run that did not finish", () => {
    const loop = scratch();
    runDirectory(loop, "a", { result: false, ledger: false });
    loopRecord(loop, { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "loop_stage_ledger_unreadable" }, failure: "loop_stage_ledger_unreadable", failedStage: "a" });
    expect(refused(["--loop-dir", loop], "infra_invalid")).toContain("a holds a run without its ledger");
    const tables = scratch();
    runDirectory(tables, "a", { result: false, ledger: false });
    const bare = new Database(join(tables, "a", "state.sqlite")); bare.exec("CREATE TABLE private_agent_events (job_id TEXT, sequence INTEGER, value TEXT)"); bare.close();
    loopRecord(tables, { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "loop_stage_incomplete" }, failedStage: "a" });
    expect(refused(["--loop-dir", tables], "infra_invalid")).toContain("a holds a run without its ledger");
    // A torn result is no result: the stage's ledger is its spend, its fields come from its freeze, and its class is an unfinished run's.
    const torn = scratch();
    runDirectory(torn, "a", { calls: 2, start: 3 }); writeFileSync(join(torn, "a", "result.json"), "{\"status\": \"incomp");
    loopRecord(torn, { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "loop_stage_incomplete" }, failure: "loop_stage_incomplete", failedStage: "a" });
    expect(row(["--loop-dir", torn], "infra_invalid")).toMatchObject({ modelCalls: 2, runClass: infra("run_unfinished"), runStatus: null, profile: "heavy", maxOutputTokens: 16384, thinking: "medium",
      taskJobSha256: h("1"), date: "2026-11-10" });
    // A stage that froze nothing left nothing: the stop is the task's unless the loop's interrupt stopped it.
    const unfrozen = scratch();
    runDirectory(unfrozen, "a", { freeze: false, result: false, calls: 0 });
    loopRecord(unfrozen, { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "local_screen_cloud_key_missing", closed: true }, failure: "local_screen_cloud_key_missing", failedStage: "a" });
    expect(row(["--loop-dir", unfrozen], "rejected")).toMatchObject({ runClass: task(), modelCalls: 0 });
  });
  it("rows a loop the operator closed after stage 1 at its critique, by the critique's failure under the loop's mark", () => {
    const loop = scratch();
    runDirectory(loop, "a", { status: "incomplete", reason: "bounded_allowance_exhausted" }); runDirectory(loop, "b", { status: "incomplete", reason: "bounded_allowance_exhausted" });
    mkdirSync(join(loop, "critique")); writeFileSync(join(loop, "critique", "critique-failure.json"), `${canonical({ code: "request_cancelled", usage: null, feeMicrousd: null })}\n`);
    loopRecord(loop, { closed: true, begun: ["a", "b", "critique"].map(stage => ({ stage, at: time(0) })), stages: [{ stage: "critique", ...span(10, 11), reused: false, interrupted: true }],
      candidates: { a: candidate("incomplete", "bounded_allowance_exhausted"), b: candidate("incomplete", "bounded_allowance_exhausted"), repair: null },
      critique: { failure: "loop_interrupted", feeMicrousd: 0, finishReason: null, usage: null, modelCalls: 0 }, failure: "loop_interrupted", failedStage: "critique",
      selected: { stage1: { candidate: "a", step: "tie" }, final: { candidate: "a", step: "critique_failed", cause: "operator_stop" } } });
    expect(row(["--loop-dir", loop], "infra_invalid")).toMatchObject({ runClass: infra("critique_operator_stop"), modelCalls: 2, loop: { step: "critique_failed", critiqueFailure: "loop_interrupted", critiqued: false } });
  });
  it("takes the lock through a file URI, whatever the loop directory's name holds, and refuses a symbolic link in its place", () => {
    const loop = join(scratch(), "loop #1 ?x%20 y");
    mkdirSync(loop);
    runDirectory(loop, "a", { result: false });
    loopRecord(loop, { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "loop_stage_incomplete" } });
    acquireLoopLock(loop).release();
    expect(row(["--loop-dir", loop], "infra_invalid")).toMatchObject({ runClass: infra("run_unfinished") });
    const held = acquireLoopLock(loop);
    expect(refused(["--loop-dir", loop], "infra_invalid")).toContain("the loop is running");
    held.release();
    const elsewhere = join(scratch(), "lock"); writeFileSync(elsewhere, ""); rmSync(join(loop, "loop.lock")); symlinkSync(elsewhere, join(loop, "loop.lock"));
    expect(refused(["--loop-dir", loop], "infra_invalid")).toContain("the loop is running, or its lock cannot be read");
  });
  it("rolls an uncommitted rewrite of a stage's rows back from its journal, in the private copy only", () => {
    const loop = scratch();
    runDirectory(loop, "a", { result: false, calls: 0, dispatches: [{ status: "settled", destinationId: "owned_local_model", reservedFeeMicrousd: 0, feeMicrousd: 0 }] });
    const path = join(loop, "a", "state.sqlite"), live = scratch();
    copyFileSync(path, join(live, "state.sqlite"));
    // A process killed while it rewrote the committed row as a priced one: the rewritten pages spilled into the database file.
    const writer = new Database(join(live, "state.sqlite")); writer.pragma("cache_size = 1"); writer.exec("BEGIN IMMEDIATE");
    writer.prepare("UPDATE private_agent_dispatches SET value = ?").run(canonical({ status: "settled", destinationId: "cloud_coordinator", reservedFeeMicrousd: 900_000, feeMicrousd: 900_000, pad: "x".repeat(2000) }));
    const insert = writer.prepare("INSERT INTO private_agent_events VALUES (?, ?, ?)");
    for (let i = 0; i < 300; i++) insert.run("job-a", 100 + i, JSON.stringify({ type: "model_finished", usage: { inputTokens: 1 }, pad: "x".repeat(400) }));
    for (const name of readdirSync(live)) copyFileSync(join(live, name), join(loop, "a", name));
    writer.exec("ROLLBACK"); writer.close();
    expect(existsSync(`${path}-journal`)).toBe(true);
    // The database file alone holds the uncommitted rewrite; the journal restores the committed row.
    const naive = scratch(); copyFileSync(path, join(naive, "state.sqlite"));
    const alone = new Database(join(naive, "state.sqlite"), { readonly: true });
    expect(String((alone.prepare("SELECT value FROM private_agent_dispatches").get() as { value: string }).value)).toContain("cloud_coordinator"); alone.close();
    loopRecord(loop, { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "loop_stage_incomplete" }, failure: "loop_stage_incomplete", failedStage: "a" });
    expect(row(["--loop-dir", loop], "infra_invalid")).toMatchObject({ usd: 0, modelCalls: 0, runClass: infra("run_unfinished") });
    expect(existsSync(`${path}-journal`)).toBe(true);
  });
  it("carries a run's own commit on a row classed as infrastructure, for a run row and a stopped loop's row (delta review of #78, item 5)", () => {
    const root = scratch();
    const run = runDirectory(root, "run", { status: "incomplete", reason: "model_unavailable", dispatches: [zeroFee], git: true });
    expect(row(["--run-dir", run], "infra_invalid")).toMatchObject({ runClass: infra("model_unavailable"), git: COMMIT.slice(0, 12), gitSource: "run", gitDirty: false });
    const loop = scratch();
    runDirectory(loop, "a", { result: false, git: true, dispatches: [zeroFee] });
    loopRecord(loop, { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "loop_stage_incomplete" }, failure: "loop_stage_incomplete", failedStage: "a" });
    expect(row(["--loop-dir", loop], "infra_invalid")).toMatchObject({ runClass: infra("run_unfinished"), git: COMMIT.slice(0, 12), gitSource: "run", gitDirty: false });
  });
  it("rows a stopped stage whose result or freeze is damaged without a traceback, its fields from what it can read, and never prints a critique's message", () => {
    const loop = scratch();
    runDirectory(loop, "a", { calls: 2 });
    // A result led by a byte-order mark is no result; a freeze without its model settings or start leaves those fields null.
    writeFileSync(join(loop, "a", "result.json"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(join(loop, "a", "result.json"))]));
    const freeze = JSON.parse(readFileSync(join(loop, "a", "freeze.json"), "utf8")) as Record<string, unknown>; delete freeze.modelConfig; delete freeze.startedAt;
    writeFileSync(join(loop, "a", "freeze.json"), `${canonical(freeze)}\n`);
    loopRecord(loop, { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "loop_closed", closed: true }, failure: "loop_closed", failedStage: "a", closed: true });
    expect(row(["--loop-dir", loop], "infra_invalid")).toMatchObject({ runClass: infra("run_unfinished"), runStatus: null, maxOutputTokens: null, thinking: null, date: "2026-11-10", taskJobSha256: h("1"), modelCalls: 2 });
    // A readable result with an end time that is not ISO 8601 still rows, with the result's status and cause.
    const odd = scratch();
    runDirectory(odd, "a", { status: "incomplete", reason: "model_unavailable", dispatches: [zeroFee] });
    const result = JSON.parse(readFileSync(join(odd, "a", "result.json"), "utf8")) as Record<string, unknown>; result.finishedAt = "yesterday";
    writeFileSync(join(odd, "a", "result.json"), `${canonical(result)}\n`);
    loopRecord(odd, { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "loop_closed", closed: true }, failure: "loop_closed", failedStage: "a", closed: true });
    expect(row(["--loop-dir", odd], "infra_invalid")).toMatchObject({ runClass: infra("model_unavailable"), runStatus: "incomplete", terminalCause: "model_unavailable", maxOutputTokens: 16384 });
    // A critique failure recorded as a message never reaches the row.
    const message = scratch();
    runDirectory(message, "a"); runDirectory(message, "b");
    loopRecord(message, { begun: ["a", "b"].map(stage => ({ stage, at: time(0) })), candidates: { a: candidate("submitted"), b: candidate("submitted"), repair: null },
      critique: { failure: "ECONNRESET reading /Users/someone/state.sqlite", feeMicrousd: 0, finishReason: null, usage: null, modelCalls: 0 },
      selected: { stage1: { candidate: "a", step: "tie" }, final: { candidate: "a", step: "critique_failed", cause: "task" } } });
    expect(row(["--loop-dir", message], "accepted")).toMatchObject({ loop: { critiqueFailure: null } });
  });
  it("times a begun stage whose process died from its begun time to its last commit, in milliseconds since the epoch", () => {
    const loop = scratch();
    runDirectory(loop, "a", { result: false, dispatches: [zeroFee, zeroFee], committed: Date.parse(time(3)) - 1 });
    loopRecord(loop, { begun: [{ stage: "a", at: time(0) }], stopped: { stage: "a", failure: "loop_stage_incomplete" }, failure: "loop_stage_incomplete", failedStage: "a" });
    expect(row(["--loop-dir", loop], "infra_invalid")).toMatchObject({ activeSeconds: 180 });
  });
});

describe("a run's ledger on odd input, read the same way in both languages (part 3b's code review)", { timeout: 60_000 }, () => {
  it("reads freeze fields, rows and commit times identically, and refuses identically", () => {
    const root = scratch();
    const cloudArm = runDirectory(root, "cloud", { arm: { arm: "cloud", modelConfig: { model: "m" } }, calls: 1 });
    const badJob = runDirectory(root, "badjob", { calls: 1 });
    writeFileSync(join(badJob, "freeze.json"), readFileSync(join(badJob, "freeze.json"), "utf8").replace("\"jobId\":\"job-badjob\"", "\"jobId\":\"bad id!\""));
    const bom = runDirectory(root, "bom", { calls: 1 });
    writeFileSync(join(bom, "freeze.json"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(join(bom, "freeze.json"))]));
    const nan = runDirectory(root, "nan", { calls: 1, result: false });
    writeFileSync(join(nan, "freeze.json"), readFileSync(join(nan, "freeze.json"), "utf8").replace("\"version\":1", "\"version\":NaN"));
    const linked = runDirectory(root, "linked", { calls: 1, result: false, freeze: false });
    symlinkSync(join(cloudArm, "freeze.json"), join(linked, "freeze.json"));
    const odd = runDirectory(root, "odd", { calls: 0, result: false });
    const db = new Database(join(odd, "state.sqlite"));
    db.prepare("INSERT INTO private_agent_dispatches VALUES (?, ?, ?)").run("x1", "job-odd", "{\"status\":\"settled\",\"feeMicrousd\":5,\"committedAt\":1000.0}");
    db.prepare("INSERT INTO private_agent_dispatches VALUES (?, ?, ?)").run("x2", "job-odd", "{\"status\":\"settled\",\"feeMicrousd\":\"7\",\"committedAt\":1000.5}");
    db.prepare("INSERT INTO private_agent_dispatches VALUES (?, ?, ?)").run("x3", "job-odd", "[1, 2]");
    db.prepare("INSERT INTO private_agent_events VALUES (?, ?, ?)").run("job-odd", 50, "{\"type\":\"model_finished\",\"usage\":{\"inputTokens\":\"5\",\"outputTokens\":2}}");
    db.prepare("INSERT INTO private_agent_events VALUES (?, ?, ?)").run("job-odd", 51, "{\"type\":\"research_stage\",\"calls\":true,\"usage\":\"none\",\"truncatedReplies\":1}");
    db.close();
    const dirs = [cloudArm, badJob, bom, nan, linked, odd];
    const python = JSON.parse(execFileSync("python3", ["-I", "-c", ledgerProbe, SCRIPT, ...dirs], { encoding: "utf8" })) as Record<string, unknown>[];
    dirs.forEach((dir, i) => {
      const ledger = readRunLedger(dir), mirrored = python[i] as { freeze: unknown; dispatches: unknown; claims: unknown; counts: Record<string, number>; lastCommittedAt: unknown; finishedAt: unknown };
      expect(mirrored.freeze, dir).toEqual(ledger.freeze); expect(mirrored.dispatches, dir).toEqual(ledger.dispatches); expect(mirrored.lastCommittedAt, dir).toEqual(ledger.lastCommittedAt);
      expect(mirrored.finishedAt, dir).toEqual(ledger.finishedAt);
      const { usd, ...rest } = mirrored.counts;
      expect({ ...rest, feeMicrousd: Math.round(usd! * 1_000_000) }, dir).toEqual(ledger.counts);
    });
    expect(readRunLedger(cloudArm)).toMatchObject({ freeze: { localArm: false, feeCapMicrousd: 600_000 }, finishedAt: time(5) });
    // A byte-order mark makes a run file unreadable in both languages, as JSON.parse refuses one.
    expect(readRunLedger(badJob).freeze).toBeNull(); expect(readRunLedger(bom).freeze).toBeNull();
    expect(readRunLedger(nan).freeze).toBeNull(); expect(readRunLedger(linked).freeze).toBeNull();
    expect(readRunLedger(odd)).toMatchObject({ lastCommittedAt: 1000, counts: { modelCalls: 1, inputTokens: 0, outputTokens: 2, lengthStops: 1, feeMicrousd: 5 } });
    expect(readRunLedger(odd).dispatches).toHaveLength(2);
    // A row that is not JSON refuses in both; so does a run with a result whose ledger is gone.
    const broken = runDirectory(root, "broken", { calls: 0, result: false });
    const write = new Database(join(broken, "state.sqlite")); write.prepare("INSERT INTO private_agent_dispatches VALUES (?, ?, ?)").run("y", "job-broken", "{not json"); write.close();
    const gone = runDirectory(root, "gone", { freeze: false, ledger: false });
    for (const dir of [broken, gone]) {
      expect(() => readRunLedger(dir), dir).toThrow();
      expect(() => execFileSync("python3", ["-I", "-c", ledgerProbe, SCRIPT, dir], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), dir).toThrow();
    }
  });
});

