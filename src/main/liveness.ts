/**
 * PR-B liveness helpers shared by the desktop shell and the task controller: the quit policy, the local stream
 * settings, and a lateness check for a periodic heartbeat (a late tick means the machine slept or the process was starved).
 */
export const QUIT_CLOSE_BOUND_MS = 20_000;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_LATE_THRESHOLD_MS = 5_000;
export const STREAM_INACTIVITY_TIMEOUT_MS = 120_000;
/**
 * Raw SSE bytes allowed per output token. The owned server measured 64-70 bytes per token (about 230 bytes per event,
 * several tokens per event); 512 covers one token per event with room, and discarded reasoning counts against it.
 */
export const STREAM_BYTES_PER_TOKEN_BOUND = 512;
/** The streaming settings of a local model destination: the inactivity clock and the raw stream cap for its token limit. */
export function localStreamSettings(timeoutMs: number, maxResponseBytes: number, maxOutputTokens: number): { inactivityTimeoutMs: number; maxRawBytes: number } {
  return { inactivityTimeoutMs: Math.min(STREAM_INACTIVITY_TIMEOUT_MS, timeoutMs), maxRawBytes: maxResponseBytes + maxOutputTokens * STREAM_BYTES_PER_TOKEN_BOUND };
}

export type QuitOutcome = "closed" | "timed_out" | "owner_quit";
/**
 * Runs a quit: `quit` fires exactly once. An idle app quits after `close` settles or QUIT_CLOSE_BOUND_MS passes. A
 * busy one (a task running or cleaning up) has no time bound: a pause takes effect only at the runner's next action
 * boundary, after the in-flight reply (with its retries) and the action it selected, and any fixed cut before that
 * would leave an unknown operation and a task that cannot resume. `askQuitNow` offers the owner an immediate quit
 * instead (the running step is then interrupted and the task cannot resume); `ask` re-offers it, for example on a
 * second quit request. The offer's signal aborts when the quit happens, so an open offer closes by itself.
 */
export function startQuit(input: { close: () => Promise<unknown>; busy: boolean; quit: () => void; askQuitNow?: (signal: AbortSignal) => Promise<boolean> }): { outcome: Promise<QuitOutcome>; ask: () => void } {
  const offer = new AbortController();
  let done = false, asking = false, settle: (outcome: QuitOutcome) => void = () => {};
  const outcome = new Promise<QuitOutcome>(resolve => { settle = resolve; });
  const finish = (result: QuitOutcome) => {
    if (done) return;
    done = true; offer.abort();
    try { input.quit(); } finally { settle(result); }
  };
  const ask = () => {
    if (done || asking || !input.busy || !input.askQuitNow) return;
    asking = true;
    input.askQuitNow(offer.signal).then(now => { asking = false; if (now) finish("owner_quit"); }, () => { asking = false; });
  };
  const closing: Promise<QuitOutcome> = input.busy ? input.close().then(() => "closed", () => "closed") : boundedClose(input.close, QUIT_CLOSE_BOUND_MS);
  void closing.then(finish);
  ask();
  return { outcome, ask };
}

/** Waits for `close` at most `boundMs`; resolves either way so a quit can never hang on a task. */
export function boundedClose(close: () => Promise<unknown>, boundMs = QUIT_CLOSE_BOUND_MS): Promise<"closed" | "timed_out"> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve("timed_out"), boundMs);
    close().then(() => "closed" as const, () => "closed" as const).then(outcome => { clearTimeout(timer); resolve(outcome); });
  });
}

/** How late a tick fired against its schedule, on both clocks; `null` when within the threshold. */
export function heartbeatLateness(expectedWallMs: number, expectedMonotonicMs: number, nowWallMs: number, nowMonotonicMs: number, thresholdMs = HEARTBEAT_LATE_THRESHOLD_MS): { wallLateMs: number; monotonicLateMs: number } | null {
  const wallLateMs = Math.max(0, Math.round(nowWallMs - expectedWallMs)), monotonicLateMs = Math.max(0, Math.round(nowMonotonicMs - expectedMonotonicMs));
  return wallLateMs >= thresholdMs || monotonicLateMs >= thresholdMs ? { wallLateMs, monotonicLateMs } : null;
}
