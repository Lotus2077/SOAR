import { afterEach, describe, expect, it, vi } from "vitest";
import { QUIT_CLOSE_BOUND_MS, boundedClose, heartbeatLateness, quitOffer, startQuit } from "../../src/main/liveness";

afterEach(() => { vi.useRealTimers(); });

describe("liveness helpers (PR-B)", () => {
  it("bounds a close that hangs and reports a close that finishes, even when it rejects", async () => {
    expect(await boundedClose(() => new Promise(() => {}), 30)).toBe("timed_out");
    expect(await boundedClose(async () => {}, 30)).toBe("closed");
    expect(await boundedClose(async () => { throw new Error("synthetic"); }, 30)).toBe("closed");
  });
  it("reports a late heartbeat on either clock above the threshold and nothing within it", () => {
    expect(heartbeatLateness(1000, 1000, 1000, 1000)).toBeNull();
    expect(heartbeatLateness(1000, 1000, 5999, 5999)).toBeNull();
    expect(heartbeatLateness(1000, 1000, 9000, 1200)).toEqual({ wallLateMs: 8000, monotonicLateMs: 200 });
    expect(heartbeatLateness(1000, 1000, 900, 7000)).toEqual({ wallLateMs: 0, monotonicLateMs: 6000 });
  });
  it("quits once after an idle close without asking the owner", async () => {
    const quit = vi.fn(), ask = vi.fn(async () => true);
    const run = startQuit({ close: async () => {}, busy: false, quit, askQuitNow: ask });
    expect(await run.outcome).toBe("closed"); run.ask();
    expect(quit).toHaveBeenCalledTimes(1); expect(ask).not.toHaveBeenCalled();
  });
  it("while busy, quits when the task pauses and closes the open offer, or at once when the owner chooses", async () => {
    let finishClose: () => void = () => {};
    const signals: AbortSignal[] = [];
    const quit = vi.fn();
    const waiting = startQuit({ close: () => new Promise<void>(resolve => { finishClose = resolve; }), busy: true, quit,
      askQuitNow: signal => { signals.push(signal); return new Promise<boolean>(resolve => signal.addEventListener("abort", () => resolve(false))); } });
    waiting.ask(); // an offer is already open: no second one
    expect(signals).toHaveLength(1); expect(quit).not.toHaveBeenCalled();
    finishClose();
    expect(await waiting.outcome).toBe("closed"); expect(signals[0]!.aborted).toBe(true); expect(quit).toHaveBeenCalledTimes(1);

    let answer: (now: boolean) => void = () => {};
    const ownerQuit = vi.fn(); let closeNow: () => void = () => {};
    const asked = vi.fn(() => new Promise<boolean>(resolve => { answer = resolve; }));
    const owner = startQuit({ close: () => new Promise<void>(resolve => { closeNow = resolve; }), busy: true, quit: ownerQuit, askQuitNow: asked });
    answer(false); await Promise.resolve(); await Promise.resolve();
    owner.ask(); expect(asked).toHaveBeenCalledTimes(2); // "Keep waiting", then a second quit request re-offers
    answer(true);
    expect(await owner.outcome).toBe("owner_quit");
    closeNow(); await Promise.resolve();
    expect(ownerQuit).toHaveBeenCalledTimes(1);
  });
  it("bounds an idle close, but never cuts a busy one: only the task's own pause or the owner ends the wait", async () => {
    vi.useFakeTimers();
    const idleQuit = vi.fn();
    const idle = startQuit({ close: () => new Promise(() => {}), busy: false, quit: idleQuit });
    await vi.advanceTimersByTimeAsync(QUIT_CLOSE_BOUND_MS);
    expect(await idle.outcome).toBe("timed_out"); expect(idleQuit).toHaveBeenCalledTimes(1);
    const busyQuit = vi.fn(); let paused: () => void = () => {};
    const busy = startQuit({ close: () => new Promise<void>(resolve => { paused = resolve; }), busy: true, quit: busyQuit });
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000); expect(busyQuit).not.toHaveBeenCalled();
    paused();
    expect(await busy.outcome).toBe("closed"); expect(busyQuit).toHaveBeenCalledTimes(1);
  });
});

describe("the quit offer's words (backlog item 13a)", () => {
  it("promises a resume only outside a research stage, which ends the task whether the owner waits or quits", () => {
    // The plain offer is main's dialog text, word for word; the research offer is pinned whole too (#168's review).
    expect(quitOffer(false)).toEqual({ message: "Waiting for the running task to pause",
      detail: "The task pauses after its current step (a model reply or a command can take several minutes) and can be resumed later. Quitting now interrupts that step, and the task will then have to be cancelled instead of resumed." });
    expect(quitOffer(true)).toEqual({ message: "Waiting for the research stage to stop",
      detail: "A research stage is in progress, and a research stage cannot pause and continue. When it stops, this task ends and cannot be resumed; create it again to retry. Quitting now stops it at once, with the same result." });
  });
});

