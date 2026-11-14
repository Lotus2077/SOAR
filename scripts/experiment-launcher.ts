/**
 * Plan 11.5 (BL-20261114-1250-experiment-launcher-design): a supervised launcher that runs an experiment card's queue of harness
 * runs, H4 loops through scripts/phase4-loop.ts and single runs through scripts/private-agent-local-screen.ts. It runs them one at
 * a time, in the queue's order, only inside the card's windows, only on an idle endpoint and only under the batch's fee cap. It is a
 * tracked, tested port of the H4 and H5 supervisor (BL-20261101-0036, BL-20261101-0135): each run is a child in its own process
 * group, signals are forwarded to that group, and SIGKILL follows only a bounded wait on the owner's stop. An admitted run is never
 * cut at the end of a window. The launcher is outside the source freeze, and its ledger (DIR/launcher.jsonl) holds codes and counts
 * only: never a path, the endpoint's address, a key, an error message or a child's output.
 *
 *   node --import tsx scripts/experiment-launcher.ts --queue QUEUE.json --state-directory DIR   (run from the repository root)
 *
 * The queue is the operator's transcription of the card (docs/experiments/LAUNCHER.md). Each run's output goes to DIR/runs. A STOP
 * file in DIR stops new starts, and the run in progress finishes.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { loadConfig } from "../src/main/config";
import { canonical, digest } from "../src/main/private-agent/contracts";
import { acquireLoopLock } from "../src/main/private-agent/loop-ledger";
import { readRunLedger, readRunObject, readRunResult } from "../src/main/private-agent/selection";
import { localScreenGitRunner, localScreenGitState, localScreenSourceFreeze } from "./private-agent-local-screen";

export const LAUNCHER_LEDGER_VERSION = 1;
/** Decision (3): 3 observations 20 s apart, all with no running and no waiting request, before any start. */
export const IDLE_OBSERVATIONS = 3;
export const IDLE_SPACING_MS = 20_000;
/** How long the launcher waits after a busy or unreadable idle check before it checks again. */
export const IDLE_RETRY_MS = 60_000;
/** How often a wait for a window or a later start looks at the STOP file. */
export const WAIT_POLL_MS = 30_000;
/** Decision (5): the wait after a forwarded signal before SIGKILL, and the wait for the reap after it. */
export const TERM_WAIT_MS = 120_000;
export const REAP_WAIT_MS = 10_000;
/** Decision (6): at most this many re-invocations of one loop after its first. */
export const MAX_LOOP_REINVOCATIONS = 4;
/** Decision (6), HARN-22: the loop stops that part 3b resumes in a later invocation (BL-20261113-0836-infra-resume-design). */
export const RESUMABLE_LOOP_FAILURES: readonly string[] = ["loop_stage_infra", "loop_interrupted", "loop_stage_cleanup_required", "loop_stage_ledger_unreadable"];
export const LAUNCHER_SCRIPTS = { loop: "scripts/phase4-loop.ts", run: "scripts/private-agent-local-screen.ts" } as const;
const LAUNCHER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const RUN_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const JOB_ID = /^[A-Za-z0-9_-]{1,100}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/u;
const MICRO = 1_000_000;

