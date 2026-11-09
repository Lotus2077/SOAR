import { describe, expect, it } from "vitest";
import { ORDERED_POOL_MAX_LIMIT, runOrderedPool, type PoolOutcome } from "../../src/main/private-agent/ordered-pool";

/** A call the test settles by hand: `resolve`/`reject` it, read the signal it was launched with. */
interface Deferred { index: number; signal: AbortSignal; resolve: (value: string) => void; reject: (error: unknown) => void }
function harness(count: number) {
  const calls: Deferred[] = [], events: string[] = [];
  let live = 0, peak = 0;
  const launch = (_item: number, index: number, signal: AbortSignal) => new Promise<string>((resolve, reject) => {
    live++; peak = Math.max(peak, live); events.push(`launch ${index}`);
    const settle = () => { live--; };
    calls.push({ index, signal, resolve: value => { settle(); resolve(value); }, reject: error => { settle(); reject(error); } });
  });
  return { items: Array.from({ length: count }, (_, i) => i), calls, events, launch, peak: () => peak, call: (index: number) => calls.find(call => call.index === index)! };
}
/** Lets every pending promise reaction run, so the pool reaches its next await. */
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

describe("the ordered pool (backlog item 8)", () => {
  it("keeps at most K launched and not yet applied, and applies strictly in item order when calls finish in reverse", async () => {
    const h = harness(7), applied: number[] = [];
    let unapplied = 0, unappliedPeak = 0;
    const run = runOrderedPool({ items: h.items, limit: 3, signal: new AbortController().signal,
      launch: (item, index, signal) => { unapplied++; unappliedPeak = Math.max(unappliedPeak, unapplied); return h.launch(item, index, signal); },
      apply: (outcome, _item, index) => { unapplied--; applied.push(index); expect(outcome).toEqual({ status: "fulfilled", value: `reply ${index}` }); } });
    // Finish every launched call newest first; the pool still applies 0, 1, 2, ... and refills only after each apply.
    for (let round = 0; round < 7; round++) {
      await tick();
      const pending = h.calls.filter(call => !(call as { done?: boolean }).done).sort((a, b) => b.index - a.index);
      for (const call of pending) { (call as { done?: boolean }).done = true; call.resolve(`reply ${call.index}`); await tick(); }
    }
    expect(await run).toEqual({ launched: 7, applied: 7, stopped: false, aborted: false });
    expect(applied).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(h.peak()).toBeLessThanOrEqual(3);
    expect(unappliedPeak).toBeLessThanOrEqual(3);
  });

  it("reproduces the serial loop at K = 1: launch, settle, apply, then the next launch", async () => {
    const events: string[] = [];
    const result = await runOrderedPool({ items: ["a", "b", "c"], limit: 1, signal: new AbortController().signal,
      launch: async (item, index) => { events.push(`launch ${index}`); await tick(); events.push(`settle ${index}`); return item.toUpperCase(); },
      apply: (outcome, _item, index) => { events.push(`apply ${index} ${(outcome as { value: string }).value}`); } });
    expect(events).toEqual(["launch 0", "settle 0", "apply 0 A", "launch 1", "settle 1", "apply 1 B", "launch 2", "settle 2", "apply 2 C"]);
    expect(result).toEqual({ launched: 3, applied: 3, stopped: false, aborted: false });
  });

  it("on a denial stops launching, aborts and drains the siblings, applies every outcome in order, and marks the sibling stops", async () => {
    const h = harness(8), seen: { index: number; outcome: PoolOutcome<string>; afterAbort: boolean }[] = [];
    const denied = (outcome: PoolOutcome<string>) => outcome.status === "fulfilled" && outcome.value.startsWith("denied");
    const run = runOrderedPool({ items: h.items, limit: 4, signal: new AbortController().signal, launch: h.launch,
      interrupt: outcome => denied(outcome),
      apply: (outcome, _item, index, context) => { seen.push({ index, outcome, afterAbort: context.afterAbort }); return denied(outcome) && !context.afterAbort ? "abort" : "continue"; } });
    await tick();
    expect(h.calls.map(call => call.index)).toEqual([0, 1, 2, 3]);
    // 3 settles first, then 2 is denied while 0 and 1 are still in flight: the pool aborts them at once, before 2's turn.
    h.call(3).resolve("reply 3"); await tick();
    h.call(2).resolve("denied budget_denied"); await tick();
    expect(h.call(0).signal.aborted && h.call(1).signal.aborted).toBe(true);
    expect(h.call(3).signal.aborted).toBe(false);
    // The aborted siblings answer as the pipeline's call() would after its signal aborted.
    h.call(1).resolve("denied cancelled"); await tick();
    h.call(0).resolve("reply 0"); await tick();
    const result = await run;
    expect(result).toEqual({ launched: 4, applied: 4, stopped: true, aborted: true });
    expect(seen.map(row => [row.index, row.afterAbort])).toEqual([[0, true], [1, true], [2, false], [3, false]]);
    // The lowest-index genuine denial is the first denial applied without afterAbort: 2, never the aborted sibling 1.
    expect(seen.find(row => denied(row.outcome) && !row.afterAbort)?.index).toBe(2);
    // Item 0 settled after the abort but did settle: the caller still applies it, so the stage counts every settled row.
    expect(seen[0]!.outcome).toEqual({ status: "fulfilled", value: "reply 0" });
  });

  it("drains every in-flight call before rethrowing a throw from apply", async () => {
    const h = harness(4);
    const run = runOrderedPool({ items: h.items, limit: 3, signal: new AbortController().signal, launch: h.launch,
      apply: (_outcome, _item, index) => { if (index === 0) throw new Error("apply_bug"); } });
    const observed = run.then(() => "resolved", (error: Error) => error.message);
    await tick();
    h.call(0).resolve("reply 0"); await tick();
    expect(h.call(1).signal.aborted && h.call(2).signal.aborted).toBe(true);
    // Still pending: the pool waits for 1 and 2 although apply already threw.
    let early = "pending"; void observed.then(value => { early = value; }); await tick();
    expect(early).toBe("pending");
    h.call(1).resolve("reply 1"); h.call(2).reject(new Error("aborted")); await tick();
    expect(await observed).toBe("apply_bug");
    expect(h.calls).toHaveLength(3);
  });

  it("serves the judge: a failure stops launching but lets in-flight calls finish and keeps their results", async () => {
    const h = harness(6), applied: [number, string][] = [];
    let paused = false;
    const run = runOrderedPool({ items: h.items, limit: 3, signal: new AbortController().signal, launch: h.launch, beforeLaunch: () => !paused,
      apply: (outcome, _item, index) => { applied.push([index, outcome.status]); return outcome.status === "rejected" ? "stop" : "continue"; } });
    await tick();
    h.call(0).reject(new Error("judge_request_failed")); await tick();
    // No abort: the siblings keep running and their verdicts arrive; nothing new is launched.
    expect(h.call(1).signal.aborted || h.call(2).signal.aborted).toBe(false);
    h.call(2).resolve("verdict 2"); h.call(1).resolve("verdict 1"); await tick();
    expect(await run).toEqual({ launched: 3, applied: 3, stopped: true, aborted: false });
    expect(applied).toEqual([[0, "rejected"], [1, "fulfilled"], [2, "fulfilled"]]);
    // A pause checked before each launch stops the pool at the next free slot.
    const p = harness(5);
    const paused2 = runOrderedPool({ items: p.items, limit: 2, signal: new AbortController().signal, launch: p.launch, beforeLaunch: (_item, index) => { if (index === 3) paused = true; return !paused; },
      apply: () => "continue" });
    paused = false; await tick();
    for (let i = 0; i < 3; i++) { p.call(i).resolve(`v${i}`); await tick(); }
    expect(await paused2).toEqual({ launched: 3, applied: 3, stopped: true, aborted: false });
  });

  it("passes the stage's own abort to every launch without marking it a sibling stop", async () => {
    const h = harness(3), stage = new AbortController(), flags: boolean[] = [];
    const run = runOrderedPool({ items: h.items, limit: 3, signal: stage.signal, launch: h.launch, apply: (_o, _i, _x, context) => { flags.push(context.afterAbort); } });
    await tick();
    stage.abort();
    expect(h.calls.every(call => call.signal.aborted)).toBe(true);
    for (const call of h.calls) call.resolve("denied cancelled");
    expect(await run).toEqual({ launched: 3, applied: 3, stopped: false, aborted: false });
    expect(flags).toEqual([false, false, false]);
  });

  it("applies a launch that throws synchronously as a rejected outcome, in its turn", async () => {
    const order: string[] = [];
    await runOrderedPool({ items: [0, 1, 2], limit: 2, signal: new AbortController().signal,
      launch: async (_item, index) => { if (index === 1) throw new Error("sync_failure"); return `v${index}`; },
      apply: (outcome, _item, index) => { order.push(`${index}:${outcome.status}`); } });
    const syncThrow = await runOrderedPool<number, string>({ items: [0], limit: 1, signal: new AbortController().signal, launch: () => { throw new Error("before_promise"); },
      apply: outcome => { order.push(`sync:${outcome.status}:${(outcome as { error: Error }).error.message}`); } });
    expect(order).toEqual(["0:fulfilled", "1:rejected", "2:fulfilled", "sync:rejected:before_promise"]);
    expect(syncThrow).toEqual({ launched: 1, applied: 1, stopped: false, aborted: false });
  });

  it("refuses a K outside 1 to 8, returns at once with no items, and adds one listener per in-flight call at K = 8", async () => {
    for (const limit of [0, 9, 1.5, Number.NaN]) await expect(runOrderedPool({ items: [1], limit, signal: new AbortController().signal, launch: async () => 1, apply: () => {} })).rejects.toThrow("ordered_pool_limit_invalid");
    expect(ORDERED_POOL_MAX_LIMIT).toBe(8);
    expect(await runOrderedPool({ items: [], limit: 3, signal: new AbortController().signal, launch: async () => 1, apply: () => {} })).toEqual({ launched: 0, applied: 0, stopped: false, aborted: false });
    // Each call adds three listeners to its own signal, as the broker, token admission and a backoff would: no warning at K = 8.
    const warnings: Error[] = [], onWarning = (warning: Error) => { warnings.push(warning); };
    process.on("warning", onWarning);
    try {
      const h = harness(16);
      const run = runOrderedPool({ items: h.items, limit: 8, signal: new AbortController().signal,
        launch: (item, index, signal) => { for (let i = 0; i < 3; i++) signal.addEventListener("abort", () => {}); return h.launch(item, index, signal); }, apply: () => {} });
      for (let i = 0; i < 16; i++) { await tick(); h.call(i).resolve(`v${i}`); }
      await run; await tick();
    } finally { process.off("warning", onWarning); }
    expect(warnings.filter(warning => warning.name === "MaxListenersExceededWarning")).toEqual([]);
  });
});
