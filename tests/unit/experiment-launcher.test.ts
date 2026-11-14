import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_OBSERVATIONS, IDLE_RETRY_MS, IDLE_SPACING_MS, MAX_LOOP_REINVOCATIONS, REAP_WAIT_MS, SIGNAL_REPEAT_MS, TERM_WAIT_MS, directoryExposure, parseLauncherArguments, parseMetrics, parseQueue,
  readLoopView, runLauncher, writeFinalLine, type ChildExit, type ForwardedSignal, type LauncherDependencies, type QueueRun } from "../../scripts/experiment-launcher";

/**
 * Plan 11.5 (BL-20261114-1344-experiment-launcher-design): the launcher's rules on fakes for the clock (vitest's fake timers), the
 * children, the endpoint's metrics and git, with real run directories, ledgers and loop records. Nothing starts a process, reads an
 * endpoint or spends.
 */
const cleanups: (() => void)[] = [];
const T0 = Date.parse("2026-11-20T01:00:00.000Z"), M = 60_000, H = 60 * M;
beforeEach(() => { vi.useFakeTimers({ now: T0 }); });
afterEach(() => { vi.useRealTimers(); for (const step of cleanups.splice(0).reverse()) step(); });
const iso = (ms: number) => new Date(ms).toISOString();
function workspace(): string { const dir = mkdtempSync(join(tmpdir(), "soar-launcher-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }

type RunInput = { id: string; kind: "loop" | "run"; capUsd: number; argv: string[]; projectedSeconds?: number };
/** The driver's own flags, as the loop's parse test gives them, and a cloud arm (H5's split arm on Claude). */
const DRIVER = ["--task-directory", "task", "--job-sha256", "1".repeat(64), "--brief-sha256", "2".repeat(64), "--authority-sha256", "3".repeat(64),
  "--image-id", `sha256:${"4".repeat(64)}`, "--runtime-sha256", "5".repeat(64), "--profile", "heavy", "--claims-ledger", "true"];
const CLOUD = ["--pipeline", "research", "--arm", "cloud", "--cloud-model", "claude-sonnet-5-5", "--cloud-endpoint", "https://api.anthropic.com/v1/messages",
  "--cloud-prices", "2,10,0.1,2.5", "--max-fee-usd", "0.6"];
const loopRun = (id: string, over: Partial<RunInput> = {}): RunInput => ({ id, kind: "loop", capUsd: 0, argv: ["--select-and-repair", "--loop-directory", `loops/${id}`, ...DRIVER], ...over });
const singleRun = (id: string, over: Partial<RunInput> = {}): RunInput => ({ id, kind: "run", capUsd: 0, argv: ["--execute-synthetic-local", ...DRIVER, "--output-directory", `runs/${id}`], ...over });
function writeQueue(root: string, runs: RunInput[], over: { windows?: [number, number][]; batchCapUsd?: number; name?: string } = {}): string {
  const path = join(root, over.name ?? "queue.json");
  writeFileSync(path, JSON.stringify({ version: 1, batch: "e3-test", batchCapUsd: over.batchCapUsd ?? 20.4,
    windows: (over.windows ?? [[T0, T0 + 6 * H]]).map(([start, end]) => ({ start: iso(start), end: iso(end) })), runs }));
  return path;
}
/** A run directory with a freeze and a ledger of these dispatch rows, as the driver leaves one. */
function writeLedger(directory: string, rows: Record<string, unknown>[], jobId = "job-a"): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "freeze.json"), JSON.stringify({ jobId }));
  const db = new Database(join(directory, "state.sqlite"));
  db.exec("CREATE TABLE private_agent_events (job_id TEXT, sequence INTEGER, value TEXT); CREATE TABLE private_agent_dispatches (value TEXT); CREATE TABLE private_agent_run_claims (value TEXT)");
  const insert = db.prepare("INSERT INTO private_agent_dispatches (value) VALUES (?)");
  for (const row of rows) insert.run(JSON.stringify(row));
  db.close();
}
/** A loop record as phase4-loop.ts saves one; `finishedAt: null` is the record it saves when it starts and before each stage. */
function writeLoop(directory: string, over: { failure?: string | null; stopped?: Record<string, unknown> | null; final?: Record<string, unknown> | null; finishedAt?: string | null; feeMicrousd?: number } = {}): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "loop.json"), JSON.stringify({ version: 2, finishedAt: "finishedAt" in over ? over.finishedAt : iso(Date.now()), failure: over.failure ?? null,
    stopped: over.stopped ?? null, selected: { stage1: null, final: over.final ?? null }, totals: { feeMicrousd: over.feeMicrousd ?? 0 } }));
}

/** One child's behaviour: how long it runs, its exit code, what it writes, and whether it ignores a forwarded signal or even SIGKILL. */
interface Script { ms?: number; code?: number; killed?: boolean; start?(run: QueueRun, files: { out: string; err: string }): void; ignore?: boolean; unreaped?: boolean }
interface HarnessOptions { scripts?: (id: string, attempt: number) => Script; metrics?: (call: number) => { running: number; waiting: number } | null;
  git?: { commit: string; dirty: boolean } | null | ((call: number) => { commit: string; dirty: boolean } | null); onMain?: boolean | null | ((call: number) => boolean | null); inhibitor?: boolean; alive?: (pid: number) => boolean; locked?: boolean }