const QueueSchema = z.strictObject({
  version: z.literal(1),
  batch: z.string().regex(RUN_ID),
  batchCapUsd: z.number().positive(),
  windows: z.array(z.strictObject({ start: z.string().regex(INSTANT), end: z.string().regex(INSTANT) })).min(1),
  runs: z.array(z.strictObject({
    id: z.string().regex(RUN_ID),
    kind: z.enum(["loop", "run"]),
    capUsd: z.number().nonnegative(),
    argv: z.array(z.string().min(1)).min(1),
    projectedSeconds: z.number().int().positive().optional(),
  })).min(1),
});
export interface QueueRun { id: string; kind: "loop" | "run"; capMicrousd: number; argv: string[]; directory: string; projectedMs: number | null }
export interface LauncherQueue { batch: string; batchCapMicrousd: number; windows: { start: number; end: number }[]; runs: QueueRun[]; sha256: string }
export interface LauncherInput { queuePath: string; stateDirectory: string }
export interface ChildExit { code: number | null; signal: string | null }
export interface LauncherChild { pid: number; signal(signal: NodeJS.Signals): void; exited: Promise<ChildExit> }
export type ForwardedSignal = "SIGINT" | "SIGTERM" | "SIGHUP";
export interface LauncherSignals { subscribe(listener: (signal: ForwardedSignal) => void): () => void }
export interface LauncherDependencies {
  /** The repository root, which the queue's directories are relative to. */
  root: string;
  now(): number;
  /** Resolves after `ms`, or as soon as `cancel` aborts. */
  sleep(ms: number, cancel: AbortSignal): Promise<void>;
  /** Decision (3): `localScreenGitState()`; null when git cannot say (#73's review). */
  gitState(): { commit: string; dirty: boolean } | null;
  /** Decision (4), HARN-16: whether `commit` is an ancestor of the local `origin/main`; null when git cannot say. */
  headOnMain(commit: string): boolean | null;
  lock(directory: string): { release(): void };
  /** Decision (5): the idle-sleep inhibitor for the launcher's life; null when it did not start. */
  startInhibitor(): Promise<{ kind: string; stop(): void } | null>;
  /** Decision (3): the endpoint's request counts from its origin's /metrics; null when the route or a metric cannot be read. */
  readMetrics(): Promise<{ running: number; waiting: number } | null>;
  /** Starts one run as a child in its own process group, its output going to `files`. */
  spawnRun(run: QueueRun, files: { out: string; err: string }): LauncherChild;
  pidAlive(pid: number): boolean;
  launcherSha256(): string;
}
export interface LauncherOutcome { state: "done" | "stopped" | "refused"; code: string; finished: number; deferred: number; pending: number; spentMicrousd: number | null }

/** `--queue QUEUE.json --state-directory DIR`, nothing else; one leading `--`, which `pnpm launcher -- ...` passes on, is dropped. */
export function parseLauncherArguments(input: readonly string[]): LauncherInput {
  const args = input[0] === "--" ? input.slice(1) : input;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]!, value = args[index + 1];
    if (!["--queue", "--state-directory"].includes(name) || value === undefined || values.has(name)) throw new Error("launcher_cli_invalid");
    values.set(name, value);
  }
  if (values.size !== 2) throw new Error("launcher_cli_invalid");
  return { queuePath: resolve(values.get("--queue")!), stateDirectory: resolve(values.get("--state-directory")!) };
}

/** Decision (2): the strict queue, its windows in order and apart, each run naming its own directory once and a cap that covers its arguments' cap. */
export function parseQueue(bytes: Buffer, root: string): LauncherQueue {
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { throw new Error("launcher_queue_invalid"); }
  const parsed = QueueSchema.safeParse(raw);
  if (!parsed.success) throw new Error("launcher_queue_invalid");
  const windows = parsed.data.windows.map(window => ({ start: Date.parse(window.start), end: Date.parse(window.end) }));
  if (windows.some((window, index) => !Number.isFinite(window.start) || !Number.isFinite(window.end) || window.start >= window.end ||
      (index > 0 && windows[index - 1]!.end > window.start))) throw new Error("launcher_queue_invalid");
  const runs = parsed.data.runs.map(run => {
    const own = run.kind === "loop" ? "--loop-directory" : "--output-directory", other = run.kind === "loop" ? "--output-directory" : "--loop-directory";
    const at = run.argv.flatMap((value, index) => value === own ? [index] : []);
    if (at.length !== 1 || run.argv[at[0]! + 1] === undefined || run.argv.includes(other) || run.argv.includes("--close") ||
        (run.kind === "loop" && run.argv[0] !== "--select-and-repair")) throw new Error("launcher_queue_invalid");
    const fee = run.argv.indexOf("--max-fee-usd"), argumentCap = fee === -1 ? 0 : Number(run.argv[fee + 1]);
    if (!Number.isFinite(argumentCap) || argumentCap < 0) throw new Error("launcher_queue_invalid");
    // A loop's a, b and repair may each spend the arguments' cap; part 3b's resumes are zero fee.
    const capMicrousd = Math.round(run.capUsd * MICRO);
    if (capMicrousd < Math.round(argumentCap * MICRO) * (run.kind === "loop" ? 3 : 1)) throw new Error("launcher_queue_invalid");
    return { id: run.id, kind: run.kind, capMicrousd, argv: [...run.argv], directory: resolve(root, run.argv[at[0]! + 1]!),
      projectedMs: run.projectedSeconds === undefined ? null : run.projectedSeconds * 1000 };
  });
  if (new Set(runs.map(run => run.id)).size !== runs.length || new Set(runs.map(run => run.directory)).size !== runs.length) throw new Error("launcher_queue_invalid");
  return { batch: parsed.data.batch, batchCapMicrousd: Math.round(parsed.data.batchCapUsd * MICRO), windows, runs, sha256: digest(bytes) };
}

/** The endpoint's running and waiting request counts from a Prometheus text page, summed over label sets; null when either is absent or unreadable. */
export function parseMetrics(text: string): { running: number; waiting: number } | null {
  const total = (name: string): number | null => {
    let sum: number | null = null;
    for (const line of text.split("\n")) {
      if (line.startsWith("#")) continue;
      let rest: string;
      if (line.startsWith(`${name}{`)) { const close = line.lastIndexOf("}"); if (close === -1) return null; rest = line.slice(close + 1); }
      else if (line.startsWith(`${name} `)) rest = line.slice(name.length);
      else continue;
      const value = Number(rest.trim().split(/\s+/u)[0]);
      if (!Number.isFinite(value) || value < 0) return null;
      sum = (sum ?? 0) + value;
    }
    return sum;
  };
  const running = total("vllm:num_requests_running"), waiting = total("vllm:num_requests_waiting");
  return running === null || waiting === null ? null : { running, waiting };
}

/** A count a ledger row holds; anything else makes the ledger unreadable for the batch cap (fail closed). */
function counted(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("launcher_ledger_unreadable");
  return value;
}

/** What a loop directory's loop.json says, or null when there is none; throws `launcher_loop_unreadable` when it cannot be read. */
export interface LoopView { finishedAt: string | null; failure: string | null; stopped: string | null; final: string | null; feeMicrousd: number }
export function readLoopView(directory: string): LoopView | null {
  if (!existsSync(join(directory, "loop.json"))) return null;
  let value: Record<string, unknown> | undefined;
  try { value = readRunObject(directory, "loop.json")?.value; } catch { value = undefined; }
  const totals = value?.totals as Record<string, unknown> | undefined, selected = value?.selected as Record<string, unknown> | undefined;
  const stopped = value?.stopped as Record<string, unknown> | null | undefined, final = selected?.final as Record<string, unknown> | null | undefined;
  if (!value || typeof totals !== "object" || totals === null || typeof selected !== "object" || selected === null) throw new Error("launcher_loop_unreadable");
  const code = (item: unknown) => typeof item === "string" && CODE.test(item) ? item : null;
  return { finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null, failure: code(value.failure),
    stopped: stopped && typeof stopped === "object" ? code(stopped.failure) ?? "loop_stopped" : null,
    final: final && typeof final === "object" ? code(final.step) ?? "loop_final" : null, feeMicrousd: counted(totals.feeMicrousd) };
}

/**
 * Decision (3)'s spend of one queue run: settled fees plus pinned reservations by store.ts's exposure formula (a settled row its
 * fee, a superseded or failed row nothing, any other row its reservation), over every ledger in the run's directory; for a loop,
 * every stage directory, moved-aside runs included, and never less than loop.json's settled total. 0 when the directory is absent.
 * Throws `launcher_ledger_unreadable` (or `launcher_loop_unreadable`) when anything it must count cannot be read.
 */
export function directoryExposure(directory: string, kind: "loop" | "run"): number {
  if (!existsSync(directory)) return 0;
  if (lstatSync(directory).isSymbolicLink()) throw new Error("launcher_ledger_unreadable");
  const runs = kind === "run" ? [directory] : readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(directory, entry.name));
  let settled = 0, pinned = 0;
  for (const run of runs) {
    if (!["state.sqlite", "freeze.json", "result.json"].some(name => existsSync(join(run, name)))) continue;
    let rows: Record<string, unknown>[];
    try { rows = readRunLedger(run).dispatches; } catch { throw new Error("launcher_ledger_unreadable"); }
    for (const row of rows) {
      if (row.status === "settled") settled += counted(row.feeMicrousd);
      else if (row.status !== "superseded" && row.status !== "failed") pinned += counted(row.reservedFeeMicrousd);
    }
  }
  if (kind === "loop") { const loop = readLoopView(directory); if (loop) settled = Math.max(settled, loop.feeMicrousd); }
  return settled + pinned;
}