function harness(root: string, options: HarnessOptions = {}) {
  const spawned: { run: string; attempt: number; at: number }[] = [], sent: { run: string; signal: string; at: number }[] = [], metricTimes: number[] = [];
  const attempts = new Map<string, number>(), listeners = new Set<(signal: ForwardedSignal) => void>();
  let gitCalls = 0, mainCalls = 0;
  const deps: LauncherDependencies = {
    root,
    now: () => Date.now(),
    sleep: (ms, cancel) => new Promise<void>(done => {
      if (cancel.aborted) { done(); return; }
      const timer = setTimeout(done, ms);
      cancel.addEventListener("abort", () => { clearTimeout(timer); done(); }, { once: true });
    }),
    gitState: () => { gitCalls += 1; return typeof options.git === "function" ? options.git(gitCalls) : options.git === undefined ? { commit: "c".repeat(40), dirty: false } : options.git; },
    headOnMain: () => { mainCalls += 1; return typeof options.onMain === "function" ? options.onMain(mainCalls) : options.onMain === undefined ? true : options.onMain; },
    lock: () => { if (options.locked) throw new Error("loop_locked"); return { release() { /* one launcher in these tests */ } }; },
    startInhibitor: async () => options.inhibitor === false ? null : { kind: "test", stop() { /* nothing to stop */ } },
    readMetrics: async () => { metricTimes.push(Date.now()); return options.metrics ? options.metrics(metricTimes.length) : { running: 0, waiting: 0 }; },
    spawnRun: (run, files) => {
      const attempt = (attempts.get(run.id) ?? 0) + 1;
      attempts.set(run.id, attempt);
      spawned.push({ run: run.id, attempt, at: Date.now() });
      const script = options.scripts?.(run.id, attempt) ?? {};
      let done!: (exit: ChildExit) => void;
      const exited = new Promise<ChildExit>(resolve => { done = resolve; });
      script.start?.(run, files);
      const timer = setTimeout(() => done(script.killed ? { code: null, signal: "SIGKILL" } : { code: script.code ?? 0, signal: null }), script.ms ?? 30 * M);
      return { pid: 4000 + spawned.length, exited, signal: signal => {
        sent.push({ run: run.id, signal, at: Date.now() });
        if (signal === "SIGKILL" ? script.unreaped : script.ignore) return;
        clearTimeout(timer); done({ code: signal === "SIGKILL" ? null : 1, signal: signal === "SIGKILL" ? "SIGKILL" : null });
      } };
    },
    pidAlive: pid => options.alive?.(pid) ?? false,
    launcherSha256: () => "f".repeat(64),
  };
  const signals = { subscribe: (listener: (signal: ForwardedSignal) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const emit = (signal: ForwardedSignal) => { for (const listener of listeners) listener(signal); };
  return { deps, signals, emit, spawned, sent, metricTimes };
}
async function launch(h: ReturnType<typeof harness>, queuePath: string, stateDirectory: string) {
  const running = runLauncher({ queuePath, stateDirectory }, h.deps, h.signals);
  await vi.runAllTimersAsync();
  return running;
}
const events = (state: string) => readFileSync(join(state, "launcher.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
const named = (state: string, name: string) => events(state).filter(event => event.event === name);

describe("experiment launcher: inputs", () => {
  it("parses its command line, and its queue strictly: windows in order and apart, each run naming its own directory once, with a cap that covers its arguments' cap", () => {
    expect(parseLauncherArguments(["--queue", "q.json", "--state-directory", "s"])).toMatchObject({ queuePath: expect.stringMatching(/q\.json$/u), stateDirectory: expect.stringMatching(/s$/u) });
    expect(parseLauncherArguments(["--", "--queue", "q.json", "--state-directory", "s"]).queuePath).toMatch(/q\.json$/u);
    for (const args of [[], ["--", "--", "--queue", "q", "--state-directory", "s"], ["--queue", "q"], ["--queue", "q", "--state-directory"], ["--queue", "q", "--queue", "r"], ["--queue", "q", "--state-directory", "s", "--x", "y"]]) {
      expect(() => parseLauncherArguments(args)).toThrow("launcher_cli_invalid");
    }
    const root = workspace();
    const parsed = parseQueue(readFileSync(writeQueue(root, [loopRun("l1", { capUsd: 0.6, argv: [...loopRun("l1").argv, ...CLOUD] }),
      singleRun("r1", { capUsd: 0.6, argv: [...singleRun("r1").argv, ...CLOUD], projectedSeconds: 600 })], { windows: [[T0, T0 + H], [T0 + 2 * H, T0 + 3 * H]] })), root);
    expect(parsed).toMatchObject({ batch: "e3-test", batchCapMicrousd: 20_400_000, windows: [{ start: T0, end: T0 + H }, { start: T0 + 2 * H, end: T0 + 3 * H }], sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) });
    // A loop's cap covers its arguments' cap once: only sample a can spend (b and the repair are seeded writers, the critique is local).
    expect(parsed.runs).toEqual([{ id: "l1", kind: "loop", capMicrousd: 600_000, argv: [...loopRun("l1").argv, ...CLOUD], directory: join(root, "loops/l1"), projectedMs: null },
      { id: "r1", kind: "run", capMicrousd: 600_000, argv: [...singleRun("r1").argv, ...CLOUD], directory: join(root, "runs/r1"), projectedMs: 600_000 }]);
    const refused: [RunInput[], { windows?: [number, number][]; batchCapUsd?: number }][] = [
      [[loopRun("l1")], { windows: [[T0, T0 + 2 * H], [T0 + H, T0 + 3 * H]] }],          // overlapping windows
      [[loopRun("l1")], { windows: [[T0 + 2 * H, T0 + 3 * H], [T0, T0 + H]] }],          // out of order
      [[loopRun("l1")], { windows: [[T0, T0]] }],                                           // empty
      [[loopRun("l1")], { batchCapUsd: 0 }],
      [[loopRun("l1"), loopRun("l1", { argv: ["--select-and-repair", "--loop-directory", "loops/other", ...DRIVER] })], {}],   // duplicate id
      [[loopRun("l1"), loopRun("l2", { argv: loopRun("l1").argv })], {}],                   // one directory for two runs
      // The scripts' own parsers refuse: a loop that is not --select-and-repair, --close, an --output-directory, a cloud loop that is not a
      // research loop; a run without --execute-synthetic-local, a repeated or missing flag, an unreadable cap.
      [[loopRun("l1", { argv: ["--loop-directory", "loops/l1", ...DRIVER] })], {}],
      [[loopRun("l1", { argv: [...loopRun("l1").argv, "--close", "x"] })], {}],
      [[loopRun("l1", { argv: [...loopRun("l1").argv, "--output-directory", "x"] })], {}],
      [[loopRun("l1", { capUsd: 1, argv: [...loopRun("l1").argv, ...CLOUD.slice(2)] })], {}],
      [[singleRun("r1", { argv: [...DRIVER, "--output-directory", "runs/r1"] })], {}],
      [[singleRun("r1", { argv: [...singleRun("r1").argv, "--output-directory", "y"] })], {}],
      [[singleRun("r1", { argv: ["--execute-synthetic-local", "--task-directory", "task"] })], {}],
      [[singleRun("r1", { capUsd: 1, argv: [...singleRun("r1").argv, ...CLOUD.slice(0, -1), "lots"] })], {}],
      // A cap below the arguments' cap, for a loop and for a run.
      [[loopRun("l1", { capUsd: 0.5, argv: [...loopRun("l1").argv, ...CLOUD] })], {}],
      [[singleRun("r1", { capUsd: 0.5, argv: [...singleRun("r1").argv, ...CLOUD] })], {}],
      [[{ ...singleRun("r1"), extra: true } as RunInput], {}],
      [[singleRun("R1")], {}],
    ];
    for (const [runs, over] of refused) expect(() => parseQueue(readFileSync(writeQueue(root, runs, over)), root)).toThrow("launcher_queue_invalid");
    writeFileSync(join(root, "bad.json"), JSON.stringify({ version: 1, batch: "b", batchCapUsd: 1, windows: [{ start: "2026-11-20T01:00:00+01:00", end: iso(T0 + H) }], runs: [singleRun("r1")] }));
    expect(() => parseQueue(readFileSync(join(root, "bad.json")), root)).toThrow("launcher_queue_invalid");
  });
  it("reads the endpoint's running and waiting counts, summed over label sets, and nothing when a metric is missing or unreadable", () => {
    const page = ["# HELP vllm:num_requests_running Number of requests running.", "vllm:num_requests_running{model_name=\"m\",engine=\"0\"} 0.0",
      "vllm:num_requests_running{model_name=\"m\",engine=\"1\"} 2.0", "vllm:num_requests_waiting{model_name=\"m\"} 1", "vllm:num_requests_running_total 9"].join("\n");
    expect(parseMetrics(page)).toEqual({ running: 2, waiting: 1 });
    expect(parseMetrics("vllm:num_requests_running 0\nvllm:num_requests_waiting 0\n")).toEqual({ running: 0, waiting: 0 });
    expect(parseMetrics("vllm:num_requests_running 0\n")).toBeNull();
    expect(parseMetrics("vllm:num_requests_running NaN\nvllm:num_requests_waiting 0")).toBeNull();
    expect(parseMetrics("vllm:num_requests_running_total 0\nvllm:num_requests_waiting 0")).toBeNull();
  });
  it("counts a run's spend as settled fees plus pinned reservations over every ledger in its directory, and for a loop never less than loop.json's total", () => {
    const root = workspace();
    // A settled row its fee, a superseded or failed row nothing, a committed or unknown row its reservation (store.ts's exposure).
    writeLedger(join(root, "runs/r1"), [{ status: "settled", feeMicrousd: 150_000, reservedFeeMicrousd: 160_000 }, { status: "superseded", reservedFeeMicrousd: 160_000 },
      { status: "failed", reservedFeeMicrousd: 160_000 }, { status: "unknown", reservedFeeMicrousd: 20_000 }, { status: "committed", reservedFeeMicrousd: 5_000 }]);
    expect(directoryExposure(join(root, "runs/r1"), "run")).toBe(175_000);
    expect(directoryExposure(join(root, "runs/absent"), "run")).toBe(0);
    // A loop: every stage directory, a moved-aside run included; a void start with no ledger counts nothing.
    writeLedger(join(root, "loops/l1/a"), [{ status: "settled", feeMicrousd: 100_000 }]);
    writeLedger(join(root, "loops/l1/a.infra-1"), [{ status: "settled", feeMicrousd: 40_000 }, { status: "unknown", reservedFeeMicrousd: 7_000 }]);
    mkdirSync(join(root, "loops/l1/b.void-1"));
    expect(directoryExposure(join(root, "loops/l1"), "loop")).toBe(147_000);
    writeLoop(join(root, "loops/l1"), { feeMicrousd: 300_000 });
    expect(directoryExposure(join(root, "loops/l1"), "loop")).toBe(307_000);
    // Anything it must count and cannot read stops the batch (fail closed).
    writeLedger(join(root, "runs/r2"), [{ status: "committed", reservedFeeMicrousd: "a lot" }]);
    expect(() => directoryExposure(join(root, "runs/r2"), "run")).toThrow("launcher_ledger_unreadable");
    mkdirSync(join(root, "runs/r3")); writeFileSync(join(root, "runs/r3/freeze.json"), JSON.stringify({ jobId: "job-c" }));
    expect(() => directoryExposure(join(root, "runs/r3"), "run")).toThrow("launcher_ledger_unreadable");
    symlinkSync(join(root, "runs/r1"), join(root, "runs/r4"));
    expect(() => directoryExposure(join(root, "runs/r4"), "run")).toThrow("launcher_ledger_unreadable");
    writeFileSync(join(root, "loops/l1/loop.json"), "{\"totals\":");
    expect(() => readLoopView(join(root, "loops/l1"))).toThrow("launcher_loop_unreadable");
  });
});

describe("experiment launcher: refusals", () => {
  it("refuses, before it writes anything, a dirty tree, a commit git cannot name, a HEAD that is not on main, an invalid queue and a held state directory", async () => {
    const root = workspace(), queue = writeQueue(root, [singleRun("r1")]);
    for (const [options, code] of [[{ git: { commit: "c".repeat(40), dirty: true } }, "tree_dirty"], [{ git: null }, "commit_unknown"], [{ onMain: false }, "head_not_on_main"],
      [{ onMain: null }, "main_unknown"], [{ locked: true }, "launcher_locked"]] as [HarnessOptions, string][]) {
      const h = harness(root, options), state = join(workspace(), "state");
      expect(await launch(h, queue, state)).toMatchObject({ state: "refused", code });
      expect(h.spawned).toEqual([]);
    }
    const h = harness(root);
    expect(await launch(h, writeQueue(root, [singleRun("r1")], { windows: [[T0 + H, T0]], name: "bad.json" }), join(workspace(), "state"))).toMatchObject({ state: "refused", code: "queue_invalid" });
  });
  it("refuses a queue other than the one its ledger began with, and an inhibitor that does not start, with the refusal recorded", async () => {
    const root = workspace(), state = join(workspace(), "state");
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "launcher.jsonl"), `${JSON.stringify({ event: "launcher_started", at: iso(T0 - H), queueSha256: "0".repeat(64) })}\n`);
    expect(await launch(harness(root), writeQueue(root, [singleRun("r1")]), state)).toMatchObject({ state: "refused", code: "queue_changed" });
    const state2 = join(workspace(), "state"), h = harness(root, { inhibitor: false });
    expect(await launch(h, writeQueue(root, [singleRun("r1")]), state2)).toMatchObject({ state: "refused", code: "inhibitor_failed" });
    expect(named(state2, "refused")).toEqual([expect.objectContaining({ code: "inhibitor_failed" })]); expect(h.spawned).toEqual([]);
    writeFileSync(join(state, "launcher.jsonl"), "not json\n");
    expect(await launch(harness(root), writeQueue(root, [singleRun("r1")]), state)).toMatchObject({ state: "refused", code: "ledger_unreadable" });
  });
});

describe("experiment launcher: the batch rules (HARN-26)", () => {
  it("starts one run at a time in the queue's order, only inside a window, after three idle observations 20 s apart, and never cuts an admitted run at a window's end", async () => {
    const root = workspace(), state = join(workspace(), "state");
    const queue = writeQueue(root, [singleRun("r1"), singleRun("r2"), singleRun("r3")], { windows: [[T0 + H, T0 + 2 * H], [T0 + 3 * H, T0 + 4 * H]] });
    const h = harness(root, { scripts: () => ({ ms: 50 * M }) });
    expect(await launch(h, queue, state)).toMatchObject({ state: "done", code: "queue_done", finished: 3, pending: 0 });
    expect(h.spawned.map(item => item.run)).toEqual(["r1", "r2", "r3"]);
    // r1 waits for the first window and its idle check; r2 starts inside it and runs past its end, uncut; r3 waits for the second window.
    expect(h.spawned[0]!.at).toBe(T0 + H + 2 * 20_000);
    expect(h.spawned[1]!.at).toBeLessThan(T0 + 2 * H); expect(h.spawned[1]!.at + 50 * M).toBeGreaterThan(T0 + 2 * H);
    expect(h.spawned[2]!.at).toBe(T0 + 3 * H + 2 * 20_000); expect(h.sent).toEqual([]);
    expect(h.metricTimes.slice(0, 3)).toEqual([T0 + H, T0 + H + 20_000, T0 + H + 2 * 20_000]);
    // Each run's exit is followed by a recorded quiescence check, and the ledger opens with the launcher's identity.
    expect(named(state, "quiescence")).toHaveLength(3);
    expect(named(state, "launcher_started")).toEqual([expect.objectContaining({ version: 1, launcherSha256: "f".repeat(64), commit: "c".repeat(40), batch: "e3-test", batchCapMicrousd: 20_400_000, inhibitor: "test" })]);
  });
  it("starts nothing on a busy or unreadable endpoint, checks again a minute later, and ends when the windows run out", async () => {
    const root = workspace(), state = join(workspace(), "state");
    // Busy at the second observation of the first check, then idle.
    const h = harness(root, { metrics: call => call === 2 ? { running: 1, waiting: 0 } : { running: 0, waiting: 0 } });
    expect(await launch(h, writeQueue(root, [singleRun("r1")]), state)).toMatchObject({ state: "done" });
    expect(h.spawned[0]!.at).toBe(T0 + 20_000 + 60_000 + 2 * 20_000);
    expect(named(state, "idle_check").map(event => event.result)).toEqual(["busy", "idle"]);
    // An unreadable /metrics route is not idle: nothing starts, the code is recorded once, and the batch ends with its windows.
    const state2 = join(workspace(), "state"), dark = harness(root, { metrics: () => null });
    expect(await launch(dark, writeQueue(root, [singleRun("r1")], { windows: [[T0, T0 + H]] }), state2)).toMatchObject({ state: "stopped", code: "windows_exhausted", pending: 1 });
    expect(dark.spawned).toEqual([]); expect(named(state2, "idle_check").map(event => event.result)).toEqual(["unavailable"]);
  });
  it("keeps settled fees plus pinned reservations plus the next run's cap within the batch cap", async () => {
    const root = workspace(), state = join(workspace(), "state");
    const runs = [singleRun("r1", { capUsd: 1 }), singleRun("r2", { capUsd: 0.5 })];
    const h = harness(root, { scripts: id => ({ start: run => { if (id === "r1") writeLedger(run.directory, [{ status: "settled", feeMicrousd: 1_500_000 }, { status: "unknown", reservedFeeMicrousd: 200_000 }]); } }) });
    expect(await launch(h, writeQueue(root, runs, { batchCapUsd: 2 }), state)).toMatchObject({ state: "stopped", code: "batch_cap_reached", spentMicrousd: 1_700_000 });
    expect(h.spawned.map(item => item.run)).toEqual(["r1"]);
    expect(named(state, "batch_cap_reached")).toEqual([expect.objectContaining({ spentMicrousd: 1_700_000, nextMicrousd: 500_000 })]);
    expect(named(state, "run_admitted")).toEqual([expect.objectContaining({ run: "r1", attempt: 1, capMicrousd: 1_000_000, spentMicrousd: 0 })]);
    // A ledger it cannot read stops the batch too.
    const root2 = workspace(), state2 = join(workspace(), "state"), broken = harness(root2, { scripts: () => ({ start: run => writeLedger(run.directory, [{ status: "committed" }]) }) });
    expect(await launch(broken, writeQueue(root2, [singleRun("r1"), singleRun("r2")]), state2)).toMatchObject({ state: "stopped", code: "batch_cap_unreadable" });
    expect(broken.spawned.map(item => item.run)).toEqual(["r1"]);
  });
  it("never starts a single run again, and records its end and its job id for the registry", async () => {
    const root = workspace(), state = join(workspace(), "state");
    const h = harness(root, { scripts: () => ({ code: 2, start: run => {
      writeLedger(run.directory, [], "job-r1");
      writeFileSync(join(run.directory, "result.json"), JSON.stringify({ status: "incomplete", reason: "model_unavailable", finishedAt: iso(Date.now()) }));
    } }) });
    expect(await launch(h, writeQueue(root, [singleRun("r1")]), state)).toMatchObject({ state: "done", finished: 1 });
    expect(h.spawned).toHaveLength(1);
    expect(named(state, "run_exited")).toEqual([expect.objectContaining({ run: "r1", attempt: 1, exitCode: 2, signalled: false, jobId: "job-r1" })]);
    expect(named(state, "run_finished")).toEqual([expect.objectContaining({ run: "r1", outcome: "model_unavailable" })]);
  });
  it("honours a STOP file: nothing starts, and a run in progress finishes", async () => {
    const root = workspace(), state = join(workspace(), "state");
    mkdirSync(state, { recursive: true }); writeFileSync(join(state, "STOP"), "");
    const h = harness(root);
    expect(await launch(h, writeQueue(root, [singleRun("r1")]), state)).toMatchObject({ state: "stopped", code: "stop_file", pending: 1 });
    expect(h.spawned).toEqual([]);
    const state2 = join(workspace(), "state"), h2 = harness(root, { scripts: () => ({ ms: 20 * M, start: () => { setTimeout(() => writeFileSync(join(state2, "STOP"), ""), 5 * M); } }) });
    expect(await launch(h2, writeQueue(root, [singleRun("r1"), singleRun("r2")]), state2)).toMatchObject({ state: "stopped", code: "stop_file", finished: 1, pending: 1 });
    expect(h2.spawned.map(item => item.run)).toEqual(["r1"]); expect(h2.sent).toEqual([]);
  });
});

describe("experiment launcher: supervision", () => {
  it("forwards an owner's signal to the run's process group, records it for the registry, and starts nothing after it", async () => {
    const root = workspace(), state = join(workspace(), "state");
    let h!: ReturnType<typeof harness>;
    h = harness(root, { scripts: () => ({ ms: 40 * M, start: () => { setTimeout(() => h.emit("SIGINT"), 5 * M); } }) });
    expect(await launch(h, writeQueue(root, [singleRun("r1"), singleRun("r2")]), state)).toMatchObject({ state: "stopped", code: "signal", finished: 1, pending: 1 });
    expect(h.sent.map(item => item.signal)).toEqual(["SIGINT"]); expect(h.spawned.map(item => item.run)).toEqual(["r1"]);
    expect(named(state, "signal_forwarded")).toEqual([expect.objectContaining({ run: "r1", attempt: 1, signal: "SIGINT" })]);
    expect(named(state, "run_exited")).toEqual([expect.objectContaining({ run: "r1", signalled: true })]);
  });
  it("sends SIGKILL only after a bounded wait on the owner's stop, or at once on a second signal, and stops when no reap follows", async () => {
    const root = workspace();
    const stubborn = (delays: number[], over: Partial<Script> = {}) => {
      const state = join(workspace(), "state");
      let h!: ReturnType<typeof harness>;
      h = harness(root, { scripts: () => ({ ms: 5 * H, ignore: true, ...over, start: () => { for (const [index, delay] of delays.entries()) setTimeout(() => h.emit(index ? "SIGTERM" : "SIGINT"), delay); } }) });
      return { h, state };
    };
    const one = stubborn([5 * M]);
    expect(await launch(one.h, writeQueue(root, [singleRun("r1")]), one.state)).toMatchObject({ state: "stopped", code: "signal" });
    expect(one.h.sent.map(item => item.signal)).toEqual(["SIGINT", "SIGKILL"]);
    expect(one.h.sent[1]!.at - one.h.sent[0]!.at).toBe(120_000);
    expect(named(one.state, "kill_sent")).toHaveLength(1);
    const two = stubborn([5 * M, 5 * M + 10_000]);
    await launch(two.h, writeQueue(root, [singleRun("r1")]), two.state);
    expect(two.h.sent.map(item => item.signal)).toEqual(["SIGINT", "SIGKILL"]); expect(two.h.sent[1]!.at - two.h.sent[0]!.at).toBe(10_000);
    const zombie = stubborn([5 * M], { unreaped: true });
    expect(await launch(zombie.h, writeQueue(root, [singleRun("r1")]), zombie.state)).toMatchObject({ state: "stopped", code: "reap_unconfirmed" });
    expect(named(zombie.state, "reap_unconfirmed")).toHaveLength(1);
    expect(events(zombie.state).at(-1)).toMatchObject({ event: "launcher_stopped", code: "reap_unconfirmed" });
    expect(Date.parse(events(zombie.state).at(-1)!.at as string) - zombie.h.sent[1]!.at).toBe(10_000);
  });
});

describe("experiment launcher: loops (HARN-22)", () => {
  it("re-invokes a loop that stopped resumably in a later window, never on loop_locked or a terminal stop, and at most four more times", async () => {
    const root = workspace(), state = join(workspace(), "state");
    const windows: [number, number][] = [[T0, T0 + 2 * H], [T0 + 3 * H, T0 + 5 * H]];
    const h = harness(root, { scripts: (id, attempt) => ({ ms: 10 * M, code: id === "l1" && attempt === 2 ? 0 : 2, start: (run, files) => {
      if (id === "l1") writeLoop(run.directory, attempt === 1 ? { failure: "loop_stage_infra" } : { final: { candidate: "a", step: "tie" } });
      // A second loop held by another invocation: its record is an old resumable one, and its failure line names the lock.
      if (id === "l2") writeFileSync(files.err, `${JSON.stringify({ state: "incomplete", error: "loop_locked" })}\n`);
      // A loop that failed on its own, with no stop and no selection: not one of part 3b's resumable stops.
      if (id === "l4") writeLoop(run.directory, { failure: "loop_failed" });
    } }) });
    writeLoop(join(root, "loops/l2"), { failure: "loop_stage_infra", finishedAt: iso(T0 - H) });
    writeLoop(join(root, "loops/l3"), { stopped: { stage: "b", failure: "loop_resume_spent" }, finishedAt: iso(T0 - H) });
    expect(await launch(h, writeQueue(root, [loopRun("l1"), loopRun("l2"), loopRun("l3"), loopRun("l4")], { windows }), state)).toMatchObject({ state: "done", finished: 4 });
    expect(h.spawned.map(item => `${item.run}.${item.attempt}`)).toEqual(["l1.1", "l2.1", "l3.1", "l4.1", "l1.2"]);
    expect(h.spawned[4]!.at).toBeGreaterThanOrEqual(T0 + 3 * H);
    expect(named(state, "run_deferred")).toEqual([expect.objectContaining({ run: "l1", attempt: 1, notBefore: iso(T0 + 2 * H) })]);
    expect(named(state, "run_finished").map(event => [event.run, event.outcome])).toEqual([["l2", "loop_locked"], ["l3", "loop_resume_spent"], ["l4", "loop_failed"], ["l1", "tie"]]);
    // A loop the owner stops while it refuses on its lock is never re-invoked either.
    const state3 = join(workspace(), "state");
    let locked!: ReturnType<typeof harness>;
    locked = harness(root, { scripts: () => ({ ms: 10 * M, code: 1, start: (_run, files) => { writeFileSync(files.err, `${JSON.stringify({ state: "incomplete", error: "loop_locked" })}\n`); setTimeout(() => locked.emit("SIGTERM"), M); } }) });
    expect(await launch(locked, writeQueue(root, [loopRun("l5")], { windows, name: "q3.json" }), state3)).toMatchObject({ state: "stopped", code: "signal", finished: 1 });
    expect(named(state3, "run_deferred")).toEqual([]); expect(named(state3, "run_finished")).toEqual([expect.objectContaining({ run: "l5", outcome: "loop_locked" })]);
    // A loop that keeps stopping resumably is left for --close after its fifth invocation.
    const state2 = join(workspace(), "state");
    const many = Array.from({ length: 7 }, (_, index): [number, number] => [T0 + index * 2 * H, T0 + index * 2 * H + H]);
    const again = harness(root, { scripts: () => ({ ms: 10 * M, code: 2, start: run => writeLoop(run.directory, { failure: "loop_interrupted" }) }) });
    expect(await launch(again, writeQueue(root, [loopRun("l9")], { windows: many, name: "q2.json" }), state2)).toMatchObject({ state: "done" });
    expect(again.spawned).toHaveLength(1 + 4);
    expect(named(state2, "run_finished")).toEqual([expect.objectContaining({ run: "l9", attempt: 1 + 4, outcome: "reinvoke_limit" })]);
  });
  it("resumes from its own ledger after a restart: finished runs are skipped, a run still going refuses, and a lost one is decided", async () => {
    const root = workspace(), state = join(workspace(), "state"), queue = writeQueue(root, [singleRun("r1"), loopRun("l1"), singleRun("r2")]);
    const sha = parseQueue(readFileSync(queue), root).sha256;
    mkdirSync(state, { recursive: true });
    const line = (event: Record<string, unknown>) => `${JSON.stringify({ at: iso(T0 - H), ...event })}\n`;
    writeFileSync(join(state, "launcher.jsonl"), line({ event: "launcher_started", queueSha256: sha }) + line({ event: "run_admitted", run: "r1", attempt: 1, priorFinishedAt: null }) +
      line({ event: "run_started", run: "r1", attempt: 1, pid: 77 }) + line({ event: "run_exited", run: "r1", attempt: 1, exitCode: 0, signal: null, failure: null, signalled: false, jobId: null }) +
      line({ event: "run_finished", run: "r1", attempt: 1, outcome: "submitted" }) + line({ event: "run_admitted", run: "l1", attempt: 1, priorFinishedAt: null }) + line({ event: "run_started", run: "l1", attempt: 1, pid: 88 }));
    const busy = harness(root, { alive: pid => pid === 88 });
    expect(await launch(busy, queue, state)).toMatchObject({ state: "refused", code: "previous_run_running" }); expect(busy.spawned).toEqual([]);
    // Once the pid is gone the loop is lost with the launcher: it resumes in a later window like an interrupted one; r1 never runs again.
    const h = harness(root, { scripts: () => ({ start: run => { if (run.kind === "loop") writeLoop(run.directory, { final: { candidate: "a", step: "submitted" } }); } }) });
    expect(await launch(h, queue, state)).toMatchObject({ state: "done", finished: 3 });
    expect(named(state, "run_lost")).toEqual([expect.objectContaining({ run: "l1", attempt: 1 })]);
    expect(h.spawned.map(item => item.run)).toEqual(["l1", "r2"]);
    expect(named(state, "run_admitted").slice(-2).map(event => `${event.run}.${event.attempt}`)).toEqual(["l1.2", "r2.1"]);
    // Admitted outside any window, the lost loop may resume in the first one; admitted inside the window it would wait for a later one.
    expect(named(state, "run_deferred")).toEqual([expect.objectContaining({ run: "l1", attempt: 1, notBefore: iso(T0 - H) })]);
  });
  it("writes codes and counts only: no path, argument or child output reaches its ledger", async () => {
    const root = workspace(), state = join(workspace(), "state");
    const h = harness(root, { scripts: (id) => ({ code: 1, start: (run, files) => { writeFileSync(files.err, `Error: ENOENT ${root}/secret/path\n`); if (id === "l1") writeLoop(run.directory, { failure: "loop_stage_infra" }); } }) });
    await launch(h, writeQueue(root, [loopRun("l1"), singleRun("r1")], { windows: [[T0, T0 + H]] }), state);
    const text = readFileSync(join(state, "launcher.jsonl"), "utf8");
    expect(text).not.toContain(root); expect(text).not.toContain("loops/"); expect(text).not.toContain("--select-and-repair"); expect(text).not.toContain("ENOENT");
    for (const event of events(state)) expect(Object.keys(event)).toEqual(Object.keys(event).sort());
    expect(named(state, "run_exited").map(event => event.failure)).toEqual([null, null]);
  });
});

describe("experiment launcher after its light review (PR #98)", () => {
  it("pins the decided values", () => {
    expect({ IDLE_OBSERVATIONS, IDLE_SPACING_MS, IDLE_RETRY_MS, TERM_WAIT_MS, REAP_WAIT_MS, MAX_LOOP_REINVOCATIONS, SIGNAL_REPEAT_MS })
      .toEqual({ IDLE_OBSERVATIONS: 3, IDLE_SPACING_MS: 20_000, IDLE_RETRY_MS: 60_000, TERM_WAIT_MS: 120_000, REAP_WAIT_MS: 10_000, MAX_LOOP_REINVOCATIONS: 4, SIGNAL_REPEAT_MS: 5_000 });
  });
  it("takes one Ctrl-C delivered twice (pnpm and the terminal) as one signal, and a hangup as the run's graceful SIGTERM", async () => {
    const root = workspace(), state = join(workspace(), "state");
    let h!: ReturnType<typeof harness>;
    h = harness(root, { scripts: () => ({ ms: 5 * H, ignore: true, start: () => { setTimeout(() => { h.emit("SIGINT"); h.emit("SIGINT"); }, 5 * M); } }) });
    await launch(h, writeQueue(root, [singleRun("r1")]), state);
    expect(h.sent.map(item => item.signal)).toEqual(["SIGINT", "SIGKILL"]); expect(h.sent[1]!.at - h.sent[0]!.at).toBe(120_000);
    expect(named(state, "signal_repeated")).toEqual([expect.objectContaining({ signal: "SIGINT", run: "r1", attempt: 1 })]);
    const state2 = join(workspace(), "state");
    let hup!: ReturnType<typeof harness>;
    // A real hangup through a shell arrives twice, about 3 ms apart: one SIGTERM to the run, the repeat recorded, no SIGKILL.
    hup = harness(root, { scripts: () => ({ ms: 5 * H, start: () => { setTimeout(() => { hup.emit("SIGHUP"); hup.emit("SIGHUP"); }, 5 * M); } }) });
    expect(await launch(hup, writeQueue(root, [singleRun("r1")]), state2)).toMatchObject({ state: "stopped", code: "signal" });
    expect(hup.sent.map(item => item.signal)).toEqual(["SIGTERM"]);
    expect(named(state2, "signal_forwarded")).toEqual([expect.objectContaining({ signal: "SIGTERM", received: "SIGHUP" })]);
    expect(named(state2, "signal_repeated")).toEqual([expect.objectContaining({ signal: "SIGHUP" })]);
  });
  it("re-invokes a loop whose second invocation was killed, or lost with the launcher, before it finished its record", async () => {
    const root = workspace(), state = join(workspace(), "state");
    const halfWritten = (directory: string) => writeLoop(directory, { finishedAt: null });
    const windows: [number, number][] = [[T0, T0 + 2 * H], [T0 + 3 * H, T0 + 5 * H], [T0 + 6 * H, T0 + 8 * H]];
    const h = harness(root, { scripts: (_id, attempt) => attempt === 1 ? { ms: 10 * M, code: 2, start: run => writeLoop(run.directory, { failure: "loop_stage_infra" }) }
      : attempt === 2 ? { ms: 10 * M, killed: true, start: run => halfWritten(run.directory) } : { ms: 10 * M, start: run => writeLoop(run.directory, { final: { candidate: "a", step: "tie" } }) } });
    expect(await launch(h, writeQueue(root, [loopRun("l1")], { windows }), state)).toMatchObject({ state: "done", finished: 1 });
    expect(h.spawned).toHaveLength(3); expect(named(state, "run_deferred").map(event => event.attempt)).toEqual([1, 2]);
    expect(named(state, "run_finished")).toEqual([expect.objectContaining({ run: "l1", attempt: 3, outcome: "tie" })]);
    // Lost with the launcher during its second invocation, with the record half-written: deferred, then invoked a third time.
    vi.setSystemTime(T0);   // the first batch ran its clock past the default window
    const root2 = workspace(), state2 = join(workspace(), "state"), queue = writeQueue(root2, [loopRun("l1")]);
    halfWritten(join(root2, "loops/l1"));
    mkdirSync(state2, { recursive: true });
    const line = (event: Record<string, unknown>) => `${JSON.stringify({ at: iso(T0 - 2 * H), ...event })}\n`;
    writeFileSync(join(state2, "launcher.jsonl"), line({ event: "launcher_started", queueSha256: parseQueue(readFileSync(queue), root2).sha256 }) +
      line({ event: "run_admitted", run: "l1", attempt: 1, priorFinishedAt: null }) + line({ event: "run_started", run: "l1", attempt: 1, pid: 70 }) +
      line({ event: "run_exited", run: "l1", attempt: 1, exitCode: 2, signal: null, failure: null, signalled: false, jobId: null }) +
      line({ event: "run_deferred", run: "l1", attempt: 1, notBefore: iso(T0 - 2 * H) }) +
      line({ event: "run_admitted", run: "l1", attempt: 2, priorFinishedAt: iso(T0 - 3 * H) }) + line({ event: "run_started", run: "l1", attempt: 2, pid: 88 }));
    const resumed = harness(root2, { scripts: () => ({ start: run => writeLoop(run.directory, { final: { candidate: "a", step: "submitted" } }) }) });
    expect(await launch(resumed, queue, state2)).toMatchObject({ state: "done", finished: 1 });
    expect(named(state2, "run_lost")).toEqual([expect.objectContaining({ run: "l1", attempt: 2 })]);
    expect(named(state2, "run_deferred").at(-1)).toMatchObject({ attempt: 2 });
    expect(named(state2, "run_admitted").at(-1)).toMatchObject({ run: "l1", attempt: 3 });
  });
  it("checks the tree, the commit and its place on main again before each admission", async () => {
    const root = workspace();
    for (const [later, code] of [[{ commit: "c".repeat(40), dirty: true }, "tree_dirty"], [{ commit: "d".repeat(40), dirty: false }, "commit_changed"], [null, "commit_unknown"]] as const) {
      const state = join(workspace(), "state");
      const h = harness(root, { git: call => call >= 3 ? later : { commit: "c".repeat(40), dirty: false } });
      expect(await launch(h, writeQueue(root, [singleRun("r1"), singleRun("r2")]), state)).toMatchObject({ state: "stopped", code, finished: 1, pending: 1 });
      expect(h.spawned.map(item => item.run)).toEqual(["r1"]);
    }
    for (const [later, code] of [[false, "head_not_on_main"], [null, "main_unknown"]] as const) {
      const state = join(workspace(), "state");
      const h = harness(root, { onMain: call => call >= 3 ? later : true });
      expect(await launch(h, writeQueue(root, [singleRun("r1"), singleRun("r2")]), state)).toMatchObject({ state: "stopped", code, finished: 1, pending: 1 });
      expect(h.spawned.map(item => item.run)).toEqual(["r1"]);
    }
  });
  it("records a single run's job id on its finish and on its loss, and keeps a loop record's finish time only when it is an instant", async () => {
    const root = workspace(), state = join(workspace(), "state");
    const h = harness(root, { scripts: () => ({ start: run => writeLedger(run.directory, [], "job-r1") }) });
    await launch(h, writeQueue(root, [singleRun("r1")]), state);
    expect(named(state, "run_finished")).toEqual([expect.objectContaining({ run: "r1", outcome: "submitted", jobId: "job-r1" })]);
    const root2 = workspace(), state2 = join(workspace(), "state"), queue = writeQueue(root2, [singleRun("r9")]);
    writeLedger(join(root2, "runs/r9"), [], "job-r9");
    mkdirSync(state2, { recursive: true });
    writeFileSync(join(state2, "launcher.jsonl"), [{ event: "launcher_started", queueSha256: parseQueue(readFileSync(queue), root2).sha256 },
      { event: "run_admitted", run: "r9", attempt: 1, priorFinishedAt: null }, { event: "run_started", run: "r9", attempt: 1, pid: 99 }]
      .map(event => JSON.stringify({ at: iso(T0 - H), ...event })).join("\n") + "\n");
    await launch(harness(root2), queue, state2);
    expect(named(state2, "run_lost")).toEqual([expect.objectContaining({ run: "r9", jobId: "job-r9" })]);
    expect(named(state2, "run_finished")).toEqual([expect.objectContaining({ run: "r9", outcome: "run_lost", jobId: "job-r9" })]);
    const root3 = workspace(), state3 = join(workspace(), "state");
    mkdirSync(join(root3, "loops/l1"), { recursive: true });
    writeFileSync(join(root3, "loops/l1/loop.json"), JSON.stringify({ version: 2, finishedAt: "/Users/someone/secret", failure: null, stopped: null, selected: { final: null }, totals: { feeMicrousd: 0 } }));
    await launch(harness(root3, { scripts: () => ({ start: run => writeLoop(run.directory, { final: { candidate: "a", step: "tie" } }) }) }), writeQueue(root3, [loopRun("l1")]), state3);
    expect(named(state3, "run_admitted")).toEqual([expect.objectContaining({ run: "l1", priorFinishedAt: null })]);
    expect(readFileSync(join(state3, "launcher.jsonl"), "utf8")).not.toContain("someone");
  });
  it("signals the run before it writes the ledger, and stops after the run when the ledger cannot be written", async () => {
    const root = workspace(), state = join(workspace(), "state");
    let h!: ReturnType<typeof harness>;
    h = harness(root, { scripts: () => ({ ms: 5 * H, start: () => {
      setTimeout(() => { rmSync(join(state, "launcher.jsonl")); mkdirSync(join(state, "launcher.jsonl")); }, M);
      setTimeout(() => h.emit("SIGINT"), 2 * M);
    } }) });
    expect(await launch(h, writeQueue(root, [singleRun("r1"), singleRun("r2")]), state)).toMatchObject({ state: "stopped", code: "ledger_unwritable" });
    expect(h.sent.map(item => item.signal)).toEqual(["SIGINT"]); expect(h.spawned.map(item => item.run)).toEqual(["r1"]);
  });
});

describe("experiment launcher after the skeptic's re-check (PR #98)", () => {
  it("never escalates on a hangup: a Ctrl-C, then the terminal closed 6 s later while the run stops, sends SIGKILL only after 120 s", async () => {
    const root = workspace(), state = join(workspace(), "state");
    let h!: ReturnType<typeof harness>;
    h = harness(root, { scripts: () => ({ ms: 5 * H, ignore: true, start: () => {
      setTimeout(() => h.emit("SIGINT"), 5 * M);
      setTimeout(() => { h.emit("SIGHUP"); h.emit("SIGHUP"); }, 5 * M + 6_000);
    } }) });
    await launch(h, writeQueue(root, [singleRun("r1")]), state);
    expect(h.sent.map(item => item.signal)).toEqual(["SIGINT", "SIGKILL"]); expect(h.sent[1]!.at - h.sent[0]!.at).toBe(120_000);
    expect(named(state, "signal_repeated")).toEqual([expect.objectContaining({ signal: "SIGHUP", run: "r1", attempt: 1 }),
      expect.objectContaining({ signal: "SIGHUP", run: "r1", attempt: 1 })]);
  });
  it("ignores EIO and EPIPE on its final line, as a hangup's dead terminal gives them, and no other write error", () => {
    const stream = (code: string, how: "throw" | "emit") => {
      const emitter = new EventEmitter();
      return Object.assign(emitter, { write: () => { const error = Object.assign(new Error(code), { code }); if (how === "throw") throw error; emitter.emit("error", error); return false; } });
    };
    for (const code of ["EIO", "EPIPE"]) for (const how of ["throw", "emit"] as const) expect(() => writeFinalLine(stream(code, how), "{}\n")).not.toThrow();
    for (const how of ["throw", "emit"] as const) expect(() => writeFinalLine(stream("EACCES", how), "{}\n")).toThrow("EACCES");
  });
});