/** The last line of a child's error output, when it is the harness's failure line, as its code. */
export function readFailureLine(path: string): string | null {
  try {
    const lines = readFileSync(path, "utf8").split("\n").filter(line => line.trim().length > 0);
    const value = JSON.parse(lines.at(-1) ?? "") as unknown;
    const error = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).error : undefined;
    return typeof error === "string" && CODE.test(error) ? error : null;
  } catch { return null; }
}

/** A single run's job id from its freeze, for the registry's join (decision (10)). */
export function readRunJobId(directory: string): string | null {
  try { const jobId = readRunObject(directory, "freeze.json")?.value.jobId; return typeof jobId === "string" && JOB_ID.test(jobId) ? jobId : null; } catch { return null; }
}

interface AttemptState { attempt: number; admittedAt: number; pid: number | null; priorFinishedAt: string | null; exit: (ChildExit & { failure: string | null }) | null; lost: boolean; signalled: boolean; decided: boolean }
interface RunState { attempts: number; finished: string | null; notBefore: number | null; last: AttemptState | null }
interface History { queueSha256: string | null; runs: Map<string, RunState> }
const LEDGER_EVENTS = new Set(["launcher_started", "launcher_stopped", "refused", "idle_check", "quiescence", "window_too_short", "batch_cap_reached", "run_admitted",
  "run_started", "signal_forwarded", "kill_sent", "reap_unconfirmed", "run_exited", "run_lost", "run_deferred", "run_finished"]);

/** Applies one ledger event to the history it replays (decision (8)). */
function applyEvent(history: History, event: Record<string, unknown>): void {
  if (typeof event.event !== "string" || !LEDGER_EVENTS.has(event.event) || typeof event.at !== "string") throw new Error("launcher_ledger_unreadable");
  if (event.event === "launcher_started") { history.queueSha256 = typeof event.queueSha256 === "string" ? event.queueSha256 : null; return; }
  if (typeof event.run !== "string" || !["run_admitted", "run_started", "signal_forwarded", "run_exited", "run_lost", "run_deferred", "run_finished"].includes(event.event)) return;
  const state = history.runs.get(event.run) ?? { attempts: 0, finished: null, notBefore: null, last: null };
  history.runs.set(event.run, state);
  const last = state.last;
  if (event.event === "run_admitted") {
    if (typeof event.attempt !== "number") throw new Error("launcher_ledger_unreadable");
    state.attempts = event.attempt; state.notBefore = null;
    state.last = { attempt: event.attempt, admittedAt: Date.parse(event.at), pid: null, priorFinishedAt: typeof event.priorFinishedAt === "string" ? event.priorFinishedAt : null, exit: null, lost: false, signalled: false, decided: false };
    return;
  }
  if (!last || event.attempt !== last.attempt) throw new Error("launcher_ledger_unreadable");
  if (event.event === "run_started") last.pid = typeof event.pid === "number" ? event.pid : null;
  else if (event.event === "signal_forwarded") last.signalled = true;
  else if (event.event === "run_exited") {
    last.exit = { code: typeof event.exitCode === "number" ? event.exitCode : null, signal: typeof event.signal === "string" ? event.signal : null,
      failure: typeof event.failure === "string" ? event.failure : null };
    last.signalled = last.signalled || event.signalled === true;
  } else if (event.event === "run_lost") last.lost = true;
  else if (event.event === "run_deferred") { last.decided = true; state.notBefore = typeof event.notBefore === "string" ? Date.parse(event.notBefore) : null; }
  else if (event.event === "run_finished") { last.decided = true; state.finished = typeof event.outcome === "string" ? event.outcome : "run_finished"; }
}

function replayLedger(text: string): History {
  const history: History = { queueSha256: null, runs: new Map() };
  for (const line of text.split("\n")) {
    if (!line) continue;
    let event: unknown;
    try { event = JSON.parse(line); } catch { throw new Error("launcher_ledger_unreadable"); }
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("launcher_ledger_unreadable");
    applyEvent(history, event as Record<string, unknown>);
  }
  return history;
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** The launcher's run (decisions (2) to (9)): refusals first, then one admission at a time until the queue, the windows or the cap end it. */
export async function runLauncher(input: LauncherInput, deps: LauncherDependencies, signals: LauncherSignals): Promise<LauncherOutcome> {
  const refusal = (code: string): LauncherOutcome => ({ state: "refused", code, finished: 0, deferred: 0, pending: 0, spentMicrousd: null });
  // Decision (4): a clean tree on a commit that is on main, a valid queue and the state directory's lock, before anything is written.
  const git = deps.gitState();
  if (!git) return refusal("commit_unknown");
  if (git.dirty) return refusal("tree_dirty");
  const onMain = deps.headOnMain(git.commit);
  if (onMain === null) return refusal("main_unknown");
  if (!onMain) return refusal("head_not_on_main");
  let queue: LauncherQueue;
  try { queue = parseQueue(readFileSync(input.queuePath), deps.root); } catch { return refusal("queue_invalid"); }
  mkdirSync(join(input.stateDirectory, "runs"), { recursive: true, mode: 0o700 });
  let lock: { release(): void };
  try { lock = deps.lock(input.stateDirectory); } catch { return refusal("launcher_locked"); }
  const ledgerPath = join(input.stateDirectory, "launcher.jsonl"), stopPath = join(input.stateDirectory, "STOP");
  const stop = new AbortController();
  let stopSignal: ForwardedSignal | null = null;
  interface Running { run: QueueRun; attempt: number; child: LauncherChild; signalled: boolean; stopRequested: ReturnType<typeof deferred>; escalate: ReturnType<typeof deferred> }
  let current: Running | null = null;
  let inhibitor: { kind: string; stop(): void } | null = null;
  let history: History = { queueSha256: null, runs: new Map() };
  const log = (event: Record<string, unknown>) => {
    const entry = { ...event, at: new Date(deps.now()).toISOString() };
    appendFileSync(ledgerPath, `${canonical(entry)}\n`, { mode: 0o600 });
    applyEvent(history, entry);
  };
  const forward = (running: Running, signal: ForwardedSignal) => {
    running.signalled = true;
    log({ event: "signal_forwarded", run: running.run.id, attempt: running.attempt, signal });
    running.child.signal(signal); running.stopRequested.resolve();
  };
  // Decision (5): the first signal is forwarded to the child's group and stops new starts; a second sends SIGKILL at once.
  const unsubscribe = signals.subscribe(signal => {
    if (stopSignal === null) { stopSignal = signal; stop.abort(); if (current) forward(current, signal); }
    else current?.escalate.resolve();
  });
  const windowAt = (at: number) => queue.windows.find(window => window.start <= at && at < window.end) ?? null;
  const exposureOf = (run: QueueRun) => directoryExposure(run.directory, run.kind);
  const spentNow = (): number | null => { try { return queue.runs.reduce((sum, run) => sum + exposureOf(run), 0); } catch { return null; } };
  const outcome = (state: LauncherOutcome["state"], code: string): LauncherOutcome => {
    const states = queue.runs.map(run => history.runs.get(run.id));
    return { state, code, finished: states.filter(state => state?.finished).length, deferred: states.filter(state => !state?.finished && state?.notBefore != null).length,
      pending: states.filter(state => !state?.finished && state?.notBefore == null).length, spentMicrousd: spentNow() };
  };
  const stopped = (code: string, state: LauncherOutcome["state"] = "stopped") => { log({ event: "launcher_stopped", code }); return outcome(state, code); };
  const refuseLogged = (code: string) => { log({ event: "refused", code }); return outcome("refused", code); };
  /** Decision (6): what an exited, killed or lost attempt leaves: a finished run, or a loop deferred to a later window. */
  const decide = (run: QueueRun, attempt: AttemptState) => {
    const finish = (result: string) => log({ event: "run_finished", run: run.id, attempt: attempt.attempt, outcome: CODE.test(result) ? result : "run_finished" });
    if (run.kind === "run") {
      if (attempt.exit?.code === 0) return finish("submitted");
      let result: Record<string, unknown> | null = null;
      try { result = readRunResult(run.directory); } catch { result = null; }
      if (result) return finish(result.status === "submitted" ? "submitted" : String(result.reason));
      return finish(attempt.exit?.failure ?? (attempt.lost ? "run_lost" : "run_failed"));
    }
    let view: LoopView | null;
    try { view = readLoopView(run.directory); } catch { return finish("loop_record_unreadable"); }
    if (view?.stopped) return finish(view.stopped);
    if (view?.final) return finish(view.final);
    const fresh = view !== null && view.finishedAt !== attempt.priorFinishedAt;
    const resumable = fresh ? view!.failure !== null && RESUMABLE_LOOP_FAILURES.includes(view!.failure)
      // A loop killed before it could save, or lost with the launcher, resumes like an interrupted one; a locked or terminal one never.
      : (attempt.lost || attempt.signalled) && attempt.exit?.failure !== "loop_locked" && attempt.exit?.failure !== "loop_terminal";
    if (!resumable) return finish(attempt.exit?.failure ?? (fresh ? view!.failure : null) ?? "loop_failed");
    if (attempt.attempt > MAX_LOOP_REINVOCATIONS) return finish("reinvoke_limit");
    // A later window than the one the loop stopped in: for a loop lost with the launcher, the one it was admitted in.
    const stoppedAt = attempt.lost ? attempt.admittedAt : deps.now();
    log({ event: "run_deferred", run: run.id, attempt: attempt.attempt, notBefore: new Date(windowAt(stoppedAt)?.end ?? stoppedAt).toISOString() });
  };
  /** Decision (3): 3 observations IDLE_SPACING_MS apart, all with no running and no waiting request. */
  const idleCheck = async (): Promise<"idle" | "busy" | "unavailable"> => {
    for (let index = 0; index < IDLE_OBSERVATIONS; index++) {
      if (index > 0) await deps.sleep(IDLE_SPACING_MS, stop.signal);
      if (stopSignal) return "busy";
      const metrics = await deps.readMetrics();
      if (!metrics) return "unavailable";
      if (metrics.running !== 0 || metrics.waiting !== 0) return "busy";
    }
    return "idle";
  };
  const waitUntil = async (target: number) => {
    while (deps.now() < target && !stopSignal && !existsSync(stopPath)) await deps.sleep(Math.min(WAIT_POLL_MS, target - deps.now()), stop.signal);
  };
  /** The earliest later time at which some unfinished run could start inside a window, or null when no window is left. */
  const nextChance = (now: number): number | null => {
    let best: number | null = null;
    for (const run of queue.runs) {
      const state = history.runs.get(run.id);
      if (state?.finished) continue;
      const from = Math.max(now, state?.notBefore ?? now);
      for (const window of queue.windows) {
        const start = Math.max(window.start, from);
        if (window.end <= from || start <= now || (run.projectedMs !== null && window.end - start < run.projectedMs)) continue;
        if (best === null || start < best) best = start;
        break;
      }
    }
    return best;
  };
  /** Decision (5): the run's exit; after a forwarded signal, SIGKILL once TERM_WAIT_MS passes or a second signal comes; null when no reap follows. */
  const waitForExit = async (running: Running): Promise<ChildExit | null> => {
    const first = await Promise.race([running.child.exited, running.stopRequested.promise.then(() => "stop_requested" as const)]);
    if (first !== "stop_requested") return first;
    const grace = new AbortController();
    const second = await Promise.race([running.child.exited, deps.sleep(TERM_WAIT_MS, grace.signal).then(() => "timed_out" as const), running.escalate.promise.then(() => "timed_out" as const)]);
    grace.abort();
    if (second !== "timed_out") return second;
    log({ event: "kill_sent", run: running.run.id, attempt: running.attempt });
    running.child.signal("SIGKILL");
    const reap = new AbortController();
    const third = await Promise.race([running.child.exited, deps.sleep(REAP_WAIT_MS, reap.signal).then(() => "timed_out" as const)]);
    reap.abort();
    return third === "timed_out" ? null : third;
  };

  try {
    try { history = replayLedger(existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : ""); } catch { return refusal("ledger_unreadable"); }
    if (history.queueSha256 !== null && history.queueSha256 !== queue.sha256) return refuseLogged("queue_changed");
    // Decision (8): an admission the ledger never closed is a run still going (refuse) or one lost with the launcher (decide it now).
    for (const run of queue.runs) {
      const last = history.runs.get(run.id)?.last;
      if (!last || last.decided) continue;
      if (!last.exit && !last.lost) {
        if (last.pid !== null && deps.pidAlive(last.pid)) return refuseLogged("previous_run_running");
        log({ event: "run_lost", run: run.id, attempt: last.attempt });
      }
      decide(run, history.runs.get(run.id)!.last!);
    }
    inhibitor = await deps.startInhibitor();
    if (!inhibitor) return refuseLogged("inhibitor_failed");
    log({ event: "launcher_started", version: LAUNCHER_LEDGER_VERSION, launcherSha256: deps.launcherSha256(), commit: git.commit, queueSha256: queue.sha256,
      batch: queue.batch, batchCapMicrousd: queue.batchCapMicrousd, inhibitor: inhibitor.kind });
    let lastIdle: string | null = null, tooShort: string | null = null;
    for (;;) {
      if (stopSignal) return stopped("signal");
      if (existsSync(stopPath)) return stopped("stop_file");
      if (queue.runs.every(run => history.runs.get(run.id)?.finished)) return stopped("queue_done", "done");
      const now = deps.now(), window = windowAt(now);
      const next = queue.runs.find(run => { const state = history.runs.get(run.id); return !state?.finished && (state?.notBefore ?? -Infinity) <= now; }) ?? null;
      const fits = next !== null && window !== null && (next.projectedMs === null || window.end - now >= next.projectedMs);
      if (!fits) {
        if (next && window && tooShort !== `${next.id}@${window.start}`) { tooShort = `${next.id}@${window.start}`; log({ event: "window_too_short", run: next.id }); }
        const target = nextChance(now);
        if (target === null) return stopped("windows_exhausted");
        await waitUntil(target);
        continue;
      }
      // Decision (3): the batch's spend so far plus this run's cap (for a loop invoked again, what is left of its cap) must fit the batch cap.
      const spent = spentNow();
      if (spent === null) return stopped("batch_cap_unreadable");
      const prior = history.runs.get(next.id);
      let nextMicrousd = next.capMicrousd;
      if (prior && prior.attempts > 0) { try { nextMicrousd = Math.max(0, next.capMicrousd - exposureOf(next)); } catch { return stopped("batch_cap_unreadable"); } }
      if (spent + nextMicrousd > queue.batchCapMicrousd) { log({ event: "batch_cap_reached", spentMicrousd: spent, nextMicrousd }); return stopped("batch_cap_reached"); }
      const idle = await idleCheck();
      if (stopSignal) continue;
      if (idle !== lastIdle) { lastIdle = idle; log({ event: "idle_check", result: idle }); }
      if (idle !== "idle") { await deps.sleep(IDLE_RETRY_MS, stop.signal); continue; }
      // The idle check took IDLE_SPACING_MS twice: the signals, the STOP file and the window are read again before the admission.
      const at = deps.now(), still = windowAt(at);
      if (stopSignal || existsSync(stopPath) || !still || (next.projectedMs !== null && still.end - at < next.projectedMs)) continue;
      const attempt = (prior?.attempts ?? 0) + 1;
      let priorFinishedAt: string | null = null;
      if (next.kind === "loop") { try { priorFinishedAt = readLoopView(next.directory)?.finishedAt ?? null; } catch { priorFinishedAt = null; } }
      log({ event: "run_admitted", run: next.id, attempt, kind: next.kind, capMicrousd: nextMicrousd, spentMicrousd: spent, priorFinishedAt });
      const files = { out: join(input.stateDirectory, "runs", `${next.id}.${attempt}.out`), err: join(input.stateDirectory, "runs", `${next.id}.${attempt}.err`) };
      let child: LauncherChild;
      try { child = deps.spawnRun(next, files); }
      catch {
        log({ event: "run_exited", run: next.id, attempt, exitCode: null, signal: null, failure: "spawn_failed", signalled: false, jobId: null });
        decide(next, history.runs.get(next.id)!.last!);
        continue;
      }
      log({ event: "run_started", run: next.id, attempt, pid: child.pid });
      const running: Running = { run: next, attempt, child, signalled: false, stopRequested: deferred(), escalate: deferred() };
      current = running;
      const exit = await waitForExit(running);
      current = null;
      if (!exit) { log({ event: "reap_unconfirmed", run: next.id, attempt }); return stopped("reap_unconfirmed"); }
      log({ event: "run_exited", run: next.id, attempt, exitCode: exit.code, signal: exit.signal, failure: readFailureLine(files.err), signalled: running.signalled,
        jobId: next.kind === "run" ? readRunJobId(next.directory) : null });
      decide(next, history.runs.get(next.id)!.last!);
      // Decision (5): quiescence after each run is recorded; the next start's own idle check is what gates it.
      if (!stopSignal) { const quiet = await idleCheck(); if (!stopSignal) log({ event: "quiescence", result: quiet }); }
    }
  } finally {
    unsubscribe();
    inhibitor?.stop();
    lock.release();
  }
}

/** The production dependencies: real git, the loop's lock, caffeinate on macOS, the endpoint's /metrics, and children in their own process groups. */
export function productionLauncherDependencies(root = LAUNCHER_ROOT): LauncherDependencies {
  const config = (() => { try { return loadConfig(); } catch { throw new Error("launcher_config_invalid"); } })();
  const origin = (() => { try { return new URL(config.vllm.baseUrl).origin; } catch { throw new Error("launcher_config_invalid"); } })();
  const headers: Record<string, string> = config.vllm.sensitiveApiKey ? { Authorization: `Bearer ${config.vllm.sensitiveApiKey}` } : {};
  const git = localScreenGitRunner(root);
  return {
    root,
    now: () => Date.now(),
    sleep: (ms, cancel) => new Promise<void>(done => {
      if (cancel.aborted) { done(); return; }
      const timer = setTimeout(() => { cancel.removeEventListener("abort", onAbort); done(); }, ms);
      const onAbort = () => { clearTimeout(timer); done(); };
      cancel.addEventListener("abort", onAbort, { once: true });
    }),
    gitState: () => realpathSync(process.cwd()) === realpathSync(root) ? localScreenGitState(localScreenSourceFreeze().files) : null,
    headOnMain: commit => {
      try { git(["merge-base", "--is-ancestor", commit, "refs/remotes/origin/main"]); return true; }
      catch (error) { return (error as { status?: unknown }).status === 1 ? false : null; }
    },
    lock: directory => acquireLoopLock(directory),
    startInhibitor: () => process.platform !== "darwin" ? Promise.resolve({ kind: "none", stop() { /* no inhibitor off macOS */ } })
      : new Promise(done => {
        const inhibitor = spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
        inhibitor.once("spawn", () => done({ kind: "caffeinate", stop() { try { inhibitor.kill("SIGTERM"); } catch { /* it exits with the launcher */ } } }));
        inhibitor.once("error", () => done(null));
      }),
    readMetrics: async () => {
      try {
        const response = await fetch(`${origin}/metrics`, { headers, signal: AbortSignal.timeout(10_000), redirect: "error" });
        return response.status === 200 ? parseMetrics(await response.text()) : null;
      } catch { return null; }
    },
    spawnRun: (run, files) => {
      const out = openSync(files.out, "a", 0o600), err = openSync(files.err, "a", 0o600);
      try {
        const child = spawn(process.execPath, ["--import", "tsx", LAUNCHER_SCRIPTS[run.kind], ...run.argv], { cwd: root, detached: true, stdio: ["ignore", out, err] });
        const exited = new Promise<ChildExit>(done => {
          child.once("exit", (code, signal) => done({ code, signal }));
          child.once("error", () => done({ code: null, signal: null }));
        });
        if (child.pid === undefined) throw new Error("launcher_spawn_failed");
        const pid = child.pid;
        return { pid, exited, signal: signal => { try { process.kill(-pid, signal); } catch { /* the group is gone */ } } };
      } finally { closeSync(out); closeSync(err); }
    },
    pidAlive: pid => { try { process.kill(pid, 0); return true; } catch (error) { return (error as { code?: unknown }).code === "EPERM"; } },
    launcherSha256: () => digest(readFileSync(fileURLToPath(import.meta.url))),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const listeners = new Set<(signal: ForwardedSignal) => void>();
  const signals: LauncherSignals = { subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(name, () => { for (const listener of listeners) listener(name); });
  try {
    const input = parseLauncherArguments(process.argv.slice(2));
    const result = await runLauncher(input, productionLauncherDependencies(), signals);
    process.stdout.write(`${canonical(result)}\n`);
    process.exitCode = result.state === "done" ? 0 : result.state === "refused" ? 1 : 2;
  } catch (error) {
    process.stderr.write(`${canonical({ state: "failed", code: error instanceof Error && CODE.test(error.message) ? error.message : "launcher_failed" })}\n`);
    process.exitCode = 1;
  }
  // Once the launcher is done, a signal ends it as usual.
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.removeAllListeners(name);
}
